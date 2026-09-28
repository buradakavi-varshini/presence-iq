const API_BASE = "http://127.0.0.1:8000";

let accessToken = null;

export function setAccessToken(token) {
  accessToken = token;
}

export function clearAccessToken() {
  accessToken = null;
}

export async function apiFetch(path, options = {}) {
  const tokenUsed = accessToken;
  const headers = new Headers(options.headers);

  if (tokenUsed) {
    headers.set("Authorization", `Bearer ${tokenUsed}`);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (response.status === 401 && accessToken === tokenUsed) {
    clearAccessToken();
    window.dispatchEvent(new Event("presenceiq:logout"));
  }

  return response;
}