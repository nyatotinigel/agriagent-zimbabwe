from typing import Any, Literal, TypedDict


class AgriAgentState(TypedDict, total=False):
    image_bytes: bytes
    filename: str
    content_type: str
    farmer_id: str
    location: dict[str, str]
    predicted_class: str
    confidence: float
    triage_status: Literal["unrecognized", "low_confidence", "confident"]
    treatment_entry: dict[str, Any]
    location_results: dict[str, Any]
    response_text: str
    follow_up_message: str
    follow_up_intent: Literal[
        "new_photo", "updated_location", "diagnosis_question", "unrelated"
    ]
    updated_location: dict[str, str]