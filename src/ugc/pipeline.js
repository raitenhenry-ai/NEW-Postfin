import fs from "node:fs";
import path from "node:path";
import config from "../config.js";
import { q, q1, run } from "../db.js";
import { platforms, freshAccount } from "../accounts.js";
import { scrapeProduct, downloadImages } from "./scrape.js";
import { generateScript, captionText, spokenText } from "./script.js";
import { heygenConfigured, startAvatarVideo, waitAndDownload } from "./heygen.js";
import { klingConfigured, renderShots } from "./kling.js";
import { assembleVideo } from "./assemble.js";

// UGC job lifecycle:
//   queued -> scraping -> scripting -> rendering -> ready -> posting -> posted
// Any stage can land in 'failed' (error says which stage). Jobs process one
// at a time - rendering is CPU-heavy and the HeyGen plan rate-limits anyway.

const queue = [];
let draining = false;

export function ugcQueueLength() {
  return queue.length + (draining ? 1 : 0);
}

export function enqueueUgcJob(jobId) {
  if (!queue.includes(jobId)) queue.push(jobId);
  drain();
}

async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (queue.length) {
      await processJob(queue.shift()).catch((err) =>
        console.error("[ugc] job crashed:", err));
    }
  } finally {
    draining = false;
  }
}

// Anything mid-flight when the server stopped picks up where it left off.
export async function recoverStuckUgcJobs() {
  const stuck = await q(
    "SELECT id FROM ugc_jobs WHERE status IN ('queued', 'scraping', 'scripting', 'rendering', 'posting')"
  );
  for (const job of stuck) enqueueUgcJob(job.id);
  return stuck.length;
}

async function setJob(id, fields) {
  const keys = Object.keys(fields);
  await run(
    `UPDATE ugc_jobs SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`,
    [...keys.map((k) => fields[k]), Date.now(), id]
  );
}

// Kling animates the real product photos into shots; HeyGen renders a
// talking avatar. "auto" prefers Kling when its keys are set.
// A job can override the deployment-wide setting; both accept "auto".
export function pickProvider(settings = {}) {
  const wanted = settings.provider && settings.provider !== "auto"
    ? settings.provider
    : config.videoProvider;
  if (wanted === "kling") return "kling";
  if (wanted === "heygen") return "heygen";
  return klingConfigured() ? "kling" : "heygen";
}

// The storyboard turned into shot requests. Each shot that contains the
// product is generated from the real photos - as references where the model
// supports it, so the item can appear in a scene it was never photographed
// in, rather than the photo simply being panned across.
function buildShots({ script, sceneImages }) {
  const lines = [script.hook, ...(script.scenes || []), script.cta]
    .map((l) => String(l || "").trim())
    .filter(Boolean);

  return (script.storyboard || []).slice(0, lines.length).map((entry, i) => {
    const wantsProduct = entry.productInShot && sceneImages.length;
    const primary = entry.imageIndex >= 0 ? sceneImages[entry.imageIndex] : sceneImages[0];
    return {
      kind: wantsProduct ? "reference" : "text",
      imageUrl: wantsProduct ? primary : null,
      // Every photo goes along as reference so the model has the item from
      // more than one angle.
      imageUrls: wantsProduct ? [primary, ...sceneImages.filter((u) => u !== primary)] : [],
      prompt: entry.shot || lines[i],
      line: lines[i],
    };
  });
}

