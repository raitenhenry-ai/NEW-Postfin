import fs from "node:fs";
import path from "node:path";
import config from "../config.js";
import { q, q1, run } from "../db.js";
import { platforms, freshAccount } from "../accounts.js";
import { scrapeProduct, downloadImages } from "./scrape.js";
import { generateScript, captionText, spokenText, spokenLines } from "./script.js";
import { heygenConfigured, startAvatarVideo, waitAndDownload } from "./heygen.js";
import {
  planSlideshow, generateSlideImages, generateSceneImages, renderSlideImages,
  renderSlideshowVideo,
} from "./slideshow.js";
import { spliceCutaways } from "./cutaways.js";

// UGC job lifecycle:
//   queued -> scraping -> scripting -> rendering -> ready -> posting -> posted
// Any stage can land in 'failed' (error says which stage). Jobs process one
// at a time - rendering is CPU-heavy and the HeyGen plan rate-limits anyway.
//
// A job is either an avatar video (HeyGen reads the script to camera) or a
// slideshow ad (images cut on the beat under burned-in text). The format is
// chosen per job and decides both how the script is written and how the
// video is rendered.

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

// Which renderer a job will use. Slideshows are rendered in-process with
// ffmpeg; avatar videos need HeyGen, and without a key such a job fails with
// that reason rather than quietly producing something else.
export function pickProvider(settings) {
  return jobFormat(settings) === "slideshow" ? "slideshow" : "heygen";
}

// A slideshow goes out as photos wherever the platform has a photo post -
// that is the format's native shape. Everywhere else it falls back to the
// rendered mp4, which is why both are produced.
export function postAsPhotos(target, ctx) {
  return Boolean(ctx?.imageUrls?.length) && typeof target?.uploadPhotos === "function";
}

