import logging

import numpy as np
from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Path,
    UploadFile,
)

from auth import get_current_user
from faces import (
    DETECTOR,
    MODEL_NAME,
    NORMALIZATION,
    create_embedding,
    decode_photo,
    face_cursor,
)


logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/recognition",
    tags=["Face attendance"],
    dependencies=[Depends(get_current_user)],
)

MATCH_THRESHOLD = 0.30
MIN_DISTANCE_GAP = 0.05


def no_match(reason, message):
    return {
        "matched": False,
        "attendance_updated": False,
        "reason": reason,
        "message": message,
    }


@router.post("/sessions/{session_id}/scan")
def scan_attendance(
    session_id: int = Path(gt=0),
    photo: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    with face_cursor() as cursor:
        cursor.execute(
            "SELECT id FROM attendance_sessions WHERE id = %s;",
            (session_id,),
        )

        if cursor.fetchone() is None:
            raise HTTPException(
                status_code=404,
                detail="Attendance session not found.",
            )

        cursor.execute(
            """
            SELECT EXISTS (
                SELECT 1
                FROM attendance_records AS r
                JOIN face_enrollments AS f
                    ON f.student_id = r.student_id
                WHERE r.session_id = %s
                  AND f.model_name = %s
                  AND f.detector_backend = %s
                  AND f.normalization = %s
            ) AS available;
            """,
            (
                session_id,
                MODEL_NAME,
                DETECTOR,
                NORMALIZATION,
            ),
        )

        if not cursor.fetchone()["available"]:
            raise HTTPException(
                status_code=400,
                detail=(
                    "No compatible face enrollments exist for this "
                    "session's students. Enroll their faces first."
                ),
            )

    image = decode_photo(photo)

    query_embedding = np.asarray(
        create_embedding(image),
        dtype=np.float64,
    )

    query_embedding = query_embedding / np.linalg.norm(query_embedding)

    with face_cursor() as cursor:
        cursor.execute(
            """
            SELECT id
            FROM attendance_sessions
            WHERE id = %s
            FOR UPDATE;
            """,
            (session_id,),
        )

        if cursor.fetchone() is None:
            raise HTTPException(
                status_code=404,
                detail="Attendance session not found.",
            )

        cursor.execute(
            """
            SELECT
                r.student_id,
                r.status,
                s.student_code,
                s.full_name,
                f.embedding
            FROM attendance_records AS r
            JOIN students AS s
                ON s.id = r.student_id
            JOIN face_enrollments AS f
                ON f.student_id = r.student_id
            WHERE r.session_id = %s
              AND f.model_name = %s
              AND f.detector_backend = %s
              AND f.normalization = %s
            ORDER BY r.student_id
            FOR SHARE OF f;
            """,
            (
                session_id,
                MODEL_NAME,
                DETECTOR,
                NORMALIZATION,
            ),
        )

        candidates = cursor.fetchall()

        if not candidates:
            raise HTTPException(
                status_code=409,
                detail="Enrollments changed. Refresh and try again.",
            )

        ranked = []

        for candidate in candidates:
            saved_embedding = np.asarray(
                candidate["embedding"],
                dtype=np.float64,
            )

            if (
                saved_embedding.shape != (512,)
                or not np.isfinite(saved_embedding).all()
                or np.linalg.norm(saved_embedding) == 0
            ):
                logger.error(
                    "Invalid enrollment vector for student %s",
                    candidate["student_id"],
                )

                raise HTTPException(
                    status_code=503,
                    detail=(
                        "A saved face enrollment is invalid. "
                        "Check the backend terminal and re-enroll that student."
                    ),
                )

            saved_embedding = (
                saved_embedding / np.linalg.norm(saved_embedding)
            )

            similarity = float(
                np.clip(
                    np.dot(query_embedding, saved_embedding),
                    -1.0,
                    1.0,
                )
            )

            distance = 1.0 - similarity
            ranked.append((distance, candidate))

        ranked.sort(key=lambda item: item[0])

        # Temporary diagnostic output.
        logger.warning(
            "Face scan diagnostics: session=%s, candidates=%s, threshold=%.3f",
            session_id,
            len(ranked),
            MATCH_THRESHOLD,
        )

        for distance, candidate in ranked[:3]:
            logger.warning(
                "Candidate student_id=%s, cosine_distance=%.4f",
                candidate["student_id"],
                distance,
            )

        best_distance, best_student = ranked[0]

        if best_distance > MATCH_THRESHOLD:
            return no_match(
                "unknown",
                "No matching student found in this session. "
                "Attendance was not changed.",
            )

        if len(ranked) > 1:
            second_distance = ranked[1][0]

            if second_distance - best_distance < MIN_DISTANCE_GAP:
                return no_match(
                    "ambiguous",
                    "The match is too close to another enrollment. "
                    "Attendance was not changed. Use manual attendance.",
                )

        already_present = best_student["status"] == "present"

        if not already_present:
            cursor.execute(
                """
                UPDATE attendance_records
                SET
                    status = 'present',
                    marked_by = %s,
                    marked_at = CURRENT_TIMESTAMP
                WHERE session_id = %s
                  AND student_id = %s;
                """,
                (
                    current_user["id"],
                    session_id,
                    best_student["student_id"],
                ),
            )

        result = {
            "matched": True,
            "attendance_updated": not already_present,
            "already_present": already_present,
            "session_id": session_id,
            "student_id": best_student["student_id"],
            "student_code": best_student["student_code"],
            "full_name": best_student["full_name"],
            "status": "present",
            "distance": round(best_distance, 4),
            "message": (
                f"{best_student['full_name']} is already present."
                if already_present
                else f"{best_student['full_name']} marked present."
            ),
        }

    return result