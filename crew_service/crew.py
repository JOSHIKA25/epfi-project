import os

from crewai import Agent, Crew, LLM, Process, Task

from .models import (
    DiagnosisAssessment,
    ExplainabilityReview,
    MaintenanceAssessment,
    PredictionReview,
    ProcessHealthAssessment,
    RunRequest,
    RunResponse,
    UnitSpecialistAssessment,
    PlantSynthesisAssessment,
)
from .tools import ContextEvidenceTool


class CrewAIConfigurationError(RuntimeError):
    pass


def create_llm() -> LLM:
    model = os.getenv("CREWAI_MODEL", "openai/gpt-4o-mini")
    if model.startswith("openai/") and not os.getenv("OPENAI_API_KEY"):
        raise CrewAIConfigurationError(
            "OPENAI_API_KEY is required when CREWAI_MODEL uses the OpenAI provider."
        )
    if model.startswith("groq/"):
        groq_api_key = os.getenv("GROQ_API_KEY")
        if not groq_api_key:
            raise CrewAIConfigurationError(
                "GROQ_API_KEY is required when CREWAI_MODEL uses the Groq provider."
            )
        groq_model = model.removeprefix("groq/")
        return LLM(
            model=f"openai/{groq_model}",
            base_url="https://api.groq.com/openai/v1",
            api_key=groq_api_key,
            temperature=0,
        )
    return LLM(model=model, temperature=0)


