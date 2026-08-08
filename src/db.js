import config from "./config.js";

// Async database adapter with two drivers:
//   - SQLite (default): zero-config, stored in data/app.db.
//   - Postgres (Neon or any other): set DATABASE_URL.
// All queries use ?-placeholders; they're translated to $n for Postgres.
//
//   q(sql, params)   -> all rows
//   q1(sql, params)  -> first row or undefined
//   run(sql, params) -> { changes } (use q1 with RETURNING for insert ids)

export let dbKind = "sqlite";

let _q, _q1, _run, _close;

function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

const PG_SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  platform TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at BIGINT,
  external_id TEXT,
  display_name TEXT,
  connected_at BIGINT NOT NULL,
  UNIQUE (platform, external_id)
);
CREATE TABLE IF NOT EXISTS users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS ugc_jobs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_url TEXT NOT NULL,
  product_json TEXT,
  settings_json TEXT,
  script_json TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  provider TEXT,
  video_filename TEXT,
  auto_post INTEGER NOT NULL DEFAULT 1,
  title TEXT,
  scheduled_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS ugc_posts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id BIGINT NOT NULL REFERENCES ugc_jobs(id) ON DELETE CASCADE,
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  platform_video_id TEXT,
  public_post_id TEXT,
  posted_at BIGINT,
  UNIQUE (job_id, account_id)
);
-- One row per post per collection run: the analytics charts read view /
-- like / comment counts straight out of here, so the series survives
-- restarts and does not depend on the platform APIs being reachable.
CREATE TABLE IF NOT EXISTS post_metrics (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  post_id BIGINT NOT NULL REFERENCES ugc_posts(id) ON DELETE CASCADE,
  collected_at BIGINT NOT NULL,
  views BIGINT NOT NULL DEFAULT 0,
  likes BIGINT NOT NULL DEFAULT 0,
  comments BIGINT NOT NULL DEFAULT 0,
  shares BIGINT NOT NULL DEFAULT 0,
  saves BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS post_metrics_post_idx ON post_metrics (post_id, collected_at);
-- Follower counts per connected account, same snapshot model.
CREATE TABLE IF NOT EXISTS account_metrics (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  collected_at BIGINT NOT NULL,
  followers BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS account_metrics_account_idx ON account_metrics (account_id, collected_at);
`;

// Columns added after the first release. Postgres supports IF NOT EXISTS on
// ADD COLUMN, so this is safe to re-run on every boot.
const PG_MIGRATIONS = `
ALTER TABLE ugc_jobs ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE ugc_jobs ADD COLUMN IF NOT EXISTS scheduled_at BIGINT;
ALTER TABLE ugc_jobs ADD COLUMN IF NOT EXISTS brief TEXT;
ALTER TABLE ugc_jobs ADD COLUMN IF NOT EXISTS concept_json TEXT;

-- Indexes for the queries that degrade first as history builds up: the
-- per-post "latest snapshot" lookup behind every chart, the published-post
-- filter on the dashboard, and the calendar's date window. Applied on boot
-- so any Postgres gets them without a manual step.
CREATE INDEX IF NOT EXISTS post_metrics_latest_idx
  ON post_metrics (post_id, collected_at DESC);
CREATE INDEX IF NOT EXISTS account_metrics_latest_idx
  ON account_metrics (account_id, collected_at DESC);
CREATE INDEX IF NOT EXISTS ugc_posts_posted_at_idx
  ON ugc_posts (posted_at) WHERE status = 'done';
CREATE INDEX IF NOT EXISTS ugc_jobs_slot_idx
  ON ugc_jobs (COALESCE(scheduled_at, created_at));
`;

if (config.databaseUrl) {
  dbKind = "postgres";
  const { default: pg } = await import("pg");
  // BIGINT (ids, epoch-ms timestamps) comes back as strings by default;
  // our values all fit safely in JS numbers.
  pg.types.setTypeParser(20, (v) => Number(v));
  const needsSsl = !/localhost|127\.0\.0\.1/.test(config.databaseUrl);
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    max: 5,
  });
  pool.on("error", (err) => console.error("[db] postgres pool error:", err.message));

  _q = async (sql, params = []) => (await pool.query(toPg(sql), params)).rows;
  _q1 = async (sql, params = []) => (await pool.query(toPg(sql), params)).rows[0];
  _run = async (sql, params = []) => {
    const result = await pool.query(toPg(sql), params);
    return { changes: result.rowCount };
  };
  _close = () => pool.end();

  // A managed database can refuse connections for a few seconds while a
  // deploy settles, so retry before giving up. Without this the process
  // exits on the first refusal and the platform reports nothing more useful
  // than "replicas never became healthy".
  await connectWithRetry(pool);
  console.log("[db] connected to Postgres");
} else {
  const { default: Database } = await import("better-sqlite3");
  const sdb = new Database(config.dbPath);
  sdb.pragma("journal_mode = WAL");
  sdb.pragma("foreign_keys = ON");
  initSqlite(sdb);

  _q = async (sql, params = []) => sdb.prepare(sql).all(...params);
  _q1 = async (sql, params = []) => sdb.prepare(sql).get(...params);
  _run = async (sql, params = []) => {
    const info = sdb.prepare(sql).run(...params);
    return { changes: info.changes };
  };
  _close = () => sdb.close();
}

// Opens the connection and applies the schema, retrying transient failures.
// On a permanent failure it explains what to check instead of dumping a
// driver stack trace, because this is the error people actually hit when
// deploying.
async function connectWithRetry(pool, attempts = 5) {
  const host = safeHost(config.databaseUrl);
  for (let i = 1; i <= attempts; i++) {
    try {
      await pool.query(PG_SCHEMA);
      await pool.query(PG_MIGRATIONS);
      return;
    } catch (err) {
      const last = i === attempts;
      if (!last) {
        const wait = i * 2000;
        console.warn(
          `[db] connection to ${host} failed (${err.code || err.message}), ` +
            `retrying in ${wait / 1000}s (${i}/${attempts - 1})`
        );
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      console.error(
        `\nFATAL: could not connect to the database at ${host}.\n` +
          `  ${err.code ? err.code + ": " : ""}${err.message}\n\n` +
          explainDbError(err) +
          "\nThe app needs DATABASE_URL to be reachable, or unset it to use " +
          "local SQLite instead.\n"
      );
      process.exit(1);
    }
  }
}

// Host and port only - a connection string carries the password.
function safeHost(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || 5432}`;
  } catch {
    return "the configured host";
  }
}