export function jobFormat(settings) {
  return settings?.format === "slideshow" || (!settings?.format && config.ugc.format === "slideshow")
    ? "slideshow"
    : "avatar";
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
  const format = jobFormat(settings);
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
    // A slideshow needs a different script - slides, not spoken scenes - so
    // the format decides which writer runs.
    let script = job.script_json ? JSON.parse(job.script_json) : null;
    if (!script) {
      await setJob(job.id, { status: "scripting" });
      const brief = {
        ...settings,
        brief: job.brief || undefined,
        concept: job.concept_json ? JSON.parse(job.concept_json) : undefined,
      };
      script = format === "slideshow"
        ? await planSlideshow(product, brief)
        : await generateScript(product, brief);
      await setJob(job.id, { script_json: JSON.stringify(script) });
      console.log(
        `[ugc] job ${job.id}: ${format} script ready (${script.generatedBy})` +
          (script.slides ? `, ${script.slides.length} slides` : "")
      );
    }

    // 3. Render the video.
    const provider = pickProvider(settings);
    await setJob(job.id, { status: "rendering", provider });
    const filename = `ugc-job${job.id}.mp4`;
    const outputPath = path.join(config.ugcDir, filename);

    if (format === "slideshow") {
      // The scraped product shots are downloaded so the image model can be
      // handed them as references: on a slide that shows the product, it
      // redraws the real thing inside a scene that was never photographed,
      // rather than pasting a catalogue photo into an ad.
      const photos = product?.images?.length
        ? await downloadImages(product.images, path.join(workDir, "photos"))
        : [];
      const art = await generateSlideImages(script, path.join(workDir, "slides"), photos);
      const images = art.images;
      console.log(
        `[ugc] job ${job.id}: ${art.generated}/${art.requested} slide images drawn` +
          (art.references
            ? `, ${art.fromReferences} recreating the product from ${art.references} reference photo(s)`
            : "")
      );

      // Silently shipping a slideshow of blank gradient cards is worse than
      // failing: the user asked for generated art and would have to guess why
      // there is none. A key that cannot use the image model, or every single
      // slide failing, is a failed job with the reason attached.
      if (art.blocked) {
        throw new Error(`Slide art could not be generated - ${art.blocked}`);
      }
      if (art.requested && !art.generated) {
        throw new Error(
          `None of the ${art.requested} slide images could be generated - ` +
            (art.failures[0]?.message || "the image model returned nothing")
        );
      }
      // A few missing is survivable, but say so rather than quietly shipping
      // cards where pictures were meant to be.
      if (art.failures.length) {
        script.imageNote =
          `${art.failures.length} of ${art.requested} slide images could not be drawn ` +
          `and fell back to plain cards - ${art.failures[0].message}`;
        await setJob(job.id, { script_json: JSON.stringify(script) });
      }
      // The slides themselves are the deliverable - a slideshow post is a
      // stack of photos, not a video - so they are composed as stills and
      // kept. The mp4 is rendered too: it is what goes to platforms that
      // only take video, and what makes the preview playable.
      script.slideFiles = await renderSlideImages({
        script, images, jobId: job.id, workDir,
      });
      await setJob(job.id, { script_json: JSON.stringify(script) });

      const { durationSeconds } = await renderSlideshowVideo({
        script, images, workDir, outputPath, settings,
      });
      await setJob(job.id, { status: "ready", video_filename: filename });
      console.log(
        `[ugc] job ${job.id}: slideshow ready - ${script.slideFiles.length} slide images ` +
          `plus a ${durationSeconds.toFixed(1)}s video`
      );
    } else {
      if (!heygenConfigured()) {
        throw new Error(
          "HeyGen is not configured - set HEYGEN_API_KEY to generate avatar videos, " +
            "or switch this video to the slideshow format"
        );
      }

      // Product photos are downloaded once into a durable per-job directory,
      // not the scratch dir: HeyGen fetches images over HTTP, so anything it
      // needs has to outlive this function and stay reachable.
      const assetDir = path.join(config.ugcDir, "assets", `job${job.id}`);
      const localImages = product?.images?.length
        ? await downloadImages(product.images, assetDir)
        : [];

      // A talking head in front of a pasted screenshot is the thing people
      // scroll past. The storyboard says, line by line, whether the creator
      // is on camera or the video cuts away to the product being used, and
      // both are drawn here: rooms for her to stand in, and shots of the
      // product in hand recreated from its own photos.
      const storyboard = script.storyboard || [];
      const shots = await generateSceneImages(
        storyboard.map((entry) => ({
          prompt: entry.visual,
          withProduct: entry.shot === "product",
        })),
        {
          dir: assetDir,
          styleNote: `Filmed for a ${settings.tone || "casual"} UGC ad.`,
          productPhotos: localImages,
        }
      );
      const shotUrl = (file) =>
        `${config.baseUrl}/ugc-media/assets/job${job.id}/${path.basename(file)}`;

      // Only the creator's lines get a background - a cutaway replaces the
      // whole frame afterwards, so its image would never be seen behind her.
      const backgrounds = storyboard.map((entry, i) =>
        entry.shot === "creator" && shots.images[i] ? shotUrl(shots.images[i]) : null
      );

      const videoId = await startAvatarVideo({
        text: spokenText(script), script, backgrounds, settings,
      });
      const cutawayCount = storyboard.filter((e) => e.shot === "product").length;
      console.log(
        `[ugc] job ${job.id}: HeyGen render started (${videoId}), ` +
          `${storyboard.length || 1} scene(s), ${cutawayCount} cutaway(s), ` +
          `${shots.generated} generated shot(s)`
      );
      await waitAndDownload(videoId, outputPath);

      // Lay the product shots over her lines. The voice keeps running, so it
      // reads as one take rather than a video with photos dropped into it.
      const cuts = storyboard
        .map((entry, i) => ({ index: i, image: entry.shot === "product" ? shots.images[i] : null }))
        .filter((cut) => cut.image);
      if (cuts.length) {
        const cutPath = path.join(workDir, "cutaways.mp4");
        fs.mkdirSync(workDir, { recursive: true });
        const spliced = await spliceCutaways({
          videoPath: outputPath,
          outPath: cutPath,
          lines: spokenLines(script),
          shots: cuts,
        });
        if (spliced.cutaways) {
          fs.copyFileSync(cutPath, outputPath);
          console.log(`[ugc] job ${job.id}: cut to the product ${spliced.cutaways} time(s)`);
        }
      }

      await setJob(job.id, { status: "ready", video_filename: filename });
      console.log(`[ugc] job ${job.id}: video ready (${provider})`);
    }

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

  // A slideshow is a stack of photos. Where a platform takes them as photos -
  // TikTok's photo mode, an Instagram carousel - that is what it should get,
  // because that is the post the format is for. The mp4 is the fallback for
  // video-only platforms, and stays the preview everywhere.
  const slideUrls = (script.slideFiles || []).map(
    (name) => `${config.baseUrl}/ugc-media/${name.split("/").map(encodeURIComponent).join("/")}`
  );

  const ctx = {
    filePath,
    publicUrl,
    imageUrls: slideUrls,
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
      const target = platforms[account.platform];
      const asPhotos = postAsPhotos(target, ctx);
      const platformVideoId = asPhotos
        ? await target.uploadPhotos(account, ctx)
        : await target.uploadClip(account, ctx);
      if (asPhotos) {
        console.log(`[ugc] job ${job.id} -> ${account.platform} as ${slideUrls.length} photos`);
      }
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
  // The composed slide stills, which live outside the scratch dir because
  // the platforms fetch them at publish time.
  fs.rmSync(path.join(config.ugcDir, "slides", `job${job.id}`), {
    recursive: true, force: true,
  });
  fs.rmSync(path.join(config.ugcDir, `job${job.id}`), { recursive: true, force: true });
  // The scraped product photos kept for HeyGen scene backgrounds.
  fs.rmSync(path.join(config.ugcDir, "assets", `job${job.id}`), {
    recursive: true, force: true,
  });
}
