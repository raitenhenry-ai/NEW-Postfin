import fs from "node:fs";
import path from "node:path";
import config from "../config.js";
import { referenceImageUrls, visionImageUrl } from "./references.js";

// Grok Imagine (xAI) video provider: turns the script into one generation
// prompt, hands it to grok-imagine-video with the product's real photos as
// reference images, polls until the clip renders, then downloads the mp4.
//
// Unlike HeyGen there is no avatar account to manage - the model invents the
// creator, the room, the camera work and the voice from the prompt alone.

const POLL_MS = 5 * 1000;
const MAX_WAIT_MS = 15 * 60 * 1000;

// The API takes at most 3 reference images per request.
const MAX_REFERENCE_IMAGES = 3;
const MAX_IMAGE_BYTES = 7 * 1024 * 1024;

const MIME = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export function grokConfigured() {
  return Boolean(config.ugc.xaiApiKey);
}

async function call(apiPath, options = {}) {
  if (!grokConfigured()) throw new Error("XAI_API_KEY is not set");
  const res = await fetch(`${config.ugc.xaiApiBase}${apiPath}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.ugc.xaiApiKey}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.error?.message || data.error || data.message || JSON.stringify(data).slice(0, 300);
    // A bad key is by far the most common failure; name it rather than
    // surfacing a bare status code.
    if (res.status === 401 || res.status === 403) {
      throw new Error(`xAI rejected the API key (${res.status}): ${detail}`);
    }
    throw new Error(`xAI ${apiPath} failed (${res.status}): ${detail}`);
  }
  return data;
}

/* ---------- reference images ---------- */

// Local product photo files become base64 data URLs so xAI can see them
// without this server needing to be publicly reachable.
function fileToDataUrl(file) {
  try {
    const buf = fs.readFileSync(file);
    if (!buf.length || buf.length > MAX_IMAGE_BYTES) return null;
    const mime = MIME[path.extname(file).toLowerCase()];
    if (!mime) return null;
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

// The product's own photos first (they define what must look right), then
// any reference images the user pinned on the post, up to the API's cap.
export function grokReferenceImages({ localImages = [], settings = {} } = {}) {
  const urls = [];
  for (const file of localImages) {
    const url = fileToDataUrl(file);
    if (url) urls.push(url);
    if (urls.length >= MAX_REFERENCE_IMAGES) return urls;
  }
  for (const src of referenceImageUrls(settings)) {
    const url = visionImageUrl(src);
    if (url && (url.startsWith("data:") || /^https?:\/\//i.test(url))) urls.push(url);
    if (urls.length >= MAX_REFERENCE_IMAGES) break;
  }
  return urls;
}

/* ---------- prompt building ---------- */

// The spoken lines in script order, trimmed to what fits the clip. People
// talk at roughly 140 words a minute, so a 15-second clip carries about 35
// words - sending the full 24-second script just gets it cut off mid-word.
function fitSpokenLines(script, seconds) {
  const lines = [script?.hook, ...(script?.scenes || []), script?.cta]
    .map((line) => String(line || "").trim())
    .filter(Boolean);
  const budget = Math.max(10, Math.round(seconds * 2.3));
  const out = [];
  let words = 0;
  for (const line of lines) {
    const n = line.split(/\s+/).length;
    if (out.length && words + n > budget) break;
    out.push(line);
    words += n;
  }
  return out;
}

function buildPrompt({ script, product, settings = {}, seconds, hasReferences }) {
  const tone = settings.tone || "casual, friendly";
  const name = product?.name || script?.caption || "the product";
  const spoken = fitSpokenLines(script, seconds);

  const parts = [
    `Vertical 9:16 UGC-style phone video for social media, filmed like a real ` +
      `person's selfie video: natural handheld feel, soft everyday lighting, ` +
      `a relatable creator talking straight to camera in a ${tone} tone about ${name}.`,
  ];
  if (spoken.length) {
    parts.push(`The creator says, naturally and clearly: "${spoken.join(" ")}"`);
  }
  if (hasReferences) {
    parts.push(
      "The product shown in the reference images appears clearly in the video - " +
        "in the creator's hands or beside them - looking exactly like the " +
        "reference photos: same shape, colors, label and logo."
    );
  }
  parts.push(
    "Authentic and unpolished like real user-generated content, not a studio " +
      "ad. No captions, no subtitles, no on-screen text, no watermarks."
  );
  // Generous but bounded: extremely long prompts add nothing and risk limits.
  return parts.join(" ").slice(0, 1900);
}

/* ---------- rendering ---------- */

// Starts a generation and returns the request id to poll.
export async function startGrokVideo({ script, product, settings = {}, referenceImages = [] }) {
  const seconds = config.ugc.grokVideoSeconds;
  const refs = referenceImages.slice(0, MAX_REFERENCE_IMAGES);
  const body = {
    model: config.ugc.grokVideoModel,
    prompt: buildPrompt({ script, product, settings, seconds, hasReferences: refs.length > 0 }),
    duration: seconds,
    aspect_ratio: "9:16",
    resolution: refs.length ? "720p" : config.ugc.grokResolution,
  };
  if (refs.length) body.reference_images = refs.map((url) => ({ url }));
  if (config.ugc.grokVoiceId) body.reference_audios = [{ voice_id: config.ugc.grokVoiceId }];

  const data = await call("/v1/videos/generations", { method: "POST", body: JSON.stringify(body) });
  const requestId = data.request_id;
  if (!requestId) {
    throw new Error(`xAI returned no request_id: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return requestId;
}

// Polls until the video completes, then streams it to outputPath. xAI's
// video URLs are temporary, so the download happens immediately.
export async function waitAndDownloadGrok(requestId, outputPath) {
  const started = Date.now();
  for (;;) {
    const data = await call(`/v1/videos/${encodeURIComponent(requestId)}`);
    const status = data.status;
    if (status === "done") {
      const url = data.video?.url;
      if (!url) throw new Error("Grok finished but returned no video URL");
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Downloading the Grok video failed (${res.status})`);
      fs.writeFileSync(outputPath, Buffer.from(await res.arrayBuffer()));
      return outputPath;
    }
    if (status === "failed" || status === "expired") {
      const detail = data.error?.message || data.detail || "";
      throw new Error(`Grok video generation ${status}${detail ? `: ${detail}` : ""}`);
    }
    if (Date.now() - started > MAX_WAIT_MS) {
      throw new Error("Grok video generation timed out after 15 minutes");
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

// Cheap key check for the settings UI - lists nothing, just verifies the key
// can reach the API.
export async function testConnection() {
  await call("/v1/api-key").catch((err) => {
    // Some plans do not expose /v1/api-key; a 404 still proves the key works.
    if (!/404/.test(String(err.message))) throw err;
  });
  return { ok: true };
}
