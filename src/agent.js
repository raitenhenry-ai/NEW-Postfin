import config, { PLATFORM_NAMES, ENABLED_PLATFORMS } from "./config.js";
import { q, q1, run as dbRun } from "./db.js";
import { resolveTargetPlatforms } from "./accounts.js";
import { planContent } from "./ugc/plan.js";
import { enqueueUgcJob, postJob, deleteJobFiles } from "./ugc/pipeline.js";
import { toneOptions, styleOptions } from "./ugc/script.js";
import { slideshowAngles } from "./ugc/slideshow.js";
import { reschedule } from "./schedule.js";
import { totalsSince, accountLeaderboard, viewsByPlatform } from "./metrics.js";
import fs from "node:fs";
import path from "node:path";

// The calendar assistant.
//
// A tool-calling loop over the operator's own workspace: it can plan and
// schedule videos, but also answer questions about what is scheduled, how
// posts are performing, which accounts are connected, and edit or remove
// work that is already on the calendar.
//
// Two of those are one-way doors, so both are gated on the user rather than
// on the model's reading of a sentence:
//   - ask_user pauses the turn and hands the client a multiple-choice
//     question, so a vague brief becomes a choice instead of a guess.
//   - delete_video refuses to run until it is called with confirm: true,
//     which the prompt only allows after the user has answered a
//     confirmation question.

const MAX_TOOL_ROUNDS = 6;
const MAX_HISTORY = 20;

// Ceilings on one ask_user round, so a turn can't bury the composer under a
// questionnaire.
const MAX_QUESTIONS = 3;
const MAX_OPTIONS = 6;

// A single delete_video call is capped so "clear my calendar" can't become
// one unbounded destructive statement.
const MAX_DELETE = 25;

// Statuses where the pipeline currently owns the job - editing the direction
// or re-rendering underneath it would race the worker.
const BUSY_STATUSES = ["queued", "scraping", "scripting", "rendering", "posting"];

export function assistantAvailable() {
  return Boolean(config.openaiApiKey);
}

/* ---------------------------------------------------------------- tools */

