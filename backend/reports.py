import logging
from datetime import date
from io import BytesIO
from xml.sax.saxutils import escape

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from auth import get_current_user
from database import get_connection


logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/reports",
    tags=["Reports"],
    dependencies=[Depends(get_current_user)],
)


def calculate_rate(present, absent):
    marked = present + absent

    if marked == 0:
        return None

    return round(present * 100 / marked, 1)


def build_report(class_id, start_date, end_date):
    if start_date > end_date:
        raise HTTPException(
            status_code=422,
            detail="Start date must be on or before end date.",
        )

    if (end_date - start_date).days > 365:
        raise HTTPException(
            status_code=422,
            detail="Choose a date range no longer than 366 days.",
        )

    try:
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SET TRANSACTION ISOLATION LEVEL
                    REPEATABLE READ, READ ONLY;
                    """
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

                # Report historical session rosters, rather than
                # assuming today's enrollment applied to every session.
                cursor.execute(
                    """
                    SELECT
                        st.id AS student_id,
                        st.student_code,
                        st.full_name,
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
                    FROM attendance_records AS r
                    JOIN attendance_sessions AS s
                        ON s.id = r.session_id
                    JOIN students AS st
                        ON st.id = r.student_id
                    WHERE s.class_id = %s
                      AND s.session_date BETWEEN %s AND %s
                    GROUP BY st.id, st.student_code, st.full_name
                    ORDER BY st.full_name, st.id;
                    """,
                    (class_id, start_date, end_date),
                )

                students = cursor.fetchall()

    except psycopg.OperationalError:
        logger.exception("Report database connection failed")
        raise HTTPException(
            status_code=503,
            detail="Database unavailable. Check the backend terminal.",
        )

    except psycopg.Error:
        logger.exception("Report query failed")
        raise HTTPException(
            status_code=500,
            detail="Could not generate report. Check the backend terminal.",
        )

    for student in students:
        student["attendance_rate"] = calculate_rate(
            student["present_count"],
            student["absent_count"],
        )

    present = sum(item["present_count"] for item in students)
    absent = sum(item["absent_count"] for item in students)
    unmarked = sum(item["unmarked_count"] for item in students)

    return {
        "class_details": class_details,
        "start_date": start_date,
        "end_date": end_date,
        "summary": {
            "session_count": session_count,
            "student_count": len(students),
            "expected_records": present + absent + unmarked,
            "present_count": present,
            "absent_count": absent,
            "unmarked_count": unmarked,
            "attendance_rate": calculate_rate(present, absent),
        },
        "students": students,
    }


@router.get("/attendance")
def get_attendance_report(
    start_date: date,
    end_date: date,
    class_id: int = Query(gt=0),
):
    return build_report(class_id, start_date, end_date)


def page_footer(canvas, document):
    canvas.saveState()
    canvas.setFont("Helvetica", 9)
    canvas.setFillColor(colors.HexColor("#68766a"))

    canvas.drawString(
        document.leftMargin,
        22,
        "PresenceIQ | Attendance report",
    )

    canvas.drawRightString(
        landscape(A4)[0] - document.rightMargin,
        22,
        f"Page {document.page}",
    )

    canvas.restoreState()


@router.get(
    "/attendance/pdf",
    response_class=Response,
    responses={
        200: {
            "content": {"application/pdf": {}},
            "description": "Attendance report PDF",
        }
    },
)
def download_attendance_report(
    start_date: date,
    end_date: date,
    class_id: int = Query(gt=0),
):
    report = build_report(class_id, start_date, end_date)

    buffer = BytesIO()

    document = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        rightMargin=36,
        leftMargin=36,
        topMargin=36,
        bottomMargin=42,
        title="PresenceIQ Attendance Report",
        author="PresenceIQ",
    )

    styles = getSampleStyleSheet()
    styles["Title"].textColor = colors.HexColor("#234d40")
    styles["BodyText"].leading = 14

    def paragraph(value):
        return Paragraph(
            escape(str(value)),
            styles["BodyText"],
        )

    summary = report["summary"]
    rate = summary["attendance_rate"]
    rate_text = "Not available" if rate is None else f"{rate}%"

    story = [
        Paragraph("PresenceIQ Attendance Report", styles["Title"]),
        Spacer(1, 12),
        paragraph(
            f"Class: {report['class_details']['class_name']}"
        ),
        paragraph(
            f"Department: {report['class_details']['department']}"
        ),
        paragraph(f"Date range: {start_date} to {end_date}"),
        Spacer(1, 12),
        paragraph(
            f"Sessions: {summary['session_count']} | "
            f"Students in session rosters: {summary['student_count']}"
        ),
        paragraph(
            f"Present: {summary['present_count']} | "
            f"Absent: {summary['absent_count']} | "
            f"Unmarked: {summary['unmarked_count']} | "
            f"Rate: {rate_text}"
        ),
        Spacer(1, 16),
    ]

    if report["students"]:
        table_rows = [
            [
                "Roll number",
                "Student",
                "Sessions",
                "Present",
                "Absent",
                "Unmarked",
                "Rate",
            ]
        ]

        for student in report["students"]:
            student_rate = student["attendance_rate"]

            table_rows.append(
                [
                    paragraph(student["student_code"]),
                    paragraph(student["full_name"]),
                    str(student["expected_records"]),
                    str(student["present_count"]),
                    str(student["absent_count"]),
                    str(student["unmarked_count"]),
                    (
                        "N/A"
                        if student_rate is None
                        else f"{student_rate}%"
                    ),
                ]
            )

        table = Table(
            table_rows,
            colWidths=[125, 220, 75, 75, 75, 85, 75],
            repeatRows=1,
            hAlign="LEFT",
        )

        table.setStyle(
            TableStyle(
                [
                    (
                        "BACKGROUND",
                        (0, 0),
                        (-1, 0),
                        colors.HexColor("#234d40"),
                    ),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("FONTSIZE", (0, 0), (-1, -1), 9),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("ALIGN", (2, 0), (-1, -1), "CENTER"),
                    ("TOPPADDING", (0, 0), (-1, -1), 9),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
                    (
                        "ROWBACKGROUNDS",
                        (0, 1),
                        (-1, -1),
                        [
                            colors.HexColor("#f3f5ed"),
                            colors.white,
                        ],
                    ),
                    (
                        "LINEBELOW",
                        (0, 0),
                        (-1, 0),
                        1,
                        colors.HexColor("#234d40"),
                    ),
                ]
            )
        )

        story.append(table)

    else:
        story.append(
            paragraph("No attendance records exist for this date range.")
        )

    story.extend(
        [
            Spacer(1, 16),
            paragraph(
                "Rate = Present / (Present + Absent) x 100. "
                "Unmarked records are excluded. "
                "N/A means no attendance has been marked."
            ),
            paragraph(
                "Counts are per student per session. "
                "Only students included in session rosters during "
                "the selected date range appear in this report."
            ),
        ]
    )

    document.build(
        story,
        onFirstPage=page_footer,
        onLaterPages=page_footer,
    )

    filename = (
        f"presenceiq-class-{class_id}-{start_date}-to-{end_date}.pdf"
    )

    return Response(
        content=buffer.getvalue(),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )