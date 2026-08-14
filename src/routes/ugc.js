import { Router } from "express";
import config, { PLATFORM_NAMES, ENABLED_PLATFORMS } from "../config.js";
import { q, q1, run as dbRun } from "../db.js";
import { platforms, resolveTargetPlatforms, connectedPlatforms } from "../accounts.js";
import { toneOptions, styleOptions } from "../ugc/script.js";
import { slideshowAngles, slideshowConfigured, testImageGeneration } from "../ugc/slideshow.js";
import { planContent, normalizeSettings } from "../ugc/plan.js";
import { heygenConfigured, heygenCatalog, testConnection } from "../ugc/heygen.js";
import { collectMetrics } from "../metrics.js";
import {
  checkRefreshCooldown,
  markRefreshCooldown,
  latestSyncAt,
} from "../analytics/syncAnalytics.js";
import { reschedule } from "../schedule.js";
import { runAssistant, assistantAvailable } from "../agent.js";
import {
  enqueueUgcJob, postJob, pickProvider, ugcQueueLength, deleteJobFiles,
} from "../ugc/pipeline.js";
import { wrap, shapeJob, postsFor, postsForJobs } from "./shared.js";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const router = Router();

// Generator capabilities plus connected accounts - what the create form
// needs to draw itself.
router.get("/overview", wrap(async (req, res) => {
  const accountRows = await q(
    "SELECT id, platform, display_name FROM accounts ORDER BY platform, id"
  );
  const accounts = Object.fromEntries(ENABLED_PLATFORMS.map((k) => [k, []]));
  for (const a of accountRows) {
    accounts[a.platform]?.push({ id: a.id, displayName: a.display_name });
  }

  const count = async (sql, params = []) => Number((await q1(sql, params))?.n || 0);
  res.json({
    accounts,
    platformsConfigured: Object.fromEntries(
      ENABLED_PLATFORMS.map((k) => [k, platforms[k].isConfigured()])
    ),
    generator: {
      provider: pickProvider(),
      defaultFormat: config.ugc.format,
      heygenConfigured: heygenConfigured(),
      slideshowConfigured: slideshowConfigured(),
      openaiConfigured: Boolean(config.openaiApiKey),
      tones: toneOptions(),
      styles: styleOptions(),
      slideshowAngles: slideshowAngles(),
      queueDepth: ugcQueueLength(),
    },
    totals: {
      jobs: await count("SELECT COUNT(*) AS n FROM ugc_jobs"),
      videosReady: await count("SELECT COUNT(*) AS n FROM ugc_jobs WHERE video_filename IS NOT NULL"),
      posted: await count("SELECT COUNT(*) AS n FROM ugc_posts WHERE status = 'done'"),
      failedPosts: await count("SELECT COUNT(*) AS n FROM ugc_posts WHERE status = 'failed'"),
      connectedAccounts: accountRows.length,
      scheduled: await count("SELECT COUNT(*) AS n FROM ugc_jobs WHERE scheduled_at > ?", [Date.now()]),
    },
  });
}));

// Per-platform config state + linked accounts (kept for the accounts view;
// /api/connectors is the richer version the Connectors page uses).
router.get("/accounts", wrap(async (req, res) => {
  const rows = await q(
    "SELECT id, platform, display_name, connected_at FROM accounts ORDER BY platform, id"
  );
  const byPlatform = Object.fromEntries(PLATFORM_NAMES.map((k) => [k, []]));
  for (const a of rows) {
    byPlatform[a.platform]?.push({
      id: a.id,
      displayName: a.display_name,
      connectedAt: Number(a.connected_at),
    });
  }
  res.json({
    platforms: Object.fromEntries(PLATFORM_NAMES.map((k) => [
      k, { configured: platforms[k].isConfigured(), accounts: byPlatform[k] },
    ])),
    maxAccountsPerPlatform: config.maxAccountsPerPlatform,
    redirectUris: Object.fromEntries(
      PLATFORM_NAMES.map((k) => [k, `${config.baseUrl}/auth/${k}/callback`])
    ),
  });
}));

