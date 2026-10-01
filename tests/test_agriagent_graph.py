import json
import os
import unittest
from unittest.mock import Mock, patch

from agriagent_graph import KNOWLEDGE_BASE_PATH, agriagent_graph, follow_up_graph

CLASSIFIER_CLASSES = {
    "Tomato_Bacterial_spot",
    "Tomato_Early_blight",
    "Tomato_Late_blight",
    "Tomato_Leaf_Mold",
    "Tomato_Septoria_leaf_spot",
    "Tomato_Spider_mites_Two_spotted_spider_mite",
    "Tomato__Target_Spot",
    "Tomato__Tomato_YellowLeaf__Curl_Virus",
    "Tomato__Tomato_mosaic_virus",
    "Tomato_healthy",
}


class AgriAgentGraphTests(unittest.TestCase):
    def run_prediction(
        self,
        confidence: float,
        predicted_class: str = "Tomato_Early_blight",
    ) -> dict:
        response = Mock()
        response.json.return_value = {
            "class": predicted_class,
            "confidence": confidence,
        }
        response.raise_for_status.return_value = None

        with patch("agriagent_graph.httpx.post", return_value=response) as post:
            result = agriagent_graph.invoke(
                {
                    "image_bytes": b"leaf-image",
                    "filename": "leaf.jpg",
                    "content_type": "image/jpeg",
                }
            )

        post.assert_called_once()
        self.assertEqual(post.call_args.kwargs["files"]["file"][1], b"leaf-image")
        return result

    def test_under_thirty_percent_stops_before_treatment_lookup(self) -> None:
        result = self.run_prediction(0.29)

        self.assertEqual(result["triage_status"], "unrecognized")
        self.assertNotIn("treatment_entry", result)
        self.assertIn("retake", result["response_text"])

    def test_thirty_to_sixty_percent_returns_possible_diagnosis(self) -> None:
        result = self.run_prediction(0.60)

        self.assertEqual(result["triage_status"], "low_confidence")
        self.assertIn("treatment_entry", result)
        self.assertIn("Possible diagnosis", result["response_text"])
        self.assertIn("retake", result["response_text"])

    def test_above_sixty_percent_returns_treatment_lookup(self) -> None:
        result = self.run_prediction(0.61)

        self.assertEqual(result["triage_status"], "confident")
        self.assertIn("treatment_entry", result)
        self.assertIn("location_results", result)
        self.assertFalse(result["location_results"]["available"])
        self.assertIn("Likely diagnosis", result["response_text"])

    def test_knowledge_base_covers_all_classifier_classes(self) -> None:
        with KNOWLEDGE_BASE_PATH.open(encoding="utf-8") as knowledge_base_file:
            knowledge_base = json.load(knowledge_base_file)

        self.assertEqual(set(knowledge_base), CLASSIFIER_CLASSES)
        for class_name, entry in knowledge_base.items():
            if class_name == "Tomato_healthy":
                self.assertEqual(set(entry), {"message", "general_care_tips"})
                continue

            for field in (
                "common_name",
                "category",
                "symptoms",
                "cause",
                "organic_treatment",
                "chemical_active_ingredients",
                "prevention",
                "requires_purchase",
                "product_type",
                "no_cure",
            ):
                self.assertIn(field, entry, class_name)

            self.assertEqual(entry["no_cure"], class_name in {
                "Tomato__Tomato_YellowLeaf__Curl_Virus",
                "Tomato__Tomato_mosaic_virus",
            })

    def test_viral_diagnosis_only_returns_management_guidance(self) -> None:
        with patch.dict(os.environ, {"GEMINI_API_KEY": "", "OPENAI_API_KEY": ""}):
            result = self.run_prediction(
                0.92,
                "Tomato__Tomato_mosaic_virus",
            )

        self.assertIn("no curative treatment", result["response_text"])
        self.assertIn("Clean tools", result["response_text"])
        self.assertFalse(result["treatment_entry"]["requires_purchase"])

    def test_healthy_diagnosis_returns_general_care_without_products(self) -> None:
        with patch.dict(os.environ, {"GEMINI_API_KEY": "", "OPENAI_API_KEY": ""}):
            result = self.run_prediction(0.95, "Tomato_healthy")

        self.assertIn(result["treatment_entry"]["message"], result["response_text"])
        self.assertNotIn("chemical_active_ingredients", result["treatment_entry"])

    def follow_up_state(self, **overrides: object) -> dict:
        knowledge_base = json.loads(KNOWLEDGE_BASE_PATH.read_text(encoding="utf-8"))
        state = {
            "farmer_id": "farmer-test",
            "predicted_class": "Tomato_Early_blight",
            "confidence": 0.88,
            "triage_status": "confident",
            "treatment_entry": knowledge_base["Tomato_Early_blight"],
            "location": {"province": "Harare", "district": "Harare", "growth_point": "Harare"},
        }
        state.update(overrides)
        return state

    def test_follow_up_router_routes_diagnosis_question_to_grounded_qa(self) -> None:
        result = follow_up_graph.invoke(
            self.follow_up_state(follow_up_message="What causes this disease?")
        )

        self.assertEqual(result["follow_up_intent"], "diagnosis_question")
        self.assertIn(result["treatment_entry"]["cause"], result["response_text"])

    def test_follow_up_router_redirects_unrelated_question(self) -> None:
        result = follow_up_graph.invoke(
            self.follow_up_state(follow_up_message="How is the football match?")
        )

        self.assertEqual(result["follow_up_intent"], "unrelated")
        self.assertIn("tomato diagnosis", result["response_text"])

    def test_follow_up_router_refreshes_updated_location(self) -> None:
        result = follow_up_graph.invoke(
            self.follow_up_state(
                updated_location={
                    "province": "Harare",
                    "district": "Harare",
                    "growth_point": "Mbare",
                }
            )
        )

        self.assertEqual(result["follow_up_intent"], "updated_location")
        self.assertFalse(result["location_results"]["available"])
        self.assertIn("unavailable", result["response_text"])

    def test_follow_up_router_sends_new_photo_to_classifier(self) -> None:
        response = Mock()
        response.json.return_value = {
            "class": "Tomato_Early_blight",
            "confidence": 0.88,
        }
        response.raise_for_status.return_value = None

        with patch("agriagent_graph.httpx.post", return_value=response) as post:
            result = follow_up_graph.invoke(
                self.follow_up_state(
                    image_bytes=b"new-leaf",
                    follow_up_message="",
                )
            )

        self.assertEqual(result["follow_up_intent"], "new_photo")
        self.assertEqual(result["predicted_class"], "Tomato_Early_blight")
        post.assert_called_once()


if __name__ == "__main__":
    unittest.main()