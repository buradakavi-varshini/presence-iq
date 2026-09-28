import { useState } from "react";
import { setAccessToken } from "./api";

export default function Login({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin(event) {
    event.preventDefault();

    if (loading) return;

    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        "http://127.0.0.1:8000/auth/login",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: email.trim().toLowerCase(),
            password,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof data.detail === "string"
            ? data.detail
            : "Please check your login details."
        );
      }

      setAccessToken(data.access_token);

      onLogin({
        ...data.user,
        expiresAt: Date.now() + data.expires_in * 1000,
      });
    } catch (err) {
      setError(
        err instanceof TypeError
          ? "Cannot reach the login service. Check that the backend is running."
          : err.message
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-story">
        <div className="brand">
          <span className="brand-mark">P</span>
          Presence<span>IQ</span>
        </div>

        <div className="login-story-copy">
          <p className="eyebrow">EVERY PRESENCE MATTERS</p>

          <h1>
            Your campus.
            <br />
            <em>Beautifully connected.</em>
          </h1>

          <p>
            A thoughtful space for your students, classes,
            and everyday attendance.
          </p>
        </div>

        <p className="login-footer">
          Clarity begins with connection.
        </p>
      </section>

      <section className="login-form-side">
        <div className="login-card">
          <span className="soft-label">P-IQ WORKSPACE</span>
          <h2>Welcome back.</h2>

          <p className="login-description">
            Sign in to your campus workspace.
          </p>

          <form onSubmit={handleLogin}>
            <label>
              Email address
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Enter your login email"
                autoComplete="username"
                maxLength={255}
                required
                disabled={loading}
              />
            </label>

            <label>
              Password
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your website password"
                autoComplete="current-password"
                maxLength={1024}
                required
                disabled={loading}
              />
            </label>

            <button
              className="text-button"
              type="button"
              aria-pressed={showPassword}
              onClick={() => setShowPassword((previous) => !previous)}
            >
              {showPassword ? "Hide password" : "Show password"}
            </button>

            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              className="primary-button login-submit"
              disabled={loading}
            >
              {loading ? "Signing in…" : "Sign in to PresenceIQ ↗"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}