def run_crew(request: RunRequest) -> RunResponse:
    llm = create_llm()
    context = request.context.model_dump(by_alias=True)
    if request.context.unit_event:
        return run_unit_event_crew(request, llm, request.context.unit_event)
    shared_context = (
        "Use only observations retrieved through your read-only evidence tools and upstream "
        "task outputs. Do not invent "
        "measurements, model metrics, fault identities, or SOP citations. This is advisory "
        "analysis only: never issue actuator commands or bypass engineer approval.\n\n"
    )

    health_agent = Agent(
        role="Process Health Agent",
        goal="Classify process health from the observed anomaly score and unit health.",
        backstory=(
            "You are a process monitoring specialist. Apply the numeric status thresholds "
            "provided in the task and distinguish observations from recommendations."
        ),
        llm=llm,
        verbose=False,
        allow_delegation=False,
        max_iter=2,
        tools=[
            ContextEvidenceTool(
                name="Process Telemetry Evidence",
                description="Read telemetry, anomaly report, or unit-health sections only.",
                context=context,
                allowed_sections=["telemetry", "anomalyReport", "unitHealth"],
            )
        ],
    )
    prediction_agent = Agent(
        role="Failure Prediction Review Agent",
        goal="Review the supplied prediction without changing its identity or metrics.",
        backstory=(
            "You are a predictive-maintenance reviewer. Report the model output exactly as "
            "provided and clearly state that it is advisory."
        ),
        llm=llm,
        verbose=False,
        allow_delegation=False,
        max_iter=2,
        tools=[
            ContextEvidenceTool(
                name="Fault Prediction Evidence",
                description="Read the supplied prediction result and model-validation status.",
                context=context,
                allowed_sections=["predictionResult"],
            )
        ],
    )
    explainability_agent = Agent(
        role="Explainable AI Agent",
        goal="Summarize the supplied feature attributions without adding unsupported causes.",
        backstory=(
            "You explain model evidence to reliability engineers. Use only the supplied "
            "heuristic sensor-attribution summary and feature contributions."
        ),
        llm=llm,
        verbose=False,
        allow_delegation=False,
        max_iter=2,
        tools=[
            ContextEvidenceTool(
                name="Attribution Evidence",
                description="Read the supplied heuristic sensor-attribution summary.",
                context=context,
                allowed_sections=["shapExplanation", "anomalyReport"],
            )
        ],
    )
    diagnosis_agent = Agent(
        role="Failure Diagnosis Agent",
        goal="Build a ranked-evidence narrative from the supplied prediction and graph.",
        backstory=(
            "You are a root-cause analyst. Do not change the primary predicted fault or its "
            "confidence; tie every evidence statement to supplied sensors, attributions, or graph data."
        ),
        llm=llm,
        verbose=False,
        allow_delegation=False,
        max_iter=2,
        tools=[
            ContextEvidenceTool(
                name="Diagnosis Evidence",
                description="Read prediction, anomaly, attribution, and process-graph evidence.",
                context=context,
                allowed_sections=[
                    "predictionResult",
                    "anomalyReport",
                    "shapExplanation",
                    "knowledgeGraphSubgraph",
                ],
            )
        ],
    )
    maintenance_agent = Agent(
        role="Maintenance Action Agent",
        goal="Draft engineer-reviewable checks grounded in retrieved SOP evidence.",
        backstory=(
            "You are a maintenance planner. Recommend inspection and verification only; "
            "do not direct live control changes. Cite only supplied retrieval evidence and "
            "always leave final approval with a qualified engineer."
        ),
        llm=llm,
        verbose=False,
        allow_delegation=False,
        max_iter=2,
        tools=[
            ContextEvidenceTool(
                name="Maintenance and SOP Evidence",
                description="Read retrieved SOP snippets, graph facts, and prediction context.",
                context=context,
                allowed_sections=[
                    "ragEvidence",
                    "predictionResult",
                    "knowledgeGraphSubgraph",
                ],
            )
        ],
    )

    health_task = Task(
        description=(
            f"{shared_context}\n\n"
            "Use Process Telemetry Evidence to retrieve anomalyReport and unitHealth. "
            "Assess overall plant health. Compute mean unitHealth.healthIndex. Apply these "
            "rules exactly: CRITICAL if anomalyScore >= 75 or mean health < 50; otherwise "
            "DEGRADED if anomalyScore >= 45 or mean health < 75; otherwise STABLE if "
            "anomalyScore >= 25 or mean health < 90; otherwise OPTIMAL. Do not repeat raw "
            "JSON or enumerate sensor values. Return a concise summary of at most 500 "
            "characters, citing only the most relevant supplied observations."
        ),
        expected_output=(
            "A validated health status and one concise evidence summary of no more than "
            "500 characters."
        ),
        output_pydantic=ProcessHealthAssessment,
        agent=health_agent,
    )
    prediction_task = Task(
        description=(
            f"{shared_context}\n\n"
            "Use Fault Prediction Evidence to retrieve predictionResult. "
            "Review predictionResult.topPrediction and riskLevel. Do not compute or claim "
            "XGBoost/GRU inference, do not modify predicted values, and do not claim "
            "validation metrics. Do not repeat raw JSON. Return a concise advisory summary "
            "of at most 500 characters."
        ),
        expected_output="A concise prediction review of no more than 500 characters.",
        output_pydantic=PredictionReview,
        agent=prediction_agent,
        context=[health_task],
    )
    explainability_task = Task(
        description=(
            f"{shared_context}\n\n"
            "Use Attribution Evidence to retrieve shapExplanation. "
            "Summarize shapExplanation.summaryText and the supplied top contributions. "
            "Do not infer causality beyond the provided evidence. Do not repeat raw JSON. "
            "Return a concise summary of at most 500 characters."
        ),
        expected_output="A concise explanation summary of no more than 500 characters.",
        output_pydantic=ExplainabilityReview,
        agent=explainability_agent,
        context=[health_task, prediction_task],
    )
    diagnosis_task = Task(
        description=(
            f"{shared_context}\n\n"
            "Use Diagnosis Evidence to retrieve prediction, anomaly, attribution, and graph data. "
            "Produce one or more concise evidence strings and affected subsystem names. "
            "Use the top prediction as the primary candidate; do not invent fault codes, "
            "confidence scores, or graph paths. If evidence is weak, say so explicitly."
        ),
        expected_output="Evidence strings and affected subsystem names.",
        output_pydantic=DiagnosisAssessment,
        agent=diagnosis_agent,
        context=[health_task, prediction_task, explainability_task],
    )
    maintenance_task = Task(
        description=(
            f"{shared_context}\n\n"
            "Use Maintenance and SOP Evidence to retrieve ragEvidence and fault context. "
            "Draft 1-6 safe inspection or verification checks grounded in ragEvidence. "
            "Do not recommend actuator changes, bypasses, or plant operation. State that "
            "work requires engineer review and apply lockout/tagout when the deterministic "
            "work-order priority requires it."
        ),
        expected_output="A short list of evidence-grounded checks and a safety note.",
        output_pydantic=MaintenanceAssessment,
        agent=maintenance_agent,
        context=[health_task, prediction_task, explainability_task, diagnosis_task],
    )

    tasks = [health_task, prediction_task, explainability_task, diagnosis_task, maintenance_task]
    crew = Crew(
        agents=[
            health_agent,
            prediction_agent,
            explainability_agent,
            diagnosis_agent,
            maintenance_agent,
        ],
        tasks=tasks,
        process=Process.sequential,
        verbose=False,
    )
    crew.kickoff()

    outputs = [task.output.pydantic if task.output else None for task in tasks]
    if any(output is None for output in outputs):
        raise RuntimeError("CrewAI completed without producing all validated agent outputs.")
    health, prediction, explanation, diagnosis, maintenance = outputs
    logs = [
        {
            "agentName": "Process Health Agent",
            "role": health_agent.role,
            "timestamp": request.timestamp,
            "status": "SUCCESS",
            "thought": "Evaluated the supplied anomaly and unit-health evidence.",
            "actionTaken": "Classified process health using configured severity thresholds.",
            "outputSummary": health.summary,
        },
        {
            "agentName": "Failure Prediction Agent",
            "role": prediction_agent.role,
            "timestamp": request.timestamp,
            "status": "SUCCESS",
            "thought": "Reviewed the prediction result supplied by the local inference service.",
            "actionTaken": "Checked the prediction against its supplied risk context.",
            "outputSummary": prediction.summary,
        },
        {
            "agentName": "Explainable AI Agent",
            "role": explainability_agent.role,
            "timestamp": request.timestamp,
            "status": "SUCCESS",
            "thought": "Reviewed the supplied heuristic sensor-attribution evidence.",
            "actionTaken": "Summarized the supplied attribution without adding unsupported causes.",
            "outputSummary": explanation.summary,
        },
        {
            "agentName": "Failure Diagnosis Agent",
            "role": diagnosis_agent.role,
            "timestamp": request.timestamp,
            "status": "SUCCESS",
            "thought": "Correlated supplied sensor evidence, attribution, and graph context.",
            "actionTaken": "Ranked the model candidate and assembled traceable evidence.",
            "outputSummary": f"Produced {len(diagnosis.evidence)} evidence statements.",
        },
        {
            "agentName": "Maintenance Action Agent",
            "role": maintenance_agent.role,
            "timestamp": request.timestamp,
            "status": "SUCCESS",
            "thought": "Reviewed the retrieved SOP snippets and engineer-review requirement.",
            "actionTaken": "Drafted inspection checks; no live plant action was authorized.",
            "outputSummary": maintenance.safety_note,
        },
    ]

    return RunResponse(
        processHealthStatus=health.process_health_status,
        diagnosisEvidence=diagnosis.evidence,
        affectedSubsystems=diagnosis.affected_subsystems,
        shapAttributionSummary=explanation.summary,
        recommendedChecks=maintenance.recommended_checks,
        agentLogs=logs,
    )


