# PresenceIQ — P-IQ

A full-stack attendance management project built with React, FastAPI, PostgreSQL, OpenCV, and DeepFace.

PresenceIQ helps staff manage students, organize classes, record attendance, and download reports. It also includes face enrollment, face-based attendance, and a separate facial-expression demonstration.

## Features

- Staff login using JWT authentication.
- Shared access for admin and teacher accounts.
- Student registration, editing, and deletion.
- Class creation and student enrollment.
- Attendance sessions with manual attendance marking.
- Face enrollment and face-based attendance.
- Basic image-based anti-spoofing checks.
- Dashboard summaries based on saved records.
- Low-attendance alerts.
- Attendance reports with PDF downloads.
- Optional facial-expression demonstration.

## Technology Stack

| Layer | Technologies |
| --- | --- |
| Frontend | React, Vite, CSS |
| Backend | Python, FastAPI |
| Database | PostgreSQL, Psycopg |
| Face processing | OpenCV, DeepFace, Facenet512 |
| Authentication | JWT, Argon2 password hashing |
| Reports | ReportLab |

## Project Structure

- `frontend/` — React application.
- `backend/` — FastAPI application and database integration.
- `.gitignore` — Files excluded from version control.
- `README.md` — Project documentation.

## Running the Existing Local Setup

These instructions assume dependencies are installed, the database schema is created, and a staff account has been configured.

### 1. Start PostgreSQL

Ensure the PostgreSQL service is running.

The current development setup uses:

- Host: `127.0.0.1`
- Port: `5433`
- Database: `presence_iq`

Configure database credentials and `JWT_SECRET_KEY` in `backend/.env`. Never commit this file.

### 2. Start the Backend

Open a PowerShell terminal at the project root:

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn main:app --reload
```

Backend: http://127.0.0.1:8000

API documentation: http://127.0.0.1:8000/docs

### 3. Start the Frontend

Open another PowerShell terminal at the project root:

```powershell
cd frontend
.\node_modules\.bin\vite.cmd --port 5173 --strictPort
```

Application: http://localhost:5173

Keep both terminals running while using the application.

## Typical Workflow

1. Log in with a staff account.
2. Register students.
3. Create a class and assign students.
4. Create an attendance session.
5. Mark attendance manually or enroll a face and scan attendance.
6. Review dashboard summaries and low-attendance alerts.
7. Download attendance reports.

A session uses the student roster captured when the session is created. Students added to a class afterward require a new session to appear in its roster.

## Facial-Expression Demonstration

The optional demonstration estimates visible facial-expression categories:

- Angry
- Disgust
- Fear
- Happy
- Sad
- Surprise
- Neutral

These model outputs do not establish a person's actual emotions, focus, confusion, tiredness, or classroom engagement.

Expression analysis is separate from attendance. The endpoint does not save the uploaded image or expression results to the database.

## Privacy and Limitations

- Face enrollment stores biometric embeddings and associated metadata.
- Use face features only with informed consent.
- Do not publish real student records, biometric embeddings, credentials, or database backups.
- Image-based anti-spoofing is a prototype feature and is not guaranteed to detect every spoofing attempt.
- Recognition can be affected by lighting, camera quality, pose, and image quality.
- Model scores and face distances are not measured system accuracy.
- Accuracy, security improvement, and monitoring-effort reductions have not been established through a formal evaluation.

## Development Status

PresenceIQ is a local demonstration project.

Deployment, broader testing, and production security and privacy review remain necessary before real-world school use.