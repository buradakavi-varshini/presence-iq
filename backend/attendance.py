import logging
from contextlib import contextmanager
from datetime import date
from typing import Literal

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from auth import get_current_user
from database import get_connection


logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/attendance",
    tags=["Attendance"],
    dependencies=[Depends(get_current_user)],
)


class SessionCreate(BaseModel):
    class_id: int = Field(gt=0)
    session_date: date
    period_number: int = Field(ge=1, le=20)


class AttendanceItem(BaseModel):
    student_id: int = Field(gt=0)
    status: Literal["present", "absent", "unmarked"]


class AttendanceSave(BaseModel):
    records: list[AttendanceItem] = Field(
        min_length=1,
        max_length=1000,
    )


@contextmanager
def attendance_cursor():
    try:
        with get_connection() as connection:
            with connection.cursor() as cursor:
                yield cursor

    except psycopg.errors.UniqueViolation:
        raise HTTPException(
            status_code=409,
            detail="A session already exists for this class, date, and period.",
        )

    except psycopg.errors.ForeignKeyViolation:
        raise HTTPException(
            status_code=409,
            detail="A linked record changed. Refresh and try again.",
        )

    except psycopg.OperationalError:
        logger.exception("Attendance database connection failed")
        raise HTTPException(
            status_code=503,
            detail="Database unavailable. Check the backend terminal.",
        )

    except psycopg.Error:
        logger.exception("Attendance database operation failed")
        raise HTTPException(
            status_code=500,
            detail="Could not process attendance. Check the backend terminal.",
        )


@router.post("/sessions", status_code=201)
def create_session(
    details: SessionCreate,
    current_user: dict = Depends(get_current_user),
):
    with attendance_cursor() as cursor:
        cursor.execute(
            "SELECT id FROM classes WHERE id = %s FOR UPDATE;",
            (details.class_id,),
        )

        if cursor.fetchone() is None:
            raise HTTPException(
                status_code=404,
                detail="Class not found.",
            )

        cursor.execute(
            """
            INSERT INTO attendance_sessions
                (class_id, session_date, period_number, created_by)
            VALUES (%s, %s, %s, %s)
            RETURNING
                id, class_id, session_date,
                period_number, created_by, created_at;
            """,
            (
                details.class_id,
                details.session_date,
                details.period_number,
                current_user["id"],
            ),
        )

        session = cursor.fetchone()

        # Snapshot the students enrolled when this session is created.
        cursor.execute(
            """
            INSERT INTO attendance_records (session_id, student_id)
            SELECT %s, student_id
            FROM class_students
            WHERE class_id = %s;
            """,
            (session["id"], details.class_id),
        )

        student_count = cursor.rowcount

        if student_count == 0:
            # Raising here rolls back the new session too.
            raise HTTPException(
                status_code=400,
                detail="Enroll students in this class before creating a session.",
            )

    return {
        **session,
        "student_count": student_count,
        "present_count": 0,
        "absent_count": 0,
        "unmarked_count": student_count,
    }


@router.get("/sessions")
def get_sessions(class_id: int = Query(gt=0)):
    with attendance_cursor() as cursor:
        cursor.execute(
            "SELECT id FROM classes WHERE id = %s;",
            (class_id,),
        )

        if cursor.fetchone() is None:
            raise HTTPException(
                status_code=404,
                detail="Class not found.",
            )

        cursor.execute(
            """
            SELECT
                s.id,
                s.class_id,
                s.session_date,
                s.period_number,
                s.created_at,
                COUNT(r.id) AS student_count,
                COUNT(r.id) FILTER (
                    WHERE r.status = 'present'
                ) AS present_count,
                COUNT(r.id) FILTER (
                    WHERE r.status = 'absent'
                ) AS absent_count,
                COUNT(r.id) FILTER (
                    WHERE r.status = 'unmarked'
                ) AS unmarked_count
            FROM attendance_sessions AS s
            LEFT JOIN attendance_records AS r
                ON r.session_id = s.id
            WHERE s.class_id = %s
            GROUP BY s.id
            ORDER BY
                s.session_date DESC,
                s.period_number DESC,
                s.id DESC;
            """,
            (class_id,),
        )

        sessions = cursor.fetchall()

    return sessions


@router.get("/sessions/{session_id}/records")
def get_session_records(session_id: int):
    with attendance_cursor() as cursor:
        cursor.execute(
            """
            SELECT
                s.id,
                s.class_id,
                c.class_name,
                s.session_date,
                s.period_number
            FROM attendance_sessions AS s
            JOIN classes AS c ON c.id = s.class_id
            WHERE s.id = %s;
            """,
            (session_id,),
        )

        session = cursor.fetchone()

        if session is None:
            raise HTTPException(
                status_code=404,
                detail="Attendance session not found.",
            )

        cursor.execute(
            """
            SELECT
                r.student_id,
                st.student_code,
                st.full_name,
                st.department,
                r.status,
                r.marked_by,
                r.marked_at
            FROM attendance_records AS r
            JOIN students AS st ON st.id = r.student_id
            WHERE r.session_id = %s
            ORDER BY st.full_name, st.id;
            """,
            (session_id,),
        )

        records = cursor.fetchall()

    return {
        "session": session,
        "records": records,
    }


@router.put("/sessions/{session_id}/records")
def save_attendance(
    session_id: int,
    details: AttendanceSave,
    current_user: dict = Depends(get_current_user),
):
    student_ids = [item.student_id for item in details.records]

    if len(student_ids) != len(set(student_ids)):
        raise HTTPException(
            status_code=422,
            detail="Each student must appear only once in the request.",
        )

    with attendance_cursor() as cursor:
        # Serialize saves for this session.
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
            SELECT student_id
            FROM attendance_records
            WHERE session_id = %s;
            """,
            (session_id,),
        )

        enrolled_ids = {
            row["student_id"] for row in cursor.fetchall()
        }

        if not set(student_ids).issubset(enrolled_ids):
            raise HTTPException(
                status_code=400,
                detail="One or more students do not belong to this session.",
            )

        for item in details.records:
            cursor.execute(
                """
                UPDATE attendance_records
                SET
                    status = %s,
                    marked_by = %s,
                    marked_at = CURRENT_TIMESTAMP
                WHERE session_id = %s AND student_id = %s;
                """,
                (
                    item.status,
                    current_user["id"],
                    session_id,
                    item.student_id,
                ),
            )

    return {
        "message": "Attendance saved successfully.",
        "session_id": session_id,
        "updated_count": len(details.records),
    }