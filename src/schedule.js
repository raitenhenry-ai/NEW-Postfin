import config from "./config.js";
import { q, run } from "./db.js";
import { postJob, enqueueUgcJob } from "./ugc/pipeline.js";

// Scheduled publishing.
//
// A scheduled job is generated immediately - scrape, script and render all
// run as soon as it's created - and then parked at 'ready' until its slot
// comes round. That way the calendar shows a finished, previewable video
// ahead of time instead of a promise, and the only thing waiting on the
// clock is the upload itself.
//
// Jobs with no scheduled_at post the moment they finish rendering, exactly
// as before.

let timer = null;
let running = false;

// How many times a due job may fail to post before it is called failed. A
// network blip deserves another go; the same error four times running is a
// broken video, and leaving it 'ready' means retrying it every thirty
// seconds forever while the calendar still says it is scheduled.
const MAX_POST_ATTEMPTS = 3;

// Attempts this process has seen, by job. In memory on purpose: a restart is
// a fair reason to try again, and it keeps the schema alone.
const attempts = new Map();

export async function dueJobs(now = Date.now()) {
  return q(
    `SELECT id FROM ugc_jobs
     WHERE status = 'ready' AND auto_post = 1
       AND scheduled_at IS NOT NULL AND scheduled_at <= ?
     ORDER BY scheduled_at ASC`,
    [now]
  );
}

export async function runDueJobs() {
  if (running) return 0;
  running = true;
  try {
    const due = await dueJobs();
    for (const job of due) {
      console.log(`[schedule] job ${job.id} is due - posting`);
      try {
        await postJob(job.id);
        attempts.delete(job.id);
      } catch (err) {
        // The reason has to reach the user. A scheduled video that quietly
        // never posts, with the explanation in a log they cannot see, is the
        // worst way for this to fail.
        const message = String(err.message || err);
        const count = (attempts.get(job.id) || 0) + 1;
        attempts.set(job.id, count);
        const giveUp = count >= MAX_POST_ATTEMPTS;

        await run(
          `UPDATE ugc_jobs SET error = ?, status = ?, updated_at = ? WHERE id = ?`,
          [
            giveUp ? `Could not post: ${message}` : `Retrying - ${message} (attempt ${count})`,
            giveUp ? "failed" : "ready",
            Date.now(),
            job.id,
          ]
        ).catch(() => {});

        console.error(
          `[schedule] job ${job.id} failed to post (attempt ${count}${giveUp ? ", giving up" : ""}):`,
          message
        );
      }
    }
    await retryFailedJobs().catch((err) => console.error("[schedule] auto-retry:", err));
    return due.length;
  } finally {
    running = false;
  }
}

// Failed jobs get another shot on their own instead of sitting in Recent as
// a wall of "Failed" until someone notices. Bounded per process so a video
// that fails the same way every time does not burn render credits forever.
const MAX_GEN_RETRIES = 2;
const genRetries = new Map();

// Failures that come out identical on every run - configuration gaps and
// content refusals. Retrying those spends time and money to be told no again.
const PERMANENT_FAILURE =
  /not configured|no social accounts|content policy|could not be generated|rejected the video/i;

export async function retryFailedJobs(now = Date.now()) {
  const rows = await q(
    `SELECT id, error, video_filename, updated_at FROM ugc_jobs
     WHERE status = 'failed'
     ORDER BY updated_at DESC
     LIMIT 25`
  );
  let kicked = 0;
  for (const row of rows) {
    if (PERMANENT_FAILURE.test(String(row.error || ""))) continue;
    const count = genRetries.get(row.id) || 0;
    if (count >= MAX_GEN_RETRIES) continue;
    // Give the failure a minute to settle - hot-looping a flaky API makes
    // rate limits worse, not better.
    if (Number(row.updated_at) > now - 60_000) continue;
    genRetries.set(row.id, count + 1);

    if (row.video_filename) {
      // The video rendered fine and only posting failed, so hand it back to
      // the posting queue rather than paying to re-render it.
      attempts.delete(row.id);
      await run(
        `UPDATE ugc_jobs SET status = 'ready', error = NULL, updated_at = ? WHERE id = ?`,
        [Date.now(), row.id]
      );
    } else {
      await run(
        `UPDATE ugc_jobs SET status = 'queued', error = NULL, updated_at = ? WHERE id = ?`,
        [Date.now(), row.id]
      );
      enqueueUgcJob(row.id);
    }
    kicked++;
    console.log(
      `[schedule] auto-retrying failed job ${row.id} (attempt ${count + 1}/${MAX_GEN_RETRIES})`
    );
  }
  return kicked;
}

// Move a job's slot. Returns false when the job has already gone out, since
// there is nothing left to reschedule at that point.
export async function reschedule(jobId, scheduledAt) {
  const result = await run(
    `UPDATE ugc_jobs SET scheduled_at = ?, updated_at = ?
     WHERE id = ? AND status <> 'posted'`,
    [scheduledAt, Date.now(), jobId]
  );
  return result.changes > 0;
}

export function startScheduler() {
  const period = Math.max(5, config.schedulerIntervalSeconds) * 1000;
  timer = setInterval(() => {
    runDueJobs().catch((err) => console.error("[schedule]", err));
  }, period);
  timer.unref();
  // Catch anything whose slot passed while the server was down.
  runDueJobs().catch((err) => console.error("[schedule]", err));
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
