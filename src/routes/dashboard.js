import { Router } from "express";
import config, { PLATFORM_NAMES, ENABLED_PLATFORMS } from "../config.js";
import { q, q1, run as dbRun } from "../db.js";
import { platforms, resolveTargetPlatforms, connectedPlatforms } from "../accounts.js";
import {
  postSeries, followerSeries, viewsByPlatform,
  estimateRevenue, accountLeaderboard, metricsStatus,
} from "../metrics.js";
import { ugcQueueLength, pickProvider, jobFormat } from "../ugc/pipeline.js";
import { checkStorage } from "../storage.js";
import { heygenConfigured } from "../ugc/heygen.js";
import { scrapeProduct } from "../ugc/scrape.js";
import { accountProfileUrl, postUrl } from "../postUrl.js";
import {
  wrap, resolveRange, expandAllTimeRange, seriesDelta, seriesGain, rebaseSeriesToGain, shapeJob, postsForJobs, jobTimestamp, jobDotStatus,
} from "./shared.js";
import { gainsForRange } from "../analytics/rangeGain.js";

const router = Router();

const DAY_MS = 86400000;

/* ---------------------------------------------------------------- Dashboard */

async function resolveAnalyticsRange(req) {
  let range = resolveRange(req.query.range || "30d", req.query.days, req.query.tz);
  if (range.key === "all") {
    const earliest = await q1("SELECT MIN(collected_at) AS at FROM post_metrics");
    range = expandAllTimeRange(range, earliest?.at ? Number(earliest.at) : null, req.query.tz);
  }
  return range;
}

// Everything dashboard.html draws: the four stat tiles, the embedded calendar,
// the account leaderboard, top videos and the suggestion list.
router.get("/dashboard", wrap(async (req, res) => {
  const range = await resolveAnalyticsRange(req);

  const [viewSeries, followers, gains, perPlatformViews, accounts, metrics] = await Promise.all([
    postSeries({ metric: "views", ...range }),
    followerSeries(range),
    gainsForRange(range),
    viewsByPlatform(),
    accountLeaderboard(6),
    metricsStatus(),
  ]);

  const followerGain = seriesGain(followers);
  const revenue = estimateRevenue(perPlatformViews);
  const lifetimeViews = viewSeries.at(-1)?.value ?? 0;
  const cpm = revenue !== null && lifetimeViews ? (revenue / lifetimeViews) * 1000 : null;

  res.json({
    range: { key: range.key, days: range.days ?? null },
    stats: {
      views: { value: gains.views, total: lifetimeViews, delta: seriesDelta(viewSeries) },
      cpm: { value: cpm, configured: cpm !== null },
      followers: { value: followerGain, total: followers.at(-1)?.value ?? 0, delta: seriesDelta(followers) },
      videosPosted: { value: gains.published },
    },
    topAccounts: accounts.map((a) => ({
      ...a,
      handle: a.displayName?.startsWith("@") ? a.displayName : `@${(a.displayName || "").replace(/\s+/g, "").toLowerCase()}`,
      url: accountProfileUrl(a),
    })),
    topVideos: await topVideos(6),
    suggestions: await suggestions(),
    system: {
      queueDepth: ugcQueueLength(),
      provider: pickProvider(),
      heygenConfigured: heygenConfigured(),
      openaiConfigured: Boolean(config.openaiApiKey),
      metrics,
      connectedAccounts: (await q("SELECT id FROM accounts")).length,
      lastSyncedAt: metrics.lastSyncedAt || null,
    },
  });
}));

