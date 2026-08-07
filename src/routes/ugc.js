import { Router } from "express";
import config, { PLATFORM_NAMES } from "../config.js";
import { q, q1, run as dbRun } from "../db.js";
import { platforms } from "../accounts.js";
import { toneOptions, styleOptions } from "../ugc/script.js";
import { heygenConfigured } from "../ugc/heygen.js";
import { collectMetrics } from "../metrics.js";
import { reschedule } from "../schedule.js";
import {
  enqueueUgcJob, postJob, pickProvider, ugcQueueLength, deleteJobFiles,
} from "../ugc/pipeline.js";
import { wrap, shapeJob, postsFor, postsForJobs } from "./shared.js";

const router = Router();

// Generator capabilities plus connected accounts - what the create form
// needs to draw itself.
router.get("/overview", wrap(async (req, res) => {
  const accountRows = await q(
    "SELECT id, platform, display_name FROM accounts ORDER BY platform, id"
  );
  const accounts = Object.fromEntries(PLATFORM_NAMES.map((k) => [k, []]));
  for (const a of accountRows) {
    accounts[a.platform]?.push({ id: a.id, displayName: a.display_name });
  }

  const count = async (sql, params = []) => Number((await q1(sql, params))?.n || 0);
  res.json({
    accounts,
    platformsConfigured: Object.fromEntries(
      PLATFORM_NAMES.map((k) => [k, platforms[k].isConfigured()])
    ),
    generator: {
      provider: pickProvider(),
      heygenConfigured: heygenConfigured(),
      openaiConfigured: Boolean(config.openaiApiKey),
      tones: toneOptions(),
      styles: styleOptions(),
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
  try {
    const parsed = new URL(productUrl);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error();
  } catch {
    return res.status(400).json({ error: "Enter a valid product URL (https://...)" });
  }

  const wanted = Array.isArray(req.body.platforms)
    ? req.body.platforms.filter((p) => PLATFORM_NAMES.includes(p))
    : [];
  const settings = {
    tone: toneOptions().includes(req.body.tone) ? req.body.tone : "casual",
    style: styleOptions().includes(req.body.style) ? req.body.style : "product_pov",
    platforms: wanted,
    provider: ["heygen", "local", "auto"].includes(req.body.provider) ? req.body.provider : undefined,
    voice: typeof req.body.voice === "string" ? req.body.voice.slice(0, 40) : undefined,
  };
  const autoPost = req.body.autoPost === false ? 0 : 1;
  const title = typeof req.body.title === "string" ? req.body.title.slice(0, 120) : null;

  const scheduledAt = parseScheduledAt(req.body.scheduledAt);
  if (scheduledAt === undefined) {
    return res.status(400).json({ error: "scheduledAt must be a timestamp in the future" });
  }

  const now = Date.now();
  const row = await q1(
    `INSERT INTO ugc_jobs (product_url, settings_json, status, auto_post, title, scheduled_at, created_at, updated_at)
     VALUES (?, ?, 'queued', ?, ?, ?, ?, ?) RETURNING id`,
    [productUrl, JSON.stringify(settings), autoPost, title, scheduledAt, now, now]
  );
  enqueueUgcJob(row.id);
  res.json({ id: row.id, status: "queued", scheduledAt });
}));

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

  if (typeof req.body.title === "string") {
    await dbRun("UPDATE ugc_jobs SET title = ?, updated_at = ? WHERE id = ?",
      [req.body.title.slice(0, 120), Date.now(), job.id]);
  }

  // Caption and hashtags live inside the generated script; both are what
  // the platforms actually receive at publish time.
  if (typeof req.body.caption === "string" || "hashtags" in req.body) {
    const script = JSON.parse(job.script_json || "null");
    if (!script) {
      return res.status(400).json({ error: "The script hasn't been generated yet" });
    }
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

  if ("scheduledAt" in req.body) {
    const scheduledAt = parseScheduledAt(req.body.scheduledAt);
    if (scheduledAt === undefined) {
      return res.status(400).json({ error: "scheduledAt must be a timestamp in the future" });
    }
    if (!(await reschedule(job.id, scheduledAt))) {
      return res.status(400).json({ error: "This video has already been posted" });
    }
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

// Pull fresh numbers from the platform APIs on demand, so the analytics page
// has a refresh button that doesn't wait for the next collection interval.
router.post("/metrics/refresh", wrap(async (req, res) => {
  res.json(await collectMetrics());
}));

export default router;
