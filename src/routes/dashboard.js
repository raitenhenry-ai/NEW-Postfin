import { Router } from "express";
import config, { PLATFORM_NAMES, ENABLED_PLATFORMS } from "../config.js";
import { q, q1 } from "../db.js";
import { platforms } from "../accounts.js";
import {
  totalsSince, postSeries, followerSeries, viewsByPlatform,
  estimateRevenue, accountLeaderboard, metricsStatus,
} from "../metrics.js";
import { ugcQueueLength, pickProvider } from "../ugc/pipeline.js";
import { heygenConfigured } from "../ugc/heygen.js";
import {
  wrap, resolveRange, seriesDelta, seriesGain, shapeJob, postsForJobs, jobTimestamp, jobDotStatus,
} from "./shared.js";

const router = Router();

const DAY_MS = 86400000;

/* ---------------------------------------------------------------- Dashboard */

// Everything index.html draws: the four stat tiles, the embedded calendar,
// the account leaderboard, top videos and the suggestion list.
router.get("/dashboard", wrap(async (req, res) => {
  const range = resolveRange(req.query.range || "30d", req.query.days, req.query.tz);
  const since = range.sinceMs;

  const [viewSeries, followers, totals, perPlatformViews, accounts] = await Promise.all([
    postSeries({ metric: "views", ...range }),
    followerSeries(range),
    totalsSince(since),
    viewsByPlatform(),
    accountLeaderboard(6),
  ]);

  const postedInRange = Number(
    (await q1("SELECT COUNT(*) AS n FROM ugc_posts WHERE status = 'done' AND posted_at > ?", [since]))?.n || 0
  );
  const followerGain = seriesGain(followers);

  const revenue = estimateRevenue(perPlatformViews);
  const totalViews = totals.views;
  const cpm = revenue !== null && totalViews ? (revenue / totalViews) * 1000 : null;

  res.json({
    range: { key: range.key, days: range.days ?? null },
    stats: {
      views: { value: totalViews, delta: seriesDelta(viewSeries) },
      // No publishing API reports ad revenue, so this stays null unless the
      // operator supplied CPM rates in the environment.
      cpm: { value: cpm, configured: cpm !== null },
      followers: { value: followerGain, total: followers.at(-1)?.value ?? 0, delta: seriesDelta(followers) },
      videosPosted: { value: postedInRange },
    },
    topAccounts: accounts.map((a) => ({
      ...a,
      handle: a.displayName?.startsWith("@") ? a.displayName : `@${(a.displayName || "").replace(/\s+/g, "").toLowerCase()}`,
    })),
    topVideos: await topVideos(6),
    suggestions: await suggestions(),
    system: {
      queueDepth: ugcQueueLength(),
      provider: pickProvider(),
      heygenConfigured: heygenConfigured(),
      openaiConfigured: Boolean(config.openaiApiKey),
      metrics: metricsStatus(),
      connectedAccounts: (await q("SELECT id FROM accounts")).length,
    },
  });
}));

