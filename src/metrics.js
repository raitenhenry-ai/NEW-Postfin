import config from "./config.js";
import { q, q1 } from "./db.js";
import {
  syncAnalytics,
  latestSyncAt,
  stalePlatformStatus,
} from "./analytics/syncAnalytics.js";

// Analytics collection façade.
//
// Age-tiered sync + adapters live in src/analytics/. This module keeps the
// historical read helpers (series, leaderboard, CPM) and the in-process
// scheduler that ticks the sync job.

let timer = null;
let running = false;
let lastRun = { at: null, posts: 0, accounts: 0, errors: [], stalePlatforms: [] };

export async function collectMetrics({ force = false } = {}) {
  if (running) return lastRun;
  running = true;
  try {
    const result = await syncAnalytics({ force });
    lastRun = {
      at: result.at,
      posts: result.posts,
      accounts: result.accounts,
      errors: result.errors || [],
      stalePlatforms: result.stalePlatforms || [],
    };
    if (result.posts || result.accounts) {
      console.log(
        `[metrics] synced ${result.posts} post snapshot(s), ${result.accounts} account snapshot(s)`
      );
    }
    for (const err of lastRun.errors) console.warn(`[metrics] ${err}`);
    return lastRun;
  } finally {
    running = false;
  }
}

export async function metricsStatus() {
  const [syncedAt, stale] = await Promise.all([latestSyncAt(), stalePlatformStatus()]);
  return {
    ...lastRun,
    lastSyncedAt: syncedAt || lastRun.at,
    stalePlatforms: stale.length ? stale : lastRun.stalePlatforms || [],
    intervalMinutes: config.metrics.intervalMinutes,
    enabled: config.metrics.intervalMinutes > 0,
  };
}

export function startMetricsCollector() {
  if (config.metrics.intervalMinutes <= 0) {
    console.log("[metrics] collector disabled (METRICS_INTERVAL_MINUTES=0)");
    return;
  }
  // Tick often; age tiers decide which posts are actually due.
  const period = Math.max(5, config.metrics.intervalMinutes) * 60 * 1000;
  setTimeout(() => collectMetrics().catch((e) => console.error("[metrics]", e)), 15000).unref();
  timer = setInterval(() => collectMetrics().catch((e) => console.error("[metrics]", e)), period);
  timer.unref();
  console.log(`[metrics] age-tiered collector every ${config.metrics.intervalMinutes}m`);
}

export function stopMetricsCollector() {
  if (timer) clearInterval(timer);
  timer = null;
}

/* ---------- Read helpers used by the API routes ---------- */

// Legacy helper: latest lifetime totals for posts published after sinceMs.
// Prefer analytics/rangeGain.js for true in-window gains.
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

function bucketize(rows, { keyField, edges, startingValues }) {
  const carried = new Map(startingValues || []);
  const out = [];
  let cursor = 0;

  for (let i = 0; i < edges.length - 1; i++) {
    const end = edges[i + 1];
    while (cursor < rows.length && Number(rows[cursor].collected_at) < end) {
      carried.set(rows[cursor][keyField], Number(rows[cursor].value || 0));
      cursor++;
    }
    let total = 0;
    for (const value of carried.values()) total += value;
    out.push({ start: edges[i], end, value: total, observed: carried.size > 0 });
  }
  return out;
}

const METRIC_COLUMNS = {
  views: "views", likes: "likes", comments: "comments", shares: "shares", saves: "saves",
};

export async function postSeries({ metric = "views", edges, platform = null }) {
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

  const seed = new Map();
  const inWindow = [];
  for (const row of rows) {
    if (Number(row.collected_at) < edges[0]) seed.set(row.k, Number(row.value || 0));
    else inWindow.push(row);
  }
  return bucketize(inWindow, { keyField: "k", edges, startingValues: seed });
}

export async function followerSeries({ edges, platform = null }) {
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
    if (Number(row.collected_at) < edges[0]) seed.set(row.k, Number(row.value || 0));
    else inWindow.push(row);
  }
  return bucketize(inWindow, { keyField: "k", edges, startingValues: seed });
}

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

export async function viewsByPlatform() {
  const rows = await q(
    `SELECT p.platform, COALESCE(SUM(COALESCE(p.views, m.views)), 0) AS views
     FROM ugc_posts p
     LEFT JOIN post_metrics m ON m.post_id = p.id AND m.collected_at = (
       SELECT MAX(m2.collected_at) FROM post_metrics m2 WHERE m2.post_id = p.id
     )
     WHERE p.status = 'done'
     GROUP BY p.platform`
  );
  return Object.fromEntries(rows.map((r) => [r.platform, Number(r.views || 0)]));
}

export async function accountLeaderboard(limit = 10) {
  const rows = await q(
    `SELECT a.id, a.platform, a.display_name, a.external_id,
            COALESCE(SUM(COALESCE(p.views, m.views)), 0) AS views
     FROM accounts a
     LEFT JOIN ugc_posts p ON p.account_id = a.id AND p.status = 'done'
     LEFT JOIN post_metrics m ON m.post_id = p.id AND m.collected_at = (
       SELECT MAX(m2.collected_at) FROM post_metrics m2 WHERE m2.post_id = p.id
     )
     GROUP BY a.id, a.platform, a.display_name, a.external_id
     ORDER BY views DESC, a.id ASC
     LIMIT ?`,
    [limit]
  );
  return rows.map((r) => ({
    id: r.id,
    platform: r.platform,
    displayName: r.display_name,
    externalId: r.external_id || null,
    views: Number(r.views || 0),
  }));
}