function explainDbError(err) {
  const hints = {
    ENOTFOUND: "The hostname does not resolve - check it for typos.",
    ECONNREFUSED: "Nothing is accepting connections there - check the host and port.",
    ETIMEDOUT:
      "The connection timed out. On Supabase this usually means the direct\n" +
      "  db.<ref>.supabase.co host, which is IPv6-only without the IPv4 add-on -\n" +
      "  use the Session pooler connection string instead.",
    ENETUNREACH:
      "The network is unreachable, which usually means an IPv6-only host.\n" +
      "  On Supabase, switch to the Session pooler connection string.",
  };
  if (hints[err.code]) return `  ${hints[err.code]}\n`;
  if (/password authentication failed/i.test(err.message)) {
    return "  The password was rejected - re-copy it, and remember the connection\n" +
      "  string from Supabase contains a [YOUR-PASSWORD] placeholder to replace.\n";
  }
  if (/does not exist/i.test(err.message)) {
    return "  That database or role does not exist - check the end of the URL.\n";
  }
  if (/no pg_hba|SSL/i.test(err.message)) {
    return "  The server refused the connection settings - it may require SSL.\n";
  }
  return "";
}

export const q = (sql, params) => _q(sql, params);
export const q1 = (sql, params) => _q1(sql, params);
export const run = (sql, params) => _run(sql, params);
export const closeDb = () => _close();

function initSqlite(db) {
  const version = db.pragma("user_version", { simple: true });
  if (version < 1) {
    db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at INTEGER,
  external_id TEXT,
  display_name TEXT,
  connected_at INTEGER NOT NULL,
  UNIQUE (platform, external_id)
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ugc_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_url TEXT NOT NULL,
  product_json TEXT,
  settings_json TEXT,
  script_json TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  provider TEXT,
  video_filename TEXT,
  auto_post INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ugc_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES ugc_jobs(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  platform_video_id TEXT,
  public_post_id TEXT,
  posted_at INTEGER,
  UNIQUE (job_id, account_id)
);`);
    db.pragma("user_version = 1");
  }

  // v2: scheduling (a job can be parked until its slot) + the metric
  // snapshots the dashboard and analytics charts are built from.
  if (version < 2) {
    const columns = db.prepare("PRAGMA table_info(ugc_jobs)").all().map((c) => c.name);
    if (!columns.includes("title")) db.exec("ALTER TABLE ugc_jobs ADD COLUMN title TEXT");
    if (!columns.includes("scheduled_at")) {
      db.exec("ALTER TABLE ugc_jobs ADD COLUMN scheduled_at INTEGER");
    }
    db.exec(`
CREATE TABLE IF NOT EXISTS post_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES ugc_posts(id) ON DELETE CASCADE,
  collected_at INTEGER NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  comments INTEGER NOT NULL DEFAULT 0,
  shares INTEGER NOT NULL DEFAULT 0,
  saves INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS post_metrics_post_idx ON post_metrics (post_id, collected_at);
CREATE TABLE IF NOT EXISTS account_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  collected_at INTEGER NOT NULL,
  followers INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS account_metrics_account_idx ON account_metrics (account_id, collected_at);`);
    db.pragma("user_version = 2");
  }

  // v3: videos planned from a written brief rather than a product page.
  // product_url keeps its NOT NULL constraint and holds an empty string for
  // these - rebuilding the table to drop it would risk live data for no real
  // gain, and every read already treats "" as "no product".
  if (version < 3) {
    const columns = db.prepare("PRAGMA table_info(ugc_jobs)").all().map((c) => c.name);
    if (!columns.includes("brief")) db.exec("ALTER TABLE ugc_jobs ADD COLUMN brief TEXT");
    if (!columns.includes("concept_json")) {
      db.exec("ALTER TABLE ugc_jobs ADD COLUMN concept_json TEXT");
    }
    db.pragma("user_version = 3");
  }
}