// Best-performing finished videos by view count. Views are broken down per
// platform so each video's CPM uses that video's own rates rather than a
// workspace-wide average.
async function topVideos(limit) {
  const rows = await q(
    `SELECT j.id, j.title, j.product_json, j.script_json, j.video_filename,
            p.platform, COALESCE(SUM(m.views), 0) AS views
     FROM ugc_jobs j
     LEFT JOIN ugc_posts p ON p.job_id = j.id
     LEFT JOIN post_metrics m ON m.post_id = p.id AND m.collected_at = (
       SELECT MAX(m2.collected_at) FROM post_metrics m2 WHERE m2.post_id = p.id
     )
     WHERE j.video_filename IS NOT NULL
     GROUP BY j.id, j.title, j.product_json, j.script_json, j.video_filename, p.platform`
  );

  // Collapse the per-platform rows back into one entry per job.
  const jobs = new Map();
  for (const row of rows) {
    if (!jobs.has(row.id)) {
      jobs.set(row.id, {
        id: row.id,
        title: row.title,
        product: row.product_json ? JSON.parse(row.product_json) : null,
        script: row.script_json ? JSON.parse(row.script_json) : null,
        videoFilename: row.video_filename,
        byPlatform: {},
      });
    }
    if (row.platform) {
      const entry = jobs.get(row.id);
      entry.byPlatform[row.platform] = (entry.byPlatform[row.platform] || 0) + Number(row.views || 0);
    }
  }

  return [...jobs.values()]
    .map((job) => {
      const views = Object.values(job.byPlatform).reduce((a, b) => a + b, 0);
      const revenue = estimateRevenue(job.byPlatform);
      return {
        id: job.id,
        title: job.title || job.script?.hook || job.product?.name || `Video #${job.id}`,
        subtitle: job.product?.brand || job.product?.name || "",
        views,
        // Thumbnail comes from the scraped product image; the UI falls back
        // to a placeholder when a job has none.
        thumb: job.product?.images?.[0] || null,
        videoUrl: `/ugc-media/${encodeURIComponent(job.videoFilename)}`,
        cpm: revenue !== null && views ? Number(((revenue / views) * 1000).toFixed(2)) : null,
        durationSeconds: config.ugc.videoSeconds,
      };
    })
    .sort((a, b) => b.views - a.views || b.id - a.id)
    .slice(0, limit)
    .map((video, i) => ({ ...video, rank: i + 1 }));
}

// Observations drawn from real state - each one links to the page that acts
// on it. Nothing here is invented: every branch is a fact about the data.
async function suggestions() {
  const out = [];

  const accountCount = Number((await q1("SELECT COUNT(*) AS n FROM accounts"))?.n || 0);
  if (!accountCount) {
    out.push({ text: "Connect a social account to start posting", href: "connectors.html" });
  }

  const failed = Number(
    (await q1("SELECT COUNT(*) AS n FROM ugc_posts WHERE status = 'failed'"))?.n || 0
  );
  if (failed) {
    out.push({ text: `${failed} post${failed === 1 ? "" : "s"} failed - retry them`, href: "recent.html" });
  }

  const scheduled = Number(
    (await q1("SELECT COUNT(*) AS n FROM ugc_jobs WHERE scheduled_at > ?", [Date.now()]))?.n || 0
  );
  if (scheduled) {
    out.push({ text: `${scheduled} video${scheduled === 1 ? "" : "s"} scheduled ahead`, href: "calendar.html" });
  } else {
    out.push({ text: "Nothing scheduled - plan next week's posts", href: "calendar.html" });
  }

  const best = (await accountLeaderboard(1))[0];
  if (best?.views) {
    out.push({
      text: `${best.displayName || best.platform} is your top account`,
      href: "analytics.html",
    });
  }

  if (!config.openaiApiKey) {
    out.push({ text: "Add an OpenAI key for AI-written scripts", href: "profile.html" });
  }

  const weekAgo = Date.now() - 7 * DAY_MS;
  const thisWeek = Number(
    (await q1("SELECT COUNT(*) AS n FROM ugc_jobs WHERE created_at > ?", [weekAgo]))?.n || 0
  );
  out.push({ text: `${thisWeek} video${thisWeek === 1 ? "" : "s"} created this week`, href: "analytics.html" });

  return out.slice(0, 4);
}

/* ---------------------------------------------------------------- Analytics */