// Create a video. `scheduledAt` (epoch ms) parks it at 'ready' until its
// slot; without one it posts as soon as it has rendered.
router.post("/jobs", wrap(async (req, res) => {
  const productUrl = String(req.body.productUrl || "").trim();
  const brief = String(req.body.brief || "").trim();

  // One of the two is required: a page to scrape, or a written brief to
  // build the video from.
  if (productUrl) {
    try {
      const parsed = new URL(productUrl);
      if (!/^https?:$/.test(parsed.protocol)) throw new Error();
    } catch {
      return res.status(400).json({ error: "Enter a valid product URL (https://...)" });
    }
  } else if (!brief) {
    return res.status(400).json({ error: "Enter a product URL (https://...) or describe the video" });
  }

  const wanted = await resolveTargetPlatforms(req.body.platforms);
  const settings = {
    tone: toneOptions().includes(req.body.tone) ? req.body.tone : "casual",
    style: styleOptions().includes(req.body.style) ? req.body.style : "product_pov",
    platforms: wanted,
    provider: ["heygen", "local", "auto"].includes(req.body.provider) ? req.body.provider : undefined,
    voice: typeof req.body.voice === "string" ? req.body.voice.slice(0, 40) : undefined,
    ...formatSettings(req.body),
    ...avatarSettings(req.body),
  };
  const autoPost = req.body.autoPost === false ? 0 : 1;
  const title = typeof req.body.title === "string" ? req.body.title.slice(0, 120) : null;

  const scheduledAt = parseScheduledAt(req.body.scheduledAt);
  if (scheduledAt === undefined) {
    return res.status(400).json({ error: "scheduledAt must be a timestamp in the future" });
  }

  const now = Date.now();
  const row = await q1(
    `INSERT INTO ugc_jobs (product_url, settings_json, status, auto_post, title, brief,
       scheduled_at, created_at, updated_at)
     VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?) RETURNING id`,
    [productUrl, JSON.stringify(settings), autoPost, title, brief || null, scheduledAt, now, now]
  );
  enqueueUgcJob(row.id);
  res.json({ id: row.id, status: "queued", scheduledAt });
}));