const TOOLS = [
  {
    type: "function",
    function: {
      name: "ask_user",
      description:
        "Ask the user a multiple-choice question and stop until they answer. " +
        "Use this before generating videos whenever the brief leaves something " +
        "material open (subject, tone, style, platforms, dates), and to confirm " +
        "a deletion. Call it up to three times in one message for up to three " +
        "questions; the user sees them all at once. Do not call any other tool " +
        "in the same message.",
      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "One short question, in plain language.",
          },
          options: {
            type: "array",
            description:
              "Two to six concrete answers to choose from. Make them real, " +
              "distinct choices - never 'yes/no' for an open question.",
            items: {
              type: "object",
              properties: {
                label: { type: "string", description: "The answer, a few words." },
                hint: {
                  type: "string",
                  description: "Optional one-line explanation of what it means.",
                },
              },
              required: ["label"],
            },
          },
          allowMultiple: {
            type: "boolean",
            description: "True when several answers can be picked together, e.g. platforms.",
          },
        },
        required: ["question", "options"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "plan_videos",
      description:
        "Plan and schedule new videos from a creative brief. Use whenever the " +
        "user asks for videos to be made. One video per date.",
      parameters: {
        type: "object",
        properties: {
          brief: {
            type: "string",
            description: "What the videos should be about, in the user's own words.",
          },
          dates: {
            type: "array",
            items: { type: "string" },
            description:
              "Local dates to post on, each YYYY-MM-DD. If the user selected days " +
              "on the calendar and did not say otherwise, use those.",
          },
          time: {
            type: "string",
            description: "Local time of day to post, HH:MM 24-hour. Defaults to 09:00.",
          },
          productUrl: {
            type: "string",
            description: "Optional product page to build the videos around.",
          },
          platforms: {
            type: "array",
            items: { type: "string", enum: ENABLED_PLATFORMS },
            description: "Platforms to post to. Omit for all connected accounts.",
          },
          tone: {
            type: "string",
            enum: toneOptions(),
            description: "Voice of the script. Defaults to casual.",
          },
          style: {
            type: "string",
            enum: styleOptions(),
            description:
              "How an avatar video is framed. Defaults to product_pov. Ignored " +
              "by slideshows, which use angle instead.",
          },
          format: {
            type: "string",
            enum: ["avatar", "slideshow"],
            description:
              "avatar: a person talks to camera about it. slideshow: images cut " +
              "every few seconds under big on-screen text with a voiceover - the " +
              "format used to advertise software, apps and money-making methods, " +
              "and the only one that works when there is nothing to film.",
          },
          angle: {
            type: "string",
            enum: slideshowAngles(),
            description: "Slideshow only: the shape of the ad, e.g. tool_comparison.",
          },
          slides: {
            type: "number",
            description: "Slideshow only: how many slides, 3-10. Defaults to 6.",
          },
        },
        required: ["brief", "dates", "format"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_videos",
      description:
        "List the user's videos with their status, schedule and view counts. " +
        "Use to answer questions about what is scheduled or what failed, and to " +
        "find the video a request refers to before acting on it. Every date it " +
        "returns is in the user's own timezone.",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["all", "scheduled", "posted", "failed", "ready"],
            description: "Filter by state. 'scheduled' means not yet published.",
          },
          date: {
            type: "string",
            description:
              "Only videos on this local day, YYYY-MM-DD. Use it whenever the " +
              "user names a day, e.g. 'the one on August 18'.",
          },
          fromDate: { type: "string", description: "Start of a local date range, YYYY-MM-DD." },
          toDate: { type: "string", description: "End of a local date range, inclusive, YYYY-MM-DD." },
          limit: { type: "number", description: "Maximum to return (default 20)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_analytics",
      description:
        "Total views, likes, comments, shares and saves over a period, plus the " +
        "best performing accounts. Use for any performance question.",
      parameters: {
        type: "object",
        properties: {
          days: { type: "number", description: "How many days back (default 30)." },
          platform: { type: "string", enum: ENABLED_PLATFORMS },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_accounts",
      description: "The social accounts currently connected, per platform.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "reschedule_video",
      description: "Move a video to a different date and time.",
      parameters: {
        type: "object",
        properties: {
          videoId: { type: "number" },
          date: { type: "string", description: "Local date, YYYY-MM-DD." },
          time: { type: "string", description: "Local time, HH:MM 24-hour. Defaults to 09:00." },
        },
        required: ["videoId", "date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_video",
      description:
        "Change what a video is published with: its title, caption, hashtags " +
        "or the platforms it goes to. Works on videos that are already " +
        "scheduled. Does not touch the video itself - use regenerate_video to " +
        "change what is in it.",
      parameters: {
        type: "object",
        properties: {
          videoId: { type: "number" },
          title: { type: "string" },
          caption: { type: "string" },
          hashtags: { type: "string", description: "Space-separated hashtags." },
          platforms: {
            type: "array",
            items: { type: "string", enum: ENABLED_PLATFORMS },
            description: "Replaces the platforms this video posts to.",
          },
        },
        required: ["videoId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "regenerate_video",
      description:
        "Rewrite and re-render a scheduled video, optionally with new creative " +
        "direction. Use when the user wants the video itself changed rather " +
        "than its caption. Keeps its slot on the calendar.",
      parameters: {
        type: "object",
        properties: {
          videoId: { type: "number" },
          brief: {
            type: "string",
            description: "New direction for this one video, in the user's own words.",
          },
          tone: { type: "string", enum: toneOptions() },
          style: { type: "string", enum: styleOptions() },
          format: {
            type: "string",
            enum: ["avatar", "slideshow"],
            description: "Re-render this video as the other format.",
          },
          angle: { type: "string", enum: slideshowAngles() },
        },
        required: ["videoId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_video",
      description:
        "Permanently delete videos and their files. Only call this after the " +
        "user has answered a confirmation question naming exactly what would " +
        "go; then call it with confirm true.",
      parameters: {
        type: "object",
        properties: {
          videoIds: {
            type: "array",
            items: { type: "number" },
            description: "The ids to delete. Read them with list_videos first.",
          },
          confirm: {
            type: "boolean",
            description: "True only once the user has explicitly confirmed.",
          },
        },
        required: ["videoIds", "confirm"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "post_video_now",
      description:
        "Publish a video immediately, ignoring its schedule. Only use when the " +
        "user clearly asks to post now.",
      parameters: {
        type: "object",
        properties: {
          videoId: { type: "number" },
          onlyFailed: {
            type: "boolean",
            description: "Retry only the accounts that previously failed.",
          },
        },
        required: ["videoId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "retry_video",
      description: "Re-run a failed video from the stage it failed at.",
      parameters: {
        type: "object",
        properties: { videoId: { type: "number" } },
        required: ["videoId"],
      },
    },
  },
];

/* ---------------------------------------------------------- tool bodies */

// The client sends its UTC offset so "Friday 9am" means the user's Friday.
// offsetMinutes is minutes AHEAD of UTC (UTC+2 sends 120), so the wall-clock
// time has to be moved back by it to get the actual instant: 09:00 in UTC+2
// is 07:00Z.
// Does this reply announce work rather than report it? Two shapes: an
// intention followed by a doing-word ("I'll schedule those for Friday"), and
// a bare stall ("one moment", "on it"). Past tense is deliberately not
// matched - "I've scheduled them" is a report, and the caller only asks
// about this when nothing was actually changed.
const INTENT_THEN_VERB = new RegExp(
  "\\b(i'?ll|i will|let me|i'?m going to|i am going to|going to|i can|shall i just)\\b" +
    "[^.!?]{0,90}\\b(" +
    "schedul|creat|generat|plan|mak|add|delet|remov|mov|edit|updat|post|render|" +
    "regenerat|re-?run|retry|queue|" +
    // "set it up", "sort that out" - the verb and its particle get separated
    // by whatever is being acted on.
    "set(?:\\s+\\w+){0,2}\\s+up|sort(?:\\s+\\w+){0,2}\\s+out|put(?:\\s+\\w+){0,2}\\s+together" +
    ")",
  "i"
);
const BARE_STALL =
  /\b(one moment|just a moment|give me a (?:sec|second|moment)|hold on|on it|right away|working on it|starting now|proceeding|stand by)\b/i;

export function promisesAction(text) {
  const reply = String(text || "").trim();
  if (!reply) return false;
  // A question is a question, even when it contains "I'll".
  if (reply.endsWith("?")) return false;
  return INTENT_THEN_VERB.test(reply) || BARE_STALL.test(reply);
}

function slotFor(date, time, offsetMinutes) {
  const [h, m] = String(time || "09:00").split(":").map(Number);
  const [y, mo, d] = String(date).split("-").map(Number);
  if (!y || !mo || !d) throw new Error(`"${date}" is not a valid date`);
  return Date.UTC(y, mo - 1, d, h || 0, m || 0) - offsetMinutes * 60000;
}

// The same conversion the other way. Every timestamp handed back to the model
// goes through this: the prompt tells it today's date in the user's timezone,
// so a UTC stamp alongside that is not just unhelpful but wrong - a video at
// 9pm on the 18th in New York is the 19th in UTC, and the model will say the
// 18th is empty because that is exactly what the data told it.
function localStamp(ms, offsetMinutes) {
  if (!ms) return null;
  const shifted = new Date(Number(ms) + offsetMinutes * 60000);
  return {
    date: shifted.toISOString().slice(0, 10),
    time: shifted.toISOString().slice(11, 16),
  };
}

// "2026-08-18 21:00" - one string for the model to quote back, unambiguous
// because the prompt tells it every time it sees is the user's own.
function localLabel(ms, offsetMinutes) {
  const stamp = localStamp(ms, offsetMinutes);
  return stamp ? `${stamp.date} ${stamp.time}` : null;
}

// An option list can come back as ["Casual", ...] or as [{label, hint}, ...]
// depending on how literally the model read the schema; both mean the same
// thing to the user, so both are accepted.
function normalizeOptions(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map((option) => (typeof option === "string" ? { label: option } : option))
    .map((option) => ({
      label: String(option?.label ?? "").trim().slice(0, 60),
      hint: option?.hint ? String(option.hint).trim().slice(0, 140) : undefined,
    }))
    .filter((option) => option.label)
    .slice(0, MAX_OPTIONS);
}

// Which format a video is actually made in, in order of authority:
//
//   1. What the user said. "Make it a slideshow" is the most explicit signal
//      there is, and it beats every setting - including a switch they left
//      on yesterday.
//   2. The composer's Video/Slideshow switch, which is their own setting
//      sitting on screen as they type. It beats anything the model inferred.
//   3. What the model asked for.
//   4. The workspace default.
//
// Getting this wrong is expensive and invisible until the render finishes:
// an avatar job goes to HeyGen and looks nothing like what was asked for.
function resolveFormat(requested, brief, ctx) {
  const said = spokenFormat(brief);
  if (said) return said;
  if (ctx.outputFormat) return ctx.outputFormat;
  if (requested === "slideshow" || requested === "avatar") return requested;
  return config.ugc.format === "slideshow" ? "slideshow" : "avatar";
}

// A format named in the brief itself, in the words people actually use.
function spokenFormat(brief) {
  const text = String(brief || "");
  if (/slide\s?show|\bslides\b|image ad|picture ad/i.test(text)) return "slideshow";
  if (/\bavatar\b|talking head|person talking to camera/i.test(text)) return "avatar";
  return "";
}

const IMPLEMENTATIONS = {
  // Does not touch the workspace: it parks the question on ctx, and the loop
  // hands it to the client instead of running another round.
  async ask_user({ question, options, allowMultiple }, ctx) {
    const text = String(question || "").trim().slice(0, 200);
    if (!text) throw new Error("A question is required");

    const choices = normalizeOptions(options);
    if (choices.length < 2) throw new Error("Give at least two options to choose from");
    if (ctx.questions.length >= MAX_QUESTIONS) {
      throw new Error(`Ask at most ${MAX_QUESTIONS} questions at a time`);
    }

    ctx.questions.push({
      question: text,
      options: choices,
      allowMultiple: Boolean(allowMultiple),
    });
    return { asked: true };
  },

  async plan_videos({ brief, dates, time, productUrl, platforms, tone, style, format, angle, slides }, ctx) {
    const slots = (dates || []).map((d) => slotFor(d, time, ctx.offsetMinutes));
    if (!slots.length) throw new Error("No dates given");
    if (slots.length > 30) throw new Error("That is more than 30 videos - narrow the range");

    const resolvedUrl = String(productUrl || ctx.productUrl || "").trim();

    const settings = {
      tone: toneOptions().includes(tone) ? tone : "casual",
      style: styleOptions().includes(style) ? style : "product_pov",
      // Empty/omitted platforms means every connected account - store that
      // list so the calendar never shows "No platform".
      platforms: await resolveTargetPlatforms(platforms),
      format: resolveFormat(format, brief, ctx),
    };
    if (settings.format === "slideshow") {
      if (slideshowAngles().includes(angle)) settings.angle = angle;
      const count = Number(slides);
      if (Number.isInteger(count) && count >= 3 && count <= 10) settings.slides = count;
    }

    const plan = await planContent({
      brief,
      count: slots.length,
      productUrl: resolvedUrl,
      tone: settings.tone,
      style: settings.style,
    });

    const now = Date.now();
    const created = [];
    for (const [i, concept] of plan.concepts.entries()) {
      const scheduledAt = slots[i] > now ? slots[i] : now + 60000;
      const row = await q1(
        `INSERT INTO ugc_jobs (product_url, settings_json, status, auto_post, title,
           brief, concept_json, scheduled_at, created_at, updated_at)
         VALUES (?, ?, 'queued', 1, ?, ?, ?, ?, ?, ?) RETURNING id`,
        [
          resolvedUrl,
          JSON.stringify(settings),
          concept.title, brief || null, JSON.stringify(concept), scheduledAt, now, now,
        ]
      );
      enqueueUgcJob(row.id);
      created.push({ id: row.id, title: concept.title, angle: concept.angle, scheduledAt });
    }
    ctx.changed = true;
    return {
      scheduled: created.length,
      videos: created,
      format: settings.format,
      tone: settings.tone,
      style: settings.format === "slideshow" ? undefined : settings.style,
      angle: settings.angle,
    };
  },

  async list_videos({ status = "all", limit = 20, date = "", fromDate = "", toDate = "" }, ctx) {
    const cap = Math.min(50, Math.max(1, Number(limit) || 20));
    const filters = {
      scheduled: "status <> 'posted' AND scheduled_at IS NOT NULL",
      posted: "status = 'posted'",
      failed: "status = 'failed'",
      ready: "status = 'ready'",
      all: "",
    };

    // A day filter is a local day, so it becomes the UTC window that day
    // covers for this user rather than a string comparison that would slice
    // the day at the wrong hour.
    const where = [];
    const params = [];
    if (filters[status]) where.push(filters[status]);

    const from = date || fromDate;
    const to = date || toDate;
    if (from || to) {
      const start = from ? slotFor(from, "00:00", ctx.offsetMinutes) : null;
      const end = to ? slotFor(to, "00:00", ctx.offsetMinutes) + 86400000 : null;
      if (start !== null) {
        where.push("COALESCE(scheduled_at, created_at) >= ?");
        params.push(start);
      }
      if (end !== null) {
        where.push("COALESCE(scheduled_at, created_at) < ?");
        params.push(end);
      }
    }

    const jobs = await q(
      `SELECT id, title, status, scheduled_at, created_at, error, brief
       FROM ugc_jobs ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY COALESCE(scheduled_at, created_at) DESC LIMIT ?`,
      [...params, cap]
    );

    const views = await q(
      `SELECT p.job_id, COALESCE(SUM(m.views), 0) AS views
       FROM ugc_posts p LEFT JOIN post_metrics m ON m.post_id = p.id AND m.collected_at = (
         SELECT MAX(m2.collected_at) FROM post_metrics m2 WHERE m2.post_id = p.id
       ) GROUP BY p.job_id`
    );
    const viewsByJob = Object.fromEntries(views.map((v) => [v.job_id, Number(v.views || 0)]));

    return {
      count: jobs.length,
      // Dates are the user's local ones, matching the date in the prompt.
      videos: jobs.map((j) => {
        const at = localStamp(j.scheduled_at || j.created_at, ctx.offsetMinutes);
        return {
          id: j.id,
          title: j.title || "Untitled",
          status: j.status,
          scheduled: Boolean(j.scheduled_at),
          date: at?.date ?? null,
          time: at?.time ?? null,
          views: viewsByJob[j.id] ?? 0,
          error: j.error || undefined,
        };
      }),
    };
  },

  async get_analytics({ days = 30, platform = null }) {
    const since = Date.now() - Math.max(1, Number(days) || 30) * 86400000;
    const totals = await totalsSince(since, platform);
    const accounts = await accountLeaderboard(5);
    const perPlatform = await viewsByPlatform();
    return {
      periodDays: Number(days) || 30,
      platform: platform || "all",
      totals,
      viewsByPlatform: perPlatform,
      topAccounts: accounts.map((a) => ({
        platform: a.platform, name: a.displayName, views: a.views,
      })),
      note:
        totals.posts === 0
          ? "No posts have metrics yet - either nothing has been published or the collector has not run."
          : undefined,
    };
  },

  async list_accounts() {
    const rows = await q("SELECT platform, display_name FROM accounts ORDER BY platform");
    const byPlatform = {};
    for (const r of rows) (byPlatform[r.platform] ??= []).push(r.display_name);
    return {
      connected: byPlatform,
      total: rows.length,
      configuredButUnconnected: ENABLED_PLATFORMS.filter((p) => !byPlatform[p]),
    };
  },

  async reschedule_video({ videoId, date, time }, ctx) {
    const when = slotFor(date, time, ctx.offsetMinutes);
    if (when <= Date.now()) throw new Error("That time has already passed");
    if (!(await reschedule(videoId, when))) {
      throw new Error("That video has already been posted, so it cannot be moved");
    }
    ctx.changed = true;
    return { videoId, scheduledFor: localLabel(when, ctx.offsetMinutes) };
  },

  async edit_video({ videoId, title, caption, hashtags, platforms }, ctx) {
    const job = await q1("SELECT * FROM ugc_jobs WHERE id = ?", [videoId]);
    if (!job) throw new Error(`No video with id ${videoId}`);

    const updated = [];
    const skipped = [];

    if (typeof title === "string") {
      await dbRun("UPDATE ugc_jobs SET title = ?, updated_at = ? WHERE id = ?",
        [title.slice(0, 120), Date.now(), videoId]);
      updated.push("title");
    }

    if (typeof caption === "string" || typeof hashtags === "string") {
      // Caption and hashtags live inside the generated script. A video that
      // hasn't been scripted yet has nowhere to put them, and writing a stub
      // would stop the pipeline generating one - so those fields are reported
      // as skipped rather than swallowed.
      const script = JSON.parse(job.script_json || "null");
      if (!script) {
        if (typeof caption === "string") skipped.push("caption");
        if (typeof hashtags === "string") skipped.push("hashtags");
      } else {
        if (typeof caption === "string") {
          script.caption = caption.slice(0, 2200);
          updated.push("caption");
        }
        if (typeof hashtags === "string") {
          script.hashtags = hashtags.split(/[\s,]+/).filter(Boolean)
            .map((t) => (t.startsWith("#") ? t : `#${t}`)).slice(0, 30);
          updated.push("hashtags");
        }
        await dbRun("UPDATE ugc_jobs SET script_json = ?, updated_at = ? WHERE id = ?",
          [JSON.stringify(script), Date.now(), videoId]);
      }
    }

    if (Array.isArray(platforms)) {
      const wanted = platforms.filter((p) => ENABLED_PLATFORMS.includes(p));
      if (!wanted.length) throw new Error("None of those are platforms this workspace can post to");
      const settings = JSON.parse(job.settings_json || "{}");
      settings.platforms = wanted;
      await dbRun("UPDATE ugc_jobs SET settings_json = ?, updated_at = ? WHERE id = ?",
        [JSON.stringify(settings), Date.now(), videoId]);
      updated.push("platforms");
    }

    if (!updated.length && !skipped.length) throw new Error("Nothing to change was given");

    ctx.changed = true;
    return {
      videoId,
      updated,
      skipped: skipped.length ? skipped : undefined,
      note: skipped.length
        ? "That video hasn't been scripted yet, so it has no caption to edit - " +
          "the caption is written when the video generates."
        : job.status === "posted"
          ? "This video has already been published, so the change only affects the record here."
          : undefined,
    };
  },

  async regenerate_video({ videoId, brief, tone, style, format, angle }, ctx) {
    const job = await q1("SELECT * FROM ugc_jobs WHERE id = ?", [videoId]);
    if (!job) throw new Error(`No video with id ${videoId}`);
    if (job.status === "posted") {
      throw new Error("That video has already gone out - plan a new one instead of re-rendering it");
    }
    if (BUSY_STATUSES.includes(job.status)) {
      throw new Error("That video is still generating - wait for it to finish");
    }

    // New direction, when given, replaces the brief and the planned concept's
    // angle so the rewritten script actually follows it.
    const applied = [];
    if (typeof brief === "string" && brief.trim()) {
      const text = brief.trim().slice(0, 2000);
      const concept = JSON.parse(job.concept_json || "null");
      if (concept) concept.angle = text;
      await dbRun(
        "UPDATE ugc_jobs SET brief = ?, concept_json = ?, updated_at = ? WHERE id = ?",
        [text, concept ? JSON.stringify(concept) : job.concept_json, Date.now(), videoId]
      );
      applied.push("brief");
    }
    const wantsFormat = format === "avatar" || format === "slideshow";
    if (toneOptions().includes(tone) || styleOptions().includes(style) || wantsFormat
        || slideshowAngles().includes(angle)) {
      const settings = JSON.parse(job.settings_json || "{}");
      if (toneOptions().includes(tone)) { settings.tone = tone; applied.push("tone"); }
      if (styleOptions().includes(style)) { settings.style = style; applied.push("style"); }
      if (wantsFormat) { settings.format = format; applied.push("format"); }
      if (slideshowAngles().includes(angle)) { settings.angle = angle; applied.push("angle"); }
      await dbRun("UPDATE ugc_jobs SET settings_json = ?, updated_at = ? WHERE id = ?",
        [JSON.stringify(settings), Date.now(), videoId]);
    }

    // Same reset the Recent page's regenerate does: script and render are
    // thrown away, the slot is kept, and the job goes back on the queue.
    await deleteJobFiles(job);
    await dbRun("DELETE FROM ugc_posts WHERE job_id = ?", [videoId]);
    await dbRun(
      `UPDATE ugc_jobs SET status = 'queued', error = NULL, script_json = NULL,
         video_filename = NULL, updated_at = ? WHERE id = ?`,
      [Date.now(), videoId]
    );
    enqueueUgcJob(videoId);

    ctx.changed = true;
    return {
      videoId,
      regenerating: true,
      applied,
      scheduledFor: localLabel(job.scheduled_at, ctx.offsetMinutes),
    };
  },

  async delete_video({ videoIds, confirm }, ctx) {
    const ids = [...new Set(
      (Array.isArray(videoIds) ? videoIds : [videoIds])
        .map(Number)
        .filter((id) => Number.isInteger(id) && id > 0)
    )];
    if (!ids.length) throw new Error("Give the id of the video to delete");
    if (ids.length > MAX_DELETE) {
      throw new Error(`Delete at most ${MAX_DELETE} videos at a time`);
    }
    if (confirm !== true) {
      throw new Error(
        "Deleting is permanent. Ask the user to confirm, naming what would go, " +
        "then call this again with confirm true."
      );
    }

    const deleted = [];
    const missing = [];
    const published = [];
    for (const id of ids) {
      const job = await q1("SELECT * FROM ugc_jobs WHERE id = ?", [id]);
      if (!job) { missing.push(id); continue; }

      const live = Number(
        (await q1("SELECT COUNT(*) AS n FROM ugc_posts WHERE job_id = ? AND status = 'done'", [id]))?.n || 0
      );
      if (live) published.push(id);

      await deleteJobFiles(job);
      await dbRun("DELETE FROM ugc_posts WHERE job_id = ?", [id]);
      await dbRun("DELETE FROM ugc_jobs WHERE id = ?", [id]);
      deleted.push({ id, title: job.title || `Video #${id}` });
    }

    ctx.changed = true;
    return {
      deleted,
      missing: missing.length ? missing : undefined,
      note: published.length
        ? `${published.length} of those were already published - deleting them here ` +
          "removes them from Postfin but does not take them down from the platform."
        : undefined,
    };
  },

  async post_video_now({ videoId, onlyFailed }, ctx) {
    const result = await postJob(videoId, { onlyFailed: Boolean(onlyFailed) });
    ctx.changed = true;
    return result;
  },

  async retry_video({ videoId }, ctx) {
    const job = await q1("SELECT status FROM ugc_jobs WHERE id = ?", [videoId]);
    if (!job) throw new Error(`No video with id ${videoId}`);
    if (job.status !== "failed") throw new Error("Only failed videos can be retried");
    await dbRun("UPDATE ugc_jobs SET status = 'queued', error = NULL, updated_at = ? WHERE id = ?",
      [Date.now(), videoId]);
    enqueueUgcJob(videoId);
    ctx.changed = true;
    return { videoId, requeued: true };
  },
};

/* ----------------------------------------------------------------- loop */

const VISION_MIME = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};
const MAX_DATA_URL_BYTES = 4 * 1024 * 1024;

// OpenAI has to fetch http(s) image URLs itself. Uploads live on this
// server, so inline them as data URLs rather than hoping their crawler
// can reach Railway.
function visionImageUrl(src) {
  try {
    const parsed = new URL(String(src), config.baseUrl);
    const match = parsed.pathname.match(/\/ugc-media\/uploads\/([^/]+)$/);
    if (!match) return src;
    const file = path.join(config.ugcDir, "uploads", path.basename(match[1]));
    if (!fs.existsSync(file)) return src;
    const buf = fs.readFileSync(file);
    if (!buf.length || buf.length > MAX_DATA_URL_BYTES) return src;
    const mime = VISION_MIME[path.extname(file).toLowerCase()] || "image/jpeg";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return src;
  }
}

function visionUserContent(text, images, { asProduct = false } = {}) {
  const urls = (images || []).map(visionImageUrl).filter(Boolean);
  if (!urls.length) return text;
  const note = asProduct
    ? "A product photo is attached. You can see it. Use what is actually in the image."
    : "A screenshot or reference image is attached. You can see it. It is not automatically the product — only extra context unless the user says it is the product.";
  return [
    { type: "text", text: `${text}\n\n${note}` },
    ...urls.map((url) => ({ type: "image_url", image_url: { url, detail: "low" } })),
  ];
}

function systemPrompt(ctx) {
  const today = new Date(Date.now() + ctx.offsetMinutes * 60000).toISOString().slice(0, 10);
  return [
    "You are the assistant inside Postfin, a tool that generates short-form " +
      "UGC videos and publishes them to the user's social accounts.",
    // The summary the model reads first is the one it answers "can you...?"
    // from, so it lists what the tools actually do rather than a sample of it.
    "You help with anything in their workspace: planning and scheduling videos, " +
      "reporting on how posts are performing, checking what is scheduled, fixing " +
      "failures, editing videos that are already scheduled - their title, caption, " +
      "hashtags and platforms - re-rendering them, moving them to another day, and " +
      "deleting them.",
    "You have a tool for every one of those, so never tell the user you cannot do " +
      "one of them or send them off to another page to do it themselves. The only " +
      "things genuinely outside your reach are taking down a post that has already " +
      "been published, and connecting a social account.",
    `Today is ${today} in the user's timezone. Resolve relative dates like ` +
      '"next week" or "Friday" against that, and always pass dates as YYYY-MM-DD.',
    ctx.selectedDates?.length
      ? `The user has these days selected on the calendar: ${ctx.selectedDates.join(", ")}. ` +
        "Use them when they ask for videos without naming dates."
      : "The user has no days selected on the calendar. If they ask for videos " +
        "without naming dates, pick sensible upcoming dates and say which you chose.",
    ctx.productUrl
      ? `The user selected this product for the current chat: ${ctx.productName || "product"} (${ctx.productUrl}). ` +
        "When planning videos, pass that URL as productUrl unless they ask for a different product."
      : "No product is selected in the chat picker. Plan from the brief alone unless they paste a product URL.",
    ctx.attachedImages?.length
      ? "The user attached a screenshot or reference image to their latest message — you CAN see it. " +
        "It is NOT automatically the product. Treat it as extra context (a screenshot, mock, example, or note) " +
        "unless they clearly say that image IS the product."
      : null,
    ctx.accounts
      ? `Connected accounts: ${ctx.accounts}.`
      : "No social accounts are connected yet - videos will generate but cannot publish.",
    "Use the tools rather than guessing. Never invent view counts, dates or video " +
      "ids: read them with a tool first. Every date a tool gives you is already " +
      "in the user's timezone - use it as-is and never convert it.",
    // Asking "which one?" when the workspace holds exactly one answer is the
    // fastest way to look broken.
    "Never ask a question a tool can answer. When the user points at a video - " +
      "'the one on August 18', 'the failed one', 'my last video' - call " +
      "list_videos with that day or status first. If exactly one video matches, " +
      "that is the one they mean: act on it, naming it back to them. Only ask " +
      "which they meant when more than one genuinely matches, and then the " +
      "options must be the actual videos, each with its title and date.",
    "If a video failed, say what it failed with. list_videos returns the error " +
      "on each video - quote it in plain words rather than saying it failed.",
    // Asking beats guessing on the one action that costs a render and lands on
    // a public account, so this is a rule rather than a suggestion.
    "Before generating videos, make sure you know what to make. If the request " +
      "leaves anything material open - what the videos are about, the format, " +
      "the tone, the style or angle, which platforms, which days - call ask_user " +
      "with up to three multiple-choice questions and stop there. Every option " +
      "must be a real choice the user can act on, drawn from this workspace: the " +
      `tones are ${toneOptions().join(", ")}, the avatar styles are ` +
      `${styleOptions().join(", ")}, the slideshow angles are ` +
      `${slideshowAngles().join(", ")}, and the platforms are ` +
      `${ENABLED_PLATFORMS.join(", ")}.`,
    // The composer has its own format switch; when it is set the question is
    // already answered and asking again would be noise.
    ctx.outputFormat === "slideshow"
      ? "The user has the composer set to slideshow generation: plan slideshows " +
        "unless they ask for something else, and do not ask which format they want."
      : ctx.outputFormat === "avatar"
        ? "The user has the composer set to video generation: plan avatar videos " +
          "unless they ask for a slideshow, and do not ask which format they want."
        : null,
    // The format is the first real decision and the user rarely states it.
    "There are two formats. An avatar video is a person talking to camera - it " +
      "suits a physical product someone can hold. A slideshow is images cutting " +
      "every few seconds under big on-screen text with a voiceover - it is how " +
      "software, apps, tool comparisons and money-method videos are advertised, " +
      "and it is the only format that works when there is nothing to film. When " +
      "the subject is software or a method rather than an object, offer the " +
      "slideshow first and say why. Slideshows also take an angle: " +
      `${slideshowAngles().join(", ")}.`,
    "Ask once per request, not repeatedly. Never ask about something the user " +
      "already told you, and if they say you should pick, or leave part of it " +
      "open, choose sensible defaults, say what you chose, and get on with it.",
    "You can change videos that are already scheduled: edit_video for the title, " +
      "caption, hashtags or platforms, regenerate_video to rewrite and re-render " +
      "the video itself - including switching it between the two formats - and " +
      "reschedule_video to move its slot.",
    "delete_video is permanent. Always confirm first with ask_user - the question " +
      "names the video and its date ('Delete \"Shower Power Boost\", scheduled " +
      "Aug 18?'), the options are to delete or keep, and only after they choose " +
      "to delete do you call it with confirm true. Deleting a video that has already been published " +
      "does not remove it from the platform - say so when it applies.",
    "Never announce work you have not done. If you can act, call the tool in " +
      "the same reply and then report it in the past tense - 'I'll schedule " +
      "that' followed by nothing is the one answer that is always wrong. If " +
      "something is missing, ask for it instead of promising.",
    "Be brief and concrete. Plain sentences, no headings. When you schedule " +
      "something, say what and when in one line. When you ask a question, write " +
      "one short line - the options are shown as buttons, so do not list them " +
      "again in your reply.",
  ].filter(Boolean).join(" ");
}

// Runs the tool-calling loop and returns the assistant's reply plus a note
// of what it actually did.
export async function runAssistant({
  messages, selectedDates = [], offsetMinutes = 0, productUrl = "", outputFormat = "",
  imageUrls = [],
}) {
  if (!assistantAvailable()) {
    throw new Error("The assistant needs an OpenAI key - set OPENAI_API_KEY");
  }

  const accountRows = await q("SELECT platform, display_name FROM accounts ORDER BY platform");
  let productName = "";
  let productImages = [];
  if (productUrl) {
    const saved = await q1("SELECT product_json FROM products WHERE url = ?", [productUrl]);
    if (saved?.product_json) {
      try {
        const parsed = JSON.parse(saved.product_json);
        productName = parsed?.name || "";
        productImages = (Array.isArray(parsed?.images) ? parsed.images : [])
          .filter((u) => typeof u === "string" && u)
          .slice(0, 4);
      } catch {
        productName = "";
      }
    }
  }
  const attachedImages = (Array.isArray(imageUrls) ? imageUrls : [])
    .filter((u) => typeof u === "string" && u)
    .slice(0, 4);
  const ctx = {
    offsetMinutes,
    selectedDates,
    productUrl: productUrl || "",
    productName,
    productImages,
    attachedImages,
    // The composer's own format switch. When it is set, it is an answer the
    // user has already given, so the assistant uses it instead of asking.
    outputFormat: outputFormat === "slideshow" ? "slideshow" : outputFormat === "avatar" ? "avatar" : "",
    changed: false,
    questions: [],
    accounts: accountRows.map((a) => `${a.platform} (${a.display_name})`).join(", "),
  };

  const history = messages
    .filter((m) => m && typeof m.content === "string" && ["user", "assistant"].includes(m.role))
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content }));

  const lastUser = [...history].reverse().find((m) => m.role === "user");
  if (lastUser) {
    const vision = [...attachedImages, ...productImages.filter((u) => !attachedImages.includes(u))].slice(0, 4);
    if (vision.length) {
      lastUser.content = visionUserContent(lastUser.content, vision, {
        asProduct: attachedImages.length === 0 && productImages.length > 0,
      });
    }
  }

  const thread = [{ role: "system", content: systemPrompt(ctx) }, ...history];
  const actions = [];
  // Only ever nudged once - if it still only talks after being told, its
  // answer stands rather than the loop spinning.
  let nudged = false;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await fetch(`${config.openaiApiBase}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.openaiChatModel,
        temperature: 0.4,
        messages: thread,
        tools: TOOLS,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(`Assistant failed (${res.status}): ${JSON.stringify(data).slice(0, 300)}`);
    }

    const message = data.choices?.[0]?.message;
    if (!message) throw new Error("The assistant returned nothing");

    if (!message.tool_calls?.length) {
      // "Sure, I'll schedule that now." and then nothing - the single most
      // annoying thing a tool-calling model does, because the user has to
      // ask again to get work that was never started. A promise is not an
      // answer: push it back and make it act in the same turn.
      if (!nudged && !ctx.changed && promisesAction(message.content) && round < MAX_TOOL_ROUNDS - 1) {
        nudged = true;
        thread.push(message);
        thread.push({
          role: "user",
          content:
            "You said you would do that but did not call a tool, so nothing " +
            "happened. Do it now, in this reply, by calling the tool - then " +
            "report what you did in the past tense. If you cannot, say what is " +
            "missing instead of saying you will do it.",
        });
        continue;
      }
      return { reply: message.content || "", actions, changed: ctx.changed, questions: [] };
    }

    thread.push(message);
    for (const call of message.tool_calls) {
      const impl = IMPLEMENTATIONS[call.function?.name];
      let result;
      try {
        if (!impl) throw new Error(`Unknown tool ${call.function?.name}`);
        const args = JSON.parse(call.function.arguments || "{}");
        result = await impl(args, ctx);
        actions.push({ name: call.function.name, ok: true, result });
      } catch (err) {
        // Hand the failure back to the model so it can explain or retry,
        // rather than collapsing the whole turn.
        result = { error: String(err.message || err) };
        actions.push({ name: call.function?.name, ok: false, error: result.error });
      }
      thread.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result).slice(0, 6000),
      });
    }

    // A question ends the turn: there is nothing more the model can usefully
    // decide until the user answers, and their answer arrives as an ordinary
    // message on the next turn.
    if (ctx.questions.length) {
      return {
        reply: message.content?.trim() || ctx.questions.map((entry) => entry.question).join("\n"),
        questions: ctx.questions,
        actions,
        changed: ctx.changed,
      };
    }
  }

  return {
    reply: "That needed more steps than I can take in one go - try narrowing the request.",
    actions,
    changed: ctx.changed,
    questions: [],
  };
}
