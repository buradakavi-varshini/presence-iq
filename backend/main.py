import logging
from contextlib import contextmanager

import psycopg
from fastapi import APIRouter, Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field
from expressions import router as expressions_router

from database import get_connection

from auth import (
    require_admin,
    require_teacher_or_admin,
    router as auth_router,
)

from attendance import router as attendance_router
from dashboard import router as dashboard_router
from reports import router as reports_router
from faces import router as faces_router
from recognition import router as recognition_router
from alerts import router as alerts_router


app = FastAPI(title="PresenceIQ API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)

logger = logging.getLogger(__name__)

# All routes on this router require an active teacher or admin.
protected = APIRouter(
    dependencies=[Depends(require_teacher_or_admin)],
)


class StudentCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    student_code: str = Field(min_length=1, max_length=30)
    full_name: str = Field(min_length=1, max_length=100)
    email: str | None = Field(default=None, max_length=255)
    department: str = Field(min_length=1, max_length=100)


class ClassCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    class_name: str = Field(min_length=1, max_length=100)
    department: str = Field(min_length=1, max_length=100)


class ClassEnrollment(BaseModel):
    student_id: int = Field(gt=0)


@contextmanager
def database_cursor():
    try:
        with get_connection() as connection:
            with connection.cursor() as cursor:
                yield cursor

    except psycopg.errors.UniqueViolation as error:
        raise HTTPException(
            status_code=409,
            detail="A student with this roll number or email already exists.",
        ) from error

    except psycopg.errors.ForeignKeyViolation as error:
        raise HTTPException(
            status_code=409,
            detail="The operation conflicts with linked records.",
        ) from error

    except psycopg.OperationalError as error:
        logger.exception("Database connection failed")
        raise HTTPException(
            status_code=503,
            detail="Database unavailable. Check the backend terminal.",
        ) from error

    except psycopg.Error as error:
        logger.exception("Database operation failed")
        raise HTTPException(
            status_code=500,
            detail="Database operation failed. Check the backend terminal.",
        ) from error


# Public endpoints

@app.get("/")
def home():
    return {"message": "Welcome to PresenceIQ"}


@app.get("/health")
def health_check():
    return {"status": "ok"}


# Student endpoints

@protected.get("/students")
def get_students():
    with database_cursor() as cursor:
        cursor.execute(
            """
            SELECT
                id,
                student_code,
                full_name,
                email,
                department,
                created_at
            FROM students
            ORDER BY id;
            """
        )

        students = cursor.fetchall()

    return students


@protected.post(
    "/students",
    status_code=201,
    dependencies=[Depends(require_admin)],
)
def create_student(student: StudentCreate):
    with database_cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO students (
                student_code,
                full_name,
                email,
                department
            )
            VALUES (%s, %s, %s, %s)
            RETURNING
                id,
                student_code,
                full_name,
                email,
                department,
                created_at;
            """,
            (
                student.student_code,
                student.full_name,
                student.email or None,
                student.department,
            ),
        )

        new_student = cursor.fetchone()

    return new_student


@protected.put(
    "/students/{student_id}",
    dependencies=[Depends(require_admin)],
)
def update_student(student_id: int, student: StudentCreate):
    with database_cursor() as cursor:
        cursor.execute(
            """
            UPDATE students
            SET
                student_code = %s,
                full_name = %s,
                email = %s,
                department = %s
            WHERE id = %s
            RETURNING
                id,
                student_code,
                full_name,
                email,
                department,
                created_at;
            """,
            (
                student.student_code,
                student.full_name,
                student.email or None,
                student.department,
                student_id,
            ),
        )

        updated_student = cursor.fetchone()

        if updated_student is None:
            raise HTTPException(
                status_code=404,
                detail="Student not found.",
            )

    return updated_student


@protected.delete(
    "/students/{student_id}",
    dependencies=[Depends(require_admin)],
)
def delete_student(student_id: int):
    with database_cursor() as cursor:
        cursor.execute(
            """
            DELETE FROM students
            WHERE id = %s
            RETURNING id;
            """,
            (student_id,),
        )

        deleted_student = cursor.fetchone()

        if deleted_student is None:
            raise HTTPException(
                status_code=404,
                detail="Student not found.",
            )

    return {
        "message": "Student deleted successfully.",
        "id": deleted_student["id"],
    }


# Class endpoints

@protected.get("/classes")
def get_classes():
    with database_cursor() as cursor:
        cursor.execute(
            """
            SELECT
                c.id,
                c.class_name,
                c.department,
                c.created_at,
                COUNT(cs.student_id) AS student_count
            FROM classes AS c
            LEFT JOIN class_students AS cs
                ON c.id = cs.class_id
            GROUP BY
                c.id,
                c.class_name,
                c.department,
                c.created_at
            ORDER BY c.id;
            """
        )

        classes = cursor.fetchall()

    return classes


@protected.post(
    "/classes",
    status_code=201,
    dependencies=[Depends(require_admin)],
)
def create_class(class_details: ClassCreate):
    with database_cursor() as cursor:
        try:
            cursor.execute(
                """
                INSERT INTO classes (
                    class_name,
                    department
                )
                VALUES (%s, %s)
                RETURNING
                    id,
                    class_name,
                    department,
                    created_at;
                """,
                (
                    class_details.class_name,
                    class_details.department,
                ),
            )

        except psycopg.errors.UniqueViolation as error:
            raise HTTPException(
                status_code=409,
                detail="A class with this name already exists.",
            ) from error

        new_class = cursor.fetchone()

    return {
        **new_class,
        "student_count": 0,
    }


@protected.post(
    "/classes/{class_id}/students",
    status_code=201,
    dependencies=[Depends(require_admin)],
)
def enroll_student(class_id: int, enrollment: ClassEnrollment):
    with database_cursor() as cursor:
        cursor.execute(
            """
            SELECT id
            FROM classes
            WHERE id = %s
            FOR KEY SHARE;
            """,
            (class_id,),
        )

        if cursor.fetchone() is None:
            raise HTTPException(
                status_code=404,
                detail="Class not found.",
            )

        cursor.execute(
            """
            SELECT id
            FROM students
            WHERE id = %s
            FOR KEY SHARE;
            """,
            (enrollment.student_id,),
        )

        if cursor.fetchone() is None:
            raise HTTPException(
                status_code=404,
                detail="Student not found.",
            )

        cursor.execute(
            """
            INSERT INTO class_students (
                class_id,
                student_id
            )
            VALUES (%s, %s)
            ON CONFLICT (class_id, student_id) DO NOTHING
            RETURNING class_id, student_id;
            """,
            (class_id, enrollment.student_id),
        )

        membership = cursor.fetchone()

        if membership is None:
            raise HTTPException(
                status_code=409,
                detail="This student is already assigned to this class.",
            )

    return {
        "message": "Student assigned successfully.",
        **membership,
    }


@protected.get("/classes/{class_id}/students")
def get_class_students(class_id: int):
    with database_cursor() as cursor:
        cursor.execute(
            """
            SELECT id
            FROM classes
            WHERE id = %s;
            """,
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
                s.student_code,
                s.full_name,
                s.email,
                s.department
            FROM students AS s
            INNER JOIN class_students AS cs
                ON s.id = cs.student_id
            WHERE cs.class_id = %s
            ORDER BY s.full_name, s.id;
            """,
            (class_id,),
        )

        students = cursor.fetchall()

    return students


# Register each router once.

app.include_router(auth_router)
app.include_router(protected)

app.include_router(
    attendance_router,
    dependencies=[Depends(require_teacher_or_admin)],
)

app.include_router(
    dashboard_router,
    dependencies=[Depends(require_teacher_or_admin)],
)

app.include_router(
    reports_router,
    dependencies=[Depends(require_teacher_or_admin)],
)

app.include_router(
    faces_router,
    dependencies=[Depends(require_teacher_or_admin)],
)

app.include_router(
    recognition_router,
    dependencies=[Depends(require_teacher_or_admin)],
)

app.include_router(
    alerts_router,
    dependencies=[Depends(require_teacher_or_admin)],
)

app.include_router(expressions_router)