// analytics.html: three chart series, engagement totals and the recent grid,
// all filtered by platform and range.
router.get("/analytics", wrap(async (req, res) => {
  const platform = ENABLED_PLATFORMS.includes(req.query.platform) ? req.query.platform : null;
  const range = resolveRange(req.query.range || "30d", req.query.days, req.query.tz);
  const opts = { ...range, platform };

  const [views, followers, comments, likes, shares, saves, totals] = await Promise.all([
    postSeries({ metric: "views", ...opts }),
    followerSeries(opts),
    postSeries({ metric: "comments", ...opts }),
    postSeries({ metric: "likes", ...opts }),
    postSeries({ metric: "shares", ...opts }),
    postSeries({ metric: "saves", ...opts }),
    totalsSince(range.sinceMs, platform),
  ]);

  // A point covers [t, end) and holds the running total as of `end`. The
  // final bucket is still filling, so its end is clamped to now rather than
  // advertising a reading from the future.
  //
  // `total` is the lifetime running total the platforms report; `gain` is
  // what actually moved inside the selected window. The card leads with the
  // gain, because a number sitting under "Last 24 hours" is read as a
  // 24-hour figure - a lifetime follower count there claims growth that
  // never happened.
  const now = Date.now();
  const chart = (series) => ({
    series: series.map((p) => ({
      t: p.start, end: Math.min(p.end, now), v: p.value, observed: p.observed,
    })),
    total: series.at(-1)?.value ?? 0,
    gain: seriesGain(series),
    delta: seriesDelta(series),
  });

  // Same split for the engagement tiles.
  const tile = (series) => ({
    value: seriesGain(series),
    total: series.at(-1)?.value ?? 0,
    delta: seriesDelta(series),
  });

  res.json({
    range: {
      key: range.key,
      days: range.days ?? null,
      points: range.points,
      bucketMs: range.bucketMs,
      bucketDays: range.bucketDays ?? null,
      // How the client should name a point: "date" buckets are whole
      // calendar days and are named after the day they cover, the others
      // are named for the instant their reading was taken.
      labelStyle: range.labelStyle,
      startMs: range.sinceMs,
      endMs: Math.min(range.endMs, now),
    },
    platform: platform || "all",
    charts: {
      views: chart(views),
      followers: chart(followers),
      comments: chart(comments),
    },
    totals: {
      likes: tile(likes),
      comments: tile(comments),
      saves: tile(saves),
      shares: tile(shares),
    },
    engagement: totals,
    recentVideos: await recentVideos(platform, 8),
    hasData: views.some((p) => p.value > 0) || followers.some((p) => p.value > 0),
  });
}));

// Newest published videos with their totals. Rows come back per platform
// (so the card can show which platform it went to) and are collapsed here -
// group_concat/string_agg differ between SQLite and Postgres, so the
// grouping happens in JS rather than in SQL.
async function recentVideos(platform, limit) {
  const params = [];
  let platformFilter = "";
  if (platform) {
    platformFilter = "AND p.platform = ?";
    params.push(platform);
  }

  const rows = await q(
    `SELECT j.id, j.title, j.product_json, j.script_json, j.video_filename, j.created_at,
            p.platform,
            COALESCE(SUM(m.views), 0) AS views,
            COALESCE(SUM(m.likes), 0) AS likes,
            COALESCE(SUM(m.comments), 0) AS comments
     FROM ugc_jobs j
     JOIN ugc_posts p ON p.job_id = j.id ${platformFilter}
     LEFT JOIN post_metrics m ON m.post_id = p.id AND m.collected_at = (
       SELECT MAX(m2.collected_at) FROM post_metrics m2 WHERE m2.post_id = p.id
     )
     WHERE j.video_filename IS NOT NULL
     GROUP BY j.id, j.title, j.product_json, j.script_json, j.video_filename, j.created_at, p.platform
     ORDER BY j.created_at DESC`,
    params
  );

  const byJob = new Map();
  for (const row of rows) {
    if (!byJob.has(row.id)) {
      const product = row.product_json ? JSON.parse(row.product_json) : null;
      const script = row.script_json ? JSON.parse(row.script_json) : null;
      byJob.set(row.id, {
        id: row.id,
        title: row.title || script?.hook || product?.name || `Video #${row.id}`,
        thumb: product?.images?.[0] || null,
        videoUrl: `/ugc-media/${encodeURIComponent(row.video_filename)}`,
        createdAt: Number(row.created_at),
        platforms: [],
        views: 0,
        likes: 0,
        comments: 0,
        durationSeconds: config.ugc.videoSeconds,
      });
    }
    const entry = byJob.get(row.id);
    if (row.platform && !entry.platforms.includes(row.platform)) entry.platforms.push(row.platform);
    entry.views += Number(row.views || 0);
    entry.likes += Number(row.likes || 0);
    entry.comments += Number(row.comments || 0);
  }

  return [...byJob.values()].slice(0, limit);
}

