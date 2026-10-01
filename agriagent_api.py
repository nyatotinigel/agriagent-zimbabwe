import json
import os
import uuid
from pathlib import Path
from typing import Any

import psycopg
import httpx
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from psycopg.types.json import Jsonb

from agriagent_graph import APP_NAME, COMPANY_NAME, agriagent_graph, follow_up_graph

router = APIRouter()
LOCATIONS_PATH = Path(__file__).parent / "knowledge_base" / "zimbabwe_locations.json"
MAX_IMAGE_BYTES = 8 * 1024 * 1024


class FeedbackRequest(BaseModel):
    diagnosis_id: uuid.UUID
    farmer_id: str = Field(min_length=1, max_length=100)
    did_treatment_work: bool
    comment: str | None = Field(default=None, max_length=1000)


def _locations() -> dict[str, list[str]]:
    with LOCATIONS_PATH.open(encoding="utf-8") as locations_file:
        return json.load(locations_file)


def _database_url() -> str | None:
    return os.getenv("DATABASE_URL")


def _ensure_database_schema(connection: psycopg.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS farmers (
            farmer_id TEXT PRIMARY KEY,
            province TEXT NOT NULL,
            district TEXT NOT NULL,
            growth_point TEXT NOT NULL,
            village TEXT NOT NULL DEFAULT '',
            default_location JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS diagnoses (
            diagnosis_id UUID PRIMARY KEY,
            farmer_id TEXT NOT NULL REFERENCES farmers(farmer_id),
            image_ref TEXT NOT NULL,
            image_data BYTEA NOT NULL,
            predicted_class TEXT NOT NULL,
            confidence DOUBLE PRECISION NOT NULL,
            treatment_summary JSONB,
            location_snapshot JSONB NOT NULL,
            location_results JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    connection.execute(
        "ALTER TABLE diagnoses ADD COLUMN IF NOT EXISTS location_results JSONB NOT NULL DEFAULT '{}'::jsonb"
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS feedback (
            feedback_id UUID PRIMARY KEY,
            diagnosis_id UUID NOT NULL REFERENCES diagnoses(diagnosis_id),
            farmer_id TEXT NOT NULL REFERENCES farmers(farmer_id),
            did_treatment_work BOOLEAN NOT NULL,
            comment TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )


def _save_diagnosis(
    farmer_id: str,
    location: dict[str, str],
    image_bytes: bytes,
    filename: str,
    result: dict[str, Any],
) -> uuid.UUID:
    database_url = _database_url()
    if not database_url:
        raise RuntimeError("DATABASE_URL is not configured")

    diagnosis_id = uuid.uuid4()
    with psycopg.connect(database_url) as connection:
        _ensure_database_schema(connection)
        connection.execute(
            """
            INSERT INTO farmers (
                farmer_id, province, district, growth_point, village, default_location
            ) VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (farmer_id) DO UPDATE SET
                province = EXCLUDED.province,
                district = EXCLUDED.district,
                growth_point = EXCLUDED.growth_point,
                village = EXCLUDED.village,
                default_location = EXCLUDED.default_location,
                updated_at = NOW()
            """,
            (
                farmer_id,
                location["province"],
                location["district"],
                location["growth_point"],
                location.get("village", ""),
                Jsonb(location),
            ),
        )
        connection.execute(
            """
            INSERT INTO diagnoses (
                diagnosis_id, farmer_id, image_ref, image_data, predicted_class,
                confidence, treatment_summary, location_snapshot, location_results
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                diagnosis_id,
                farmer_id,
                f"postgres://diagnoses/{diagnosis_id}/{filename}",
                image_bytes,
                result["predicted_class"],
                result["confidence"],
                Jsonb(result.get("treatment", {})),
                Jsonb(location),
                Jsonb(result.get("location_results", {})),
            ),
        )
    return diagnosis_id


def _load_saved_diagnosis(diagnosis_id: uuid.UUID, farmer_id: str) -> dict[str, Any]:
    database_url = _database_url()
    if not database_url:
        raise HTTPException(status_code=503, detail="Saved diagnosis follow-up requires PostgreSQL.")

    with psycopg.connect(database_url) as connection:
        _ensure_database_schema(connection)
        row = connection.execute(
            """
            SELECT predicted_class, confidence, treatment_summary,
                   location_snapshot, location_results
            FROM diagnoses
            WHERE diagnosis_id = %s AND farmer_id = %s
            """,
            (diagnosis_id, farmer_id),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Saved diagnosis not found.")
    return {
        "predicted_class": row[0],
        "confidence": row[1],
        "treatment_entry": row[2] or {},
        "location": row[3] or {},
        "location_results": row[4] or {},
    }


def _validate_location(location: dict[str, str]) -> None:
    locations = _locations()
    province = location.get("province", "")
    district = location.get("district", "")
    if province not in locations or district not in locations[province]:
        raise HTTPException(status_code=422, detail="Select a valid Zimbabwe province and district.")
    if not location.get("growth_point", "").strip():
        raise HTTPException(status_code=422, detail="Enter a growth point or nearby town.")


def _save_updated_location(
    diagnosis_id: uuid.UUID,
    farmer_id: str,
    location: dict[str, str],
    location_results: dict[str, Any],
) -> None:
    database_url = _database_url()
    if not database_url:
        raise HTTPException(status_code=503, detail="Location updates require PostgreSQL.")

    with psycopg.connect(database_url) as connection:
        connection.execute(
            """
            UPDATE farmers SET province = %s, district = %s, growth_point = %s,
                village = %s, default_location = %s, updated_at = NOW()
            WHERE farmer_id = %s
            """,
            (
                location["province"],
                location["district"],
                location["growth_point"],
                location.get("village", ""),
                Jsonb(location),
                farmer_id,
            ),
        )
        cursor = connection.execute(
            """
            UPDATE diagnoses SET location_snapshot = %s, location_results = %s
            WHERE diagnosis_id = %s AND farmer_id = %s
            """,
            (Jsonb(location), Jsonb(location_results), diagnosis_id, farmer_id),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Saved diagnosis not found.")


@router.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "app": APP_NAME, "company": COMPANY_NAME}


@router.get("/api/locations")
def get_locations() -> dict[str, list[str]]:
    return _locations()


@router.post("/api/diagnose")
def diagnose(
    file: UploadFile = File(...),
    farmer_id: str = Form(..., min_length=1, max_length=100),
    province: str = Form(...),
    district: str = Form(...),
    growth_point: str = Form(..., min_length=1, max_length=120),
    village: str = Form(default="", max_length=120),
) -> dict[str, Any]:
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=415, detail="Upload a supported image file.")

    location_catalog = _locations()
    if province not in location_catalog:
        raise HTTPException(status_code=422, detail="Select a valid Zimbabwe province.")
    if district not in location_catalog[province]:
        raise HTTPException(status_code=422, detail="Select a district in that province.")

    image_bytes = file.file.read(MAX_IMAGE_BYTES + 1)
    if not image_bytes or len(image_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image must be smaller than 8 MB.")

    location = {
        "province": province,
        "district": district,
        "growth_point": growth_point.strip(),
        "village": village.strip(),
    }
    try:
        graph_result = agriagent_graph.invoke(
            {
                "image_bytes": image_bytes,
                "filename": file.filename or "tomato-leaf.jpg",
                "content_type": file.content_type,
                "farmer_id": farmer_id,
                "location": location,
            }
        )
    except (httpx.HTTPError, KeyError, ValueError) as error:
        raise HTTPException(
            status_code=502,
            detail="The tomato classifier is unavailable or returned an invalid result.",
        ) from error

    response: dict[str, Any] = {
        "app_name": APP_NAME,
        "company_name": COMPANY_NAME,
        "predicted_class": graph_result.get("predicted_class"),
        "confidence": graph_result.get("confidence"),
        "triage_status": graph_result.get("triage_status"),
        "treatment": graph_result.get("treatment_entry"),
        "location_results": graph_result.get("location_results", {}),
        "response_text": graph_result.get("response_text", "Please retake the photo."),
        "diagnosis_id": None,
        "persistence_status": "skipped_low_confidence",
    }

    if graph_result.get("triage_status") != "unrecognized":
        if not _database_url():
            response["persistence_status"] = "not_configured"
        else:
            try:
                diagnosis_id = _save_diagnosis(
                    farmer_id, location, image_bytes, file.filename or "leaf-image", response
                )
                response["diagnosis_id"] = str(diagnosis_id)
                response["persistence_status"] = "saved"
            except psycopg.Error:
                response["persistence_status"] = "failed"

    return response


@router.post("/api/follow-up")
def follow_up(
    farmer_id: str = Form(..., min_length=1, max_length=100),
    diagnosis_id: uuid.UUID = Form(...),
    message: str = Form(default="", max_length=1000),
    file: UploadFile | None = File(default=None),
    update_location: bool = Form(default=False),
    province: str | None = Form(default=None),
    district: str | None = Form(default=None),
    growth_point: str | None = Form(default=None, max_length=120),
    village: str | None = Form(default=None, max_length=120),
) -> dict[str, Any]:
    saved = _load_saved_diagnosis(diagnosis_id, farmer_id)
    updated_location = None
    if update_location:
        updated_location = {
            "province": province or "",
            "district": district or "",
            "growth_point": (growth_point or "").strip(),
            "village": (village or "").strip(),
        }
        _validate_location(updated_location)

    image_bytes = b""
    filename = "tomato-leaf.jpg"
    content_type = "image/jpeg"
    if file is not None:
        if not file.content_type or not file.content_type.startswith("image/"):
            raise HTTPException(status_code=415, detail="Upload a supported image file.")
        image_bytes = file.file.read(MAX_IMAGE_BYTES + 1)
        if not image_bytes or len(image_bytes) > MAX_IMAGE_BYTES:
            raise HTTPException(status_code=413, detail="Image must be smaller than 8 MB.")
        filename = file.filename or filename
        content_type = file.content_type

    graph_state = {
        **saved,
        "farmer_id": farmer_id,
        "follow_up_message": message,
        "image_bytes": image_bytes,
        "filename": filename,
        "content_type": content_type,
        "updated_location": updated_location or {},
        "location": updated_location or saved["location"],
    }
    graph_result = follow_up_graph.invoke(graph_state)
    response: dict[str, Any] = {
        "diagnosis_id": str(diagnosis_id),
        "follow_up_intent": graph_result["follow_up_intent"],
        "response_text": graph_result.get("response_text", "Please retake the photo."),
    }

    if graph_result["follow_up_intent"] == "updated_location":
        _save_updated_location(
            diagnosis_id,
            farmer_id,
            updated_location or {},
            graph_result.get("location_results", {}),
        )
        response["location_results"] = graph_result.get("location_results", {})
    elif graph_result["follow_up_intent"] == "new_photo":
        response["diagnosis_id"] = None
        response.update(
            {
                "predicted_class": graph_result.get("predicted_class"),
                "confidence": graph_result.get("confidence"),
                "triage_status": graph_result.get("triage_status"),
                "treatment": graph_result.get("treatment_entry"),
                "location_results": graph_result.get("location_results", {}),
            }
        )
        if graph_result.get("triage_status") != "unrecognized":
            new_diagnosis_id = _save_diagnosis(
                farmer_id, saved["location"], image_bytes, filename, response
            )
            response["diagnosis_id"] = str(new_diagnosis_id)

    return response


@router.post("/api/feedback")
def save_feedback(feedback: FeedbackRequest) -> dict[str, str]:
    database_url = _database_url()
    if not database_url:
        raise HTTPException(status_code=503, detail="Feedback storage is not configured.")
    try:
        with psycopg.connect(database_url) as connection:
            _ensure_database_schema(connection)
            cursor = connection.execute(
                """
                INSERT INTO feedback (
                    feedback_id, diagnosis_id, farmer_id, did_treatment_work, comment
                )
                SELECT %s, diagnosis_id, farmer_id, %s, %s
                FROM diagnoses
                WHERE diagnosis_id = %s AND farmer_id = %s
                """,
                (
                    uuid.uuid4(),
                    feedback.did_treatment_work,
                    feedback.comment,
                    feedback.diagnosis_id,
                    feedback.farmer_id,
                ),
            )
            if cursor.rowcount == 0:
                raise HTTPException(status_code=404, detail="Diagnosis not found.")
    except psycopg.Error as error:
        raise HTTPException(status_code=503, detail="Feedback could not be saved.") from error
    return {"status": "saved"}