// Plan a set of videos from one written brief: the calendar composer sends
// what the user typed plus the slots they selected, and gets back one
// distinct concept per slot, each already queued as a job.
//
// body: { brief, slots: [epochMs], productUrl?, platforms?, tone?, style?, autoPost? }
router.post("/plan", wrap(async (req, res) => {
  const brief = String(req.body.brief || "").trim();

  // The client sends absolute timestamps because it knows the user's
  // timezone; the server never has to guess what "Tuesday 9am" means.
  const slots = (Array.isArray(req.body.slots) ? req.body.slots : [])
    .map((s) => (typeof s === "number" ? s : Date.parse(s)))
    .filter((s) => Number.isFinite(s))
    .sort((a, b) => a - b);
  if (!slots.length) return res.status(400).json({ error: "Select at least one day to post on" });
  if (slots.length > 30) return res.status(400).json({ error: "Plan at most 30 videos at a time" });

  // A product URL is optional - it becomes source material when present.
  let productUrl = String(req.body.productUrl || "").trim();
  if (productUrl) {
    try {
      const parsed = new URL(productUrl);
      if (!/^https?:$/.test(parsed.protocol)) throw new Error();
    } catch {
      return res.status(400).json({ error: "That product URL isn't valid" });
    }
  }
  if (!brief && !productUrl) {
    return res.status(400).json({ error: "Describe what you want, or include a product URL" });
  }

  const { tone, style } = normalizeSettings(req.body);
  const plan = await planContent({ brief, count: slots.length, productUrl, tone, style });

  const wanted = await resolveTargetPlatforms(req.body.platforms);
  const autoPost = req.body.autoPost === false ? 0 : 1;
  const now = Date.now();

  const created = [];
  for (const [i, concept] of plan.concepts.entries()) {
    // A slot in the past would publish the moment it renders; nudge it just
    // far enough out that the video finishes first.
    const scheduledAt = slots[i] > now ? slots[i] : now + 60000;
    const settings = {
      tone, style, platforms: wanted,
      ...formatSettings(req.body),
      ...avatarSettings(req.body),
    };
    const row = await q1(
      `INSERT INTO ugc_jobs (product_url, settings_json, status, auto_post, title,
         brief, concept_json, scheduled_at, created_at, updated_at)
       VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [
        productUrl, JSON.stringify(settings), autoPost, concept.title,
        brief || null, JSON.stringify(concept), scheduledAt, now, now,
      ]
    );
    enqueueUgcJob(row.id);
    created.push({ id: row.id, scheduledAt, ...concept });
  }

  res.json({
    plannedBy: plan.generatedBy,
    brief,
    productUrl: productUrl || null,
    videos: created,
  });
}));

// Which of the two video formats a job is, plus the settings only the
// slideshow uses. Stored per job, so changing the workspace default later
// doesn't silently re-shape videos that are already scheduled.
function formatSettings(body) {
  const format = body.format === "slideshow" ? "slideshow" : body.format === "avatar" ? "avatar" : null;
  const out = format ? { format } : {};
  if (slideshowAngles().includes(body.angle)) out.angle = body.angle;
  const slides = Number(body.slides);
  if (Number.isInteger(slides) && slides >= 3 && slides <= 10) out.slides = slides;
  return out;
}

// HeyGen avatar/voice selection. Stored per job so re-rendering a video
// months later still uses the avatar it was made with, even if the
// workspace default has moved on.
function avatarSettings(body) {
  const out = {};
  if (typeof body.avatarId === "string" && body.avatarId.trim()) {
    out.avatarId = body.avatarId.trim().slice(0, 120);
  }
  if (body.avatarKind === "talking_photo") out.avatarKind = "talking_photo";
  if (typeof body.voiceId === "string" && body.voiceId.trim()) {
    out.voiceId = body.voiceId.trim().slice(0, 120);
  }
  return out;
}

// null = no schedule, a number = a valid future slot, undefined = invalid.
function parseScheduledAt(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const value = typeof raw === "number" ? raw : Date.parse(raw);
  if (!Number.isFinite(value) || value <= Date.now()) return undefined;
  return value;
}

router.get("/jobs", wrap(async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  const jobs = await q("SELECT * FROM ugc_jobs ORDER BY created_at DESC LIMIT ?", [limit]);
  const postsByJob = await postsForJobs(jobs.map((j) => j.id));
  res.json(jobs.map((job) => shapeJob(job, postsByJob.get(job.id) || [])));
}));

router.get("/jobs/:id", wrap(async (req, res) => {
  const job = await q1("SELECT * FROM ugc_jobs WHERE id = ?", [req.params.id]);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(shapeJob(job, await postsFor(job.id)));
}));

// Edit a job in place: retitle it, rewrite the caption the platforms will
// use, or move its slot on the calendar.
router.patch("/jobs/:id", wrap(async (req, res) => {
  const job = await q1("SELECT * FROM ugc_jobs WHERE id = ?", [req.params.id]);
  if (!job) return res.status(404).json({ error: "Job not found" });

  let nextPlatforms = null;
  if ("platforms" in req.body) {
    if (!Array.isArray(req.body.platforms)) {
      return res.status(400).json({ error: "platforms must be an array" });
    }
    nextPlatforms = await resolveTargetPlatforms(req.body.platforms);
    if (!nextPlatforms.length) {
      const linked = await connectedPlatforms();
      return res.status(400).json({
        error: linked.length
          ? "Pick at least one linked platform"
          : "No social accounts are linked",
      });
    }
  }

  if (typeof req.body.title === "string") {
    await dbRun("UPDATE ugc_jobs SET title = ?, updated_at = ? WHERE id = ?",
      [req.body.title.slice(0, 120), Date.now(), job.id]);
  }

  if (typeof req.body.brief === "string") {
    await dbRun("UPDATE ugc_jobs SET brief = ?, updated_at = ? WHERE id = ?",
      [req.body.brief.slice(0, 12000), Date.now(), job.id]);
  }

  // Caption and hashtags live inside the generated script; both are what
  // the platforms actually receive at publish time.
  if (typeof req.body.caption === "string" || "hashtags" in req.body) {
    const script = JSON.parse(job.script_json || "null");
    if (script) {
      if (typeof req.body.caption === "string") {
        script.caption = req.body.caption.slice(0, 2200);
      }
      if ("hashtags" in req.body) {
        const raw = Array.isArray(req.body.hashtags)
          ? req.body.hashtags
          : String(req.body.hashtags || "").split(/[\s,]+/);
        script.hashtags = raw
          .map((tag) => String(tag).trim())
          .filter(Boolean)
          .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`))
          .slice(0, 30);
      }
      await dbRun("UPDATE ugc_jobs SET script_json = ?, updated_at = ? WHERE id = ?",
        [JSON.stringify(script), Date.now(), job.id]);
    }
  }

  if ("scheduledAt" in req.body) {
    const scheduledAt = parseScheduledAt(req.body.scheduledAt);
    if (scheduledAt === undefined) {
      return res.status(400).json({ error: "scheduledAt must be a timestamp in the future" });
    }
    if (!(await reschedule(job.id, scheduledAt))) {
      return res.status(400).json({ error: "This video has already been posted" });
    }
  }

  if (nextPlatforms) {
    const settings = JSON.parse(job.settings_json || "{}");
    settings.platforms = nextPlatforms;
    await dbRun("UPDATE ugc_jobs SET settings_json = ?, updated_at = ? WHERE id = ?",
      [JSON.stringify(settings), Date.now(), job.id]);
  }

  const updated = await q1("SELECT * FROM ugc_jobs WHERE id = ?", [job.id]);
  res.json(shapeJob(updated, await postsFor(job.id)));
}));

