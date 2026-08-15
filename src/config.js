import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Credentials pasted into env panels often pick up trailing whitespace or
// newlines, which platforms reject as "incorrect secret". Always trim.
const env = (name, fallback = "") => (process.env[name] ?? fallback).trim();

// Trailing slashes and a pasted-in page path ("…/index.html") both produce
// redirect URIs the platforms reject, so strip them.
function normalizeBaseUrl(raw) {
  const trimmed = String(raw).trim().replace(/\/+$/, "");
  try {
    // Operate on the path only - the host is full of dots and would other-
    // wise look like a filename to strip.
    const url = new URL(trimmed);
    url.pathname = url.pathname.replace(/\/[^/]*\.[a-z]{2,5}$/i, "");
    return (url.origin + url.pathname).replace(/\/+$/, "");
  } catch {
    return trimmed;
  }
}

// Railway, Render and Fly each expose the public hostname; use it when
// BASE_URL wasn't set explicitly.
function hostProvidedUrl() {
  const railway = env("RAILWAY_PUBLIC_DOMAIN");
  if (railway) return `https://${railway}`;
  const render = env("RENDER_EXTERNAL_URL");
  if (render) return render;
  const fly = env("FLY_APP_NAME");
  if (fly) return `https://${fly}.fly.dev`;
  return "";
}

// Optional numeric settings stay null when unset so the UI can tell
// "not configured" apart from a genuine zero.
function numberOrNull(raw) {
  const value = Number(String(raw ?? "").trim());
  return String(raw ?? "").trim() && Number.isFinite(value) ? value : null;
}

// The first path that actually exists - used to find a font for the
// slideshow renderer without demanding the operator name one.
function firstExisting(candidates) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// The platforms Postfin can publish to, in the order the UI lists them.
// Kept here (rather than imported from accounts.js) so config stays free of
// circular imports - accounts.js pulls the platform modules, which read this.
export const PLATFORM_NAMES = [
  "tiktok", "instagram", "youtube", "facebook", "x", "threads", "pinterest", "linkedin",
];

// Which of those the UI actually offers. All eight are implemented, but only
// these are shown on Connectors, in the platform pickers and in the
// analytics filters. Widen it with ENABLED_PLATFORMS when you want more.
// PLATFORM_NAMES stays the full list so accounts connected under a platform
// that is later switched off still resolve their post links and metrics.
export const ENABLED_PLATFORMS = (() => {
  const raw = (process.env.ENABLED_PLATFORMS || "tiktok,instagram,youtube")
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  const valid = raw.filter((p) => PLATFORM_NAMES.includes(p));
  return valid.length ? valid : ["tiktok", "instagram", "youtube"];
})();

// Which build is actually running. A 404 from an endpoint that exists in the
// source is nearly always a stale or dead deploy, and that is unanswerable
// without the running build saying what it is.
function buildInfo() {
  let version = "unknown";
  try {
    version = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8")).version || version;
  } catch { /* keep unknown */ }
  const commit =
    env("RAILWAY_GIT_COMMIT_SHA") || env("RENDER_GIT_COMMIT") || env("GIT_COMMIT") ||
    env("SOURCE_VERSION") || env("FLY_MACHINE_VERSION") || "";
  return {
    version,
    commit: commit ? commit.slice(0, 12) : null,
    startedAt: Date.now(),
  };
}

