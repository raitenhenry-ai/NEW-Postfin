import { q, q1, run } from "./db.js";
import { ENABLED_PLATFORMS } from "./config.js";
import * as youtube from "./platforms/youtube.js";
import * as instagram from "./platforms/instagram.js";
import * as tiktok from "./platforms/tiktok.js";
import * as facebook from "./platforms/facebook.js";
import * as x from "./platforms/x.js";
import * as threads from "./platforms/threads.js";
import * as pinterest from "./platforms/pinterest.js";
import * as linkedin from "./platforms/linkedin.js";

export const platforms = { youtube, instagram, tiktok, facebook, x, threads, pinterest, linkedin };

// Platforms that currently have at least one connected account, in UI order.
export async function connectedPlatforms() {
  const rows = await q("SELECT DISTINCT platform FROM accounts");
  const set = new Set(rows.map((r) => r.platform));
  return ENABLED_PLATFORMS.filter((p) => set.has(p));
}

// Jobs store an explicit platform list. Empty/"omit" means every connected
// account (or every enabled platform when nothing is connected yet), which
// matches how the publisher already behaves.
export async function resolveTargetPlatforms(wanted) {
  const picked = [...new Set(
    (Array.isArray(wanted) ? wanted : [])
      .map((p) => String(p || "").toLowerCase())
      .filter((p) => ENABLED_PLATFORMS.includes(p))
  )];
  if (picked.length) return picked;
  const connected = await connectedPlatforms();
  return connected.length ? connected : [...ENABLED_PLATFORMS];
}

// Refresh the access token if it expires within the next 5 minutes.
export async function freshAccount(accountId) {
  const account = await q1("SELECT * FROM accounts WHERE id = ?", [accountId]);
  if (!account) return null;

  if (account.expires_at && Number(account.expires_at) < Date.now() + 5 * 60 * 1000) {
    if (account.platform !== "instagram" && !account.refresh_token) return account;
    const updated = await platforms[account.platform].refresh(account);
    await run(
      "UPDATE accounts SET access_token = ?, refresh_token = ?, expires_at = ? WHERE id = ?",
      [updated.accessToken, updated.refreshToken ?? account.refresh_token, updated.expiresAt, account.id]
    );
    return q1("SELECT * FROM accounts WHERE id = ?", [account.id]);
  }
  return account;
}
