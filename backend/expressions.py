import logging
import math

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Response,
    UploadFile,
)

from auth import require_teacher_or_admin
from faces import DETECTOR, decode_photo, model_lock


logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/expressions",
    tags=["Expression demo"],
    dependencies=[Depends(require_teacher_or_admin)],
)

EXPRESSION_LABELS = (
    "angry",
    "disgust",
    "fear",
    "happy",
    "sad",
    "surprise",
    "neutral",
)


@router.post("/analyze")
def analyze_expression(
    response: Response,
    photo: UploadFile = File(...),
    consent: bool = Form(...),
):
    if not consent:
        raise HTTPException(
            status_code=400,
            detail="Confirm consent before analyzing a photo.",
        )

    # Reuse the existing image size, format, and decoding checks.
    image = decode_photo(photo)

    with model_lock:
        try:
            # faces.py sets the TensorFlow environment before this import.
            from deepface import DeepFace

            DeepFace.build_model(
                model_name="Emotion",
                task="facial_attribute",
            )

            DeepFace.build_model(
                model_name="Fasnet",
                task="spoofing",
            )

        except Exception as error:
            logger.exception("Expression models could not load")
            raise HTTPException(
                status_code=503,
                detail=(
                    "Expression model unavailable. "
                    "Check the backend terminal."
                ),
            ) from error

        try:
            results = DeepFace.analyze(
                img_path=image,
                actions=["emotion"],
                detector_backend=DETECTOR,
                enforce_detection=True,
                align=True,
                anti_spoofing=True,
                silent=True,
            )

        except Exception as error:
            error_name = type(error).__name__

            is_spoof_error = (
                error_name == "SpoofDetected"
                or (
                    isinstance(error, ValueError)
                    and "spoof detected" in str(error).lower()
                )
            )

            if is_spoof_error:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Anti-spoofing check failed. "
                        "Capture your live face directly with the camera."
                    ),
                ) from error

            logger.exception("Expression analysis failed")

            if (
                isinstance(error, ValueError)
                or error_name == "FaceNotDetected"
            ):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Could not analyze the face. "
                        "Capture one clear face in good lighting. "
                        "If this continues, check the backend terminal."
                    ),
                ) from error

            raise HTTPException(
                status_code=500,
                detail=(
                    "Expression analysis failed. "
                    "Check the backend terminal."
                ),
            ) from error

    if not isinstance(results, list) or len(results) != 1:
        raise HTTPException(
            status_code=400,
            detail="Capture exactly one visible face.",
        )

    try:
        raw_scores = results[0]["emotion"]

        scores = {
            label: float(raw_scores[label])
            for label in EXPRESSION_LABELS
        }

        if any(
            not math.isfinite(value) or value < 0
            for value in scores.values()
        ):
            raise ValueError("Invalid expression scores")

        total = sum(scores.values())

        if not math.isfinite(total) or total <= 0:
            raise ValueError("Invalid expression score total")

        # Normalize model scores to a percentage distribution.
        percentages = {
            label: value / total * 100
            for label, value in scores.items()
        }

        ranked_scores = sorted(
            percentages.items(),
            key=lambda item: item[1],
            reverse=True,
        )

    except (KeyError, TypeError, ValueError, OverflowError) as error:
        logger.exception("Expression model returned invalid scores")
        raise HTTPException(
            status_code=500,
            detail="The expression model returned an invalid result.",
        ) from error

    response.headers["Cache-Control"] = "no-store"

    return {
        "analysis_type": "facial_expression_estimate",
        "top_expression": ranked_scores[0][0],
        "scores": [
            {
                "label": label,
                "model_score_percent": round(value, 2),
            }
            for label, value in ranked_scores
        ],
        "notice": (
            "These are model estimates of facial expression, "
            "not verified emotions or measurements of attention, "
            "understanding, confusion, or tiredness. "
            "Model scores are not accuracy percentages."
        ),
        "photo_saved": False,
        "attendance_changed": False,
    }