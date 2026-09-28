import { useEffect, useState } from "react";

import Overview from "./Overview";
import Students from "./Students";
import Classes from "./Classes";
import Attendance from "./Attendance";
import Reports from "./Reports";
import FaceEnrollment from "./FaceEnrollment";
import ScanAttendance from "./ScanAttendance";
import AttendanceAlerts from "./AttendanceAlerts";
import ExpressionDemo from "./ExpressionDemo";
import Login from "./Login";

import { clearAccessToken } from "./api";

import "./App.css";
import "./Login.css";

const pages = [
  "Overview",
  "Students",
  "Classes",
  "Attendance",
  "Face Enrollment",
  "Scan Attendance",
  "Attendance Alerts",
  "Expression Demo",
  "Reports",
];

const pageLabels = {
  Overview: "Database overview",
  Students: "Student directory",
  Classes: "Class management",
  Attendance: "Attendance tracking",
  "Face Enrollment": "Student face enrollment",
  "Scan Attendance": "Face attendance",
  "Attendance Alerts": "Low-attendance review",
  "Expression Demo": "Experimental expression analysis",
  Reports: "Attendance reports",
};

const subtitles = {
  Overview: "Your saved attendance, people, and patterns.",
  Students: "Register students and explore your saved student directory.",
  Classes: "Create classes, assign students, and explore class membership.",
  Attendance: "Create class sessions, mark attendance, and save your records.",
  "Face Enrollment": "Capture and enroll a student's face for future matching.",
  "Scan Attendance":
    "Match an enrolled face with basic anti-spoofing and save session attendance.",
  "Attendance Alerts":
    "Review students below your selected attendance threshold.",
  "Expression Demo":
    "Explore facial-expression estimates using your own camera capture.",
  Reports: "Explore class attendance and download PDF summaries.",
};

const eyebrows = {
  Overview: "YOUR CAMPUS, AT A GLANCE",
  Students: "YOUR CAMPUS COMMUNITY",
  Classes: "YOUR CAMPUS COMMUNITY",
  Attendance: "EVERY PRESENCE MATTERS",
  "Face Enrollment": "EVERY PRESENCE MATTERS",
  "Scan Attendance": "EVERY PRESENCE MATTERS",
  "Attendance Alerts": "NOTICE EARLY, SUPPORT BETTER",
  "Expression Demo": "EXPLORE THE MODEL",
  Reports: "FROM RECORDS TO INSIGHTS",
};

export default function App() {
  const [page, setPage] = useState("Overview");
  const [user, setUser] = useState(null);

  function handleLogout() {
    clearAccessToken();
    setUser(null);
    setPage("Overview");
  }

  useEffect(() => {
    function endSession() {
      clearAccessToken();
      setUser(null);
      setPage("Overview");
    }

    window.addEventListener("presenceiq:logout", endSession);

    const timer = user
      ? window.setTimeout(
          endSession,
          Math.max(0, user.expiresAt - Date.now())
        )
      : null;

    return () => {
      window.removeEventListener("presenceiq:logout", endSession);

      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [user]);

  if (!user) {
    return <Login onLogin={setUser} />;
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#overview"
          onClick={(event) => {
            event.preventDefault();
            setPage("Overview");
          }}
        >
          <span className="brand-mark">P</span>
          Presence<span>IQ</span>
        </a>

        <div className="workspace">
          <span className="workspace-icon">P-IQ</span>
          <div>
            <strong>Campus workspace</strong>
            <small>Attendance management</small>
          </div>
        </div>

        <p className="nav-label">WORKSPACE</p>

        <nav aria-label="Main navigation">
          {pages.map((item, index) => (
            <button
              type="button"
              key={item}
              className={`nav-item ${page === item ? "selected" : ""}`}
              aria-current={page === item ? "page" : undefined}
              onClick={() => setPage(item)}
            >
              <span className="nav-number">
                {String(index + 1).padStart(2, "0")}
              </span>
              {item}
              <span className="nav-arrow">↗</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-note">
          <span className="tiny-label">BUILT FOR BETTER DAYS</span>
          <h3>
            Every presence
            <br />
            makes a difference.
          </h3>
          <p>A little clarity for your everyday classroom.</p>
          <div className="note-line" />
        </div>

        <div className="profile">
          <span className="avatar profile-avatar">
            {user.full_name.charAt(0).toUpperCase()}
          </span>
          <div>
            <strong>{user.full_name}</strong>
            <small>{user.role}</small>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <span>
            Workspace <span className="slash">/</span> {page}
          </span>

          <span className="demo-label">{pageLabels[page]}</span>

          <button
            type="button"
            className="text-button logout-button"
            onClick={handleLogout}
          >
            Log out ↗
          </button>
        </header>

        <section className="page" key={page}>
          <div className="page-heading">
            <div>
              <p className="eyebrow">{eyebrows[page]}</p>

              <h1>
                {page === "Overview"
                  ? "A clearer view of every day."
                  : page}
              </h1>

              <p className="subtitle">{subtitles[page]}</p>
            </div>
          </div>

          {page === "Overview" && <Overview onNavigate={setPage} />}
          {page === "Students" && <Students />}
          {page === "Classes" && <Classes />}
          {page === "Attendance" && <Attendance />}
          {page === "Face Enrollment" && <FaceEnrollment />}
          {page === "Scan Attendance" && <ScanAttendance />}
          {page === "Attendance Alerts" && <AttendanceAlerts />}
          {page === "Expression Demo" && <ExpressionDemo />}
          {page === "Reports" && <Reports />}

          <footer className="footer">
            <span>PresenceIQ</span>
            <span>A thoughtful approach to attendance.</span>
          </footer>
        </section>
      </main>
    </div>
  );
}