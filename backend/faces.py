import os

# Must be set before importing TensorFlow or DeepFace.
os.environ["TF_USE_LEGACY_KERAS"] = "1"

import logging
from contextlib import contextmanager
from io import BytesIO
from threading import Lock

import numpy as np
import psycopg
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

from auth import require_admin, require_teacher_or_admin
from database import get_connection


logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/faces",
    tags=["Face enrollment"],
    dependencies=[Depends(require_teacher_or_admin)],
)

MODEL_NAME = "Facenet512"
DETECTOR = "opencv"
NORMALIZATION = "base"

MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_IMAGE_PIXELS = 4_000_000

model_lock = Lock()


@contextmanager
def face_cursor():
    try:
        with get_connection() as connection:
            with connection.cursor() as cursor:
                yield cursor

    except psycopg.errors.UniqueViolation as error:
        raise HTTPException(
            status_code=409,
            detail="This student already has a face enrollment.",
        ) from error

    except psycopg.errors.ForeignKeyViolation as error:
        raise HTTPException(
            status_code=409,
            detail="A linked record changed. Refresh and try again.",
        ) from error

    except psycopg.OperationalError as error:
        logger.exception("Face database connection failed")
        raise HTTPException(
            status_code=503,
            detail="Database unavailable. Check the backend terminal.",
        ) from error

    except psycopg.Error as error:
        logger.exception("Face database operation failed")
        raise HTTPException(
            status_code=500,
            detail="Could not process enrollment. Check the backend terminal.",
        ) from error


def decode_photo(photo: UploadFile):
    content = photo.file.read(MAX_FILE_BYTES + 1)

    if not content:
        raise HTTPException(
            status_code=400,
            detail="The uploaded photo is empty.",
        )

    if len(content) > MAX_FILE_BYTES:
        raise HTTPException(
            status_code=413,
            detail="Use a photo smaller than 5 MB.",
        )

    try:
        with Image.open(BytesIO(content)) as source_image:
            if source_image.format not in {"JPEG", "PNG"}:
                raise HTTPException(
                    status_code=415,
                    detail="Upload a JPEG or PNG photo.",
                )

            width, height = source_image.size

            if width * height > MAX_IMAGE_PIXELS:
                raise HTTPException(
                    status_code=413,
                    detail="Use a photo with at most 4 million pixels.",
                )

            corrected_image = ImageOps.exif_transpose(source_image)
            rgb_image = np.array(corrected_image.convert("RGB"))

    except HTTPException:
        raise

    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        Image.DecompressionBombError,
    ) as error:
        logger.warning("Uploaded face image could not be decoded")
        raise HTTPException(
            status_code=400,
            detail="This photo could not be read. Capture another photo.",
        ) from error

    # DeepFace expects a BGR image array.
    return np.ascontiguousarray(rgb_image[:, :, ::-1])


def create_embedding(image):
    """
    Check for spoofing and generate one face embedding.

    Used by enrollment and attendance recognition.
    Permission checks belong to the individual API routes.
    """
    with model_lock:
        try:
            from deepface import DeepFace

            DeepFace.build_model(MODEL_NAME)

            DeepFace.build_model(
                model_name="Fasnet",
                task="spoofing",
            )

        except Exception as error:
            logger.exception("Face models could not load")
            raise HTTPException(
                status_code=503,
                detail="Face models unavailable. Check the backend terminal.",
            ) from error

        try:
            faces = DeepFace.represent(
                img_path=image,
                model_name=MODEL_NAME,
                detector_backend=DETECTOR,
                normalization=NORMALIZATION,
                enforce_detection=True,
                align=True,
                anti_spoofing=True,
            )

        except Exception as error:
            is_spoof_error = (
                type(error).__name__ == "SpoofDetected"
                or (
                    isinstance(error, ValueError)
                    and "spoof detected" in str(error).lower()
                )
            )

            if is_spoof_error:
                logger.warning("Face rejected by anti-spoofing check")
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Anti-spoofing check failed. "
                        "Use your live face directly in front of the camera. "
                        "No enrollment or attendance change was saved."
                    ),
                ) from error

            logger.exception("Face processing failed")

            if isinstance(error, ValueError):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Could not process the face. "
                        "Capture one clear face in good lighting. "
                        "If this continues, check the backend terminal."
                    ),
                ) from error

            raise HTTPException(
                status_code=500,
                detail="Face processing failed. Check the backend terminal.",
            ) from error

    if not isinstance(faces, list) or len(faces) != 1:
        raise HTTPException(
            status_code=400,
            detail="Use a photo containing exactly one visible face.",
        )

    try:
        embedding = np.asarray(
            faces[0]["embedding"],
            dtype=np.float64,
        )

        valid_embedding = (
            embedding.shape == (512,)
            and np.isfinite(embedding).all()
            and np.linalg.norm(embedding) > 0
        )

    except (KeyError, TypeError, ValueError):
        valid_embedding = False

    if not valid_embedding:
        logger.error("Face model returned an invalid embedding")
        raise HTTPException(
            status_code=500,
            detail="The model returned an invalid embedding.",
        )

    return embedding.tolist()


