import logging

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException

from .crew import CrewAIConfigurationError, run_crew
from .models import RunRequest, RunResponse

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("crew-service")

app = FastAPI(title="Industrial Digital Twin CrewAI Service", version="1.0.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/ml/health")
def ml_health() -> dict[str, str]:
    from .xgboost_inference import SERVING_DIR

    metadata = SERVING_DIR / "metadata.json"
    model = SERVING_DIR / "classifier.json"
    detector = SERVING_DIR / "detector.joblib"
    ready = metadata.is_file() and model.is_file() and detector.is_file()
    return {
        "status": "ready" if ready else "model_not_trained",
        "model": "52-variable-alarm-time-xgboost-treeshap",
    }


@app.post("/ml/predict")
def ml_predict(payload: dict) -> dict:
    history = payload.get("history") if isinstance(payload, dict) else None
    if not isinstance(history, list):
        raise HTTPException(status_code=400, detail="history must be a list of telemetry samples.")
    try:
        from .xgboost_inference import predict_with_explanation

        return predict_with_explanation(history)
    except FileNotFoundError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except Exception as error:
        logger.exception("TEP XGBoost inference failed")
        raise HTTPException(status_code=502, detail="XGBoost inference failed; inspect service logs.") from error


@app.post("/ml/pipeline/first-alarm")
def ml_first_alarm_pipeline(payload: dict) -> dict:
    history = payload.get("history") if isinstance(payload, dict) else None
    if not isinstance(history, list) or not history or len(history) > 10_000:
        raise HTTPException(status_code=400, detail="Provide 1 to 10,000 sequential samples from one TEP run.")
    try:
        from .xgboost_inference import detect_then_diagnose

        return detect_then_diagnose(history, final_replay=payload.get("finalReplay") is True)
    except FileNotFoundError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except (TypeError, ValueError, KeyError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except Exception as error:
        logger.exception("TEP first-alarm pipeline failed")
        raise HTTPException(status_code=502, detail="First-alarm pipeline failed; inspect service logs.") from error


@app.post("/ml/anomaly/compare")
def ml_anomaly_compare(payload: dict) -> dict:
    history = payload.get("history") if isinstance(payload, dict) else None
    if not isinstance(history, list):
        raise HTTPException(status_code=400, detail="history must be a list of telemetry samples.")
    try:
        from .anomaly_inference import compare_detectors

        return compare_detectors(history)
    except FileNotFoundError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except Exception as error:
        logger.exception("TEP anomaly comparison failed")
        raise HTTPException(status_code=502, detail="Anomaly comparison failed; inspect service logs.") from error


@app.post("/orchestrator/run", response_model=RunResponse, response_model_by_alias=True)
def orchestrate(request: RunRequest) -> RunResponse:
    try:
        return run_crew(request)
    except CrewAIConfigurationError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except Exception as error:
        logger.exception("CrewAI orchestration failed")
        raise HTTPException(
            status_code=502, detail="CrewAI orchestration failed; inspect service logs."
        ) from error