const config = {
  rootDir,
  build: buildInfo(),
  port: Number(process.env.PORT || 3000),
  // Every OAuth redirect URI and the public video URLs are built off this, so
  // getting it wrong breaks connecting accounts and publishing. An explicit
  // BASE_URL always wins; otherwise fall back to the domain the host already
  // knows about, which is right far more often than localhost is.
  baseUrl: normalizeBaseUrl(
    env("BASE_URL") ||
      hostProvidedUrl() ||
      `http://localhost:${process.env.PORT || 3000}`
  ),

  // Login; empty = no auth (local use only).
  adminPassword: env("ADMIN_PASSWORD"),
  maxAccountsPerPlatform: Number(process.env.MAX_ACCOUNTS_PER_PLATFORM || 5),

  // Script generation + TTS voiceover; disabled without a key.
  openaiApiKey: env("OPENAI_API_KEY"),
  openaiChatModel: process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini",
  // Overridable so the assistant and script writer can be pointed at a stub.
  openaiApiBase: env("OPENAI_API_BASE", "https://api.openai.com/v1").replace(/\/+$/, ""),

  // Postgres/Neon connection string; empty = local SQLite in data/app.db.
  databaseUrl: env("DATABASE_URL"),

  // Meta (Instagram/Facebook/Threads) app setup demands a webhook callback
  // URL + verify token; /webhooks/meta answers the handshake with this.
  metaVerifyToken: env("META_VERIFY_TOKEN", "postfin-verify"),

  // Analytics collection: how often to re-poll the platform APIs for view /
  // like / comment counts, and how long a post stays in the polling set.
  // 0 minutes disables the collector entirely.
  metrics: {
    // Tick interval for the age-tiered sync scheduler (minutes). 0 disables.
    intervalMinutes: Number(process.env.METRICS_INTERVAL_MINUTES || 15),
    maxAgeDays: Number(process.env.METRICS_MAX_AGE_DAYS || 365),
    // Manual refresh cooldown per session (minutes).
    refreshCooldownMinutes: Number(process.env.METRICS_REFRESH_COOLDOWN_MINUTES || 3),
    // Max posts synced in one scheduler/manual pass.
    batchLimit: Number(process.env.METRICS_BATCH_LIMIT || 200),
    // No platform reports ad revenue for posts published through their
    // publishing APIs, so CPM is only shown when the operator supplies their
    // own rates (dollars per 1000 views). Missing = the UI shows no CPM
    // rather than an invented one.
    cpm: {
      default: numberOrNull(process.env.ESTIMATED_CPM),
      byPlatform: Object.fromEntries(
        PLATFORM_NAMES.map((p) => [p, numberOrNull(process.env[`ESTIMATED_CPM_${p.toUpperCase()}`])])
          .filter(([, v]) => v !== null)
      ),
    },
  },

  // How often the scheduler scans for jobs whose scheduled time has passed.
  schedulerIntervalSeconds: Number(process.env.SCHEDULER_INTERVAL_SECONDS || 30),

  // Video generation. Two formats:
  //   avatar    - a talking-creator UGC clip, rendered by Grok Imagine when
  //               XAI_API_KEY is set (preferred) or HeyGen otherwise
  //   slideshow - the built-in renderer builds the short-form slideshow ad
  //               format: AI-generated images, one big text overlay per slide,
  //               a voiceover, hard cuts (needs OPENAI_API_KEY + ffmpeg)
  ugc: {
    format: ["avatar", "slideshow"].includes(env("UGC_FORMAT"))
      ? env("UGC_FORMAT")
      : "avatar",
    // Which renderer makes non-slideshow videos. Empty means auto: Grok when
    // an xAI key exists, HeyGen otherwise. Set explicitly to pin one.
    videoProvider: ["grok", "heygen"].includes(env("UGC_VIDEO_PROVIDER"))
      ? env("UGC_VIDEO_PROVIDER")
      : "",

    // Grok Imagine (xAI) - generates the whole clip in one shot from the
    // script, with the product's real photos passed as reference images.
    xaiApiKey: env("XAI_API_KEY"),
    xaiApiBase: env("XAI_API_BASE", "https://api.x.ai").replace(/\/+$/, ""),
    grokVideoModel: env("GROK_VIDEO_MODEL", "grok-imagine-video-1.5"),
    // Reference-to-video is capped at 720p; plain text/image-to-video can do
    // 1080p. 720p is the safe default since product references are the norm.
    grokResolution: ["480p", "720p", "1080p"].includes(env("GROK_VIDEO_RESOLUTION"))
      ? env("GROK_VIDEO_RESOLUTION")
      : "720p",
    // The API's hard ceiling is 15 seconds.
    grokVideoSeconds: Math.max(1, Math.min(15, Number(process.env.GROK_VIDEO_SECONDS || 15))),
    // Optional preset voice (e.g. "eve") from xAI's TTS roster, so the
    // creator in the clip speaks with a consistent voice across videos.
    grokVoiceId: env("GROK_VOICE_ID"),

    heygenApiKey: env("HEYGEN_API_KEY"),
    heygenApiBase: env("HEYGEN_API_BASE", "https://api.heygen.com").replace(/\/+$/, ""),
    // Fallbacks only - the create form lists the avatars and voices this
    // account actually has, and a job stores the pair it was made with.
    // Empty by default on purpose. A hardcoded stock id is a stale id -
    // HeyGen retires sample avatars, and a video that names one fails with
    // "avatar not found" on an account that never had it. Left empty, the
    // renderer asks the account which avatars it actually has.
    heygenAvatarId: env("HEYGEN_AVATAR_ID"),
    heygenVoiceId: env("HEYGEN_VOICE_ID"),
    heygenBackground: env("HEYGEN_BACKGROUND", "#0b0d12"),
    heygenSpeed: Number(process.env.HEYGEN_SPEED || 1.05),
    videoSeconds: Number(process.env.UGC_VIDEO_SECONDS || 24),

    // Slideshow renderer. Slide art comes from OpenAI's image model; a
    // 1024x1536 portrait frame is the closest it offers to 9:16 and crops to
    // it with the least loss. Quality drives both look and cost - at medium a
    // six-slide ad is roughly $0.38 of image generation, at low about $0.10,
    // at high about $1.50.
    imageModel: env("OPENAI_IMAGE_MODEL", "gpt-image-1"),
    imageQuality: ["low", "medium", "high", "auto"].includes(env("OPENAI_IMAGE_QUALITY"))
      ? env("OPENAI_IMAGE_QUALITY")
      : "medium",
    imageSize: "1024x1536",
    // When a slide shows the product, the scraped photos are sent as
    // references and the model recreates the product inside its own scene.
    // "high" is what keeps a logo, a label or a screenshot's layout intact;
    // newer image models reject the setting because they always work that
    // way, and the renderer drops it when told to.
    imageFidelity: ["high", "low"].includes(env("OPENAI_IMAGE_FIDELITY"))
      ? env("OPENAI_IMAGE_FIDELITY")
      : "high",
    // 6 slides at ~3s is the shape the format converges on: long enough to
    // land a hook, a payoff and a CTA, short enough to loop.
    slides: Math.max(3, Math.min(10, Number(process.env.UGC_SLIDE_COUNT || 6))),
    slideSeconds: Number(process.env.UGC_SLIDE_SECONDS || 3.2),
    ttsModel: env("UGC_TTS_MODEL", "gpt-4o-mini-tts"),
    ttsVoice: env("UGC_TTS_VOICE", "nova"),
  },

  // Encode settings for the slideshow renderer.
  videoCrf: Number(process.env.VIDEO_CRF || 20),
  videoPreset: process.env.VIDEO_PRESET || "veryfast",
  ffmpegPath: process.env.FFMPEG_PATH || "ffmpeg",
  ffprobePath: process.env.FFPROBE_PATH || "ffprobe",
  // Overlay text is the whole ad when the sound is off, so a font has to be
  // found. The bundled one is the last resort that always exists.
  fontPath: firstExisting([
    env("FONT_PATH"),
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    path.join(rootDir, "public", "fonts", "Merriweather.ttf"),
  ]),

  dataDir: path.join(rootDir, "data"),
  ugcDir: path.join(rootDir, "data", "ugc"),
  dbPath: path.join(rootDir, "data", "app.db"),

  youtube: {
    clientId: env("YOUTUBE_CLIENT_ID"),
    clientSecret: env("YOUTUBE_CLIENT_SECRET"),
    privacyStatus: process.env.YOUTUBE_PRIVACY_STATUS || "public",
    // Overridable so the upload path can be pointed at a stub, the same way
    // the HeyGen base is.
    apiBase: env("YOUTUBE_API_BASE", "https://www.googleapis.com").replace(/\/+$/, ""),
  },
  instagram: {
    clientId: env("INSTAGRAM_CLIENT_ID"),
    clientSecret: env("INSTAGRAM_CLIENT_SECRET"),
  },
  tiktok: {
    clientKey: env("TIKTOK_CLIENT_KEY"),
    clientSecret: env("TIKTOK_CLIENT_SECRET"),
    privacyLevel: process.env.TIKTOK_PRIVACY_LEVEL || "SELF_ONLY",
    scopes: env("TIKTOK_SCOPES", "user.info.basic,video.publish,video.list"),
  },
  facebook: {
    appId: env("FACEBOOK_APP_ID"),
    appSecret: env("FACEBOOK_APP_SECRET"),
    configId: env("FACEBOOK_CONFIG_ID"),
  },
  x: {
    clientId: env("X_CLIENT_ID"),
    clientSecret: env("X_CLIENT_SECRET"),
  },
  threads: {
    appId: env("THREADS_APP_ID"),
    appSecret: env("THREADS_APP_SECRET"),
  },
  pinterest: {
    appId: env("PINTEREST_APP_ID"),
    appSecret: env("PINTEREST_APP_SECRET"),
  },
  linkedin: {
    clientId: env("LINKEDIN_CLIENT_ID"),
    clientSecret: env("LINKEDIN_CLIENT_SECRET"),
    companyPages: (process.env.LINKEDIN_COMPANY_PAGES || "false").toLowerCase() === "true",
  },
};

try {
  for (const dir of [config.dataDir, config.ugcDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
} catch (err) {
  console.error(
    `\nFATAL: cannot create the data directory (${err.code}: ${err.message}).\n` +
      "This app needs a persistent server with a writable disk - " +
      "deploy the included Dockerfile to Railway, Render, Fly.io or a VPS.\n"
  );
  process.exit(1);
}

export default config;
