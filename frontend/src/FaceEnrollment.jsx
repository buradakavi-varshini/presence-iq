import { useEffect, useRef, useState } from "react";
import { apiFetch } from "./api";
async function readResponse(response) {
  const data = await response.json();
  if (!response.ok) {
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : "The request failed. Please try again.",
    );
  }
  return data;
}
const pictureStyle = {
  width: "100%",
  maxWidth: "640px",
  borderRadius: "14px",
  background: "#18372c",
  display: "block",
  marginTop: "18px",
};
export default function FaceEnrollment() {
  const [students, setStudents] = useState([]);
  const [studentId, setStudentId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [cameraOn, setCameraOn] = useState(false);
  const [startingCamera, setStartingCamera] = useState(false);
  const [photo, setPhoto] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const cameraRequest = useRef(0);
  const mounted = useRef(false);
  const mutationLock = useRef(false);
  const selectedStudent = students.find(
    (student) => String(student.id) === studentId,
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cameraRequest.current += 1;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    async function loadStudents() {
      setLoading(true);
      setLoadError("");
      try {
        const response = await apiFetch("/faces/students", {
          signal: controller.signal,
        });
        const data = await readResponse(response);
        if (!controller.signal.aborted) {
          setStudents(data);
          setStudentId((previous) =>
            data.some((student) => String(student.id) === previous)
              ? previous
              : data.length
                ? String(data[0].id)
                : "",
          );
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setLoadError(err.message);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }
    loadStudents();
    return () => controller.abort();
  }, [refreshKey]);
  function stopCamera() {
    cameraRequest.current += 1;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraOn(false);
    setStartingCamera(false);
  }
  function changeStudent(event) {
    stopCamera();
    setStudentId(event.target.value);
    setPhoto("");
    setConsent(false);
    setError("");
    setMessage("");
  }
  async function startCamera() {
    if (startingCamera || cameraOn || busy) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Open this page in Chrome using http://localhost:5173.");
      return;
    }
    const requestId = ++cameraRequest.current;
    setStartingCamera(true);
    setPhoto("");
    setConsent(false);
    setError("");
    setMessage("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      // Stop a late camera response if the user left or cancelled.
      if (!mounted.current || requestId !== cameraRequest.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        return;
      }
      video.srcObject = stream;
      setCameraOn(true);
      await video.play();
    } catch (err) {
      if (mounted.current && requestId === cameraRequest.current) {
        stopCamera();
        const messages = {
          NotAllowedError:
            "Camera permission was denied. Allow camera access in Chrome's site settings.",
          NotFoundError: "No camera was found. Connect a webcam and try again.",
          NotReadableError:
            "The camera could not start. Close other apps using it and try again.",
        };
        setError(
          messages[err.name] ||
            "Could not start the camera. Check camera access and try again.",
        );
      }
    } finally {
      if (mounted.current && requestId === cameraRequest.current) {
        setStartingCamera(false);
      }
    }
  }
  function capturePhoto() {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth) {
      setError("Wait until the camera preview appears, then capture.");
      return;
    }
    const scale = Math.min(
      1,
      1280 / Math.max(video.videoWidth, video.videoHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      setError("Could not capture the photo. Please try again.");
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    setPhoto(canvas.toDataURL("image/jpeg", 0.9));
    setError("");
    setMessage("");
    stopCamera();
  }
  async function enrollFace() {
    if (
      mutationLock.current ||
      !selectedStudent ||
      selectedStudent.face_enrolled ||
      !photo ||
      !consent
    ) {
      return;
    }
    mutationLock.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    const targetId = selectedStudent.id;
    try {
      // Convert the local preview into a file for the upload.
      const blob = await fetch(photo).then((response) => response.blob());
      const formData = new FormData();
      formData.append("photo", blob, "enrollment.jpg");
      const response = await apiFetch(`/faces/students/${targetId}`, {
        method: "POST",
        body: formData,
      });
      const result = await readResponse(response);
      if (mounted.current) {
        setStudents((previous) =>
          previous.map((student) =>
            student.id === targetId
              ? {
                  ...student,
                  face_enrolled: true,
                  enrolled_at: result.created_at,
                }
              : student,
          ),
        );
        setPhoto("");
        setConsent(false);
        setMessage(`${result.full_name}: face enrolled successfully.`);
      }
    } catch (err) {
      if (mounted.current) {
        setError(err.message);
      }
    } finally {
      mutationLock.current = false;
      if (mounted.current) {
        setBusy(false);
      }
    }
  }
  async function removeEnrollment() {
    if (mutationLock.current || !selectedStudent?.face_enrolled) {
      return;
    }
    const confirmed = window.confirm(
      `Remove the saved face enrollment for ${selectedStudent.full_name}? ` +
        "Their student record and attendance history will remain.",
    );
    if (!confirmed) return;
    const targetId = selectedStudent.id;
    mutationLock.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await apiFetch(`/faces/students/${targetId}`, {
        method: "DELETE",
      });
      await readResponse(response);
      if (mounted.current) {
        setStudents((previous) =>
          previous.map((student) =>
            student.id === targetId
              ? {
                  ...student,
                  face_enrolled: false,
                  enrolled_at: null,
                }
              : student,
          ),
        );
        setPhoto("");
        setConsent(false);
        setMessage("Face enrollment removed. You can enroll a new photo.");
      }
    } catch (err) {
      if (mounted.current) {
        setError(err.message);
      }
    } finally {
      mutationLock.current = false;
      if (mounted.current) {
        setBusy(false);
      }
    }
  }
  return (
    <div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Enroll a student's face</h2>
            <p>Select the correct student, capture a photo, and review it.</p>
          </div>
          <span className="soft-label">Face enrollment</span>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="form-success" role="status">
            {message}
          </p>
        )}
        {loading ? (
          <p className="directory-message">Loading students…</p>
        ) : loadError ? (
          <>
            <p className="form-error" role="alert">
              {loadError}
            </p>
            <button
              type="button"
              className="student-action"
              onClick={() => setRefreshKey((previous) => previous + 1)}
            >
              Retry
            </button>
          </>
        ) : students.length === 0 ? (
          <p className="directory-message">
            Register a student on the Students page first.
          </p>
        ) : (
          <>
            <div className="student-form">
              <label>
                Student
                <select
                  value={studentId}
                  onChange={changeStudent}
                  disabled={busy || startingCamera}
                >
                  {students.map((student) => (
                    <option key={student.id} value={student.id}>
                      {student.full_name} — {student.student_code}
                      {student.face_enrolled ? " — Enrolled" : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {selectedStudent?.face_enrolled ? (
              <>
                <p className="form-success">
                  This student already has a saved face enrollment.
                </p>
                <button
                  type="button"
                  className="student-action student-delete"
                  onClick={removeEnrollment}
                  disabled={busy}
                >
                  {busy ? "Removing…" : "Remove face enrollment"}
                </button>
              </>
            ) : (
              <>
                <p className="directory-message">
                  Face the camera in good lighting. Keep only one person in the
                  frame. Check the selected student's name before enrolling.
                </p>
                <div className="student-form-buttons">
                  <button
                    type="button"
                    className="student-action"
                    onClick={startCamera}
                    disabled={busy || cameraOn || startingCamera}
                  >
                    {startingCamera
                      ? "Starting camera…"
                      : photo
                        ? "Retake photo"
                        : "Start camera"}
                  </button>
                  {(cameraOn || startingCamera) && (
                    <button
                      type="button"
                      className="student-action"
                      onClick={stopCamera}
                      disabled={busy}
                    >
                      Stop camera
                    </button>
                  )}
                  {cameraOn && (
                    <button
                      type="button"
                      className="student-action"
                      onClick={capturePhoto}
                      disabled={busy || startingCamera}
                    >
                      Capture photo
                    </button>
                  )}
                </div>
              </>
            )}
          </>
        )}
        {/* Keep the video mounted so its ref is ready before starting. */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          aria-label="Live webcam preview"
          style={{
            ...pictureStyle,
            display: cameraOn ? "block" : "none",
          }}
        />
        {photo && !selectedStudent?.face_enrolled && (
          <>
            <img
              src={photo}
              alt="Captured enrollment photo"
              style={pictureStyle}
            />
            <label
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "10px",
                marginTop: "20px",
                fontSize: "13px",
                lineHeight: 1.6,
              }}
            >
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
                disabled={busy}
              />
              <span>
                This photo belongs to {selectedStudent?.full_name}, and they
                agree to face enrollment for attendance.
              </span>
            </label>
            <button
              type="button"
              className="primary-button"
              onClick={enrollFace}
              disabled={busy || !consent || loading || Boolean(loadError)}
            >
              {busy ? "Enrolling face…" : "Enroll face ↗"}
            </button>
          </>
        )}
      </section>
      <section className="panel records-panel">
        <div className="panel-heading">
          <div>
            <h2>Enrollment status</h2>
            <p>Saved face enrollments linked to student records.</p>
          </div>
        </div>
        {!loading && !loadError && students.length > 0 && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Department</th>
                  <th>Face enrollment</th>
                </tr>
              </thead>
              <tbody>
                {students.map((student) => (
                  <tr key={student.id}>
                    <td>
                      <div className="student">
                        <span className="avatar">
                          {student.full_name.charAt(0).toUpperCase()}
                        </span>
                        <div>
                          <strong>{student.full_name}</strong>
                          <small>{student.student_code}</small>
                        </div>
                      </div>
                    </td>
                    <td>{student.department}</td>
                    <td>
                      <span
                        className={`badge ${
                          student.face_enrolled ? "present" : "absent"
                        }`}
                      >
                        {student.face_enrolled ? "Enrolled" : "Not enrolled"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="directory-message">
          Enrollment stores a numerical face representation. Use Scan Attendance
          to mark attendance with basic anti-spoofing checks.
        </p>
      </section>
    </div>
  );
}
