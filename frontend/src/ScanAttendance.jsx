import { useEffect, useRef, useState } from "react";
import { apiFetch } from "./api";

async function readResponse(response) {
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      typeof data?.detail === "string"
        ? data.detail
        : `Request failed (${response.status}). Please try again.`
    );
  }

  if (data === null) {
    throw new Error("The server returned an empty response.");
  }

  return data;
}

export default function ScanAttendance() {
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState("");
  const [sessions, setSessions] = useState([]);
  const [sessionId, setSessionId] = useState("");

  const [loadingClasses, setLoadingClasses] = useState(true);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [classesError, setClassesError] = useState("");
  const [sessionsError, setSessionsError] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  const [cameraOn, setCameraOn] = useState(false);
  const [startingCamera, setStartingCamera] = useState(false);
  const [photo, setPhoto] = useState("");
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState(null);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const cameraRequestRef = useRef(0);
  const scanLockRef = useRef(false);
  const scanControllerRef = useRef(null);
  const mountedRef = useRef(false);

  const selectedClass = classes.find(
    (item) => String(item.id) === classId
  );

  const selectedSession = sessions.find(
    (item) => String(item.id) === sessionId
  );

  const busy = scanning || startingCamera;

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      cameraRequestRef.current += 1;

      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;

      scanControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function loadClasses() {
      setLoadingClasses(true);
      setClassesError("");

      try {
        const response = await apiFetch("/classes", {
          signal: controller.signal,
        });

        const data = await readResponse(response);

        if (!Array.isArray(data)) {
          throw new Error("The server returned an invalid class list.");
        }

        if (controller.signal.aborted) return;

        setClasses(data);
        setClassId((previous) =>
          data.some((item) => String(item.id) === previous)
            ? previous
            : data.length > 0
              ? String(data[0].id)
              : ""
        );
      } catch (err) {
        if (!controller.signal.aborted) {
          setClassesError(err.message || "Could not load classes.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoadingClasses(false);
        }
      }
    }

    loadClasses();

    return () => controller.abort();
  }, [retry]);

  useEffect(() => {
    const controller = new AbortController();

    setSessions([]);
    setSessionId("");
    setSessionsError("");

    if (!classId) {
      setLoadingSessions(false);
      return () => controller.abort();
    }

    async function loadSessions() {
      setLoadingSessions(true);

      try {
        const response = await apiFetch(
          `/attendance/sessions?class_id=${encodeURIComponent(classId)}`,
          { signal: controller.signal }
        );

        const data = await readResponse(response);

        if (!Array.isArray(data)) {
          throw new Error("The server returned an invalid session list.");
        }

        if (!controller.signal.aborted) {
          setSessions(data);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setSessionsError(err.message || "Could not load sessions.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoadingSessions(false);
        }
      }
    }

    loadSessions();

    return () => controller.abort();
  }, [classId, retry]);

  function stopCamera() {
    cameraRequestRef.current += 1;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraOn(false);
    setStartingCamera(false);
  }

  function clearCapture() {
    stopCamera();
    setPhoto("");
    setResult(null);
    setError("");
  }

  function handleClassChange(event) {
    clearCapture();
    setSessions([]);
    setSessionId("");
    setClassId(event.target.value);
  }

  function handleSessionChange(event) {
    clearCapture();
    setSessionId(event.target.value);
  }

  function refreshLists() {
    clearCapture();
    setSessionId("");
    setRetry((previous) => previous + 1);
  }

  async function startCamera() {
    if (!selectedSession || scanning || startingCamera) return;

    stopCamera();

    const requestId = ++cameraRequestRef.current;

    setError("");
    setResult(null);
    setPhoto("");
    setStartingCamera(true);

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          "Camera access is unavailable. Open the app using localhost or HTTPS."
        );
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      if (
        !mountedRef.current ||
        requestId !== cameraRequestRef.current
      ) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;

      const video = videoRef.current;

      if (!video) {
        throw new Error("Camera preview could not open. Please try again.");
      }

      video.srcObject = stream;
      await video.play();

      if (
        !mountedRef.current ||
        requestId !== cameraRequestRef.current
      ) {
        return;
      }

      setCameraOn(true);
    } catch (err) {
      if (
        !mountedRef.current ||
        requestId !== cameraRequestRef.current
      ) {
        return;
      }

      stopCamera();

      if (err.name === "NotAllowedError") {
        setError(
          "Camera permission was denied. Allow camera access in your browser."
        );
      } else if (err.name === "NotFoundError") {
        setError("No camera was found on this device.");
      } else if (err.name === "NotReadableError") {
        setError(
          "The camera could not start. Close other apps using it and try again."
        );
      } else {
        setError(err.message || "Could not start the camera.");
      }
    } finally {
      if (
        mountedRef.current &&
        requestId === cameraRequestRef.current
      ) {
        setStartingCamera(false);
      }
    }
  }

  function capturePhoto() {
    const video = videoRef.current;

    if (
      !video ||
      video.readyState < 2 ||
      !video.videoWidth ||
      !video.videoHeight
    ) {
      setError("Wait for the camera preview, then capture again.");
      return;
    }

    try {
      const scale = Math.min(
        1,
        1280 / Math.max(video.videoWidth, video.videoHeight)
      );

      const canvas = document.createElement("canvas");

      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));

      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("Could not capture the photo.");
      }

      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      setPhoto(canvas.toDataURL("image/jpeg", 0.9));
      setResult(null);
      setError("");
      stopCamera();
    } catch (err) {
      setError(err.message || "Could not capture the photo.");
    }
  }

  async function scanAttendance() {
    if (scanLockRef.current) return;

    if (!selectedSession || !photo) {
      setError("Choose a session and capture a photo first.");
      return;
    }

    scanLockRef.current = true;
    setScanning(true);
    setError("");
    setResult(null);

    const controller = new AbortController();
    scanControllerRef.current = controller;

    try {
      const photoResponse = await fetch(photo, {
        signal: controller.signal,
      });

      const blob = await photoResponse.blob();
      const formData = new FormData();

      formData.append("photo", blob, "attendance.jpg");

      const response = await apiFetch(
        `/recognition/sessions/${encodeURIComponent(sessionId)}/scan`,
        {
          method: "POST",
          body: formData,
          signal: controller.signal,
        }
      );

      const data = await readResponse(response);

      if (typeof data.matched !== "boolean") {
        throw new Error("The server returned an invalid scan result.");
      }

      if (!mountedRef.current || controller.signal.aborted) return;

      setResult(data);
      setPhoto("");
    } catch (err) {
      if (mountedRef.current && !controller.signal.aborted) {
        setError(err.message || "Could not scan attendance.");
      }
    } finally {
      scanLockRef.current = false;

      if (scanControllerRef.current === controller) {
        scanControllerRef.current = null;
      }

      if (mountedRef.current) {
        setScanning(false);
      }
    }
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Scan attendance</h2>
          <p>Choose a class session, then capture one enrolled student.</p>
        </div>

        <span className="soft-label">Supervised prototype</span>
      </div>

      <p className="directory-message">
        An accepted match is immediately saved as Present. Unknown or
        ambiguous matches leave attendance unchanged. Basic anti-spoofing
        is enabled. Use your live face directly in front of the camera.
      </p>

      {classesError && (
        <p className="form-error" role="alert">
          {classesError}
        </p>
      )}

      {sessionsError && (
        <p className="form-error" role="alert">
          {sessionsError}
        </p>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="student-form">
        <label>
          Class
          <select
            value={classId}
            onChange={handleClassChange}
            disabled={busy || loadingClasses || classes.length === 0}
          >
            <option value="">
              {loadingClasses ? "Loading classes…" : "Choose a class"}
            </option>

            {classes.map((item) => (
              <option key={item.id} value={String(item.id)}>
                {item.class_name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Attendance session
          <select
            value={sessionId}
            onChange={handleSessionChange}
            disabled={
              busy ||
              loadingClasses ||
              loadingSessions ||
              !classId ||
              sessions.length === 0
            }
          >
            <option value="">
              {loadingSessions
                ? "Loading sessions…"
                : "Choose the correct date and period"}
            </option>

            {sessions.map((session) => (
              <option key={session.id} value={String(session.id)}>
                {session.session_date} — Period {session.period_number}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!loadingClasses && !classesError && classes.length === 0 && (
        <p className="directory-message">
          Create a class and assign students on the Classes page first.
        </p>
      )}

      {classId &&
        !loadingSessions &&
        !sessionsError &&
        sessions.length === 0 && (
          <p className="directory-message">
            No sessions found for this class. Create a session on the
            Attendance page, then click Refresh sessions below.
          </p>
        )}

      <div className="form-actions" style={{ marginTop: 16 }}>
        <button
          type="button"
          className="student-action"
          onClick={refreshLists}
          disabled={busy || loadingClasses || loadingSessions}
        >
          Refresh sessions
        </button>
      </div>

      {selectedSession && (
        <div className="directory-message" style={{ marginTop: 20 }}>
          <strong>{selectedClass?.class_name}</strong>
          <div>
            {selectedSession.session_date} · Period{" "}
            {selectedSession.period_number}
          </div>
          <div>Check this date and period before scanning.</div>
        </div>
      )}

      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        aria-label="Live camera preview"
        style={{
          display: cameraOn ? "block" : "none",
          width: "100%",
          maxWidth: 640,
          borderRadius: 18,
          marginTop: 20,
          background: "#182b24",
          transform: "scaleX(-1)",
        }}
      />

      {photo && (
        <div style={{ marginTop: 20 }}>
          <img
            src={photo}
            alt="Captured photo for attendance verification"
            style={{
              display: "block",
              width: "100%",
              maxWidth: 640,
              borderRadius: 18,
            }}
          />
          <p className="directory-message">
            Make sure only one face is clearly visible.
          </p>
        </div>
      )}

      <div
        className="form-actions"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          marginTop: 20,
        }}
      >
        {!cameraOn && !photo && (
          <button
            type="button"
            className="primary-button"
            onClick={startCamera}
            disabled={
              busy ||
              loadingClasses ||
              loadingSessions ||
              !selectedSession
            }
          >
            {startingCamera ? "Opening camera…" : "Start camera"}
          </button>
        )}

        {cameraOn && (
          <>
            <button
              type="button"
              className="primary-button"
              onClick={capturePhoto}
              disabled={busy}
            >
              Capture photo
            </button>

            <button
              type="button"
              className="student-action"
              onClick={stopCamera}
              disabled={scanning}
            >
              Stop camera
            </button>
          </>
        )}

        {photo && (
          <>
            <button
              type="button"
              className="primary-button"
              onClick={scanAttendance}
              disabled={busy || !selectedSession}
            >
              {scanning ? "Checking face…" : "Scan attendance"}
            </button>

            <button
              type="button"
              className="student-action"
              onClick={startCamera}
              disabled={busy}
            >
              Retake photo
            </button>
          </>
        )}
      </div>

      {scanning && (
        <p className="directory-message" role="status">
          Checking anti-spoofing and matching the student. Please stay on
          this page until the result appears.
        </p>
      )}

      {result?.matched === true && (
        <div
          className="form-success"
          role="status"
          style={{ marginTop: 20 }}
        >
          <strong>
            {result.full_name}
            {result.already_present
              ? " is already marked present."
              : " marked present."}
          </strong>

          <p>Roll number: {result.student_code}</p>

          <p>
            {result.already_present
              ? "The existing attendance record was left unchanged."
              : "Attendance has been saved to the database."}
          </p>

          <p>
            Verify that the displayed student is correct. If the match is
            incorrect, correct the record on the Attendance page.
          </p>
        </div>
      )}

      {result?.matched === false && (
        <div
          className="directory-message"
          role="status"
          style={{ marginTop: 20 }}
        >
          <strong>No attendance change was made.</strong>
          <p>
            {result.message ||
              "The face could not be matched confidently. Capture a new photo and try again."}
          </p>
        </div>
      )}
    </section>
  );
}