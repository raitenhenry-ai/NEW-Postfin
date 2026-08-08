import { q } from "../db.js";
import { postUrl } from "../postUrl.js";

// Helpers shared by the Postfin API routes.

// Wraps an async handler so a rejected promise becomes a 500 with a body
// instead of a hung request.
export const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error(`[api] ${req.method} ${req.originalUrl} failed:`, err);
    if (!res.headersSent) res.status(500).json({ error: String(err.message || err) });
  });

const MINUTE = 60000;
const HOUR = 3600000;
const DAY = 86400000;

// Most points a chart plots. Multi-day ranges pick the smallest whole number
// of days per bucket that keeps them at or under this.
const MAX_POINTS = 12;

/* ------------------------------------------------------------- time zones */

// Day boundaries have to land on the *viewer's* midnight rather than the
// server's. The browser formats every axis label in its own locale, so a
// bucket cut on a UTC midnight reads as the previous day for anyone west of
// Greenwich - the deploys run in UTC, the users mostly don't. The client
// sends its IANA zone and the arithmetic below happens in it, which also
// keeps buckets exactly one calendar day wide across DST changes.
function normalizeZone(timeZone) {
  if (!timeZone || typeof timeZone !== "string") return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return null;
  }
}

// Milliseconds to add to a UTC instant to read it as wall clock time in `zone`.
function zoneOffset(ms, zone) {
  const parts = {};
  for (const part of new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(ms))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

// Midnight, in `zone`, of the day containing `ms`.
function startOfLocalDay(ms, zone) {
  if (!zone) {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  const offset = zoneOffset(ms, zone);
  const midnight = Math.floor((ms + offset) / DAY) * DAY;
  // The offset can differ on the far side of a DST change, so re-resolve the
  // first guess and use the corrected offset when it does.
  const guess = midnight - offset;
  const corrected = zoneOffset(guess, zone);
  return corrected === offset ? guess : midnight - corrected;
}

// `days` calendar days from a local midnight, landing on a local midnight.
// The two-hour cushion absorbs DST shifts so a 23- or 25-hour day never
// leaves the result on the wrong side of midnight.
function addLocalDays(ms, days, zone) {
  return startOfLocalDay(ms + days * DAY + 2 * HOUR, zone);
}

/* ----------------------------------------------------------------- ranges */

// A rolling window ending at this instant, bucketed by the clock. Used for
// the sub-day ranges, where "the last hour" really does mean the last sixty
// minutes rather than the hour so far.
function intradayRange(key, now, points, bucketMs) {
  const edges = [];
  for (let i = points; i >= 0; i--) edges.push(now - i * bucketMs);
  return {
    key, points, bucketMs, edges,
    sinceMs: edges[0],
    endMs: now,
    // A bare time is ambiguous once the window spans more than a day.
    labelStyle: points * bucketMs > DAY ? "datetime" : "time",
  };
}

// Whole calendar days, so a point labelled "Aug 2" covers exactly Aug 2 in
// the viewer's zone instead of a slice that drifts with the time of day. The
// window ends at tonight's midnight, which makes the last bucket the one
// currently in progress.
function calendarRange(key, now, days, zone) {
  const bucketDays = Math.max(1, Math.ceil(days / MAX_POINTS));
  const points = Math.ceil(days / bucketDays);
  const edges = new Array(points + 1);
  edges[points] = addLocalDays(startOfLocalDay(now, zone), 1, zone);
  for (let i = points - 1; i > 0; i--) edges[i] = addLocalDays(edges[i + 1], -bucketDays, zone);
  // Pin the opening edge to exactly `days` back. When the day count isn't a
  // multiple of the bucket size the leading bucket is short, which is honest:
  // rounding it up instead made "Last 90 days" plot 96.
  edges[0] = addLocalDays(edges[points], -days, zone);
  return {
    key, points, edges, bucketDays,
    bucketMs: bucketDays * DAY,
    sinceMs: edges[0],
    endMs: edges[points],
    labelStyle: "date",
  };
}

// The ranges the analytics page offers, resolved to a bucketed window the
// metrics helpers understand. Every range carries explicit bucket `edges`
// rather than a start plus a stride: month-length buckets and DST days are
// not a fixed number of milliseconds, and rounding them was what put the
// labels on the wrong days. `custom` carries its own day count.
export function resolveRange(rangeKey, customDays = 14, timeZone = null) {
  const now = Date.now();
  const zone = normalizeZone(timeZone);

  switch (rangeKey) {
    case "1h":
      return intradayRange("1h", now, 12, 5 * MINUTE);
    case "24h":
      return intradayRange("24h", now, 12, 2 * HOUR);
    case "7d":
      return calendarRange("7d", now, 7, zone);
    case "custom": {
      const days = Math.max(1, Math.min(365, Math.round(Number(customDays) || 14)));
      // Under three days there aren't enough whole days to draw a line from,
      // so those windows bucket by the hour instead.
      const range = days < 3
        ? intradayRange("custom", now, MAX_POINTS, Math.ceil(days * DAY / MAX_POINTS / HOUR) * HOUR)
        : calendarRange("custom", now, days, zone);
      return { ...range, days };
    }
    case "30d":
    default:
      return calendarRange("30d", now, 30, zone);
  }
}

// These series are running totals, and the stretch before collection
// started carries no information at all. Measuring growth from there would
// count a channel's entire existing audience as "new", so the baseline is
// the first bucket we actually collected something in.
//
// That bucket is the one flagged `observed`, not the first one above zero:
// a metric that genuinely sat at 0 and then climbed - comments on a new
// account, say - would otherwise be measured from its first non-zero
// reading and report no growth at all.
function baselineIndex(series) {
  const observed = series.findIndex((p) => p.observed);
  return observed === -1 ? series.findIndex((p) => p.value > 0) : observed;
}

// Percentage change across the observed part of the series, or null when
// there is nothing to compare against (no data, or a single observation).
export function seriesDelta(series) {
  if (!series || series.length < 2) return null;
  const from = baselineIndex(series);
  if (from === -1 || from === series.length - 1) return null;
  const first = series[from].value;
  const last = series[series.length - 1].value;
  if (!first) return null;
  return (last - first) / first;
}

// Absolute growth over the observed part of the series - what the
// "New followers" tile counts.
export function seriesGain(series) {
  if (!series || !series.length) return 0;
  const from = baselineIndex(series);
  if (from === -1) return 0;
  return series[series.length - 1].value - series[from].value;
}

// Turns a job row plus its posts into the shape the UI consumes.
export function shapeJob(job, posts = []) {
  const product = job.product_json ? JSON.parse(job.product_json) : null;
  const script = job.script_json ? JSON.parse(job.script_json) : null;
  const settings = JSON.parse(job.settings_json || "{}");
  return {
    id: job.id,
    title: job.title || script?.hook || product?.name || "Untitled video",
    // Empty for videos planned from a brief rather than a product page.
    productUrl: job.product_url || null,
    brief: job.brief || null,
    concept: job.concept_json ? JSON.parse(job.concept_json) : null,
    product,
    script,
    settings,
    status: job.status,
    error: job.error,
    provider: job.provider,
    autoPost: Boolean(job.auto_post),
    scheduledAt: job.scheduled_at ? Number(job.scheduled_at) : null,
    videoUrl: job.video_filename ? `/ugc-media/${encodeURIComponent(job.video_filename)}` : null,
    createdAt: Number(job.created_at),
    updatedAt: Number(job.updated_at),
    posts: posts.map((p) => ({
      id: p.id,
      platform: p.platform,
      accountId: p.account_id,
      accountName: p.account_name,
      status: p.status,
      error: p.error,
      postedAt: p.posted_at ? Number(p.posted_at) : null,
      url: p.status === "done" ? postUrl(p) : null,
      views: p.views != null ? Number(p.views) : null,
      likes: p.likes != null ? Number(p.likes) : null,
      comments: p.comments != null ? Number(p.comments) : null,
      shares: p.shares != null ? Number(p.shares) : null,
      saves: p.saves != null ? Number(p.saves) : null,
    })),
  };
}

// Posts for a job, with each post's most recent metric snapshot attached.
export async function postsFor(jobId) {
  return q(
    `SELECT ugc_posts.*, accounts.display_name AS account_name,
            m.views, m.likes, m.comments, m.shares, m.saves
     FROM ugc_posts
     LEFT JOIN accounts ON accounts.id = ugc_posts.account_id
     LEFT JOIN post_metrics m ON m.post_id = ugc_posts.id AND m.collected_at = (
       SELECT MAX(m2.collected_at) FROM post_metrics m2 WHERE m2.post_id = ugc_posts.id
     )
     WHERE ugc_posts.job_id = ? ORDER BY ugc_posts.platform, ugc_posts.id`,
    [jobId]
  );
}

// Same, in one pass, for a list of jobs - avoids a query per job when
// rendering the calendar or the recent feed.
export async function postsForJobs(jobIds) {
  if (!jobIds.length) return new Map();
  const placeholders = jobIds.map(() => "?").join(",");
  const rows = await q(
    `SELECT ugc_posts.*, accounts.display_name AS account_name,
            m.views, m.likes, m.comments, m.shares, m.saves
     FROM ugc_posts
     LEFT JOIN accounts ON accounts.id = ugc_posts.account_id
     LEFT JOIN post_metrics m ON m.post_id = ugc_posts.id AND m.collected_at = (
       SELECT MAX(m2.collected_at) FROM post_metrics m2 WHERE m2.post_id = ugc_posts.id
     )
     WHERE ugc_posts.job_id IN (${placeholders})
     ORDER BY ugc_posts.platform, ugc_posts.id`,
    jobIds
  );
  const byJob = new Map();
  for (const row of rows) {
    if (!byJob.has(row.job_id)) byJob.set(row.job_id, []);
    byJob.get(row.job_id).push(row);
  }
  return byJob;
}

// The moment a job occupies on the calendar: its slot if scheduled,
// otherwise when it actually went out, otherwise when it was created.
export function jobTimestamp(job, posts = []) {
  if (job.scheduled_at) return Number(job.scheduled_at);
  const postedAt = posts.map((p) => p.postedAt ?? p.posted_at).filter(Boolean).map(Number);
  if (postedAt.length) return Math.min(...postedAt);
  return Number(job.created_at);
}

// Green = fully published, blue = still working or waiting for its slot,
// red = something failed. Matches the dots the UI already renders.
export function jobDotStatus(job, posts = []) {
  if (job.status === "failed") return "red";
  if (posts.length && posts.every((p) => p.status === "done")) return "green";
  if (posts.some((p) => p.status === "failed")) return "red";
  return "blue";
}

