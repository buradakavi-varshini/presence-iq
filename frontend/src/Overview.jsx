import { useEffect, useState } from "react";
import { apiFetch } from "./api";

function todayLocal() {
  const now = new Date();

  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatDate(value, options) {
  return new Date(`${value}T12:00:00`).toLocaleDateString(
    "en-IN",
    options
  );
}

export default function Overview({ onNavigate }) {
  const [reportDate, setReportDate] = useState(todayLocal);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadDashboard() {
      setLoading(true);
      setError("");
      setData(null);

      try {
        const response = await apiFetch(
          `/dashboard/summary?report_date=${encodeURIComponent(reportDate)}`,
          { signal: controller.signal }
        );

        const result = await response.json();

        if (!response.ok) {
          throw new Error(
            typeof result.detail === "string"
              ? result.detail
              : "Could not load the dashboard."
          );
        }

        if (!controller.signal.aborted) {
          setData(result);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err.message);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    loadDashboard();

    return () => controller.abort();
  }, [reportDate, refreshKey]);

  function changeDate(event) {
    const nextDate = event.target.value;

    if (!nextDate) return;

    setData(null);
    setLoading(true);
    setReportDate(nextDate);
  }

  const daily = data?.daily;
  const markedCount = daily
    ? daily.present_count + daily.absent_count
    : 0;

  const metrics = data
    ? [
        [
          "Registered students",
          data.total_students,
          "Current student directory total",
        ],
        [
          "Classes",
          data.total_classes,
          "Current class directory total",
        ],
        [
          "Sessions",
          daily.session_count,
          "For the selected date",
        ],
        [
          "Present records",
          daily.present_count,
          "One record per student per session",
        ],
        [
          "Absent records",
          daily.absent_count,
          "Explicitly marked absent",
        ],
        [
          "Attendance rate",
          daily.attendance_rate === null
            ? "—"
            : `${daily.attendance_rate}%`,
          `${markedCount} marked records · ${daily.unmarked_count} unmarked`,
        ],
      ]
    : [];

  return (
    <div>
      <section className="hero">
        <div className="hero-copy">
          <span className="hero-tag">PRESENCE MATTERS</span>

          <h2>
            Less paperwork.
            <br />
            <em>More possibility.</em>
          </h2>

          <p>
            Your students, classes, and saved attendance.
            A clearer picture of your campus.
          </p>

          <button
            type="button"
            className="primary-button"
            onClick={() => onNavigate("Attendance")}
          >
            Mark attendance <span>↗</span>
          </button>
        </div>

        <div className="orbital" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="orbit orbit-three" />

          <div className="orbit-core">
            IQ
            <span>CONNECTED CAMPUS</span>
          </div>

          <div className="orbit-dot" />
        </div>
      </section>

      <section className="panel records-panel">
        <div className="panel-heading">
          <div>
            <h2>Campus snapshot</h2>
            <p>Calculated from saved database records.</p>
          </div>

          <button
            type="button"
            className="student-action"
            onClick={() => setRefreshKey((previous) => previous + 1)}
            disabled={loading}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>

        <div className="student-form">
          <label>
            Attendance date
            <input
              type="date"
              value={reportDate}
              onChange={changeDate}
              required
            />
          </label>
        </div>

        <p className="directory-message">
          Student and class totals show the current directory.
          Attendance totals use the selected date.
        </p>
      </section>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="directory-message" role="status">
          Loading your dashboard…
        </p>
      ) : data ? (
        <>
          <div className="section-caption">
            <span>
              {formatDate(data.report_date, {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </span>
            <span>Saved attendance data</span>
          </div>

          <div className="stats-grid">
            {metrics.map(([label, value, note], index) => (
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

          <div className="details-grid">
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Attendance rhythm</h2>
                  <p>Seven days ending on the selected date.</p>
                </div>
                <span className="soft-label">7 days</span>
              </div>

              <div
                className="chart"
                aria-label="Daily attendance rates for the selected seven days"
              >
                {data.weekly.map((day, index) => {
                  const rate = day.attendance_rate;
                  const rateLabel = rate === null ? "—" : `${rate}%`;

                  return (
                    <div
                      className="chart-column"
                      key={day.session_date}
                      title={
                        `${day.session_date}: ` +
                        `${day.present_count} present, ` +
                        `${day.absent_count} absent, ` +
                        `${day.unmarked_count} unmarked`
                      }
                    >
                      <span className="bar-value">{rateLabel}</span>

                      <div className="bar-track">
                        <div
                          className={`bar ${
                            index === data.weekly.length - 1
                              ? "gold-bar"
                              : ""
                          }`}
                          style={{
                            height: `${rate ?? 0}%`,
                            "--delay": `${index * 80}ms`,
                          }}
                        />
                      </div>

                      <span className="day-label">
                        {formatDate(day.session_date, {
                          weekday: "short",
                        })}
                        <br />
                        {formatDate(day.session_date, {
                          day: "numeric",
                          month: "short",
                        })}
                      </span>
                    </div>
                  );
                })}
              </div>

              <p className="directory-message">
                — means no attendance was marked that day.
                Unmarked records are excluded from the percentage.
              </p>
            </section>

            <section className="insight-panel">
              <span className="insight-star" aria-hidden="true">
                ✳
              </span>

              <p className="eyebrow">ATTENDANCE PROGRESS</p>

              <h2>
                {daily.session_count === 0
                  ? "Start with a session."
                  : daily.unmarked_count > 0
                    ? "A few records need you."
                    : "All records are marked."}
              </h2>

              <p>
                {daily.session_count === 0
                  ? "There are no attendance sessions for the selected date."
                  : `${markedCount} of ${daily.expected_records} student-session records are marked. ${daily.unmarked_count} remain unmarked.`}
              </p>

              <button
                type="button"
                className="text-button"
                onClick={() => onNavigate("Attendance")}
              >
                Open attendance ↗
              </button>
            </section>
          </div>

          <section className="panel records-panel">
            <div className="panel-heading">
              <div>
                <h2>Daily breakdown</h2>
                <p>Saved attendance across all classes and periods.</p>
              </div>
            </div>

            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Sessions</th>
                    <th>Present</th>
                    <th>Absent</th>
                    <th>Unmarked</th>
                    <th>Rate</th>
                  </tr>
                </thead>

                <tbody>
                  {data.weekly.map((day) => (
                    <tr key={day.session_date}>
                      <td>
                        {formatDate(day.session_date, {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </td>
                      <td>{day.session_count}</td>
                      <td>{day.present_count}</td>
                      <td>{day.absent_count}</td>
                      <td>{day.unmarked_count}</td>
                      <td>
                        {day.attendance_rate === null
                          ? "—"
                          : `${day.attendance_rate}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="directory-message">
              Rate = Present ÷ (Present + Absent) × 100.
              One student attending two periods counts as two
              attendance records.
            </p>
          </section>
        </>
      ) : null}
    </div>
  );
}