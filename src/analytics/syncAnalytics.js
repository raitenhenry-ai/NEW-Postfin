import config from "../config.js";
import { q, q1, run } from "../db.js";
import { platforms, freshAccount } from "../accounts.js";
import { fetchAnalyticsForAccount, statsId, hasAnalyticsAdapter } from "./adapters.js";

const HOUR = 3600000;
const DAY = 86400000;

const METRIC_KEYS = ["views", "likes", "comments", "shares", "saves", "impressions", "reach"];

// Age-tiered sync cadence: how often a post is eligible for a new poll.
export function syncIntervalForAge(postedAt, now = Date.now()) {
  const age = now - Number(postedAt || 0);
  if (age < 2 * DAY) return 30 * 60 * 1000;       // < 48h → 30m
  if (age < 7 * DAY) return 2 * HOUR;             // 2–7d → 2h
  if (age < 30 * DAY) return 6 * HOUR;            // 7–30d → 6h
  return DAY;                                     // older → daily
}

function sameSnapshot(prev, next) {
  if (!prev) return false;
  for (const key of METRIC_KEYS) {
    const a = prev[key] == null ? null : Number(prev[key]);
    const b = next[key] == null ? null : Number(next[key] || 0);
    if (a !== b && !(a == null && (b == null || b === 0))) {
      // Treat missing optional metrics as equal to 0 / null.
      if ((a == null || a === 0) && (b == null || b === 0)) continue;
      return false;
    }
  }
  return true;
}

async function latestSnapshot(postId) {
  return q1(
    `SELECT * FROM post_metrics WHERE post_id = ? ORDER BY collected_at DESC LIMIT 1`,
    [postId]
  );
}

async function markAccountState(accountId, platform, { ok, error, backoffMs }) {
  const now = Date.now();
  const next = ok ? null : now + (backoffMs || HOUR);
  await run(
    `INSERT INTO analytics_sync_state
       (account_id, platform, last_success_at, last_attempt_at, last_error, stale, next_eligible_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (account_id) DO UPDATE SET
       platform = excluded.platform,
       last_success_at = COALESCE(excluded.last_success_at, analytics_sync_state.last_success_at),
       last_attempt_at = excluded.last_attempt_at,
       last_error = excluded.last_error,
       stale = excluded.stale,
       next_eligible_at = excluded.next_eligible_at`,
    [
      accountId,
      platform,
      ok ? now : null,
      now,
      ok ? null : String(error || "unknown"),
      ok ? 0 : 1,
      next,
    ]
  );
}

