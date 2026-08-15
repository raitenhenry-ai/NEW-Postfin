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
    return due.length;
  } finally {
    running = false;
  }
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