def run_unit_event_crew(request: RunRequest, llm: LLM, event: dict) -> RunResponse:
    """Run all five unit specialists in sequence, then synthesize their handoffs."""
    unit_names = {
        "reactor": "Reactor",
        "condenser": "Condenser",
        "separator": "Separator",
        "stripper": "Stripper",
        "compressor": "Compressor",
    }
    snapshots = {item.get("unit"): item for item in event.get("unitObservations", [])}
    if not snapshots:
        snapshots[event.get("targetUnit")] = {
            "unit": event.get("targetUnit"),
            "unitName": event.get("unitName", event.get("targetUnit")),
            "observations": event.get("observations", []),
        }
    adjacent_status = event.get("adjacentUnitStatus", [])
    active_faults = event.get("activeFaults", [])
    tasks: list[Task] = []
    agents: list[Agent] = []
    stage_agents: list[Agent] = []
    for unit_id, unit_name in unit_names.items():
        unit_data = snapshots.get(unit_id, {"unit": unit_id, "unitName": unit_name, "observations": []})
        topology_note = {
            "reactor": "The reactor receives fresh feeds and recycle gas.",
            "condenser": "The condenser receives hot reactor effluent.",
            "separator": "The separator receives cooled condenser effluent and splits vapor and liquid.",
            "stripper": "The stripper is on the separator liquid-product branch.",
            "compressor": "The compressor is on the separator vapor branch and returns recycle gas to the reactor; its analysis is a loop-back context, not a downstream product step.",
        }[unit_id]
        agent = Agent(
            role=f"{unit_name} Unit Agent",
            goal=f"Analyze {unit_name} sensor readings, report evidence, and pass a clear or flagged result onward.",
            backstory="You are a unit specialist. Report NORMAL when evidence is within supplied reference bands. Do not invent causes or give control actions.",
            llm=llm,
            verbose=False,
            allow_delegation=False,
            max_iter=1,
        )
        previous_task = tasks[-1] if tasks else None
        handoff = (
            f"\nPrevious unit handoff: {unit_names[list(unit_names)[len(tasks) - 1]]} has completed its review. "
            "Continue even when that unit reported normal; review your own sensor set and note any plausible process connection."
            if previous_task else "You are the first unit stage in this chain."
        )
        task = Task(
            description=(
                f"Review the {unit_name} unit at telemetry step {event.get('telemetryStep')}. "
                f"Process position: {topology_note} "
                "Use only this unit's readings for its direct status; previous handoffs are context, not proof. "
                "State a suspected issue or explicitly say no issue is indicated, cite channel/value/alarm, and pass findings onward. "
                "Do not recommend control changes.\n"
                f"Unit readings: {unit_data.get('observations', [])}\n"
                f"Adjacent unit baseline: {adjacent_status}\n"
                f"Active simulator scenarios: {active_faults}\n{handoff}\n"
                "All data is advisory simulation or replay evidence."
            ),
            expected_output="A concise unit status, suspected issue, and traceable evidence.",
            output_pydantic=UnitSpecialistAssessment,
            agent=agent,
            context=[previous_task] if previous_task else [],
        )
        agents.append(agent)
        tasks.append(task)
        stage_agents.append(agent)

    coordinator = Agent(
        role="Plant Coordinator Agent",
        goal="Synthesize all five sequential unit handoffs, correlate possible cross-unit effects, and draft safe engineer-review checks.",
        backstory="You distinguish correlation from proven causality and never control equipment.",
        llm=llm,
        verbose=False,
        allow_delegation=False,
        max_iter=1,
    )
    synthesis_task = Task(
        description=(
            "Synthesize the five unit reports and adjacent-unit baseline. Every unit was reviewed, including units that reported normal. "
            "State whether evidence suggests isolated or potentially cascading behavior; do not infer causality from status alone. "
            "Draft inspection/verification checks for an engineer. No actuator changes or live control actions.\n"
            f"Triggered by: {event.get('targetUnit')}\nAdjacent status: {adjacent_status}\n"
            f"Active scenarios: {active_faults}"
        ),
        expected_output="Plant context summary and engineer-reviewable inspection checks.",
        output_pydantic=PlantSynthesisAssessment,
        agent=coordinator,
        context=tasks,
    )
    agents.append(coordinator)
    tasks.append(synthesis_task)
    Crew(agents=agents, tasks=tasks, process=Process.sequential, verbose=False).kickoff()

    unit_results = [task.output.pydantic if task.output else None for task in tasks[:-1]]
    synthesis = synthesis_task.output.pydantic if synthesis_task.output else None
    if any(result is None for result in unit_results) or synthesis is None:
        raise RuntimeError("Sequential unit workflow did not produce all six validated outputs.")

    status_map = {str(item.get("unit")): str(item.get("status", "STABLE")) for item in event.get("unitHealth", [])}
    trigger_status = status_map.get(str(event.get("targetUnit")), "STABLE")
    if trigger_status not in {"OPTIMAL", "STABLE", "DEGRADED", "CRITICAL"}:
        trigger_status = "STABLE"
    timestamp = request.timestamp
    logs = []
    evidence = []
    for unit_id, unit_name, result, agent in zip(unit_names, unit_names.values(), unit_results, stage_agents):
        evidence.extend(result.evidence)
        logs.append({
            "agentName": f"{unit_name} Unit Agent",
            "role": agent.role,
            "timestamp": timestamp,
            "status": "SUCCESS",
            "thought": f"Reviewed the {unit_name.lower()} snapshot after the prior unit handoff, even if it was clear.",
            "actionTaken": "Passed a structured clear/flagged result and evidence to the next stage.",
            "outputSummary": f"{result.suspected_issue}: {result.summary}",
        })
    logs.append({
        "agentName": "Plant Coordinator Agent",
        "role": coordinator.role,
        "timestamp": timestamp,
        "status": "SUCCESS",
        "thought": "Correlated all five unit reports and adjacent-unit baseline statuses.",
        "actionTaken": "Prepared a plant-level summary and engineer-reviewable checks.",
        "outputSummary": synthesis.summary,
    })
    return RunResponse(
        processHealthStatus=trigger_status,
        diagnosisEvidence=[*evidence[:5], synthesis.summary],
        affectedSubsystems=synthesis.affected_subsystems,
        shapAttributionSummary="Five sequential unit agents reviewed their own supplied channels; the plant coordinator received all five handoffs.",
        recommendedChecks=synthesis.recommended_checks,
        agentLogs=logs,
    )
