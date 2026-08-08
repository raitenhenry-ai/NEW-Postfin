import crypto from "node:crypto";
import { q1, run } from "./db.js";

// Anti-CSRF state tokens for the OAuth flows.
//
// These live in the database, not in memory: the token is created when the
// user is sent to the platform and read back minutes later on the callback,
// and anything that restarts the process in between - a deploy, a crash, a
// platform moving the container - would otherwise lose it and fail the
// connection with "Invalid OAuth state". It also means more than one
// instance can serve the callback.

const TTL_MS = 10 * 60 * 1000;

export async function createState(platform, data = null) {
  const state = crypto.randomBytes(24).toString("hex");
  await run(
    "INSERT INTO oauth_states (state, platform, data_json, expires_at) VALUES (?, ?, ?, ?)",
    [state, platform, data ? JSON.stringify(data) : null, Date.now() + TTL_MS]
  );
  // Opportunistic cleanup; these rows are tiny and short-lived.
  await run("DELETE FROM oauth_states WHERE expires_at < ?", [Date.now()]).catch(() => {});
  return state;
}

// Returns { ok, data, reason } - data carries flow extras like the PKCE
// verifier. `reason` distinguishes an expired attempt from an unknown one so
// the UI can tell the user which it was.
export async function consumeState(state, platform) {
  if (!state) return { ok: false, data: null, reason: "missing" };

  const row = await q1("SELECT * FROM oauth_states WHERE state = ?", [state]);
  // Single use, whatever the outcome.
  await run("DELETE FROM oauth_states WHERE state = ?", [state]).catch(() => {});

  if (!row) return { ok: false, data: null, reason: "unknown" };
  if (row.platform !== platform) return { ok: false, data: null, reason: "platform-mismatch" };
  if (Number(row.expires_at) < Date.now()) return { ok: false, data: null, reason: "expired" };

  return {
    ok: true,
    data: row.data_json ? JSON.parse(row.data_json) : null,
    reason: null,
  };
}

// Wording for the message shown on the Connectors page.
export function stateErrorMessage(reason) {
  switch (reason) {
    case "expired":
      return "That took longer than 10 minutes, so the sign-in expired. Try connecting again.";
    case "platform-mismatch":
      return "That sign-in was started for a different platform. Try connecting again.";
    case "missing":
      return "The platform did not return a state parameter. Try connecting again.";
    default:
      return "This sign-in link is no longer valid - it may already have been used. Try connecting again.";
  }
}
