import { useEffect, useRef, useState } from "react";
import { apiFetch } from "./api";

function todayLocal() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function readResponse(response) {
  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : "Could not complete the request. Check your details."
    );
  }

  return data;
}

export default function Attendance() {
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState("");
  const [sessionDate, setSessionDate] = useState(todayLocal);
  const [period, setPeriod] = useState("1");

  const [sessions, setSessions] = useState([]);
  const [sessionId, setSessionId] = useState("");
  const [records, setRecords] = useState([]);

  const [loadingClasses, setLoadingClasses] = useState(true);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const mutationLock = useRef(false);

  const busy = creating || saving;

  useEffect(() => {
    const controller = new AbortController();

    async function loadClasses() {
      try {
        const response = await apiFetch("/classes", {
          signal: controller.signal,
        });
        const data = await readResponse(response);

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

  useEffect(() => {
    if (!classId) return;

    const controller = new AbortController();
    setLoadingSessions(true);

    async function loadSessions() {
      try {
        const response = await apiFetch(
          `/attendance/sessions?class_id=${classId}`,
          { signal: controller.signal }
        );
        const data = await readResponse(response);

        if (!controller.signal.aborted) {
          setSessions(data);
          setSessionId(data.length ? String(data[0].id) : "");
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err.message);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoadingSessions(false);
        }
      }
    }

    loadSessions();
    return () => controller.abort();
  }, [classId]);

  useEffect(() => {
    if (!sessionId) return;

    const controller = new AbortController();
    setLoadingRecords(true);

    async function loadRecords() {
      try {
        const response = await apiFetch(
          `/attendance/sessions/${sessionId}/records`,
          { signal: controller.signal }
        );
        const data = await readResponse(response);

        if (!controller.signal.aborted) {
          setRecords(data.records);
          setDirty(false);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err.message);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoadingRecords(false);
        }
      }
    }

    loadRecords();
    return () => controller.abort();
  }, [sessionId]);

  // Warn before closing or refreshing with unsaved changes.
  useEffect(() => {
    if (!dirty) return;

    function warnBeforeLeaving(event) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () =>
      window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [dirty]);

  function canDiscardChanges() {
    return (
      !dirty ||
      window.confirm("Discard your unsaved attendance changes?")
    );
  }

  function changeClass(event) {
    if (!canDiscardChanges()) return;

    setClassId(event.target.value);
    setSessions([]);
    setSessionId("");
    setRecords([]);
    setDirty(false);
    setError("");
    setMessage("");
    setLoadingRecords(false);
  }

  function changeSession(event) {
    if (!canDiscardChanges()) return;

    setSessionId(event.target.value);
    setRecords([]);
    setDirty(false);
    setError("");
    setMessage("");
  }

  async function createSession(event) {
    event.preventDefault();

    if (mutationLock.current || !classId) return;
    if (!canDiscardChanges()) return;

    mutationLock.current = true;
    setCreating(true);
    setError("");
    setMessage("");

    try {
      const response = await apiFetch("/attendance/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          class_id: Number(classId),
          session_date: sessionDate,
          period_number: Number(period),
        }),
      });

      const session = await readResponse(response);

      setSessions((previous) =>
        [session, ...previous].sort(
          (a, b) =>
            b.session_date.localeCompare(a.session_date) ||
            b.period_number - a.period_number
        )
      );
      setRecords([]);
      setDirty(false);
      setSessionId(String(session.id));
      setMessage("Session created. Mark attendance below.");
    } catch (err) {
      setError(err.message);
    } finally {
      mutationLock.current = false;
      setCreating(false);
    }
  }

  function changeStatus(studentId, status) {
    setRecords((previous) =>
      previous.map((record) =>
        record.student_id === studentId
          ? { ...record, status }
          : record
      )
    );
    setDirty(true);
    setMessage("");
  }

  function markAllPresent() {
    setRecords((previous) =>
      previous.map((record) => ({
        ...record,
        status: "present",
      }))
    );
    setDirty(true);
    setMessage("");
  }

  async function saveAttendance() {
    if (mutationLock.current || !sessionId || !records.length) {
      return;
    }

    mutationLock.current = true;
    setSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await apiFetch(
        `/attendance/sessions/${sessionId}/records`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            records: records.map((record) => ({
              student_id: record.student_id,
              status: record.status,
            })),
          }),
        }
      );

      await readResponse(response);

      setDirty(false);
      setMessage("Attendance saved successfully.");
    } catch (err) {
      setError(err.message);
    } finally {
      mutationLock.current = false;
      setSaving(false);
    }
  }

  const presentCount = records.filter(
    (record) => record.status === "present"
  ).length;

  const absentCount = records.filter(
    (record) => record.status === "absent"
  ).length;

  const unmarkedCount = records.length - presentCount - absentCount;

  const selectedSession = sessions.find(
    (session) => String(session.id) === sessionId
  );

  return (
    <div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Attendance sessions</h2>
            <p>Select a class and create a session for its date and period.</p>
          </div>
          <span className="soft-label">Class attendance</span>
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
            No classes available. Create a class and enroll students first.
          </p>
        ) : (
          <form className="student-form" onSubmit={createSession}>
            <label>
              Class
              <select
                value={classId}
                onChange={changeClass}
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
              Date
              <input
                type="date"
                value={sessionDate}
                onChange={(event) => setSessionDate(event.target.value)}
                disabled={busy}
                required
              />
            </label>

            <label>
              Period number
              <input
                type="number"
                min="1"
                max="20"
                step="1"
                value={period}
                onChange={(event) => setPeriod(event.target.value)}
                disabled={busy}
                required
              />
            </label>

            <div className="form-actions">
              <button
                type="submit"
                className="primary-button"
                disabled={busy || loadingSessions || loadingRecords}
              >
                {creating ? "Creating…" : "Create session ↗"}
              </button>
            </div>
          </form>
        )}
      </section>

      {classId && (
        <section className="panel records-panel">
          <div className="panel-heading">
            <div>
              <h2>Mark attendance</h2>
              <p>Open an existing session or create one above.</p>
            </div>
            {dirty && (
              <span className="soft-label">Unsaved changes</span>
            )}
          </div>

          {loadingSessions ? (
            <p className="directory-message">Loading sessions…</p>
          ) : sessions.length === 0 ? (
            <p className="directory-message">
              No sessions to display for this class.
            </p>
          ) : (
            <>
              <div className="student-form">
                <label>
                  Session
                  <select
                    value={sessionId}
                    onChange={changeSession}
                    disabled={busy}
                  >
                    {sessions.map((session) => (
                      <option key={session.id} value={session.id}>
                        {session.session_date} — Period{" "}
                        {session.period_number}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {loadingRecords ? (
                <p className="directory-message">Loading students…</p>
              ) : records.length === 0 ? (
                <p className="directory-message">
                  No student records to display.
                </p>
              ) : (
                <>
                  <div className="section-caption">
                    <span>
                      {selectedSession?.session_date} · Period{" "}
                      {selectedSession?.period_number}
                    </span>
                    <span>
                      Present: {presentCount} · Absent: {absentCount} ·
                      Unmarked: {unmarkedCount}
                    </span>
                  </div>

                  <button
                    type="button"
                    className="student-action"
                    onClick={markAllPresent}
                    disabled={busy}
                  >
                    Mark all present
                  </button>

                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Student</th>
                          <th>Department</th>
                          <th>Attendance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {records.map((record) => (
                          <tr key={record.student_id}>
                            <td>
                              <div className="student">
                                <span className="avatar">
                                  {record.full_name.charAt(0).toUpperCase()}
                                </span>
                                <div>
                                  <strong>{record.full_name}</strong>
                                  <small>{record.student_code}</small>
                                </div>
                              </div>
                            </td>

                            <td>{record.department}</td>

                            <td>
                              <select
                                className="student-action"
                                value={record.status}
                                onChange={(event) =>
                                  changeStatus(
                                    record.student_id,
                                    event.target.value
                                  )
                                }
                                disabled={busy}
                                aria-label={`Attendance for ${record.full_name}`}
                              >
                                <option value="unmarked">Unmarked</option>
                                <option value="present">Present</option>
                                <option value="absent">Absent</option>
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <button
                    type="button"
                    className="primary-button"
                    onClick={saveAttendance}
                    disabled={busy || !dirty}
                  >
                    {saving ? "Saving…" : "Save attendance ↗"}
                  </button>

                  <p className="directory-message">
                    Save before switching pages. Unmarked students are
                    not counted as absent.
                  </p>
                </>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}