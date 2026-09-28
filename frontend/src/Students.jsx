import { useEffect, useRef, useState } from "react";
import { apiFetch } from "./api";
const emptyForm = {
  student_code: "",
  full_name: "",
  email: "",
  department: "",
};
async function readResponse(response) {
  const data = await response.json();
  if (!response.ok) {
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : "Check your details and try again.",
    );
  }
  return data;
}
export default function Students() {
  const [students, setStudents] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const firstInput = useRef(null);
  const mutationInProgress = useRef(false);
  const busy = saving || deletingId !== null;
  const isEditing = editingId !== null;
  useEffect(() => {
    const controller = new AbortController();
    async function loadStudents() {
      try {
        const response = await apiFetch("/students", {
          signal: controller.signal,
        });
        setStudents(await readResponse(response));
      } catch (err) {
        if (err.name !== "AbortError") {
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
  }, []);
  function startEditing(student) {
    if (mutationInProgress.current) return;
    setEditingId(student.id);
    setForm({
      student_code: student.student_code,
      full_name: student.full_name,
      email: student.email || "",
      department: student.department,
    });
    setError("");
    setMessage("");
    firstInput.current?.focus();
  }
  function cancelEditing() {
    if (mutationInProgress.current) return;
    setEditingId(null);
    setForm(emptyForm);
    setError("");
    setMessage("");
  }
  async function handleSubmit(event) {
    event.preventDefault();
    if (mutationInProgress.current) return;
    setError("");
    setMessage("");
    const payload = {
      student_code: form.student_code.trim(),
      full_name: form.full_name.trim(),
      email: form.email.trim() || null,
      department: form.department.trim(),
    };
    if (!payload.student_code || !payload.full_name || !payload.department) {
      setError("Enter a roll number, full name, and department.");
      return;
    }
    mutationInProgress.current = true;
    setSaving(true);
    try {
      const response = await apiFetch(
        isEditing ? `/students/${editingId}` : "/students",
        {
          method: isEditing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = await readResponse(response);
      setStudents((previous) =>
        isEditing
          ? previous.map((student) =>
              student.id === editingId ? data : student,
            )
          : [...previous, data],
      );
      setMessage(
        `${data.full_name} ${
          isEditing ? "updated" : "registered"
        } successfully.`,
      );
      setEditingId(null);
      setForm(emptyForm);
    } catch (err) {
      setError(err.message);
    } finally {
      mutationInProgress.current = false;
      setSaving(false);
    }
  }
  async function handleDelete(student) {
    if (mutationInProgress.current) return;
    const confirmed = window.confirm(
      `Delete ${student.full_name} (${student.student_code})?\n\n` +
        "If allowed, this removes the student, class memberships, and face enrollment. Attendance history may prevent deletion.",
    );
    if (!confirmed) return;
    mutationInProgress.current = true;
    setDeletingId(student.id);
    setError("");
    setMessage("");
    try {
      const response = await apiFetch(`/students/${student.id}`, {
        method: "DELETE",
      });
      await readResponse(response);
      setStudents((previous) =>
        previous.filter((item) => item.id !== student.id),
      );
      if (editingId === student.id) {
        setEditingId(null);
        setForm(emptyForm);
      }
      setMessage(`${student.full_name} deleted successfully.`);
    } catch (err) {
      setError(err.message);
    } finally {
      mutationInProgress.current = false;
      setDeletingId(null);
    }
  }
  return (
    <div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>{isEditing ? "Edit student details" : "Register a student"}</h2>
            <p>
              {isEditing
                ? "Update the details below and save your changes."
                : "Add a student to your campus directory."}
            </p>
          </div>
          {isEditing && <span className="soft-label">Editing student</span>}
        </div>
        <form className="student-form" onSubmit={handleSubmit}>
          {[
            ["student_code", "Roll number *", "Enter college roll number", 30],
            ["full_name", "Full name *", "Enter full name", 100],
            ["email", "Email", "Optional email address", 255],
            ["department", "Department *", "For example, AI & ML", 100],
          ].map(([name, label, placeholder, maxLength]) => (
            <label key={name}>
              {label}
              <input
                ref={name === "student_code" ? firstInput : undefined}
                type={name === "email" ? "email" : "text"}
                name={name}
                value={form[name]}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    [name]: event.target.value,
                  }))
                }
                placeholder={placeholder}
                maxLength={maxLength}
                required={name !== "email"}
                disabled={busy}
              />
            </label>
          ))}
          <div className="form-actions student-form-buttons">
            <button
              className="primary-button"
              type="submit"
              disabled={busy || loading || Boolean(loadError)}
            >
              {saving
                ? "Saving…"
                : isEditing
                  ? "Save changes ↗"
                  : "Register student ↗"}
            </button>
            {isEditing && (
              <button
                className="student-action"
                type="button"
                onClick={cancelEditing}
                disabled={busy}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
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
      </section>
      <section className="panel records-panel">
        <div className="panel-heading">
          <div>
            <h2>Student directory</h2>
            <p>View and manage saved student records.</p>
          </div>
          <span className="soft-label">
            {loading
              ? "Loading…"
              : loadError
                ? "Unavailable"
                : `${students.length} students`}
          </span>
        </div>
        {loading ? (
          <p className="directory-message">Loading students…</p>
        ) : loadError ? (
          <p className="form-error" role="alert">
            {loadError} Check the backend and refresh this page.
          </p>
        ) : students.length === 0 ? (
          <p className="directory-message">No students registered yet.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Department</th>
                  <th>Email</th>
                  <th>Actions</th>
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
                    <td>{student.email || "—"}</td>
                    <td>
                      <div className="student-row-actions">
                        <button
                          type="button"
                          className="student-action"
                          onClick={() => startEditing(student)}
                          disabled={busy}
                          aria-label={`Edit ${student.full_name}`}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="student-action student-delete"
                          onClick={() => handleDelete(student)}
                          disabled={busy}
                          aria-label={`Delete ${student.full_name}`}
                        >
                          {deletingId === student.id ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