/* ----------------------------------------------------------------- Calendar */

// calendar.html and the dashboard's embedded calendar. Returns every job
// that falls inside the window keyed by local date, which is what both
// views index into.
router.get("/calendar", wrap(async (req, res) => {
  const start = Number(req.query.start) || Date.now() - 30 * DAY_MS;
  const end = Number(req.query.end) || Date.now() + 30 * DAY_MS;

  const jobs = await q(
    `SELECT * FROM ugc_jobs
     WHERE COALESCE(scheduled_at, created_at) BETWEEN ? AND ?
     ORDER BY COALESCE(scheduled_at, created_at) ASC`,
    [start, end]
  );
  const postsByJob = await postsForJobs(jobs.map((j) => j.id));

  const days = {};
  for (const job of jobs) {
    const posts = postsByJob.get(job.id) || [];
    const shaped = shapeJob(job, posts);
    const at = jobTimestamp(job, posts);
    const key = dateKey(at);

    days[key] ??= { date: key, label: dayLabel(at), posts: [] };
    days[key].posts.push({
      id: shaped.id,
      // The calendar groups by platform: one entry per platform this job
      // targets, or the job's requested platforms when it hasn't posted yet.
      platforms: posts.length
        ? [...new Set(posts.map((p) => p.platform))]
        : shaped.settings.platforms || [],
      at,
      time: timeLabel(at),
      durationSeconds: config.ugc.videoSeconds,
      title: shaped.title,
      status: jobDotStatus(job, posts),
      jobStatus: job.status,
      provider: shaped.provider,
      productUrl: shaped.productUrl,
      videoUrl: shaped.videoUrl,
      prompt: promptText(shaped.script, shaped.settings, shaped.concept),
      brief: shaped.brief,
      caption: shaped.script?.caption || "",
      hashtags: (shaped.script?.hashtags || []).join(" "),
      productName: shaped.product?.name || "",
      accountCount: posts.length,
      scheduledAt: shaped.scheduledAt,
    });
  }

  res.json({ start, end, days });
}));

// The brief the video was generated from: the hook, the scenes and the CTA
// the script module produced, plus the tone/style that shaped them.
function promptText(script, settings, concept) {
  const parts = [];
  // A planned video shows its concept even before the script exists, so the
  // calendar has something to display while it is still rendering.
  if (concept?.title) parts.push(`Concept: ${concept.title}`);
  if (concept?.angle) parts.push(`Angle: ${concept.angle}`);
  if (!script) return parts.join("\n\n");
  if (script.hook) parts.push(`Hook: ${script.hook}`);
  const scenes = (script.scenes || []).map((s, i) => `${i + 1}. ${s.text || s}`);
  if (scenes.length) parts.push(`Scenes:\n${scenes.join("\n")}`);
  if (script.cta) parts.push(`CTA: ${script.cta}`);
  const meta = [settings?.tone, settings?.style].filter(Boolean).join(" · ");
  if (meta) parts.push(`Style: ${meta}`);
  return parts.join("\n\n");
}

function dateKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayLabel(ms) {
  return new Date(ms).toLocaleDateString("en-US", {
    weekday: "long", month: "short", day: "numeric",
  });
}

