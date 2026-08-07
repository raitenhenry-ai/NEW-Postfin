import fs from "node:fs";
import config from "../config.js";

// HeyGen avatar provider: hands the script to HeyGen, polls until the
// avatar video renders, then downloads the mp4 into our data dir.

// Overridable so the integration can be pointed at a stub in tests.
const API = config.ugc.heygenApiBase;
const POLL_MS = 10 * 1000;
const MAX_WAIT_MS = 15 * 60 * 1000;

// Avatar and voice lists change rarely and cost an API call each, so they
// are cached for the life of the process.
const CACHE_TTL_MS = 10 * 60 * 1000;
let cache = { at: 0, avatars: null, voices: null };

export function heygenConfigured() {
  return Boolean(config.ugc.heygenApiKey);
}

async function call(path, options = {}) {
  if (!heygenConfigured()) throw new Error("HEYGEN_API_KEY is not set");
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "X-Api-Key": config.ugc.heygenApiKey,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const detail = data.error?.message || data.message || JSON.stringify(data).slice(0, 300);
    // 401 here is almost always a key pasted with whitespace or from the
    // wrong workspace; say so rather than surfacing a bare 401.
    if (res.status === 401 || res.status === 403) {
      throw new Error(`HeyGen rejected the API key (${res.status}): ${detail}`);
    }
    throw new Error(`HeyGen ${path} failed (${res.status}): ${detail}`);
  }
  return data;
}

/* ---------- account discovery ---------- */

// The avatars available to this account, including uploaded talking photos.
// Without this an operator has to find avatar IDs by hand in HeyGen's UI.
export async function listAvatars() {
  const data = await call("/v2/avatars");
  const avatars = (data.data?.avatars || []).map((a) => ({
    id: a.avatar_id,
    name: a.avatar_name || a.avatar_id,
    gender: a.gender || null,
    preview: a.preview_image_url || null,
    kind: "avatar",
  }));
  const photos = (data.data?.talking_photos || []).map((p) => ({
    id: p.talking_photo_id,
    name: p.talking_photo_name || p.talking_photo_id,
    gender: null,
    preview: p.preview_image_url || null,
    kind: "talking_photo",
  }));
  return [...avatars, ...photos];
}

export async function listVoices() {
  const data = await call("/v2/voices");
  return (data.data?.voices || []).map((v) => ({
    id: v.voice_id,
    name: v.name || v.voice_id,
    language: v.language || null,
    gender: v.gender || null,
    preview: v.preview_audio || null,
  }));
}

// One cached call for both lists - what the create form needs to draw its
// pickers. Never throws: a failure here should degrade the picker, not stop
// the page loading.
export async function heygenCatalog({ force = false } = {}) {
  if (!heygenConfigured()) {
    return { configured: false, avatars: [], voices: [], error: null };
  }
  const fresh = Date.now() - cache.at < CACHE_TTL_MS;
  if (!force && fresh && cache.avatars) {
    return { configured: true, avatars: cache.avatars, voices: cache.voices, error: null, cached: true };
  }
  try {
    const [avatars, voices] = await Promise.all([listAvatars(), listVoices()]);
    cache = { at: Date.now(), avatars, voices };
    return { configured: true, avatars, voices, error: null };
  } catch (err) {
    return {
      configured: true,
      avatars: cache.avatars || [],
      voices: cache.voices || [],
      error: String(err.message || err),
    };
  }
}

// Cheap key check for the settings UI.
export async function testConnection() {
  const avatars = await listAvatars();
  return { ok: true, avatarCount: avatars.length };
}

/* ---------- rendering ---------- */

// Kicks off the render and resolves with HeyGen's video id.
export async function startAvatarVideo({ text, settings = {} }) {
  const body = {
    video_inputs: [
      {
        character: buildCharacter(settings),
        voice: {
          type: "text",
          input_text: text.slice(0, 1500),
          voice_id: settings.voiceId || config.ugc.heygenVoiceId,
          speed: config.ugc.heygenSpeed,
        },
        background: { type: "color", value: config.ugc.heygenBackground },
      },
    ],
    // Match the built-in renderer: full vertical 1080x1920, which is what
    // every short-form surface expects.
    dimension: { width: 1080, height: 1920 },
  };
  const data = await call("/v2/video/generate", { method: "POST", body: JSON.stringify(body) });
  const videoId = data.data?.video_id;
  if (!videoId) throw new Error(`HeyGen returned no video_id: ${JSON.stringify(data).slice(0, 300)}`);
  return videoId;
}

// Uploaded photo avatars are a different character type to stock avatars.
function buildCharacter(settings) {
  const id = settings.avatarId || config.ugc.heygenAvatarId;
  if (settings.avatarKind === "talking_photo") {
    return { type: "talking_photo", talking_photo_id: id };
  }
  return { type: "avatar", avatar_id: id, avatar_style: "normal" };
}

// Polls until the video completes, then streams it to outputPath.
export async function waitAndDownload(videoId, outputPath) {
  const started = Date.now();
  for (;;) {
    const data = await call(`/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`);
    const status = data.data?.status;
    if (status === "completed") {
      const url = data.data?.video_url;
      if (!url) throw new Error("HeyGen finished but returned no video_url");
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Downloading the HeyGen video failed (${res.status})`);
      fs.writeFileSync(outputPath, Buffer.from(await res.arrayBuffer()));
      return outputPath;
    }
    if (status === "failed") {
      throw new Error(`HeyGen render failed: ${data.data?.error?.message || "unknown error"}`);
    }
    if (Date.now() - started > MAX_WAIT_MS) {
      throw new Error("HeyGen render timed out after 15 minutes");
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}
