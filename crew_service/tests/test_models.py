import os
import unittest
from unittest.mock import patch

from pydantic import ValidationError

from crew_service.crew import CrewAIConfigurationError, create_llm
from crew_service.models import ProcessHealthAssessment, RunRequest, RunResponse
from crew_service.tools import ContextEvidenceTool


def valid_request_payload() -> dict:
    return {
        "executionId": "CREW-test",
        "timestamp": 1_700_000_000_000,
        "context": {
            "telemetry": {"values": {"XMEAS_9": 120.4}},
            "unitHealth": [],
            "anomalyReport": {},
            "predictionResult": {},
            "shapExplanation": {},
            "knowledgeGraphSubgraph": {"nodes": [], "relationships": []},
            "ragEvidence": [],
        },
    }


class CrewServiceModelTests(unittest.TestCase):
    def test_request_accepts_contract_aliases(self) -> None:
        request = RunRequest.model_validate(valid_request_payload())

        self.assertEqual(request.execution_id, "CREW-test")
        self.assertEqual(request.context.telemetry["values"]["XMEAS_9"], 120.4)

    def test_request_rejects_missing_agent_context(self) -> None:
        payload = valid_request_payload()
        del payload["context"]["predictionResult"]

        with self.assertRaises(ValidationError):
            RunRequest.model_validate(payload)

    def test_response_serializes_frontend_field_names(self) -> None:
        response = RunResponse(
            processHealthStatus="STABLE",
            diagnosisEvidence=["Evidence from telemetry."],
            affectedSubsystems=["Reactor"],
            shapAttributionSummary="Provided feature attribution summary.",
            recommendedChecks=["Inspect the supplied sensor indication."],
            agentLogs=[],
        )

        self.assertIn("processHealthStatus", response.model_dump(by_alias=True))
        self.assertIn("agentLogs", response.model_dump(by_alias=True))

    def test_agent_summaries_allow_provider_verbose_output_with_a_bound(self) -> None:
        assessment = ProcessHealthAssessment(
            processHealthStatus="DEGRADED",
            summary="Evidence. " * 200,
        )
        self.assertEqual(len(assessment.summary), 2000)
        with self.assertRaises(ValidationError):
            ProcessHealthAssessment(
                processHealthStatus="DEGRADED",
                summary="x" * 3001,
            )

    def test_openai_model_requires_explicit_api_key(self) -> None:
        with patch.dict(os.environ, {"CREWAI_MODEL": "openai/gpt-4o-mini"}, clear=True):
            with self.assertRaisesRegex(CrewAIConfigurationError, "OPENAI_API_KEY"):
                create_llm()

    def test_groq_model_uses_openai_compatible_endpoint(self) -> None:
        environment = {
            "CREWAI_MODEL": "groq/llama-3.3-70b-versatile",
            "GROQ_API_KEY": "test-groq-key",
        }
        with patch.dict(os.environ, environment, clear=True), patch(
            "crew_service.crew.LLM"
        ) as llm_factory:
            create_llm()

        llm_factory.assert_called_once_with(
            model="openai/llama-3.3-70b-versatile",
            base_url="https://api.groq.com/openai/v1",
            api_key="test-groq-key",
            temperature=0,
        )

    def test_groq_model_requires_explicit_api_key(self) -> None:
        with patch.dict(os.environ, {"CREWAI_MODEL": "groq/llama-3.3-70b-versatile"}, clear=True):
            with self.assertRaisesRegex(CrewAIConfigurationError, "GROQ_API_KEY"):
                create_llm()

    def test_context_tool_only_exposes_allowed_evidence(self) -> None:
        tool = ContextEvidenceTool(
            name="Test Evidence",
            description="Test read-only evidence lookup.",
            context={"predictionResult": {"faultId": 4}, "telemetry": {"values": {}}},
            allowed_sections=["predictionResult"],
        )

        self.assertEqual(tool._run("predictionResult"), '{"faultId":4}')
        with self.assertRaisesRegex(ValueError, "not available"):
            tool._run("telemetry")


if __name__ == "__main__":
    unittest.main()
