import { useEffect, useRef, useState } from "react";
import { apiFetch } from "./api";

function localDate(firstDay = false) {
  const now = new Date();

  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(firstDay ? 1 : now.getDate()).padStart(2, "0"),
  ].join("-");
}

async function readError(response) {
  const data = await response.json().catch(() => null);

  return typeof data?.detail === "string"
    ? data.detail
    : `Request failed (${response.status}). Please try again.`;
}

function displayRate(value) {
  return value === null ? "—" : `${value}%`;
}

export default function Reports() {
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState("");
  const [startDate, setStartDate] = useState(() => localDate(true));
  const [endDate, setEndDate] = useState(() => localDate());

  const [report, setReport] = useState(null);
  const [loadingClasses, setLoadingClasses] = useState(true);
  const [loadingReport, setLoadingReport] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const requestLock = useRef(false);
  const busy = loadingReport || downloading;

  useEffect(() => {
    const controller = new AbortController();

    async function loadClasses() {
      try {
        const response = await apiFetch("/classes", {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(await readError(response));
        }

        const data = await response.json();

        if (!controller.signal.aborted) {
          setClasses(data);
          setClassId(data.length ? String(data[0].id) : "");
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err.message);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoadingClasses(false);
        }
      }
    }

    loadClasses();

    return () => controller.abort();
  }, []);

  function updateFilter(setter, value) {
    setter(value);
    setReport(null);
    setError("");
    setMessage("");
  }

  async function generateReport(event) {
    event.preventDefault();

    if (requestLock.current) return;

    setError("");
    setMessage("");
    setReport(null);

    if (!classId || !startDate || !endDate) {
      setError("Select a class and both dates.");
      return;
    }

    if (startDate > endDate) {
      setError("Start date must be on or before end date.");
      return;
    }

    const days =
      (Date.parse(endDate) - Date.parse(startDate)) / 86400000;

    if (days > 365) {
      setError("Choose a date range no longer than 366 days.");
      return;
    }

    requestLock.current = true;
    setLoadingReport(true);

    try {
      const params = new URLSearchParams({
        class_id: classId,
        start_date: startDate,
        end_date: endDate,
      });

      const response = await apiFetch(`/reports/attendance?${params}`);

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const data = await response.json();
      setReport(data);
    } catch (err) {
      setError(err.message);
    } finally {
      requestLock.current = false;
      setLoadingReport(false);
    }
  }

  async function downloadPdf() {
    if (!report || requestLock.current) return;

    requestLock.current = true;
    setDownloading(true);
    setError("");
    setMessage("");

    try {
      // Use the displayed report's filters.
      const params = new URLSearchParams({
        class_id: String(report.class_details.id),
        start_date: report.start_date,
        end_date: report.end_date,
      });

      const response = await apiFetch(
        `/reports/attendance/pdf?${params}`
      );

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download =
        `presenceiq-class-${report.class_details.id}-` +
        `${report.start_date}-to-${report.end_date}.pdf`;

      document.body.appendChild(link);
      link.click();
      link.remove();

      // Allow the browser time to start the download.
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);

      setMessage("PDF download started. Check your browser downloads.");
    } catch (err) {
      setError(err.message);
    } finally {
      requestLock.current = false;
      setDownloading(false);
    }
  }

  const summary = report?.summary;

  return (
    <div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Attendance reports</h2>
            <p>Select a class and date range to view saved attendance.</p>
          </div>
          <span className="soft-label">PDF export</span>
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

        {loadingClasses ? (
          <p className="directory-message">Loading classes…</p>
        ) : classes.length === 0 ? (
          <p className="directory-message">
            No classes available. Create a class first.
          </p>
        ) : (
          <form className="student-form" onSubmit={generateReport}>
            <label>
              Class
              <select
                value={classId}
                onChange={(event) =>
                  updateFilter(setClassId, event.target.value)
                }
                disabled={busy}
                required
              >
                {classes.map((item) => (
                  <option key={item.id} value={item.id}>
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
                  updateFilter(setStartDate, event.target.value)
                }
                disabled={busy}
                required
              />
            </label>

            <label>
              End date
              <input
                type="date"
                value={endDate}
                onChange={(event) =>
                  updateFilter(setEndDate, event.target.value)
                }
                disabled={busy}
                required
              />
            </label>

            <div className="form-actions">
              <button
                type="submit"
                className="primary-button"
                disabled={busy}
              >
                {loadingReport ? "Generating…" : "Generate report ↗"}
              </button>
            </div>
          </form>
        )}
      </section>

      {report && (
        <>
          <div className="section-caption">
            <span>{report.class_details.class_name}</span>
            <span>
              {report.start_date} to {report.end_date}
            </span>
          </div>

          <div className="stats-grid">
            {[
              [
                "Sessions",
                summary.session_count,
                "Within the selected date range",
              ],
              [
                "Students in report",
                summary.student_count,
                "Included in historical session rosters",
              ],
              [
                "Attendance rate",
                displayRate(summary.attendance_rate),
                `${summary.present_count} present · ${summary.absent_count} absent`,
              ],
            ].map(([label, value, note], index) => (
              <article
                className="stat-card"
                key={label}
                style={{ "--delay": `${index * 70}ms` }}
              >
                <div className="stat-top">
                  <span>{label}</span>
                  <span className="stat-symbol">↗</span>
                </div>
                <strong className="stat-value">{value}</strong>
                <small>{note}</small>
              </article>
            ))}
          </div>

          <section className="panel records-panel">
            <div className="panel-heading">
              <div>
                <h2>Student attendance summary</h2>
                <p>
                  {summary.expected_records} student-session records ·{" "}
                  {summary.unmarked_count} unmarked
                </p>
              </div>

              <button
                type="button"
                className="student-action"
                onClick={downloadPdf}
                disabled={busy}
              >
                {downloading ? "Preparing PDF…" : "Download PDF ↓"}
              </button>
            </div>

            {report.students.length === 0 ? (
              <p className="directory-message">
                No attendance records exist for this class and date range.
              </p>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Sessions</th>
                      <th>Present</th>
                      <th>Absent</th>
                      <th>Unmarked</th>
                      <th>Rate</th>
                    </tr>
                  </thead>

                  <tbody>
                    {report.students.map((student) => (
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
                        <td>{student.expected_records}</td>
                        <td>{student.present_count}</td>
                        <td>{student.absent_count}</td>
                        <td>{student.unmarked_count}</td>
                        <td>{displayRate(student.attendance_rate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="directory-message">
              Rate = Present ÷ (Present + Absent) × 100.
              Unmarked records are excluded. — means no attendance
              has been marked. Each student’s session count includes
              only sessions whose roster contains that student.
            </p>

            <p className="directory-message">
              PDF downloads use the latest saved data for this date
              range. Regenerate the report after attendance changes
              to update this preview.
            </p>
          </section>
        </>
      )}
    </div>
  );
}