async function writeSnapshotAndCache(post, metrics, now) {
  const prev = await latestSnapshot(post.id);
  const row = {
    views: Number(metrics.views || 0),
    likes: Number(metrics.likes || 0),
    comments: Number(metrics.comments || 0),
    shares: Number(metrics.shares || 0),
    saves: Number(metrics.saves || 0),
    impressions: metrics.impressions != null ? Number(metrics.impressions) : null,
    reach: metrics.reach != null ? Number(metrics.reach) : null,
  };

  let written = false;
  if (!sameSnapshot(prev, row)) {
    await run(
      `INSERT INTO post_metrics
         (post_id, collected_at, views, likes, comments, shares, saves, impressions, reach)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        post.id, now,
        row.views, row.likes, row.comments, row.shares, row.saves,
        row.impressions, row.reach,
      ]
    );
    written = true;
  }

  await run(
    `UPDATE ugc_posts SET
       views = ?, likes = ?, comments = ?, shares = ?, saves = ?,
       impressions = ?, reach = ?,
       metrics_synced_at = ?, metrics_error = NULL
     WHERE id = ?`,
    [
      row.views, row.likes, row.comments, row.shares, row.saves,
      row.impressions, row.reach,
      now, post.id,
    ]
  );
  return written;
}

// Posts due for a sync under the age-tiered schedule (or force=all recent).
export async function selectDuePosts({ force = false, limit } = {}) {
  const max = Math.max(1, Number(limit || config.metrics.batchLimit || 200));
  const now = Date.now();
  const oldest = now - (config.metrics.maxAgeDays || 365) * DAY;

  const posts = await q(
    `SELECT p.*, s.next_eligible_at AS account_next_eligible
     FROM ugc_posts p
     LEFT JOIN analytics_sync_state s ON s.account_id = p.account_id
     WHERE p.status = 'done'
       AND p.posted_at IS NOT NULL
       AND p.posted_at > ?
       AND (p.platform_video_id IS NOT NULL OR p.public_post_id IS NOT NULL)
     ORDER BY p.posted_at DESC
     LIMIT ?`,
    [oldest, Math.max(max * 4, 400)]
  );

  const due = [];
  for (const post of posts) {
    if (!hasAnalyticsAdapter(post.platform)) continue;
    if (!statsId(post)) continue;
    if (!force) {
      const accountHold = Number(post.account_next_eligible || 0);
      if (accountHold > now) continue;
      const interval = syncIntervalForAge(post.posted_at, now);
      const synced = Number(post.metrics_synced_at || 0);
      if (synced && now - synced < interval) continue;
    }
    due.push(post);
    if (due.length >= max) break;
  }
  return due;
}

async function collectAudience() {
  const accounts = await q("SELECT id, platform FROM accounts");
  const now = Date.now();
  const errors = [];
  let written = 0;

  for (const row of accounts) {
    const platform = platforms[row.platform];
    if (!platform?.fetchAudience) continue;
    try {
      const account = await freshAccount(row.id);
      if (!account) continue;
      const { followers } = await platform.fetchAudience(account);
      await run(
        "INSERT INTO account_metrics (account_id, collected_at, followers) VALUES (?, ?, ?)",
        [row.id, now, Number(followers) || 0]
      );
      written++;
    } catch (err) {
      errors.push(`${row.platform}: ${String(err.message || err)}`);
    }
  }
  return { written, errors };
}

/**
 * Sync analytics for due posts (or force=true for a manual refresh).
 * Returns { at, posts, accounts, errors, stalePlatforms }.
 */
export async function syncAnalytics({ force = false, limit } = {}) {
  const due = await selectDuePosts({ force, limit });
  const now = Date.now();
  const errors = [];
  let written = 0;

  const byAccount = new Map();
  for (const post of due) {
    if (!byAccount.has(post.account_id)) byAccount.set(post.account_id, []);
    byAccount.get(post.account_id).push(post);
  }

  for (const [accountId, posts] of byAccount) {
    const platform = posts[0].platform;
    try {
      const account = await freshAccount(accountId);
      if (!account) {
        errors.push(`${platform}: account disconnected`);
        await markAccountState(accountId, platform, { ok: false, error: "disconnected", backoffMs: DAY });
        continue;
      }

      const stats = await fetchAnalyticsForAccount(account, posts);
      for (const post of posts) {
        const id = statsId(post);
        const s = id ? stats[id] : null;
        if (!s) {
          await run(
            `UPDATE ugc_posts SET metrics_error = ?, metrics_synced_at = COALESCE(metrics_synced_at, ?) WHERE id = ?`,
            ["No stats returned for this post", now, post.id]
          );
          continue;
        }
        if (await writeSnapshotAndCache(post, s, now)) written++;
        else {
          // Still bump synced_at when unchanged.
          await run(
            `UPDATE ugc_posts SET metrics_synced_at = ?, metrics_error = NULL WHERE id = ?`,
            [now, post.id]
          );
        }
      }
      await markAccountState(accountId, platform, { ok: true });
    } catch (err) {
      const message = String(err.message || err);
      errors.push(`${platform}: ${message}`);
      const backoff = err.code === "RATE_LIMIT" ? 2 * HOUR : HOUR;
      await markAccountState(accountId, platform, { ok: false, error: message, backoffMs: backoff });
      for (const post of posts) {
        await run(
          `UPDATE ugc_posts SET metrics_error = ? WHERE id = ?`,
          [message.slice(0, 400), post.id]
        );
      }
    }
  }

  const audience = await collectAudience();
  const staleRows = await q(
    `SELECT platform, last_success_at, last_error, last_attempt_at
     FROM analytics_sync_state WHERE stale = 1`
  );

  return {
    at: now,
    posts: written,
    accounts: audience.written,
    errors: [...errors, ...audience.errors],
    stalePlatforms: staleRows.map((r) => ({
      platform: r.platform,
      lastSuccessAt: r.last_success_at ? Number(r.last_success_at) : null,
      lastAttemptAt: r.last_attempt_at ? Number(r.last_attempt_at) : null,
      error: r.last_error || null,
    })),
  };
}

export async function stalePlatformStatus() {
  const rows = await q(
    `SELECT platform,
            MAX(last_success_at) AS last_success_at,
            MAX(last_attempt_at) AS last_attempt_at,
            MAX(CASE WHEN stale = 1 THEN last_error END) AS last_error,
            MAX(stale) AS stale
     FROM analytics_sync_state
     GROUP BY platform`
  );
  return rows.map((r) => ({
    platform: r.platform,
    stale: Boolean(Number(r.stale)),
    lastSuccessAt: r.last_success_at ? Number(r.last_success_at) : null,
    lastAttemptAt: r.last_attempt_at ? Number(r.last_attempt_at) : null,
    error: r.last_error || null,
  }));
}

export async function latestSyncAt() {
  const row = await q1(
    `SELECT MAX(metrics_synced_at) AS at FROM ugc_posts WHERE status = 'done'`
  );
  return row?.at ? Number(row.at) : null;
}

const REFRESH_COOLDOWN_MS = () =>
  Math.max(1, Number(config.metrics.refreshCooldownMinutes || 3)) * 60 * 1000;

export async function checkRefreshCooldown(sessionKey) {
  const key = String(sessionKey || "operator");
  const row = await q1(
    "SELECT last_refresh_at FROM analytics_refresh_cooldown WHERE session_key = ?",
    [key]
  );
  const last = row?.last_refresh_at ? Number(row.last_refresh_at) : 0;
  const wait = REFRESH_COOLDOWN_MS() - (Date.now() - last);
  if (wait > 0) {
    return { allowed: false, retryAfterMs: wait, nextRefreshAt: last + REFRESH_COOLDOWN_MS() };
  }
  return { allowed: true, retryAfterMs: 0, nextRefreshAt: null };
}

export async function markRefreshCooldown(sessionKey) {
  const key = String(sessionKey || "operator");
  const now = Date.now();
  await run(
    `INSERT INTO analytics_refresh_cooldown (session_key, last_refresh_at)
     VALUES (?, ?)
     ON CONFLICT (session_key) DO UPDATE SET last_refresh_at = excluded.last_refresh_at`,
    [key, now]
  );
  return { nextRefreshAt: now + REFRESH_COOLDOWN_MS() };
}
