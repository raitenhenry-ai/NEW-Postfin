import config from "./config.js";
import { q, q1, run } from "./db.js";
import { platforms, freshAccount } from "./accounts.js";

// Analytics collection.
//
// Every platform module exposes fetchStats(account, ids) -> { id: {views,
// likes, comments, shares, saves} } and, where the API allows it,
// fetchAudience(account) -> { followers }. This module polls both on an
// interval and writes one snapshot row per post/account per run, so the
// charts read from our own database instead of hitting eight APIs on every
// page load.
//
// Failures are per-account and never fatal: a platform whose token expired
// or whose app lacks an insights scope simply stops contributing new points.

let timer = null;
let running = false;
let lastRun = { at: null, posts: 0, accounts: 0, errors: [] };

// Posts stop being polled once they're older than the retention window -
// view counts on a three-month-old clip barely move and each one costs a
// request.
function pollWindowStart() {
  return Date.now() - config.metrics.maxAgeDays * 86400000;
}

// The id a platform recognises: TikTok hands back an internal publish_id at
// upload time and only later exposes the public video id, so prefer the
// public one where we resolved it.
function statsId(post) {
  if (post.platform === "tiktok") return post.public_post_id || null;
  return post.platform_video_id || null;
}

async function collectPostMetrics() {
  const posts = await q(
    `SELECT ugc_posts.*, accounts.platform AS account_platform
     FROM ugc_posts JOIN accounts ON accounts.id = ugc_posts.account_id
     WHERE ugc_posts.status = 'done' AND ugc_posts.posted_at > ?`,
    [pollWindowStart()]
  );

  // One fetchStats call per account, batching all of that account's posts.
  const byAccount = new Map();
  for (const post of posts) {
    const id = statsId(post);
    if (!id) continue;
    if (!byAccount.has(post.account_id)) byAccount.set(post.account_id, []);
    byAccount.get(post.account_id).push({ post, id });
  }

  const now = Date.now();
  const errors = [];
  let written = 0;

  for (const [accountId, entries] of byAccount) {
    const platform = platforms[entries[0].post.platform];
    if (!platform?.fetchStats) continue;
    try {
      const account = await freshAccount(accountId);
      if (!account) continue;
      const stats = await platform.fetchStats(account, entries.map((e) => e.id));
      for (const { post, id } of entries) {
        const s = stats[id];
        if (!s) continue;
        await run(
          `INSERT INTO post_metrics (post_id, collected_at, views, likes, comments, shares, saves)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [post.id, now, s.views || 0, s.likes || 0, s.comments || 0, s.shares || 0, s.saves || 0]
        );
        written++;
      }
    } catch (err) {
      errors.push(`${entries[0].post.platform}: ${String(err.message || err)}`);
    }
  }
  return { written, errors };
}

async function collectAudience() {
  const accounts = await q("SELECT id, platform FROM accounts");
  const now = Date.now();
  const errors = [];
  let written = 0;

  for (const row of accounts) {
    const platform = platforms[row.platform];
    // Not every API exposes follower counts to a publishing app (LinkedIn,
    // for one); those accounts just have no followers series.
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

export async function collectMetrics() {
  if (running) return lastRun;
  running = true;
  try {
    const posts = await collectPostMetrics();
    const audience = await collectAudience();
    lastRun = {
      at: Date.now(),
      posts: posts.written,
      accounts: audience.written,
      errors: [...posts.errors, ...audience.errors],
    };
    if (posts.written || audience.written) {
      console.log(
        `[metrics] collected ${posts.written} post snapshot(s), ${audience.written} account snapshot(s)`
      );
    }
    for (const err of lastRun.errors) console.warn(`[metrics] ${err}`);
    return lastRun;
  } finally {
    running = false;
  }
}

export function metricsStatus() {
  return {
    ...lastRun,
    intervalMinutes: config.metrics.intervalMinutes,
    enabled: config.metrics.intervalMinutes > 0,
  };
}

export function startMetricsCollector() {
  if (config.metrics.intervalMinutes <= 0) {
    console.log("[metrics] collector disabled (METRICS_INTERVAL_MINUTES=0)");
    return;
  }
  const period = config.metrics.intervalMinutes * 60 * 1000;
  // First pass shortly after boot so a restarted server backfills quickly,
  // then on the configured interval.
  setTimeout(() => collectMetrics().catch((e) => console.error("[metrics]", e)), 15000).unref();
  timer = setInterval(() => collectMetrics().catch((e) => console.error("[metrics]", e)), period);
  timer.unref();
}

export function stopMetricsCollector() {
  if (timer) clearInterval(timer);
  timer = null;
}

/* ---------- Read helpers used by the API routes ---------- */

// Sum of the newest snapshot of every post, optionally restricted to one
// platform. Returns zeros when nothing has been collected yet.
export async function totalsSince(sinceMs, platform = null) {
  const params = [sinceMs];
  let platformFilter = "";
  if (platform) {
    platformFilter = "AND p.platform = ?";
    params.push(platform);
  }
  const row = await q1(
    `SELECT
       COALESCE(SUM(m.views), 0)    AS views,
       COALESCE(SUM(m.likes), 0)    AS likes,
       COALESCE(SUM(m.comments), 0) AS comments,
       COALESCE(SUM(m.shares), 0)   AS shares,
       COALESCE(SUM(m.saves), 0)    AS saves,
       COUNT(*)                     AS posts
     FROM ugc_posts p
     JOIN post_metrics m ON m.post_id = p.id
     WHERE p.posted_at > ? ${platformFilter}
       AND m.collected_at = (
         SELECT MAX(m2.collected_at) FROM post_metrics m2 WHERE m2.post_id = p.id
       )`,
    params
  );
  return {
    views: Number(row?.views || 0),
    likes: Number(row?.likes || 0),
    comments: Number(row?.comments || 0),
    shares: Number(row?.shares || 0),
    saves: Number(row?.saves || 0),
    posts: Number(row?.posts || 0),
  };
}

// Everything the platforms report is a lifetime running total - a video's
// view count, an account's follower count. So a series is built by taking
// each post's most recent reading at or before each bucket boundary and
// summing across posts, carrying the last known value forward through
// buckets where no collection happened. A gap in collection therefore shows
// as a flat line, not a drop to zero.
function bucketize(rows, { keyField, sinceMs, points, bucketMs, startingValues }) {
  const carried = new Map(startingValues || []);
  const out = [];
  let cursor = 0;

  for (let i = 0; i < points; i++) {
    const bucketEnd = sinceMs + (i + 1) * bucketMs;
    while (cursor < rows.length && Number(rows[cursor].collected_at) < bucketEnd) {
      carried.set(rows[cursor][keyField], Number(rows[cursor].value || 0));
      cursor++;
    }
    let total = 0;
    for (const value of carried.values()) total += value;
    out.push({ date: sinceMs + i * bucketMs, value: total });
  }
  return out;
}

const METRIC_COLUMNS = {
  views: "views", likes: "likes", comments: "comments", shares: "shares", saves: "saves",
};

// Time series of a post metric. `points` buckets of `bucketMs` each, ending
// now. Readings from before the window seed the first bucket so a chart of
// the last 24 hours still starts at the real running total.
export async function postSeries({ metric = "views", sinceMs, points, bucketMs, platform = null }) {
  const column = METRIC_COLUMNS[metric] || "views";
  const params = [];
  let platformFilter = "";
  if (platform) {
    platformFilter = "AND p.platform = ?";
    params.push(platform);
  }

  const rows = await q(
    `SELECT m.post_id AS k, m.collected_at, m.${column} AS value
     FROM post_metrics m JOIN ugc_posts p ON p.id = m.post_id
     WHERE 1 = 1 ${platformFilter}
     ORDER BY m.collected_at ASC`,
    params
  );

  // Seed with the last reading before the window opened.
  const seed = new Map();
  const inWindow = [];
  for (const row of rows) {
    if (Number(row.collected_at) < sinceMs) seed.set(row.k, Number(row.value || 0));
    else inWindow.push(row);
  }
  return bucketize(inWindow, {
    keyField: "k", sinceMs, points, bucketMs, startingValues: seed,
  });
}

// Same shape for follower counts across every connected account.
export async function followerSeries({ sinceMs, points, bucketMs, platform = null }) {
  const params = [];
  let platformFilter = "";
  if (platform) {
    platformFilter = "AND accounts.platform = ?";
    params.push(platform);
  }
  const rows = await q(
    `SELECT am.account_id AS k, am.collected_at, am.followers AS value
     FROM account_metrics am JOIN accounts ON accounts.id = am.account_id
     WHERE 1 = 1 ${platformFilter}
     ORDER BY am.collected_at ASC`,
    params
  );

  const seed = new Map();
  const inWindow = [];
  for (const row of rows) {
    if (Number(row.collected_at) < sinceMs) seed.set(row.k, Number(row.value || 0));
    else inWindow.push(row);
  }
  return bucketize(inWindow, {
    keyField: "k", sinceMs, points, bucketMs, startingValues: seed,
  });
}

// Estimated revenue per 1000 views, or null when the operator hasn't
// supplied rates - no publishing API reports ad revenue, so a number here
// would be invented.
export function cpmFor(platform) {
  const { byPlatform, default: fallback } = config.metrics.cpm;
  return byPlatform[platform] ?? fallback ?? null;
}

export function estimateRevenue(perPlatformViews) {
  let revenue = 0;
  let anyRate = false;
  for (const [platform, views] of Object.entries(perPlatformViews)) {
    const cpm = cpmFor(platform);
    if (cpm === null) continue;
    anyRate = true;
    revenue += (views / 1000) * cpm;
  }
  return anyRate ? revenue : null;
}

// Per-platform view totals, used for the revenue estimate and the
// "top accounts" list.
export async function viewsByPlatform() {
  const rows = await q(
    `SELECT p.platform, COALESCE(SUM(m.views), 0) AS views
     FROM ugc_posts p JOIN post_metrics m ON m.post_id = p.id
     WHERE m.collected_at = (
       SELECT MAX(m2.collected_at) FROM post_metrics m2 WHERE m2.post_id = p.id
     )
     GROUP BY p.platform`
  );
  return Object.fromEntries(rows.map((r) => [r.platform, Number(r.views || 0)]));
}

// Newest reading per account, joined to the account for display.
export async function accountLeaderboard(limit = 10) {
  const rows = await q(
    `SELECT a.id, a.platform, a.display_name,
            COALESCE(SUM(m.views), 0) AS views
     FROM accounts a
     LEFT JOIN ugc_posts p ON p.account_id = a.id
     LEFT JOIN post_metrics m ON m.post_id = p.id AND m.collected_at = (
       SELECT MAX(m2.collected_at) FROM post_metrics m2 WHERE m2.post_id = p.id
     )
     GROUP BY a.id, a.platform, a.display_name
     ORDER BY views DESC, a.id ASC
     LIMIT ?`,
    [limit]
  );
  return rows.map((r) => ({
    id: r.id,
    platform: r.platform,
    displayName: r.display_name,
    views: Number(r.views || 0),
  }));
}
