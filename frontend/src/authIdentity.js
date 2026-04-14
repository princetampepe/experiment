export function decodeJwtPayload(token) {
  const rawToken = String(token || "").trim();
  if (!rawToken) {
    return null;
  }

  const parts = rawToken.split(".");
  if (parts.length < 2 || !parts[1]) {
    return null;
  }

  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "=");
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

export function normalizeUserId(value) {
  if (value == null) {
    return null;
  }

  const text = String(value).trim();
  if (!text) {
    return null;
  }

  if (/^-?\d+$/.test(text)) {
    const numeric = Number(text);
    if (Number.isSafeInteger(numeric)) {
      return String(numeric);
    }
  }

  return text;
}

export function buildHandleCandidate(input, fallback = "user") {
  const cleaned = String(input || "")
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 20);

  const base = cleaned
    || String(fallback || "user")
      .replace(/[^a-z0-9_]/gi, "")
      .toLowerCase()
      .slice(0, 20)
    || "user";

  return `@${base}`;
}
