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

// The ranges the analytics page offers, resolved to a bucketed window the
// metrics helpers understand. `custom` carries its own day count.
export function resolveRange(rangeKey, customDays = 14) {
  const now = Date.now();
  switch (rangeKey) {
    case "1h":
      return { key: "1h", points: 12, bucketMs: 5 * 60 * 1000, sinceMs: now - 60 * 60 * 1000 };
    case "24h":
      return { key: "24h", points: 12, bucketMs: 2 * 60 * 60 * 1000, sinceMs: now - 24 * 60 * 60 * 1000 };
    case "7d":
      return { key: "7d", points: 7, bucketMs: 86400000, sinceMs: now - 7 * 86400000 };
    case "custom": {
      const days = Math.max(1, Math.min(365, Number(customDays) || 14));
      const points = Math.min(12, Math.max(4, Math.min(days, 12)));
      return {
        key: "custom",
        days,
        points,
        bucketMs: Math.ceil((days * 86400000) / points),
        sinceMs: now - days * 86400000,
      };
    }
    case "30d":
    default:
      return { key: "30d", points: 8, bucketMs: Math.ceil((30 * 86400000) / 8), sinceMs: now - 30 * 86400000 };
  }
}

// These series are running totals, and they read zero for any stretch
// before collection started. Measuring growth from that leading zero would
// count a channel's entire existing audience as "new", so the baseline is
// the first bucket we actually observed something in.
function baselineIndex(series) {
  return series.findIndex((p) => p.value > 0);
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
    productUrl: job.product_url,
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

