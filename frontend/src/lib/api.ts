export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

export const NETWORK_ERROR =
  "We couldn't reach the CareerFlow server. Make sure the backend is running, then try again.";

/**
 * POST with the invite token. Retries once on a network failure or gateway error.
 * Not for non-idempotent actions like auto-apply (pass retry = false).
 */
export async function postWithRetry(url: string, body: FormData, retry = true): Promise<Response> {
  try {
    const token = localStorage.getItem("cf_token") || "";
    const res = await fetch(url, { method: "POST", body, headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) {
      // Token expired or invite code revoked: back to the sign-in screen
      localStorage.removeItem("cf_token");
      window.dispatchEvent(new Event("cf:signed-out"));
    }
    if (retry && [502, 503, 504].includes(res.status)) throw new TypeError("gateway");
    return res;
  } catch (e) {
    if (!(e instanceof TypeError)) throw e;
    if (!retry) throw new Error(NETWORK_ERROR);
    await new Promise(r => setTimeout(r, 4000));
    return postWithRetry(url, body, false);
  }
}

/** Pull FastAPI's `detail` out of an error response instead of showing raw JSON. */
export async function readError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const data = JSON.parse(text);
    if (typeof data.detail === "string") return data.detail;
  } catch {}
  return text || `Request failed (${res.status})`;
}

/** POST form data to an API path and return parsed JSON, or throw a readable error. */
export async function postJson<T = unknown>(path: string, form: FormData, retry = true): Promise<T> {
  const res = await postWithRetry(`${API_BASE}${path}`, form, retry);
  if ([502, 503, 504].includes(res.status)) throw new Error(NETWORK_ERROR);
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<T>;
}

/** Download a file returned by a POST endpoint. */
export async function downloadFile(path: string, form: FormData, fallbackName: string) {
  const res = await postWithRetry(`${API_BASE}${path}`, form);
  if (!res.ok) throw new Error(await readError(res));
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") || "")?.[1] || fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