async function processJob(jobId) {
  const job = await q1("SELECT * FROM ugc_jobs WHERE id = ?", [jobId]);
  if (!job) return;
  // Jobs recovered mid-posting already have their video; only finish posting.
  if (job.status === "posting") {
    return postJob(jobId).catch((e) => console.error("[ugc] post failed:", e));
  }
  if (["ready", "posted", "failed"].includes(job.status)) return;

  const settings = JSON.parse(job.settings_json || "{}");
  const workDir = path.join(config.ugcDir, `job${job.id}`);

  try {
    // 1. Scrape the product page (skipped if a re-run already has it, or if
    // this video was planned from a written brief and has no product).
    let product = job.product_json ? JSON.parse(job.product_json) : null;
    if (!product && job.product_url) {
      await setJob(job.id, { status: "scraping", error: null });
      product = await scrapeProduct(job.product_url);
      await setJob(job.id, { product_json: JSON.stringify(product) });
      console.log(`[ugc] job ${job.id}: scraped "${product.name}" (${product.images.length} images)`);
    }

    // 2. Write the script, from the product, the planned concept, or both.
    let script = job.script_json ? JSON.parse(job.script_json) : null;
    if (!script) {
      await setJob(job.id, { status: "scripting" });
      script = await generateScript(product, {
        ...settings,
        brief: job.brief || undefined,
        concept: job.concept_json ? JSON.parse(job.concept_json) : undefined,
      });
      await setJob(job.id, { script_json: JSON.stringify(script) });
      console.log(`[ugc] job ${job.id}: script ready (${script.generatedBy})`);
    }

    // 3. Render the video.
    const provider = pickProvider(settings);
    await setJob(job.id, { status: "rendering", provider });
    const filename = `ugc-job${job.id}.mp4`;
    const outputPath = path.join(config.ugcDir, filename);

    // Product photos are downloaded once into a durable per-job directory,
    // not the scratch dir: the video model fetches them over HTTP during the
    // render, so they have to outlive it and stay reachable.
    const assetDir = path.join(config.ugcDir, "assets", `job${job.id}`);
    const localImages = product?.images?.length
      ? await downloadImages(product.images, assetDir)
      : [];
    const sceneImages = localImages.map(
      (file) => `${config.baseUrl}/ugc-media/assets/job${job.id}/${path.basename(file)}`
    );

    if (provider === "kling") {
      if (!klingConfigured()) {
        throw new Error(
          "Kling is not configured - set KLING_ACCESS_KEY and KLING_SECRET_KEY"
        );
      }
      const shots = buildShots({ script, sceneImages });
      console.log(
        `[ugc] job ${job.id}: Kling rendering ${shots.length} shot(s), ` +
          `${sceneImages.length} product photo(s)`
      );
      const rendered = await renderShots({ shots, workDir });
      await assembleVideo({ script, shots: rendered, workDir, outputPath, settings });
    } else {
      if (!heygenConfigured()) {
        throw new Error(
          "HeyGen is not configured - set HEYGEN_API_KEY to generate videos"
        );
      }
      const videoId = await startAvatarVideo({
        text: spokenText(script), script, sceneImages, settings,
      });
      console.log(
        `[ugc] job ${job.id}: HeyGen render started (${videoId}), ` +
          `${script.storyboard?.length || 1} scene(s), ${sceneImages.length} product photo(s)`
      );
      await waitAndDownload(videoId, outputPath);
    }
    await setJob(job.id, { status: "ready", video_filename: filename });
    console.log(`[ugc] job ${job.id}: video ready (${provider})`);

    // 4. Auto-post when asked to. A job with a future slot stops here at
    // 'ready' with the video finished; the scheduler posts it when due.
    const scheduledAt = job.scheduled_at ? Number(job.scheduled_at) : null;
    if (job.auto_post && (!scheduledAt || scheduledAt <= Date.now())) {
      await postJob(job.id);
    } else if (scheduledAt) {
      console.log(
        `[ugc] job ${job.id}: video ready, holding until ${new Date(scheduledAt).toISOString()}`
      );
    }
  } catch (err) {
    console.error(`[ugc] job ${job.id} failed:`, err.message || err);
    await setJob(job.id, { status: "failed", error: String(err.message || err) });
  } finally {
    // Scene files and downloaded images aren't needed once the mp4 exists.
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

// Posts the finished video to every connected account on the selected
// platforms (all platforms when none were picked). Safe to re-run: accounts
// that already posted are skipped, failed ones get another try.
export async function postJob(jobId, { onlyFailed = false } = {}) {
  const job = await q1("SELECT * FROM ugc_jobs WHERE id = ?", [jobId]);
  if (!job) throw new Error("Job not found");
  if (!job.video_filename) throw new Error("Video is not rendered yet");

  const filePath = path.join(config.ugcDir, job.video_filename);
  if (!fs.existsSync(filePath)) throw new Error("Video file is missing from disk");

  const settings = JSON.parse(job.settings_json || "{}");
  const script = JSON.parse(job.script_json || "{}");
  const product = JSON.parse(job.product_json || "{}");
  const wantedPlatforms = Array.isArray(settings.platforms) && settings.platforms.length
    ? settings.platforms
    : Object.keys(platforms);

  const accounts = (await q("SELECT * FROM accounts ORDER BY platform, id"))
    .filter((a) => wantedPlatforms.includes(a.platform));
  if (!accounts.length) {
    await setJob(job.id, { status: "ready", error: "No connected accounts to post to - connect socials first" });
    return { posted: 0, failed: 0, skipped: 0 };
  }

  await setJob(job.id, { status: "posting", error: null });

  const publicUrl = `${config.baseUrl}/ugc-media/${encodeURIComponent(job.video_filename)}`;
  const caption = captionText(script, product);
  const ctx = {
    filePath,
    publicUrl,
    title: `${script.hook || product.name || "New find"} #Shorts`.slice(0, 100),
    caption,
    description: caption,
    // Pinterest pins carry a destination link back to the product page.
    productUrl: job.product_url,
  };

  let posted = 0, failed = 0, skipped = 0;
  for (const accountRow of accounts) {
    const existing = await q1(
      "SELECT * FROM ugc_posts WHERE job_id = ? AND account_id = ?",
      [job.id, accountRow.id]
    );
    if (existing?.status === "done") { skipped++; continue; }
    if (onlyFailed && existing && existing.status !== "failed") { skipped++; continue; }

    await run(
      `INSERT INTO ugc_posts (job_id, account_id, platform, status)
       VALUES (?, ?, ?, 'posting')
       ON CONFLICT (job_id, account_id) DO UPDATE SET status = 'posting', error = NULL`,
      [job.id, accountRow.id, accountRow.platform]
    );

    try {
      const account = await freshAccount(accountRow.id);
      if (!account) throw new Error("account disconnected");
      const platformVideoId = await platforms[account.platform].uploadClip(account, ctx);
      await run(
        `UPDATE ugc_posts SET status = 'done', platform_video_id = ?, error = NULL, posted_at = ?
         WHERE job_id = ? AND account_id = ?`,
        [String(platformVideoId ?? ""), Date.now(), job.id, account.id]
      );
      posted++;
      console.log(`[ugc] job ${job.id} -> ${account.platform}/${account.display_name} OK`);

      if (platforms[account.platform].resolvePostId) {
        try {
          const current = await freshAccount(account.id);
          const publicId = await platforms[account.platform].resolvePostId(
            current, String(platformVideoId ?? ""));
          if (publicId) {
            await run(
              "UPDATE ugc_posts SET public_post_id = ? WHERE job_id = ? AND account_id = ?",
              [String(publicId), job.id, account.id]
            );
          }
        } catch { /* link stays platform-id based */ }
      }
    } catch (err) {
      failed++;
      await run(
        `UPDATE ugc_posts SET status = 'failed', error = ? WHERE job_id = ? AND account_id = ?`,
        [String(err.message || err), job.id, accountRow.id]
      );
      console.error(
        `[ugc] job ${job.id} -> ${accountRow.platform}/${accountRow.display_name} failed:`,
        err.message || err
      );
    }
  }

  await setJob(job.id, { status: failed && !posted ? "ready" : "posted" });
  return { posted, failed, skipped };
}

export async function deleteJobFiles(job) {
  if (job.video_filename) {
    fs.rmSync(path.join(config.ugcDir, job.video_filename), { force: true });
  }
  fs.rmSync(path.join(config.ugcDir, `job${job.id}`), { recursive: true, force: true });
  // The scraped product photos kept for HeyGen scene backgrounds.
  fs.rmSync(path.join(config.ugcDir, "assets", `job${job.id}`), {
    recursive: true, force: true,
  });
}