// Re-run a failed job from the stage it died at (scrape/script results are
// kept when they succeeded).
router.post("/jobs/:id/retry", wrap(async (req, res) => {
  const job = await q1("SELECT * FROM ugc_jobs WHERE id = ?", [req.params.id]);
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (job.status !== "failed") {
    return res.status(400).json({ error: "Only failed jobs can be retried" });
  }
  await dbRun("UPDATE ugc_jobs SET status = 'queued', error = NULL, updated_at = ? WHERE id = ?",
    [Date.now(), job.id]);
  enqueueUgcJob(job.id);
  res.json({ ok: true });
}));

// Throw away the script + video and generate everything again.
router.post("/jobs/:id/regenerate", wrap(async (req, res) => {
  const job = await q1("SELECT * FROM ugc_jobs WHERE id = ?", [req.params.id]);
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (["queued", "scraping", "scripting", "rendering", "posting"].includes(job.status)) {
    return res.status(400).json({ error: "Job is still working - wait for it to finish" });
  }
  await deleteJobFiles(job);
  await dbRun(
    `UPDATE ugc_jobs SET status = 'queued', error = NULL, script_json = NULL,
     video_filename = NULL, updated_at = ? WHERE id = ?`,
    [Date.now(), job.id]
  );
  await dbRun("DELETE FROM ugc_posts WHERE job_id = ?", [job.id]);
  enqueueUgcJob(job.id);
  res.json({ ok: true });
}));

// Post (or re-post failures) right now, ignoring any schedule.
// body: { onlyFailed: true } retries just the accounts that failed.
router.post("/jobs/:id/post", wrap(async (req, res) => {
  const job = await q1("SELECT * FROM ugc_jobs WHERE id = ?", [req.params.id]);
  if (!job) return res.status(404).json({ error: "Job not found" });
  const result = await postJob(job.id, { onlyFailed: Boolean(req.body.onlyFailed) });
  res.json(result);
}));

router.delete("/jobs/:id", wrap(async (req, res) => {
  const job = await q1("SELECT * FROM ugc_jobs WHERE id = ?", [req.params.id]);
  if (!job) return res.status(404).json({ error: "Job not found" });
  await deleteJobFiles(job);
  await dbRun("DELETE FROM ugc_jobs WHERE id = ?", [job.id]);
  res.json({ ok: true });
}));

// The calendar assistant. Stateless: the client keeps the conversation and
// sends it back each turn, along with the days it has selected and its UTC
// offset so relative dates resolve in the user's timezone.
router.post("/chat", wrap(async (req, res) => {
  if (!assistantAvailable()) {
    return res.status(400).json({
      error: "The assistant needs an OpenAI key - set OPENAI_API_KEY to enable it.",
      needsKey: true,
    });
  }
  const messages = Array.isArray(req.body.messages) ? req.body.messages : [];
  if (!messages.length) return res.status(400).json({ error: "No message" });

  const selectedDates = (Array.isArray(req.body.selectedDates) ? req.body.selectedDates : [])
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d)))
    .slice(0, 60);
  const offsetMinutes = Number.isFinite(req.body.offsetMinutes)
    ? Math.max(-840, Math.min(840, req.body.offsetMinutes))
    : 0;

  let productUrl = "";
  if (typeof req.body.productUrl === "string" && req.body.productUrl.trim()) {
    try {
      const parsed = new URL(req.body.productUrl.trim());
      if (/^https?:$/.test(parsed.protocol)) productUrl = parsed.toString();
    } catch {
      productUrl = "";
    }
  }

  const imageUrls = (Array.isArray(req.body.imageUrls) ? req.body.imageUrls : [])
    .filter((u) => typeof u === "string")
    .map((u) => u.trim())
    .filter((u) => {
      try {
        const parsed = new URL(u, "https://local.invalid");
        return parsed.protocol === "https:" || parsed.protocol === "http:" || u.startsWith("/ugc-media/");
      } catch {
        return u.startsWith("/ugc-media/");
      }
    })
    .slice(0, 4);

  let selectedVideo = null;
  const rawVideo = req.body.selectedVideo;
  if (rawVideo && typeof rawVideo === "object") {
    const id = Number(rawVideo.id);
    if (Number.isFinite(id) && id > 0) {
      selectedVideo = {
        id,
        title: String(rawVideo.title || "").slice(0, 160),
        date: /^\d{4}-\d{2}-\d{2}$/.test(String(rawVideo.date || "")) ? String(rawVideo.date) : "",
      };
    }
  }

  // The composer's Video/Slideshow switch. "video" is this app's avatar
  // format; anything unrecognised leaves the choice to the assistant.
  const outputFormat = req.body.outputFormat === "slideshow"
    ? "slideshow"
    : req.body.outputFormat === "video" || req.body.outputFormat === "avatar"
      ? "avatar"
      : "";

  const platforms = Array.isArray(req.body.platforms)
    ? req.body.platforms.map((p) => String(p || "").toLowerCase()).filter(Boolean).slice(0, 12)
    : [];

  res.json(await runAssistant({
    messages, selectedDates, offsetMinutes, productUrl, outputFormat, imageUrls, selectedVideo,
    platforms,
  }));
}));