function timeLabel(ms) {
  return new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/* --------------------------------------------------------------- Connectors */

// connectors.html: every platform Postfin can publish to, whether its API
// credentials are present, and the accounts already linked.
router.get("/connectors", wrap(async (req, res) => {
  const rows = await q(
    "SELECT id, platform, display_name, connected_at, expires_at FROM accounts ORDER BY platform, id"
  );
  const byPlatform = Object.fromEntries(PLATFORM_NAMES.map((k) => [k, []]));
  for (const a of rows) {
    byPlatform[a.platform]?.push({
      id: a.id,
      displayName: a.display_name,
      connectedAt: Number(a.connected_at),
      expiresAt: a.expires_at ? Number(a.expires_at) : null,
    });
  }

  res.json({
    platforms: ENABLED_PLATFORMS.map((key) => ({
      key,
      label: PLATFORM_LABELS[key],
      description: PLATFORM_DESCRIPTIONS[key],
      configured: platforms[key].isConfigured(),
      connectUrl: `/auth/${key}`,
      accounts: byPlatform[key],
    })),
    maxAccountsPerPlatform: config.maxAccountsPerPlatform,
    // Shown on the Connectors page so the values each platform's dashboard
    // asks for can be copied from the running deployment, rather than
    // guessed at and rejected as a mismatch.
    baseUrl: config.baseUrl,
    metaWebhook: {
      url: `${config.baseUrl}/webhooks/meta`,
      verifyToken: config.metaVerifyToken,
    },
  });
}));

const PLATFORM_LABELS = {
  tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube", facebook: "Facebook",
  x: "X", threads: "Threads", pinterest: "Pinterest", linkedin: "LinkedIn",
};

const PLATFORM_DESCRIPTIONS = {
  tiktok: "Post videos to your TikTok account",
  instagram: "Publish Reels to your Instagram business account",
  youtube: "Upload Shorts to your YouTube channel",
  facebook: "Publish Reels to your Facebook Pages",
  x: "Post video tweets to X",
  threads: "Publish video posts to Threads",
  pinterest: "Create video Pins on your boards",
  linkedin: "Share video posts to your profile or Page",
};

/* ------------------------------------------------------------------- Recent */

// recent.html: the activity feed - every job newest first with its
// per-account publish results.
router.get("/recent", wrap(async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const jobs = await q("SELECT * FROM ugc_jobs ORDER BY created_at DESC LIMIT ?", [limit]);
  const postsByJob = await postsForJobs(jobs.map((j) => j.id));
  res.json(jobs.map((job) => shapeJob(job, postsByJob.get(job.id) || [])));
}));

/* ------------------------------------------------------------------ Profile */

// profile.html: who's signed in, plus the workspace's configuration state.
router.get("/profile", wrap(async (req, res) => {
  const session = req.session || {};
  const count = async (sql, params = []) => Number((await q1(sql, params))?.n || 0);

  res.json({
    user: {
      email: session.email || null,
      role: session.role || "operator",
      name: (session.email || "operator").split("@")[0],
    },
    workspace: {
      baseUrl: config.baseUrl,
      maxAccountsPerPlatform: config.maxAccountsPerPlatform,
      videoSeconds: config.ugc.videoSeconds,
      provider: pickProvider(),
    },
    integrations: {
      openai: Boolean(config.openaiApiKey),
      heygen: heygenConfigured(),
      platforms: Object.fromEntries(
        ENABLED_PLATFORMS.map((k) => [k, platforms[k].isConfigured()])
      ),
    },
    totals: {
      jobs: await count("SELECT COUNT(*) AS n FROM ugc_jobs"),
      videosReady: await count("SELECT COUNT(*) AS n FROM ugc_jobs WHERE video_filename IS NOT NULL"),
      posted: await count("SELECT COUNT(*) AS n FROM ugc_posts WHERE status = 'done'"),
      failedPosts: await count("SELECT COUNT(*) AS n FROM ugc_posts WHERE status = 'failed'"),
      connectedAccounts: await count("SELECT COUNT(*) AS n FROM accounts"),
      scheduled: await count("SELECT COUNT(*) AS n FROM ugc_jobs WHERE scheduled_at > ?", [Date.now()]),
    },
    metrics: metricsStatus(),
  });
}));

export default router;