// Best-performing posted videos by view count. Views are broken down per
// platform so each video's CPM uses that video's own rates rather than a
// workspace-wide average.
async function topVideos(limit) {
  const rows = await q(
    `SELECT j.id, j.title, j.product_json, j.script_json, j.video_filename, j.created_at,
            p.platform, COALESCE(SUM(m.views), 0) AS views, MAX(p.posted_at) AS posted_at
     FROM ugc_jobs j
     LEFT JOIN ugc_posts p ON p.job_id = j.id AND p.status = 'done'
     LEFT JOIN post_metrics m ON m.post_id = p.id AND m.collected_at = (
       SELECT MAX(m2.collected_at) FROM post_metrics m2 WHERE m2.post_id = p.id
     )
     WHERE j.status = 'posted' AND j.video_filename IS NOT NULL
     GROUP BY j.id, j.title, j.product_json, j.script_json, j.video_filename, j.created_at, p.platform`
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
        createdAt: Number(row.created_at) || 0,
        postedAt: 0,
        byPlatform: {},
      });
    }
    const entry = jobs.get(row.id);
    const posted = Number(row.posted_at) || 0;
    if (posted > entry.postedAt) entry.postedAt = posted;
    if (row.platform) {
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
        postedAt: job.postedAt || job.createdAt || null,
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

// analytics.html: chart series, engagement totals and the recent grid,
// all filtered by platform and range. Gains use snapshot differences.
router.get("/analytics", wrap(async (req, res) => {
  const platform = ENABLED_PLATFORMS.includes(req.query.platform) ? req.query.platform : null;
  const range = await resolveAnalyticsRange(req);
  const opts = { ...range, platform };

  const [views, followers, comments, likes, shares, saves, gains, metrics] = await Promise.all([
    postSeries({ metric: "views", ...opts }),
    followerSeries(opts),
    postSeries({ metric: "comments", ...opts }),
    postSeries({ metric: "likes", ...opts }),
    postSeries({ metric: "shares", ...opts }),
    postSeries({ metric: "saves", ...opts }),
    gainsForRange(range, platform),
    metricsStatus(),
  ]);

  const now = Date.now();
  const chart = (series, gainOverride = null, { asGain = false } = {}) => {
    const plot = asGain ? rebaseSeriesToGain(series) : series;
    return {
      series: plot.map((p) => ({
        t: p.start, end: Math.min(p.end, now), v: p.value, observed: p.observed,
      })),
      total: series.at(-1)?.value ?? 0,
      gain: gainOverride != null ? gainOverride : seriesGain(series),
      delta: seriesDelta(series),
    };
  };

  const tile = (series, gainOverride = null) => ({
    value: gainOverride != null ? gainOverride : seriesGain(series),
    total: series.at(-1)?.value ?? 0,
    delta: seriesDelta(series),
  });

  // Chart points for the client in a simple [{timestamp, views}] form too.
  const chartPoints = views.map((p) => ({
    timestamp: new Date(Math.min(p.end, now)).toISOString(),
    views: p.value,
  }));

  res.json({
    range: {
      key: range.key,
      days: range.days ?? null,
      points: range.points,
      bucketMs: range.bucketMs,
      bucketDays: range.bucketDays ?? null,
      labelStyle: range.labelStyle,
      startMs: range.sinceMs,
      endMs: Math.min(range.endMs, now),
    },
    platform: platform || "all",
    charts: {
      views: chart(views, gains.views),
      followers: chart(followers, null, { asGain: true }),
      comments: chart(comments, gains.comments),
    },
    chartPoints,
    totals: {
      likes: tile(likes, gains.likes),
      comments: tile(comments, gains.comments),
      saves: tile(saves, gains.saves),
      shares: tile(shares, gains.shares),
    },
    engagement: {
      views: gains.views,
      likes: gains.likes,
      comments: gains.comments,
      shares: gains.shares,
      saves: gains.saves,
      posts: gains.published,
    },
    published: gains.published,
    recentVideos: await recentVideos(platform, 8),
    hasData: views.some((p) => p.value > 0) || followers.some((p) => p.value > 0),
    lastSyncedAt: metrics.lastSyncedAt || null,
    stalePlatforms: (metrics.stalePlatforms || []).filter((s) => s.stale),
    note: "Platform APIs can delay updates — figures are Postfin-tracked snapshots, not live counts.",
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
            p.platform, p.platform_video_id, p.public_post_id, p.status AS post_status,
            a.display_name AS account_name,
            COALESCE(SUM(m.views), 0) AS views,
            COALESCE(SUM(m.likes), 0) AS likes,
            COALESCE(SUM(m.comments), 0) AS comments
     FROM ugc_jobs j
     JOIN ugc_posts p ON p.job_id = j.id ${platformFilter}
     LEFT JOIN accounts a ON a.id = p.account_id
     LEFT JOIN post_metrics m ON m.post_id = p.id AND m.collected_at = (
       SELECT MAX(m2.collected_at) FROM post_metrics m2 WHERE m2.post_id = p.id
     )
     WHERE j.video_filename IS NOT NULL
     GROUP BY j.id, j.title, j.product_json, j.script_json, j.video_filename, j.created_at,
              p.platform, p.platform_video_id, p.public_post_id, p.status, a.display_name
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
        url: null,
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
    if (!entry.url && row.post_status === "done") {
      entry.url = postUrl(row);
    }
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
  // Jobs that were saved with an empty platform list (agent "all connected")
  // resolve to the same targets the publisher uses, so the calendar never
  // shows "No platform".
  const defaultPlatforms = await resolveTargetPlatforms([]);
  const linkedPlatforms = await connectedPlatforms();
  // A job scraped before its product was saved to the catalog has no images of
  // its own, so the popup's product image falls back to the catalog row.
  const catalogImages = new Map();
  for (const row of await q("SELECT url, product_json FROM products")) {
    try {
      const images = JSON.parse(row.product_json || "null")?.images;
      if (Array.isArray(images) && images[0]) catalogImages.set(row.url, images[0]);
    } catch {
      // A product row with unreadable JSON just has no image.
    }
  }

  const days = {};
  for (const job of jobs) {
    const posts = postsByJob.get(job.id) || [];
    const shaped = shapeJob(job, posts);
    const at = jobTimestamp(job, posts);
    const key = dateKey(at);
    const savedPlatforms = (shaped.settings.platforms || [])
      .filter((p) => linkedPlatforms.includes(p));

    days[key] ??= { date: key, label: dayLabel(at), posts: [] };
    days[key].posts.push({
      id: shaped.id,
      // The calendar groups by platform: one entry per platform this job
      // targets, or the job's requested platforms when it hasn't posted yet.
      platforms: posts.length
        ? [...new Set(posts.map((p) => p.platform))]
        : (savedPlatforms.length ? savedPlatforms : defaultPlatforms),
      at,
      time: timeLabel(at),
      durationSeconds: config.ugc.videoSeconds,
      title: shaped.title,
      status: jobDotStatus(job, posts),
      jobStatus: job.status,
      // Why a failed video failed. Without this the calendar can only say
      // "failed", which is the least useful half of the information.
      error: job.error || null,
      // A video that rendered but not entirely as asked - slides that fell
      // back to plain cards, say.
      warning: shaped.script?.imageNote || null,
      provider: shaped.provider,
      // Which of the two video formats this is, so the panel can name the
      // renderer and show the slides a slideshow was built from.
      format: jobFormat(shaped.settings),
      slideCount: shaped.script?.slides?.length || null,
      slideUrls: shaped.slideUrls,
      productUrl: shaped.productUrl,
      videoUrl: shaped.videoUrl,
      prompt: promptText(shaped.script, shaped.settings, shaped.concept, shaped.brief),
      brief: shaped.brief,
      caption: shaped.script?.caption || "",
      hashtags: (shaped.script?.hashtags || []).join(" "),
      productName: shaped.product?.name || "",
      productImage: shaped.product?.images?.[0]
        || catalogImages.get(shaped.productUrl)
        || null,
      accountCount: posts.length,
      scheduledAt: shaped.scheduledAt,
      references: Array.isArray(shaped.settings.references) ? shaped.settings.references : [],
    });
  }

  res.json({ start, end, days, connectedPlatforms: linkedPlatforms });
}));

// The brief the video was generated from: the hook, the scenes and the CTA
// the script module produced, plus the tone/style that shaped them. A
// slideshow is shown as its slides instead - that is what it actually is.
// References and the main product image are part of the prompt the writers
// see, so they show up here too.
function promptText(script, settings, concept, brief, product = null) {
  const parts = [];
  const briefText = String(brief || settings?.brief || "").trim();
  if (briefText) parts.push(`Brief:\n${briefText}`);
  if (concept?.title) parts.push(`Concept: ${concept.title}`);
  if (concept?.angle) parts.push(`Angle: ${concept.angle}`);
  if (concept?.talkingPoints?.length) {
    parts.push(`Talking points:\n- ${concept.talkingPoints.join("\n- ")}`);
  }

  const refs = Array.isArray(settings?.references) ? settings.references : [];
  if (refs.length) {
    parts.push(
      "References:\n" +
        refs
          .map((r) => {
            const url = String(r?.url || "").trim();
            if (!url) return null;
            if (r?.kind === "image") {
              return `- Image${r.name ? ` (${r.name})` : ""}: ${url}`;
            }
            return `- Link${r.name ? ` (${r.name})` : ""}: ${url}`;
          })
          .filter(Boolean)
          .join("\n")
    );
  }
  const productImage = product?.images?.[0] || null;
  if (productImage) {
    parts.push(`Main product image:\n${productImage}`);
  }

  if (!script) return parts.join("\n\n");

  if (script.slides?.length) {
    if (script.styleNote) parts.push(`Look: ${script.styleNote}`);
    parts.push(
      script.slides
        .map((slide, i) => {
          const lines = [`Slide ${i + 1}`];
          if (slide.overlay) lines.push(`On screen: ${slide.overlay}`);
          if (slide.spoken) lines.push(`Voiceover: ${slide.spoken}`);
          if (slide.imagePrompt) lines.push(`Image prompt: ${slide.imagePrompt}`);
          return lines.join("\n");
        })
        .join("\n\n")
    );
    if (script.angle) parts.push(`Angle: ${script.angle}`);
    return parts.join("\n\n");
  }

  if (script.hook) parts.push(`Hook (spoken): ${script.hook}`);
  const scenes = (script.scenes || []).map((s, i) => `${i + 1}. ${s.text || s}`);
  if (scenes.length) parts.push(`Spoken scenes:\n${scenes.join("\n")}`);
  if (script.cta) parts.push(`CTA (spoken): ${script.cta}`);
  if (script.storyboard?.length) {
    parts.push(
      "Image prompts (sent to the image model):\n" +
        script.storyboard
          .map((entry, i) => {
            const shot = entry.shot === "product" ? "product cutaway" : "creator scene";
            return `${i + 1}. [${shot}] ${entry.visual || "(none)"}`;
          })
          .join("\n")
    );
  }
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

/* ----------------------------------------------------------------- Products */

function normalizeProductUrl(raw) {
  const parsed = new URL(String(raw || "").trim());
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("bad protocol");
  parsed.hash = "";
  return parsed.toString();
}

function shapeCatalogProduct(row, usage = {}) {
  let scraped = {};
  try {
    scraped = row.product_json ? JSON.parse(row.product_json) : {};
  } catch {
    scraped = {};
  }
  const images = Array.isArray(scraped.images) ? scraped.images.filter(Boolean) : [];
  return {
    id: row.id,
    url: row.url,
    name: scraped.name || null,
    brand: scraped.brand || null,
    price: scraped.price ?? null,
    currency: scraped.currency || null,
    description: scraped.description || null,
    site: scraped.site || null,
    images,
    image: images[0] || null,
    videoCount: usage.videoCount || 0,
    lastUsedAt: usage.lastUsedAt || Number(row.updated_at || row.created_at),
    latestJobId: usage.latestJobId || null,
    hasVideo: Boolean(usage.hasVideo),
    saved: true,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

// products.html: saved catalog + products that have appeared on jobs.
router.get("/products", wrap(async (req, res) => {
  const [savedRows, jobs] = await Promise.all([
    q("SELECT * FROM products ORDER BY updated_at DESC"),
    q(
      `SELECT id, product_url, product_json, created_at, video_filename
       FROM ugc_jobs
       WHERE product_url IS NOT NULL AND TRIM(product_url) <> ''
       ORDER BY created_at DESC`
    ),
  ]);

  const usageByUrl = new Map();
  for (const job of jobs) {
    const url = String(job.product_url).trim();
    if (!url) continue;
    const existing = usageByUrl.get(url);
    if (!existing) {
      let product = null;
      try {
        product = job.product_json ? JSON.parse(job.product_json) : null;
      } catch {
        product = null;
      }
      usageByUrl.set(url, {
        url,
        name: product?.name || null,
        brand: product?.brand || null,
        price: product?.price ?? null,
        currency: product?.currency || null,
        description: product?.description || null,
        site: product?.site || null,
        images: Array.isArray(product?.images) ? product.images.filter(Boolean) : [],
        videoCount: 1,
        lastUsedAt: Number(job.created_at),
        latestJobId: job.id,
        hasVideo: Boolean(job.video_filename),
        scrapedFromJob: product,
      });
      continue;
    }
    existing.videoCount += 1;
    if (job.video_filename) existing.hasVideo = true;
  }

  const products = [];
  const seen = new Set();

  for (const row of savedRows) {
    const usage = usageByUrl.get(row.url) || {};
    products.push(shapeCatalogProduct(row, usage));
    seen.add(row.url);
  }

  for (const [url, usage] of usageByUrl) {
    if (seen.has(url)) continue;
    const images = usage.images || [];
    products.push({
      id: null,
      url,
      name: usage.name,
      brand: usage.brand,
      price: usage.price,
      currency: usage.currency,
      description: usage.description,
      site: usage.site,
      images,
      image: images[0] || null,
      videoCount: usage.videoCount,
      lastUsedAt: usage.lastUsedAt,
      latestJobId: usage.latestJobId,
      hasVideo: usage.hasVideo,
      saved: false,
      createdAt: usage.lastUsedAt,
      updatedAt: usage.lastUsedAt,
    });
  }

  products.sort((a, b) => (b.updatedAt || b.lastUsedAt || 0) - (a.updatedAt || a.lastUsedAt || 0));
  res.json({ products });
}));

// Paste a product URL → scrape the page and save it to the catalog.
router.post("/products", wrap(async (req, res) => {
  let url;
  try {
    url = normalizeProductUrl(req.body.url);
  } catch {
    return res.status(400).json({ error: "Enter a valid product URL (https://...)" });
  }

  const scraped = await scrapeProduct(url);
  const now = Date.now();
  const existing = await q1("SELECT id FROM products WHERE url = ?", [scraped.url]);

  if (existing) {
    await dbRun(
      "UPDATE products SET product_json = ?, updated_at = ? WHERE id = ?",
      [JSON.stringify(scraped), now, existing.id]
    );
    const row = await q1("SELECT * FROM products WHERE id = ?", [existing.id]);
    return res.json({ product: shapeCatalogProduct(row), updated: true });
  }

  const row = await q1(
    `INSERT INTO products (url, product_json, created_at, updated_at)
     VALUES (?, ?, ?, ?) RETURNING *`,
    [scraped.url, JSON.stringify(scraped), now, now]
  );
  res.status(201).json({ product: shapeCatalogProduct(row), updated: false });
}));

router.delete("/products/:id", wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid product id" });
  const row = await q1("SELECT id FROM products WHERE id = ?", [id]);
  if (!row) return res.status(404).json({ error: "Product not found" });
  await dbRun("DELETE FROM products WHERE id = ?", [id]);
  res.json({ ok: true });
}));

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

// recent.html: only videos that actually went live somewhere.
router.get("/recent", wrap(async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));

  // Require at least one successful post row - job.status = 'posted' alone
  // is not enough (it can be set when posting was skipped or partial).
  const jobs = await q(
    `SELECT j.*
     FROM ugc_jobs j
     WHERE EXISTS (
       SELECT 1 FROM ugc_posts p
       WHERE p.job_id = j.id AND p.status = 'done'
     )
     ORDER BY j.created_at DESC
     LIMIT ?`,
    [limit]
  );
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
    metrics: await metricsStatus(),
    // Whether finished videos survive a restart. The single most expensive
    // misconfiguration this app has, and invisible until a post is due.
    storage: await checkStorage({ write: false }),
    // Which build is serving this page, so a stale deploy is visible.
    build: config.build,
  });
}));

export default router;
