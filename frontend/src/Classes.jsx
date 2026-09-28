import { useEffect, useState } from "react";
import { apiFetch } from "./api";
async function request(path, options = {}) {
  const response = await apiFetch(path, options);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : "Request failed. Check your details and try again.",
    );
  }
  return data;
}
export default function Classes() {
  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);
  const [members, setMembers] = useState([]);
  const [className, setClassName] = useState("");
  const [department, setDepartment] = useState("");
  const [selectedClass, setSelectedClass] = useState("");
  const [selectedStudent, setSelectedStudent] = useState("");
  const [loading, setLoading] = useState(true);
  const [membersLoading, setMembersLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [membersError, setMembersError] = useState("");
  const [message, setMessage] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function loadData() {
      try {
        const [classData, studentData] = await Promise.all([
          request("/classes", { signal: controller.signal }),
          request("/students", { signal: controller.signal }),
        ]);
        setClasses(classData);
        setStudents(studentData);
        if (classData.length > 0) {
          setSelectedClass(String(classData[0].id));
        }
      } catch (err) {
        if (err.name !== "AbortError") {
          setError(err.message);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }
    loadData();
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!selectedClass) return;
    const controller = new AbortController();
    async function loadMembers() {
      setMembersLoading(true);
      setMembersError("");
      try {
        const data = await request(`/classes/${selectedClass}/students`, {
          signal: controller.signal,
        });
        setMembers(data);
      } catch (err) {
        if (err.name !== "AbortError") {
          setMembers([]);
          setMembersError(err.message);
        }
      } finally {
        if (!controller.signal.aborted) {
          setMembersLoading(false);
        }
      }
    }
    loadMembers();
    return () => controller.abort();
  }, [selectedClass, refreshKey]);
  function changeClass(event) {
    setSelectedClass(event.target.value);
    setSelectedStudent("");
    setMembers([]);
    setMembersLoading(Boolean(event.target.value));
    setMembersError("");
    setError("");
    setMessage("");
  }
  async function createClass(event) {
    event.preventDefault();
    if (busy) return;
    const name = className.trim();
    const dept = department.trim();
    if (!name || !dept) {
      setError("Enter a class name and department.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const data = await request("/classes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          class_name: name,
          department: dept,
        }),
      });
      setClasses((previous) => [...previous, data]);
      setSelectedClass(String(data.id));
      setSelectedStudent("");
      setMembers([]);
      setMembersLoading(true);
      setClassName("");
      setDepartment("");
      setMessage(`${data.class_name} created successfully.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function assignStudent(event) {
    event.preventDefault();
    if (!selectedClass || !selectedStudent || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await request(`/classes/${selectedClass}/students`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          student_id: Number(selectedStudent),
        }),
      });
      setSelectedStudent("");
      setMessage("Student assigned successfully.");
      setMembersLoading(true);
      setRefreshKey((previous) => previous + 1);
      try {
        const updatedClasses = await request("/classes");
        setClasses(updatedClasses);
      } catch {
        setError(
          "Assignment was saved, but class counts could not refresh. Reload the page.",
        );
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  const availableStudents = students.filter(
    (student) => !members.some((member) => member.id === student.id),
  );
  return (
    <div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Create a class</h2>
            <p>Organize your students into classes.</p>
          </div>
          <span className="soft-label">
            {loading ? "Loading…" : `${classes.length} classes`}
          </span>
        </div>
        <form className="student-form" onSubmit={createClass}>
          <label>
            Class name *
            <input
              value={className}
              onChange={(event) => setClassName(event.target.value)}
              placeholder="AI & ML - Section B"
              maxLength={100}
              required
              disabled={busy || loading}
            />
          </label>
          <label>
            Department *
            <input
              value={department}
              onChange={(event) => setDepartment(event.target.value)}
              placeholder="AI & ML"
              maxLength={100}
              required
              disabled={busy || loading}
            />
          </label>
          <div className="form-actions">
            <button
              className="primary-button"
              type="submit"
              disabled={busy || loading}
            >
              {busy ? "Please wait…" : "Create class ↗"}
            </button>
          </div>
        </form>
      </section>
      <div aria-live="polite">
        {error && <p className="form-error">{error}</p>}
        {message && <p className="form-success">{message}</p>}
      </div>
      <section className="panel records-panel">
        <div className="panel-heading">
          <div>
            <h2>Class membership</h2>
            <p>Select a class to view and assign students.</p>
          </div>
        </div>
        {loading ? (
          <p className="directory-message">Loading classes…</p>
        ) : classes.length === 0 ? (
          <p className="directory-message">
            No classes available. Create your first class above.
          </p>
        ) : (
          <>
            <form className="student-form" onSubmit={assignStudent}>
              <label>
                Class *
                <select
                  value={selectedClass}
                  onChange={changeClass}
                  disabled={busy}
                  required
                >
                  <option value="">Select a class</option>
                  {classes.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.class_name} ({item.student_count} students)
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Student to assign *
                <select
                  value={selectedStudent}
                  onChange={(event) => setSelectedStudent(event.target.value)}
                  disabled={
                    busy ||
                    membersLoading ||
                    !selectedClass ||
                    Boolean(membersError)
                  }
                  required
                >
                  <option value="">Select a student</option>
                  {availableStudents.map((student) => (
                    <option key={student.id} value={student.id}>
                      {student.full_name} — {student.student_code}
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-actions">
                <button
                  className="primary-button"
                  type="submit"
                  disabled={
                    busy ||
                    membersLoading ||
                    !selectedClass ||
                    !selectedStudent ||
                    Boolean(membersError)
                  }
                >
                  {busy ? "Please wait…" : "Assign student ↗"}
                </button>
              </div>
            </form>
            {membersLoading ? (
              <p className="directory-message">Loading class members…</p>
            ) : membersError ? (
              <p className="form-error" role="alert">
                {membersError}
              </p>
            ) : !selectedClass ? (
              <p className="directory-message">Select a class above.</p>
            ) : (
              <>
                <p className="directory-message">
                  {members.length} students assigned.
                  {availableStudents.length === 0 &&
                    " No unassigned students available for this class."}
                </p>
                {members.length > 0 && (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Student</th>
                          <th>Roll number</th>
                          <th>Department</th>
                        </tr>
                      </thead>
                      <tbody>
                        {members.map((student) => (
                          <tr key={student.id}>
                            <td>{student.full_name}</td>
                            <td>{student.student_code}</td>
                            <td>{student.department}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
