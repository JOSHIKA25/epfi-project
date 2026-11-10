from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class APIModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class CrewContext(APIModel):
    telemetry: dict[str, Any]
    unit_health: list[dict[str, Any]] = Field(alias="unitHealth")
    anomaly_report: dict[str, Any] = Field(alias="anomalyReport")
    prediction_result: dict[str, Any] = Field(alias="predictionResult")
    shap_explanation: dict[str, Any] = Field(alias="shapExplanation")
    knowledge_graph_subgraph: dict[str, Any] = Field(alias="knowledgeGraphSubgraph")
    rag_evidence: list[dict[str, Any]] = Field(alias="ragEvidence")
    unit_event: dict[str, Any] | None = Field(default=None, alias="unitEvent")


class RunRequest(APIModel):
    execution_id: str = Field(alias="executionId", min_length=1)
    timestamp: int
    context: CrewContext


class ProcessHealthAssessment(APIModel):
    process_health_status: Literal["OPTIMAL", "STABLE", "DEGRADED", "CRITICAL"] = Field(
        alias="processHealthStatus"
    )
    summary: str = Field(min_length=1, max_length=3000)


class PredictionReview(APIModel):
    summary: str = Field(min_length=1, max_length=3000)


class ExplainabilityReview(APIModel):
    summary: str = Field(min_length=1, max_length=3000)


class DiagnosisAssessment(APIModel):
    evidence: list[str] = Field(min_length=1, max_length=6)
    affected_subsystems: list[str] = Field(
        alias="affectedSubsystems", min_length=1, max_length=5
    )


class MaintenanceAssessment(APIModel):
    recommended_checks: list[str] = Field(
        alias="recommendedChecks", min_length=1, max_length=8
    )
    safety_note: str = Field(alias="safetyNote", min_length=1, max_length=500)


class UnitSpecialistAssessment(APIModel):
    summary: str = Field(min_length=1, max_length=1200)
    suspected_issue: str = Field(min_length=1, max_length=400)
    evidence: list[str] = Field(min_length=1, max_length=5)


class PlantSynthesisAssessment(APIModel):
    summary: str = Field(min_length=1, max_length=1200)
    affected_subsystems: list[str] = Field(alias="affectedSubsystems", min_length=1, max_length=5)
    recommended_checks: list[str] = Field(alias="recommendedChecks", min_length=1, max_length=6)


class AgentExecutionLog(APIModel):
    agent_name: str = Field(alias="agentName")
    role: str
    timestamp: int
    status: Literal["PENDING", "RUNNING", "SUCCESS", "WARNING"]
    thought: str
    action_taken: str = Field(alias="actionTaken")
    output_summary: str = Field(alias="outputSummary")


class RunResponse(APIModel):
    process_health_status: Literal["OPTIMAL", "STABLE", "DEGRADED", "CRITICAL"] = Field(
        alias="processHealthStatus"
    )
    diagnosis_evidence: list[str] = Field(alias="diagnosisEvidence")
    affected_subsystems: list[str] = Field(alias="affectedSubsystems")
    shap_attribution_summary: str = Field(alias="shapAttributionSummary")
    recommended_checks: list[str] = Field(alias="recommendedChecks")
    agent_logs: list[AgentExecutionLog] = Field(alias="agentLogs")
