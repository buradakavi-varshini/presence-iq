import { useEffect, useRef, useState } from "react";
import { apiFetch } from "./api";

function localDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function initialDates() {
  const today = new Date();

  return {
    start: localDateString(
      new Date(today.getFullYear(), today.getMonth(), 1)
    ),
    end: localDateString(today),
  };
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

  if (data === null) {
    throw new Error("The server returned an empty response.");
  }

  return data;
}

export default function AttendanceAlerts() {
  const [dates] = useState(initialDates);
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState("");
  const [startDate, setStartDate] = useState(dates.start);
  const [endDate, setEndDate] = useState(dates.end);
  const [threshold, setThreshold] = useState("75");

  const [loadingClasses, setLoadingClasses] = useState(true);
  const [loadingReport, setLoadingReport] = useState(false);
  const [classesError, setClassesError] = useState("");
  const [error, setError] = useState("");
  const [report, setReport] = useState(null);
  const [retry, setRetry] = useState(0);

  const reportControllerRef = useRef(null);
  const requestIdRef = useRef(0);

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
    return () => {
      requestIdRef.current += 1;
      reportControllerRef.current?.abort();
    };
  }, []);

  function clearReport() {
    requestIdRef.current += 1;
    reportControllerRef.current?.abort();
    reportControllerRef.current = null;
    setLoadingReport(false);
    setReport(null);
    setError("");
  }

  function changeFilter(setter, value) {
    clearReport();
    setter(value);
  }

  async function loadAlerts(event) {
    event.preventDefault();
    clearReport();

    const numericThreshold = Number(threshold);

    if (!classId || !startDate || !endDate) {
      setError("Choose a class, start date, and end date.");
      return;
    }

    if (startDate > endDate) {
      setError("Start date must be on or before end date.");
      return;
    }

    if (
      !Number.isFinite(numericThreshold) ||
      numericThreshold <= 0 ||
      numericThreshold > 100
    ) {
      setError("Enter a threshold greater than 0 and at most 100.");
      return;
    }

    const rangeInDays =
      (Date.parse(`${endDate}T00:00:00Z`) -
        Date.parse(`${startDate}T00:00:00Z`)) /
      86400000;

    if (!Number.isFinite(rangeInDays) || rangeInDays > 365) {
      setError("Choose a date range of at most 366 days.");
      return;
    }

    const controller = new AbortController();
    const requestId = ++requestIdRef.current;

    reportControllerRef.current = controller;
    setLoadingReport(true);

    try {
      const params = new URLSearchParams({
        class_id: classId,
        start_date: startDate,
        end_date: endDate,
        threshold: String(numericThreshold),
      });

      const response = await apiFetch(
        `/alerts/low-attendance?${params.toString()}`,
        { signal: controller.signal }
      );

      const data = await readResponse(response);

      if (
        !data.summary ||
        !data.class_details ||
        !Array.isArray(data.alerts)
      ) {
        throw new Error("The server returned an invalid alerts report.");
      }

      if (
        !controller.signal.aborted &&
        requestId === requestIdRef.current
      ) {
        setReport(data);
      }
    } catch (err) {
      if (
        !controller.signal.aborted &&
        requestId === requestIdRef.current
      ) {
        setError(err.message || "Could not load attendance alerts.");
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoadingReport(false);
        reportControllerRef.current = null;
      }
    }
  }

  const summaryCards = report
    ? [
        {
          label: "Class sessions",
          value: report.summary.session_count,
        },
        {
          label: "Students evaluated",
          value: report.summary.students_evaluated,
        },
        {
          label: `Below ${report.threshold}%`,
          value: report.summary.students_below_threshold,
        },
        {
          label: "Unmarked records",
          value: report.summary.unmarked_records,
        },
      ]
    : [];

  return (
    <div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Attendance alerts</h2>
            <p>
              Find students whose recorded attendance is below your
              selected threshold.
            </p>
          </div>
          <span className="soft-label">Attendance review</span>
        </div>

        <form className="student-form" onSubmit={loadAlerts}>
          <label>
            Class
            <select
              value={classId}
              onChange={(event) =>
                changeFilter(setClassId, event.target.value)
              }
              disabled={loadingClasses || classes.length === 0}
              required
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
            Start date
            <input
              type="date"
              value={startDate}
              onChange={(event) =>
                changeFilter(setStartDate, event.target.value)
              }
              required
            />
          </label>

          <label>
            End date
            <input
              type="date"
              value={endDate}
              onChange={(event) =>
                changeFilter(setEndDate, event.target.value)
              }
              required
            />
          </label>

          <label>
            Alert below (%)
            <input
              type="number"
              min="0.01"
              max="100"
              step="0.01"
              value={threshold}
              onChange={(event) =>
                changeFilter(setThreshold, event.target.value)
              }
              required
            />
          </label>

          <div className="form-actions">
            <button
              type="submit"
              className="primary-button"
              disabled={
                loadingClasses ||
                loadingReport ||
                !classId ||
                Boolean(classesError)
              }
            >
              {loadingReport ? "Checking attendance…" : "Check alerts"}
            </button>
          </div>
        </form>

        <p className="directory-message">
          Attendance percentage = Present ÷ (Present + Absent) × 100.
          Unmarked records are excluded. The threshold is a review
          setting, not an automatically enforced school rule.
        </p>

        {classesError && (
          <div>
            <p className="form-error" role="alert">
              {classesError}
            </p>
            <button
              type="button"
              className="student-action"
              onClick={() => {
                clearReport();
                setRetry((previous) => previous + 1);
              }}
            >
              Retry loading classes
            </button>
          </div>
        )}

        {!loadingClasses && !classesError && classes.length === 0 && (
          <p className="directory-message">
            Create a class on the Classes page first.
          </p>
        )}

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        {loadingReport && (
          <p className="directory-message" role="status">
            Reading saved attendance records…
          </p>
        )}
      </section>

      {report && (
        <section className="panel records-panel">
          <div className="panel-heading">
            <div>
              <h2>{report.class_details.class_name}</h2>
              <p>
                {report.start_date} to {report.end_date}
              </p>
            </div>

            <span className="soft-label">
              {report.alerts.length} attendance alerts
            </span>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(160px, 1fr))",
              gap: 16,
              marginBottom: 24,
            }}
          >
            {summaryCards.map((card) => (
              <div
                key={card.label}
                style={{
                  padding: 20,
                  borderRadius: 16,
                  background: "#f3f5ed",
                  border: "1px solid #dfe5d6",
                }}
              >
                <div style={{ fontSize: 13, color: "#52645b" }}>
                  {card.label}
                </div>
                <strong
                  style={{
                    display: "block",
                    marginTop: 8,
                    fontSize: 30,
                    color: "#213d35",
                  }}
                >
                  {card.value}
                </strong>
              </div>
            ))}
          </div>

          {report.summary.unmarked_records > 0 && (
            <p
              role="status"
              style={{
                padding: 16,
                borderRadius: 12,
                background: "#fff5df",
                color: "#755514",
              }}
            >
              There are {report.summary.unmarked_records} unmarked
              attendance records. Complete them on the Attendance page
              and check alerts again before making decisions.
            </p>
          )}

          {report.summary.students_without_marked_attendance > 0 && (
            <p className="directory-message">
              {report.summary.students_without_marked_attendance}{" "}
              student(s) have no marked attendance in this date range.
              They have not been assigned an attendance percentage.
            </p>
          )}

          {report.summary.session_count === 0 ? (
            <p className="directory-message">
              No attendance sessions were found in this date range.
            </p>
          ) : report.summary.students_evaluated === 0 ? (
            <p className="directory-message">
              No marked student attendance is available to evaluate.
            </p>
          ) : report.alerts.length === 0 ? (
            <p className="form-success" role="status">
              No evaluated students are below {report.threshold}% based
              on the marked records.
            </p>
          ) : (
            <div className="table-scroll" style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Present</th>
                    <th>Absent</th>
                    <th>Unmarked</th>
                    <th>Attendance</th>
                    <th>Review</th>
                  </tr>
                </thead>

                <tbody>
                  {report.alerts.map((student) => (
                    <tr key={student.student_id}>
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

                      <td>{student.present_count}</td>
                      <td>{student.absent_count}</td>
                      <td>{student.unmarked_count}</td>

                      <td>
                        <strong style={{ color: "#a34132" }}>
                          {Number(
                            student.attendance_percentage
                          ).toFixed(2)}
                          %
                        </strong>
                      </td>

                      <td>
                        {student.has_pending_attendance
                          ? "Complete pending attendance"
                          : "Review attendance"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="directory-message">
            These alerts are shown inside PresenceIQ. No messages are
            automatically sent to students or parents.
          </p>
        </section>
      )}
    </div>
  );
}