// The avatars and voices this HeyGen account can actually use, so the
// create form offers a picker instead of asking for raw IDs.
router.get("/heygen", wrap(async (req, res) => {
  const catalog = await heygenCatalog({ force: req.query.refresh === "1" });
  res.json({
    ...catalog,
    defaults: {
      avatarId: config.ugc.heygenAvatarId,
      voiceId: config.ugc.heygenVoiceId,
    },
    provider: pickProvider(),
  });
}));

// The same check for slide art. gpt-image-1 is gated behind OpenAI's
// organisation verification, so a key that writes scripts perfectly well can
// still be unable to draw a single slide - and that is worth finding out
// before a week of slideshows is scheduled on it.
router.post("/images/test", wrap(async (req, res) => {
  const result = await testImageGeneration();
  res.status(result.ok ? 200 : 502).json(result);
}));

// Explicit key check for the settings UI - tells you the key works before
// you wait on a render to find out it doesn't.
router.post("/heygen/test", wrap(async (req, res) => {
  if (!heygenConfigured()) {
    return res.status(400).json({ ok: false, error: "HEYGEN_API_KEY is not set" });
  }
  try {
    res.json(await testConnection());
  } catch (err) {
    res.status(502).json({ ok: false, error: String(err.message || err) });
  }
}));

const UPLOAD_TYPES = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};
const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;

// Calendar + button: save a screenshot/reference image for the chat.
// This is an attachment, not a product.
router.post("/uploads", wrap(async (req, res) => {
  const mime = String(req.body?.mime || "").toLowerCase().split(";")[0].trim();
  const ext = UPLOAD_TYPES[mime];
  if (!ext) {
    return res.status(400).json({ error: "Upload a JPEG, PNG, WebP, or GIF image." });
  }

  const raw = String(req.body?.data || "").replace(/^data:[^;]+;base64,/, "");
  let buf;
  try {
    buf = Buffer.from(raw, "base64");
  } catch {
    return res.status(400).json({ error: "Could not read that file." });
  }
  if (!buf.length) return res.status(400).json({ error: "That file was empty." });
  if (buf.length > MAX_UPLOAD_BYTES) {
    return res.status(400).json({ error: "Keep uploads under 6 MB." });
  }

  const id = crypto.randomBytes(8).toString("hex");
  const dir = path.join(config.ugcDir, "uploads");
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${id}${ext}`;
  fs.writeFileSync(path.join(dir, filename), buf);

  const publicPath = `/ugc-media/uploads/${filename}`;
  const publicUrl = `${String(config.baseUrl).replace(/\/+$/, "")}${publicPath}`;
  const original = String(req.body?.filename || "Upload")
    .replace(/[^\w.\- ]+/g, "")
    .slice(0, 80) || "Upload";
  const name = original.replace(/\.[^.]+$/, "").trim() || "Uploaded image";

  res.status(201).json({
    url: publicUrl,
    path: publicPath,
    name,
  });
}));

// Pull fresh numbers from the platform APIs on demand.
// Cooldown: one manual refresh every N minutes per session.
async function handleAnalyticsRefresh(req, res) {
  const sessionKey = req.session?.id || req.session?.email || "operator";
  const gate = await checkRefreshCooldown(sessionKey);
  if (!gate.allowed) {
    return res.status(429).json({
      error: "Refresh cooldown — try again shortly.",
      retryAfterMs: gate.retryAfterMs,
      nextRefreshAt: gate.nextRefreshAt,
    });
  }

  const result = await collectMetrics({ force: true });
  const cooldown = await markRefreshCooldown(sessionKey);
  const lastSyncedAt = await latestSyncAt();

  res.json({
    ...result,
    lastSyncedAt: lastSyncedAt || result.at,
    nextRefreshAt: cooldown.nextRefreshAt,
  });
}

router.post("/analytics/refresh", wrap(handleAnalyticsRefresh));
// Back-compat alias used by older clients.
router.post("/metrics/refresh", wrap(handleAnalyticsRefresh));

export default router;
