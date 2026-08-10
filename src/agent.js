import config, { PLATFORM_NAMES, ENABLED_PLATFORMS } from "./config.js";
import { q, q1, run as dbRun } from "./db.js";
import { resolveTargetPlatforms } from "./accounts.js";
import { planContent } from "./ugc/plan.js";
import { enqueueUgcJob, postJob } from "./ugc/pipeline.js";
import { reschedule } from "./schedule.js";
import { totalsSince, accountLeaderboard, viewsByPlatform } from "./metrics.js";

// The calendar assistant.
//
// A tool-calling loop over the operator's own workspace: it can plan and
// schedule videos, but also answer questions about what is scheduled, how
// posts are performing, which accounts are connected, and make small edits.
//
// Deleting is deliberately NOT a tool. It is the one irreversible action
// here, and a model acting on a loosely worded instruction should not be
// able to destroy work - the Recent page has an explicit delete button.

const MAX_TOOL_ROUNDS = 6;
const MAX_HISTORY = 20;

export function assistantAvailable() {
  return Boolean(config.openaiApiKey);
}

/* ---------------------------------------------------------------- tools */

const TOOLS = [
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
        },
        required: ["brief", "dates"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_videos",
      description:
        "List the user's videos with their status, schedule and view counts. " +
        "Use to answer questions about what is scheduled or what failed.",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["all", "scheduled", "posted", "failed", "ready"],
            description: "Filter by state. 'scheduled' means not yet published.",
          },
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
      description: "Change a video's title, caption or hashtags.",
      parameters: {
        type: "object",
        properties: {
          videoId: { type: "number" },
          title: { type: "string" },
          caption: { type: "string" },
          hashtags: { type: "string", description: "Space-separated hashtags." },
        },
        required: ["videoId"],
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
function slotFor(date, time, offsetMinutes) {
  const [h, m] = String(time || "09:00").split(":").map(Number);
  const [y, mo, d] = String(date).split("-").map(Number);
  if (!y || !mo || !d) throw new Error(`"${date}" is not a valid date`);
  return Date.UTC(y, mo - 1, d, h || 0, m || 0) - offsetMinutes * 60000;
}

const IMPLEMENTATIONS = {
  async plan_videos({ brief, dates, time, productUrl, platforms }, ctx) {
    const slots = (dates || []).map((d) => slotFor(d, time, ctx.offsetMinutes));
    if (!slots.length) throw new Error("No dates given");
    if (slots.length > 30) throw new Error("That is more than 30 videos - narrow the range");

    const resolvedUrl = String(productUrl || ctx.productUrl || "").trim();
    const plan = await planContent({
      brief, count: slots.length, productUrl: resolvedUrl,
    });

    // Prefer the tool args; fall back to the chat platform picker.
    // Empty/omitted means every connected account — store that list so the
    // calendar never shows "No platform".
    const wanted = await resolveTargetPlatforms(
      (Array.isArray(platforms) && platforms.length) ? platforms : ctx.platforms
    );
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
          JSON.stringify({
            tone: "casual",
            style: "product_pov",
            platforms: wanted,
            outputFormat: ctx.outputFormat === "slideshow" ? "slideshow" : "video",
          }),
          concept.title, brief || null, JSON.stringify(concept), scheduledAt, now, now,
        ]
      );
      enqueueUgcJob(row.id);
      created.push({ id: row.id, title: concept.title, angle: concept.angle, scheduledAt });
    }
    ctx.changed = true;
    return { scheduled: created.length, videos: created };
  },

  async list_videos({ status = "all", limit = 20 }, ctx) {
    const cap = Math.min(50, Math.max(1, Number(limit) || 20));
    const filters = {
      scheduled: "WHERE status <> 'posted' AND scheduled_at IS NOT NULL",
      posted: "WHERE status = 'posted'",
      failed: "WHERE status = 'failed'",
      ready: "WHERE status = 'ready'",
      all: "",
    };
    const jobs = await q(
      `SELECT id, title, status, scheduled_at, created_at, error, brief
       FROM ugc_jobs ${filters[status] ?? ""}
       ORDER BY COALESCE(scheduled_at, created_at) DESC LIMIT ?`,
      [cap]
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
      videos: jobs.map((j) => ({
        id: j.id,
        title: j.title || "Untitled",
        status: j.status,
        scheduledFor: j.scheduled_at ? new Date(Number(j.scheduled_at)).toISOString() : null,
        views: viewsByJob[j.id] ?? 0,
        error: j.error || undefined,
      })),
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
    return { videoId, scheduledFor: new Date(when).toISOString() };
  },

  async edit_video({ videoId, title, caption, hashtags }, ctx) {
    const job = await q1("SELECT * FROM ugc_jobs WHERE id = ?", [videoId]);
    if (!job) throw new Error(`No video with id ${videoId}`);

    if (typeof title === "string") {
      await dbRun("UPDATE ugc_jobs SET title = ?, updated_at = ? WHERE id = ?",
        [title.slice(0, 120), Date.now(), videoId]);
    }
    if (typeof caption === "string" || typeof hashtags === "string") {
      const script = JSON.parse(job.script_json || "null");
      if (!script) throw new Error("That video's script has not been written yet");
      if (typeof caption === "string") script.caption = caption.slice(0, 2200);
      if (typeof hashtags === "string") {
        script.hashtags = hashtags.split(/[\s,]+/).filter(Boolean)
          .map((t) => (t.startsWith("#") ? t : `#${t}`)).slice(0, 30);
      }
      await dbRun("UPDATE ugc_jobs SET script_json = ?, updated_at = ? WHERE id = ?",
        [JSON.stringify(script), Date.now(), videoId]);
    }
    ctx.changed = true;
    return { videoId, updated: true };
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

function systemPrompt(ctx) {
  const today = new Date(Date.now() + ctx.offsetMinutes * 60000).toISOString().slice(0, 10);
  return [
    "You are the assistant inside Postfin, a tool that generates short-form " +
      "UGC videos and publishes them to the user's social accounts.",
    "You help with anything in their workspace: planning and scheduling videos, " +
      "reporting on how posts are performing, checking what is scheduled, " +
      "fixing failures, and editing captions.",
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
    ctx.outputFormat === "slideshow"
      ? "The user selected IMAGE / slideshow generation. Plan image slideshow posts, not talking-head videos."
      : "The user selected VIDEO generation. Plan short-form video posts.",
    ctx.platforms?.length
      ? `The user selected these target platforms in the chat picker: ${ctx.platforms.join(", ")}. ` +
        "When planning videos, pass those as platforms unless they ask for different ones."
      : "The user selected All platforms in the chat picker. Omit platforms (post to every connected account) unless they name specific ones.",
    ctx.accounts
      ? `Connected accounts: ${ctx.accounts}.`
      : "No social accounts are connected yet - videos will generate but cannot publish.",
    "Use the tools rather than guessing. Never invent view counts, dates or video " +
      "ids: read them with a tool first.",
    "You cannot delete videos - tell the user to use the delete button on the " +
      "Recent page if they ask.",
    "Be brief and concrete. Plain sentences, no headings. When you schedule " +
      "something, say what and when in one line.",
  ].filter(Boolean).join(" ");
}

// Runs the tool-calling loop and returns the assistant's reply plus a note
// of what it actually did.
export async function runAssistant({
  messages, selectedDates = [], offsetMinutes = 0, productUrl = "",
  outputFormat = "video", platforms = [],
}) {
  if (!assistantAvailable()) {
    throw new Error("The assistant needs an OpenAI key - set OPENAI_API_KEY");
  }

  const accountRows = await q("SELECT platform, display_name FROM accounts ORDER BY platform");
  let productName = "";
  if (productUrl) {
    const saved = await q1("SELECT product_json FROM products WHERE url = ?", [productUrl]);
    if (saved?.product_json) {
      try {
        productName = JSON.parse(saved.product_json)?.name || "";
      } catch {
        productName = "";
      }
    }
  }
  const pickedPlatforms = [...new Set(
    (Array.isArray(platforms) ? platforms : [])
      .map((p) => String(p || "").toLowerCase())
      .filter((p) => ENABLED_PLATFORMS.includes(p))
  )];
  const ctx = {
    offsetMinutes,
    selectedDates,
    productUrl: productUrl || "",
    productName,
    outputFormat: outputFormat === "slideshow" ? "slideshow" : "video",
    platforms: pickedPlatforms,
    changed: false,
    accounts: accountRows.map((a) => `${a.platform} (${a.display_name})`).join(", "),
  };

  const history = messages
    .filter((m) => m && typeof m.content === "string" && ["user", "assistant"].includes(m.role))
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content }));

  const thread = [{ role: "system", content: systemPrompt(ctx) }, ...history];
  const actions = [];

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
      return { reply: message.content || "", actions, changed: ctx.changed };
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
  }

  return {
    reply: "That needed more steps than I can take in one go - try narrowing the request.",
    actions,
    changed: ctx.changed,
  };
}
