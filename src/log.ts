const SECRET_KEYS = /key|token|secret|password|authorization/i;

export function log(level: "info" | "warn" | "error", message: string, fields: Record<string, unknown> = {}) {
  const safe = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, SECRET_KEYS.test(k) ? "[redacted]" : v]));
  console.error(JSON.stringify({ at: new Date().toISOString(), level, message, ...safe }));
}