# Teachers and admins can view enrollment status.
@router.get("/students")
def get_face_enrollment_status():
    with face_cursor() as cursor:
        cursor.execute(
            """
            SELECT
                s.id,
                s.student_code,
                s.full_name,
                s.department,
                (f.student_id IS NOT NULL) AS face_enrolled,
                f.created_at AS enrolled_at
            FROM students AS s
            LEFT JOIN face_enrollments AS f
                ON f.student_id = s.id
            ORDER BY s.full_name, s.id;
            """
        )

        students = cursor.fetchall()

    return students


# Only admins can create a face enrollment.
@router.post("/students/{student_id}", status_code=201)
def enroll_face(
    student_id: int,
    photo: UploadFile = File(...),
    current_user: dict = Depends(require_admin),
):
    if student_id <= 0:
        raise HTTPException(
            status_code=422,
            detail="Student ID must be a positive number.",
        )

    # The admin permission check runs before this function.
    with face_cursor() as cursor:
        cursor.execute(
            """
            SELECT
                s.id,
                s.full_name,
                (f.student_id IS NOT NULL) AS face_enrolled
            FROM students AS s
            LEFT JOIN face_enrollments AS f
                ON f.student_id = s.id
            WHERE s.id = %s;
            """,
            (student_id,),
        )

        student = cursor.fetchone()

    if student is None:
        raise HTTPException(
            status_code=404,
            detail="Student not found.",
        )

    if student["face_enrolled"]:
        raise HTTPException(
            status_code=409,
            detail=(
                "This student already has a face enrollment. "
                "Remove it before enrolling a new photo."
            ),
        )

    image = decode_photo(photo)

    # Spoofing and face checks must pass before insertion.
    embedding = create_embedding(image)

    with face_cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO face_enrollments (
                student_id,
                embedding,
                model_name,
                detector_backend,
                normalization,
                enrolled_by
            )
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING student_id, created_at;
            """,
            (
                student_id,
                embedding,
                MODEL_NAME,
                DETECTOR,
                NORMALIZATION,
                current_user["id"],
            ),
        )

        enrollment = cursor.fetchone()

    return {
        "message": "Face enrolled successfully.",
        "full_name": student["full_name"],
        **enrollment,
    }


# Only admins can remove a face enrollment.
@router.delete(
    "/students/{student_id}",
    dependencies=[Depends(require_admin)],
)
def delete_face_enrollment(student_id: int):
    if student_id <= 0:
        raise HTTPException(
            status_code=422,
            detail="Student ID must be a positive number.",
        )

    with face_cursor() as cursor:
        cursor.execute(
            """
            DELETE FROM face_enrollments
            WHERE student_id = %s
            RETURNING student_id;
            """,
            (student_id,),
        )

        deleted = cursor.fetchone()

        if deleted is None:
            raise HTTPException(
                status_code=404,
                detail="Face enrollment not found.",
            )

    return {
        "message": "Face enrollment removed.",
        "student_id": student_id,
    }