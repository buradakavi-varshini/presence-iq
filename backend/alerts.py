import logging
from datetime import date

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query

from auth import get_current_user
from database import get_connection


logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/alerts",
    tags=["Attendance alerts"],
    dependencies=[Depends(get_current_user)],
)


@router.get("/low-attendance")
def get_low_attendance(
    class_id: int = Query(..., gt=0),
    start_date: date = Query(...),
    end_date: date = Query(...),
    threshold: float = Query(default=75, gt=0, le=100),
):
    if start_date > end_date:
        raise HTTPException(
            status_code=422,
            detail="Start date must be on or before end date.",
        )

    if (end_date - start_date).days > 365:
        raise HTTPException(
            status_code=422,
            detail="Choose a date range of at most 366 days.",
        )

    try:
        with get_connection() as connection:
            with connection.cursor() as cursor:
                # Keep all report queries on the same database snapshot.
                cursor.execute(
                    "SET TRANSACTION ISOLATION LEVEL "
                    "REPEATABLE READ READ ONLY;"
                )

                cursor.execute(
                    """
                    SELECT id, class_name, department
                    FROM classes
                    WHERE id = %s;
                    """,
                    (class_id,),
                )

                class_details = cursor.fetchone()

                if class_details is None:
                    raise HTTPException(
                        status_code=404,
                        detail="Class not found.",
                    )

                cursor.execute(
                    """
                    SELECT COUNT(*) AS session_count
                    FROM attendance_sessions
                    WHERE class_id = %s
                      AND session_date BETWEEN %s AND %s;
                    """,
                    (class_id, start_date, end_date),
                )

                session_count = cursor.fetchone()["session_count"]

                # Use session rosters, including students who were
                # enrolled in the class during the selected period.
                cursor.execute(
                    """
                    SELECT
                        s.id AS student_id,
                        s.student_code,
                        s.full_name,
                        s.department,
                        COUNT(*) AS total_records,
                        COUNT(*) FILTER (
                            WHERE r.status = 'present'
                        ) AS present_count,
                        COUNT(*) FILTER (
                            WHERE r.status = 'absent'
                        ) AS absent_count,
                        COUNT(*) FILTER (
                            WHERE r.status = 'unmarked'
                        ) AS unmarked_count
                    FROM attendance_records AS r
                    INNER JOIN attendance_sessions AS a
                        ON a.id = r.session_id
                    INNER JOIN students AS s
                        ON s.id = r.student_id
                    WHERE a.class_id = %s
                      AND a.session_date BETWEEN %s AND %s
                    GROUP BY
                        s.id,
                        s.student_code,
                        s.full_name,
                        s.department
                    ORDER BY s.full_name, s.id;
                    """,
                    (class_id, start_date, end_date),
                )

                records = cursor.fetchall()

    except psycopg.OperationalError as error:
        logger.exception("Attendance alerts database unavailable")
        raise HTTPException(
            status_code=503,
            detail="Database unavailable. Check the backend terminal.",
        ) from error

    except psycopg.Error as error:
        logger.exception("Attendance alerts query failed")
        raise HTTPException(
            status_code=500,
            detail="Could not load attendance alerts.",
        ) from error

    alerts = []
    students_without_marked_attendance = 0
    total_unmarked_records = 0

    for student in records:
        present = student["present_count"]
        absent = student["absent_count"]
        marked = present + absent

        total_unmarked_records += student["unmarked_count"]

        if marked == 0:
            students_without_marked_attendance += 1
            continue

        percentage = present / marked * 100

        # Compare the original value before rounding for display.
        if percentage < threshold:
            alerts.append(
                {
                    **student,
                    "marked_count": marked,
                    "attendance_percentage": round(percentage, 2),
                    "has_pending_attendance": (
                        student["unmarked_count"] > 0
                    ),
                }
            )

    alerts.sort(
        key=lambda student: (
            student["present_count"] / student["marked_count"],
            student["full_name"].casefold(),
            student["student_id"],
        )
    )

    return {
        "class_details": class_details,
        "start_date": start_date,
        "end_date": end_date,
        "threshold": threshold,
        "calculation": (
            "Present / (Present + Absent) × 100. "
            "Unmarked records are excluded."
        ),
        "summary": {
            "session_count": session_count,
            "students_in_session_rosters": len(records),
            "students_evaluated": (
                len(records) - students_without_marked_attendance
            ),
            "students_below_threshold": len(alerts),
            "students_without_marked_attendance": (
                students_without_marked_attendance
            ),
            "unmarked_records": total_unmarked_records,
        },
        "alerts": alerts,
    }