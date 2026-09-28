import logging
from datetime import date, timedelta

import psycopg
from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_user
from database import get_connection


logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/dashboard",
    tags=["Dashboard"],
    dependencies=[Depends(get_current_user)],
)


def attendance_rate(present, absent):
    marked = present + absent

    if marked == 0:
        return None

    return round(present * 100 / marked, 1)


@router.get("/summary")
def get_dashboard_summary(report_date: date):
    start_date = report_date - timedelta(days=6)

    try:
        with get_connection() as connection:
            with connection.cursor() as cursor:
                # Use one consistent database snapshot for these totals.
                cursor.execute(
                    "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY;"
                )

                cursor.execute(
                    """
                    SELECT
                        (SELECT COUNT(*) FROM students) AS total_students,
                        (SELECT COUNT(*) FROM classes) AS total_classes;
                    """
                )
                totals = cursor.fetchone()

                cursor.execute(
                    """
                    SELECT
                        COUNT(DISTINCT s.id) AS session_count,
                        COUNT(r.id) AS expected_records,
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
                    WHERE s.session_date = %s;
                    """,
                    (report_date,),
                )
                daily = cursor.fetchone()

                cursor.execute(
                    """
                    SELECT
                        s.session_date,
                        COUNT(DISTINCT s.id) AS session_count,
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
                    WHERE s.session_date BETWEEN %s AND %s
                    GROUP BY s.session_date
                    ORDER BY s.session_date;
                    """,
                    (start_date, report_date),
                )
                weekly_rows = cursor.fetchall()

    except psycopg.OperationalError:
        logger.exception("Dashboard database connection failed")
        raise HTTPException(
            status_code=503,
            detail="Database unavailable. Check the backend terminal.",
        )

    except psycopg.Error:
        logger.exception("Dashboard query failed")
        raise HTTPException(
            status_code=500,
            detail="Could not load dashboard. Check the backend terminal.",
        )

    daily["attendance_rate"] = attendance_rate(
        daily["present_count"],
        daily["absent_count"],
    )

    rows_by_date = {
        row["session_date"]: row
        for row in weekly_rows
    }

    weekly = []

    for offset in range(7):
        current_date = start_date + timedelta(days=offset)
        row = rows_by_date.get(current_date)

        if row is None:
            row = {
                "session_date": current_date,
                "session_count": 0,
                "present_count": 0,
                "absent_count": 0,
                "unmarked_count": 0,
            }

        weekly.append(
            {
                **row,
                "attendance_rate": attendance_rate(
                    row["present_count"],
                    row["absent_count"],
                ),
            }
        )

    return {
        "report_date": report_date,
        **totals,
        "daily": daily,
        "weekly": weekly,
    }