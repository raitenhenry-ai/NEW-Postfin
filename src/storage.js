import fs from "node:fs";
import path from "node:path";
import config from "./config.js";
import { q } from "./db.js";

// Does the disk survive a restart?
//
// Generated videos live on the filesystem while the rows that name them live
// in the database, and on a managed host those two have very different
// lifetimes. With Postgres and no mounted volume, every deploy keeps the
// whole schedule and throws away every video it points at - so a scheduled
// post arrives at its slot with nothing to upload.
//
// The pipeline recovers by re-rendering, but each of those re-renders costs
// real money and a slot can pass while it runs, so this is worth saying out
// loud rather than absorbing quietly.
//
// The test is direct rather than inferred: leave a marker in the media
// directory at boot and look for it at the next one. A database with history
// and a media directory with no marker means the disk was wiped underneath
// it.

const MARKER = ".postfin-storage";

function markerPath() {
  return path.join(config.dataDir, MARKER);
}

function hostHint() {
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return "Railway: open the service, Settings > Volumes, and add one mounted at /app/data.";
  }
  if (process.env.RENDER_EXTERNAL_URL) {
    return "Render: add a Disk mounted at /app/data (render.yaml in this repo already declares one).";
  }
  if (process.env.FLY_APP_NAME) {
    return "Fly: fly volumes create postfin_data --size 10, mounted at /app/data (see fly.toml).";
  }
  return "Mount persistent storage at /app/data - see the README.";
}

// Reads the marker, counts videos whose files are actually there, and writes
// the marker again for next time.
export async function checkStorage({ write = true } = {}) {
  fs.mkdirSync(config.ugcDir, { recursive: true });

  let previous = null;
  try {
    previous = JSON.parse(fs.readFileSync(markerPath(), "utf8"));
  } catch {
    previous = null;
  }

  const rows = await q(
    "SELECT video_filename FROM ugc_jobs WHERE video_filename IS NOT NULL ORDER BY id DESC LIMIT 500"
  ).catch(() => []);

  let present = 0;
  let missing = 0;
  for (const row of rows) {
    if (fs.existsSync(path.join(config.ugcDir, row.video_filename))) present++;
    else missing++;
  }

  const hadHistory = rows.length > 0;
  // The marker is gone but the database remembers videos: the filesystem was
  // replaced while the database carried on.
  const wiped = hadHistory && !previous;

  if (write) {
    try {
      fs.writeFileSync(markerPath(), JSON.stringify({ bootedAt: Date.now() }));
    } catch {
      /* a read-only media dir is its own problem, reported below */
    }
  }

  return {
    mediaDir: config.ugcDir,
    videosOnRecord: rows.length,
    filesPresent: present,
    filesMissing: missing,
    // Best evidence available, not a guess: either the marker vanished, or
    // every video on record has lost its file.
    persistent: !(wiped || (hadHistory && present === 0 && missing > 0)),
    firstBoot: !previous && !hadHistory,
    hint: hostHint(),
  };
}

// Said once at startup, where an operator will actually see it.
export async function reportStorage() {
  const report = await checkStorage();
  if (report.persistent) {
    if (report.filesMissing) {
      console.warn(
        `[storage] ${report.filesMissing} of ${report.videosOnRecord} videos have no file on ` +
          "disk and will be re-rendered when they are needed."
      );
    }
    return report;
  }

  console.warn(
    "\n[storage] The videos directory is not persistent.\n" +
      `  ${report.filesMissing} of ${report.videosOnRecord} scheduled videos have lost their file.\n` +
      "  The database survives restarts but the filesystem does not, so every deploy throws\n" +
      "  away finished videos and they have to be generated again - which costs money and can\n" +
      "  miss a posting slot.\n" +
      `  ${report.hint}\n`
  );
  return report;
}
