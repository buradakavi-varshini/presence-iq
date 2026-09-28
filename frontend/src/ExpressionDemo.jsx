import { useEffect, useRef, useState } from "react";
import { apiFetch } from "./api";

const expressionColors = {
  happy: "#b49a42",
  neutral: "#526e61",
  surprise: "#7563a5",
  sad: "#527ca0",
  angry: "#b45c52",
  fear: "#986785",
  disgust: "#7a8450",
};

function displayLabel(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

async function readResponse(response) {
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      typeof data?.detail === "string"
        ? data.detail
        : `Request failed (${response.status}). Please try again.`
    );
  }

  if (!data) {
    throw new Error("The server returned an empty response.");
  }

  return data;
}

export default function ExpressionDemo() {
  const [cameraOn, setCameraOn] = useState(false);
  const [startingCamera, setStartingCamera] = useState(false);
  const [photo, setPhoto] = useState("");
  const [consent, setConsent] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const mountedRef = useRef(false);
  const cameraRequestRef = useRef(0);
  const cameraBusyRef = useRef(false);
  const analysisLockRef = useRef(false);
  const analysisControllerRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      cameraRequestRef.current += 1;
      cameraBusyRef.current = false;

      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;

      analysisControllerRef.current?.abort();
    };
  }, []);

  function stopCamera() {
    cameraRequestRef.current += 1;
    cameraBusyRef.current = false;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraOn(false);
    setStartingCamera(false);
  }

  async function startCamera() {
    if (analysisLockRef.current || cameraBusyRef.current) return;

    stopCamera();

    const requestId = ++cameraRequestRef.current;
    cameraBusyRef.current = true;

    setStartingCamera(true);
    setError("");
    setResult(null);
    setPhoto("");
    setConsent(false);

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
        throw new Error("Camera preview could not open.");
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
          "Close other apps using the camera, then try again."
        );
      } else {
        setError(err.message || "Could not start the camera.");
      }
    } finally {
      if (
        mountedRef.current &&
        requestId === cameraRequestRef.current
      ) {
        cameraBusyRef.current = false;
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
      canvas.width = Math.max(
        1,
        Math.round(video.videoWidth * scale)
      );
      canvas.height = Math.max(
        1,
        Math.round(video.videoHeight * scale)
      );

      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("Could not capture the photo.");
      }

      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      setPhoto(canvas.toDataURL("image/jpeg", 0.9));
      setConsent(false);
      setResult(null);
      setError("");
      stopCamera();
    } catch (err) {
      setError(err.message || "Could not capture the photo.");
    }
  }

  function clearDemo() {
    if (analysisLockRef.current) return;

    stopCamera();
    setPhoto("");
    setConsent(false);
    setResult(null);
    setError("");
  }

  async function analyzePhoto() {
    if (analysisLockRef.current) return;

    if (!photo || !consent) {
      setError("Capture a photo and confirm consent first.");
      return;
    }

    analysisLockRef.current = true;
    setAnalyzing(true);
    setError("");
    setResult(null);

    const controller = new AbortController();
    analysisControllerRef.current = controller;

    try {
      const photoResponse = await fetch(photo, {
        signal: controller.signal,
      });

      const blob = await photoResponse.blob();
      const formData = new FormData();

      formData.append("photo", blob, "expression-demo.jpg");
      formData.append("consent", "true");

      const response = await apiFetch("/expressions/analyze", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      const data = await readResponse(response);

      const expectedLabels = Object.keys(expressionColors);

      const scoresAreValid =
        Array.isArray(data.scores) &&
        data.scores.length === expectedLabels.length &&
        new Set(data.scores.map((item) => item.label)).size ===
          expectedLabels.length &&
        data.scores.every(
          (item) =>
            expectedLabels.includes(item.label) &&
            Number.isFinite(item.model_score_percent) &&
            item.model_score_percent >= 0 &&
            item.model_score_percent <= 100
        );

      if (
        !scoresAreValid ||
        !expectedLabels.includes(data.top_expression)
      ) {
        throw new Error("The server returned invalid expression scores.");
      }

      if (!mountedRef.current || controller.signal.aborted) return;

      setResult(data);
    } catch (err) {
      if (mountedRef.current && !controller.signal.aborted) {
        setError(err.message || "Expression analysis failed.");
      }
    } finally {
      analysisLockRef.current = false;

      if (analysisControllerRef.current === controller) {
        analysisControllerRef.current = null;
      }

      if (mountedRef.current) {
        setAnalyzing(false);
      }
    }
  }

  const busy = startingCamera || analyzing;

  return (
    <div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Explore facial expressions</h2>
            <p>
              Capture your own face and explore the model’s expression
              estimates.
            </p>
          </div>
          <span className="soft-label">Experimental demo</span>
        </div>

        <p className="directory-message">
          This demo estimates facial expressions. It does not measure
          attention, understanding, confusion, or tiredness. Results do
          not affect attendance.
        </p>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
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
              alt="Your captured photo for the expression demo"
              style={{
                display: "block",
                width: "100%",
                maxWidth: 640,
                borderRadius: 18,
              }}
            />

            <label
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                marginTop: 18,
                lineHeight: 1.6,
              }}
            >
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
                disabled={analyzing}
                style={{
                  width: 18,
                  height: 18,
                  marginTop: 4,
                  flexShrink: 0,
                  accentColor: "#244c3f",
                }}
              />
              <span>
                This is my photo, and I agree to send it to the backend
                for this expression demo. The demo does not save the
                photo or result to the database.
              </span>
            </label>
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
              disabled={busy}
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
                disabled={analyzing}
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
                onClick={analyzePhoto}
                disabled={busy || !consent}
              >
                {analyzing ? "Analyzing…" : "Analyze expression"}
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

          {(photo || result) && (
            <button
              type="button"
              className="student-action"
              onClick={clearDemo}
              disabled={busy}
            >
              Clear demo
            </button>
          )}
        </div>

        {analyzing && (
          <p className="directory-message" role="status">
            Checking the captured face and running expression analysis.
            The first analysis after starting the backend may take longer.
          </p>
        )}
      </section>

      {result && (
        <section className="panel records-panel">
          <div className="panel-heading">
            <div>
              <h2>Expression estimates</h2>
              <p role="status">
                Highest-scoring label:{" "}
                <strong>{displayLabel(result.top_expression)}</strong>
              </p>
            </div>
            <span className="soft-label">Model output</span>
          </div>

          <p className="directory-message">
            These percentages show the model’s distribution across
            expression labels. They are not accuracy percentages or
            proof of how you feel.
          </p>

          <div
            style={{
              display: "grid",
              gap: 20,
              marginTop: 24,
              marginBottom: 24,
            }}
          >
            {result.scores.map((item) => (
              <div key={item.label}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 16,
                    marginBottom: 8,
                  }}
                >
                  <strong>{displayLabel(item.label)}</strong>
                  <span>
                    {item.model_score_percent.toFixed(2)}%
                  </span>
                </div>

                <div
                  role="meter"
                  aria-label={`${displayLabel(item.label)} model score`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={item.model_score_percent}
                  style={{
                    height: 12,
                    overflow: "hidden",
                    borderRadius: 999,
                    background: "#edf0e7",
                  }}
                >
                  <div
                    style={{
                      width: `${item.model_score_percent}%`,
                      height: "100%",
                      borderRadius: 999,
                      background: expressionColors[item.label],
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          <p className="directory-message">
            Results remain on this page until you clear them, capture
            another photo, or leave the page. No attendance records
            were changed.
          </p>
        </section>
      )}
    </div>
  );
}