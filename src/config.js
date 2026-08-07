import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Credentials pasted into env panels often pick up trailing whitespace or
// newlines, which platforms reject as "incorrect secret". Always trim.
const env = (name, fallback = "") => (process.env[name] ?? fallback).trim();

function firstExisting(candidates) {
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

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

// The platforms Postfin can publish to, in the order the UI lists them.
// Kept here (rather than imported from accounts.js) so config stays free of
// circular imports - accounts.js pulls the platform modules, which read this.
export const PLATFORM_NAMES = [
  "tiktok", "instagram", "youtube", "facebook", "x", "threads", "pinterest", "linkedin",
];

const config = {
  rootDir,
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

  // Postgres/Neon connection string; empty = local SQLite in data/app.db.
  databaseUrl: env("DATABASE_URL"),

  // Meta (Instagram/Facebook/Threads) app setup demands a webhook callback
  // URL + verify token; /webhooks/meta answers the handshake with this.
  metaVerifyToken: env("META_VERIFY_TOKEN", "postfin-verify"),

  // Analytics collection: how often to re-poll the platform APIs for view /
  // like / comment counts, and how long a post stays in the polling set.
  // 0 minutes disables the collector entirely.
  metrics: {
    intervalMinutes: Number(process.env.METRICS_INTERVAL_MINUTES || 30),
    maxAgeDays: Number(process.env.METRICS_MAX_AGE_DAYS || 90),
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

  // Built-in renderer encode settings.
  videoCrf: Number(process.env.VIDEO_CRF || 20),
  videoPreset: process.env.VIDEO_PRESET || "superfast",
  normalizeAudio: (process.env.NORMALIZE_AUDIO || "true").toLowerCase() !== "false",

  // UGC generation: "heygen" uses the HeyGen avatar API; anything else (or
  // no key) falls back to the built-in ffmpeg renderer with an AI voiceover.
  ugc: {
    provider: env("UGC_PROVIDER", "auto"), // auto | heygen | local
    heygenApiKey: env("HEYGEN_API_KEY"),
    heygenApiBase: env("HEYGEN_API_BASE", "https://api.heygen.com").replace(/\/+$/, ""),
    // Fallbacks only - the create form lists the avatars and voices this
    // account actually has, and a job stores the pair it was made with.
    heygenAvatarId: env("HEYGEN_AVATAR_ID", "Daisy-inskirt-20220818"),
    heygenVoiceId: env("HEYGEN_VOICE_ID", "2d5b0e6cf36f460aa7fc47e3eee4ba54"),
    heygenBackground: env("HEYGEN_BACKGROUND", "#0b0d12"),
    heygenSpeed: Number(process.env.HEYGEN_SPEED || 1.05),
    ttsModel: env("UGC_TTS_MODEL", "gpt-4o-mini-tts"),
    ttsVoice: env("UGC_TTS_VOICE", "nova"),
    videoSeconds: Number(process.env.UGC_VIDEO_SECONDS || 24),
  },

  dataDir: path.join(rootDir, "data"),
  ugcDir: path.join(rootDir, "data", "ugc"),
  dbPath: path.join(rootDir, "data", "app.db"),

  ffmpegPath: process.env.FFMPEG_PATH || "ffmpeg",
  ffprobePath: process.env.FFPROBE_PATH || "ffprobe",
  fontPath: firstExisting([
    process.env.FONT_PATH,
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "C:\\Windows\\Fonts\\arialbd.ttf",
  ]),

  youtube: {
    clientId: env("YOUTUBE_CLIENT_ID"),
    clientSecret: env("YOUTUBE_CLIENT_SECRET"),
    privacyStatus: process.env.YOUTUBE_PRIVACY_STATUS || "public",
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
      "This app needs a persistent server with a writable disk and ffmpeg - " +
      "deploy the included Dockerfile to Railway, Render, Fly.io or a VPS.\n"
  );
  process.exit(1);
}

export default config;
