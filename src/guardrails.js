import config from "./config.js";

// Guardrails for the calendar assistant.
//
// The assistant is not a chatbot in a sandbox: behind it are tools that spend
// money on renders, mutate the schedule, and publish to the operator's real
// audience under their own name. So what reaches it is bounded on four axes:
//
//   size   - a turn has to fit in a turn, and a conversation in a request;
//   rate   - one operator cannot start an unbounded number of turns;
//   scope  - it plans and reports on this workspace, nothing else;
//   safety - anything it plans ends up published publicly.
//
// Scope is mostly the system prompt's job (see agent.js) because intent is
// fuzzy and regexes over intent produce false refusals. What lives here is
// the part that must not depend on the model behaving: hard limits, a small
// set of high-confidence deny rules, and the moderation endpoint.

export const LIMITS = {
  // One message, and the whole conversation replayed back to us each turn.
  messageChars: 2000,
  conversationChars: 24000,
  messages: 40,

  // Creative input that becomes public video, and the post text itself.
  briefChars: 2000,
  captionChars: 2200,

  // Videos one turn may schedule, and how far out they may land.
  videosPerRequest: 30,
  scheduleDaysAhead: 366,
  scheduleDaysBehind: 1,

  // Tool calls one turn may make, over all rounds.
  toolCallsPerTurn: 12,
  publishesPerTurn: 3,

  // Turns per client, per window.
  turnsPerMinute: 12,
  turnsPerHour: 120,
};

/* ------------------------------------------------------------- deny rules */

// Deliberately narrow. Each rule fires only on wording that has no plausible
// innocent reading inside a social-video planner, because a false refusal
// here is worse than passing something borderline to the model, which has
// its own instructions and no tool for most of this anyway.
//
// `any` fires when one pattern matches; `all` needs every pattern, which is
// how the broad verbs ("show me", "delete") are kept from firing on ordinary
// requests like "delete the Friday video".
const RULES = [
  {
    id: "prompt_injection",
    any: [
      /\b(ignore|disregard|forget|override|bypass)\b[^.?!]{0,40}\b(previous|prior|above|earlier|initial|original|your|all)\b[^.?!]{0,25}\b(instruction|prompt|rule|direction|guideline|restriction)s?\b/i,
      /\b(reveal|show|print|repeat|output|dump|leak|tell me)\b[^.?!]{0,35}\b(system prompt|your (instructions|prompt|rules)|developer message|everything above)\b/i,
      /\b(system prompt|your instructions)\b[^.?!]{0,30}\b(verbatim|word for word|in full)\b/i,
      /\b(dan mode|developer mode|jailbreak|do anything now|unfiltered mode)\b/i,
      /\byou are (now|no longer)\b[^.?!]{0,40}\b(an?\s+)?(unrestricted|uncensored|different|general)\b/i,
      /\b(pretend|act as if)\b[^.?!]{0,30}\byou have no (rules|limits|restrictions|guardrails|filters)\b/i,
    ],
    reply:
      "I can't change how I work or show you my own instructions. Ask me about " +
      "your videos, schedule or accounts and I'll help with that.",
  },
  {
    id: "secrets",
    all: [
      /\b(show|print|give|send|reveal|list|dump|leak|what(?:'s| is| are)|tell me)\b/i,
      /\b(api[ _-]?keys?|secret keys?|access tokens?|refresh tokens?|client secrets?|\.env\b|env(?:ironment)? variables?|admin password|credentials|connection string)\b/i,
    ],
    reply:
      "I don't have access to keys, tokens or environment settings, and I " +
      "wouldn't repeat them here. They live in your server's environment.",
  },
  {
    id: "raw_database",
    any: [
      // Anchored tightly on both ends: "select the best angle from last week"
      // is a normal thing to ask a content planner.
      /\bselect\s+(\*|[\w.]+(?:\s*,\s*[\w.]+)+)\s+from\s+[\w."'`]+\s*(;|where\b|order\s+by\b|group\s+by\b|limit\b|join\b|$)/i,
      /\b(drop|truncate|alter)\s+table\b/i,
      /\bdelete\s+from\s+\w+/i,
      /\bupdate\s+\w+\s+set\s+\w+\s*=/i,
      /\b(run|execute)\b[^.?!]{0,20}\b(sql|query|shell command|this command)\b/i,
    ],
    reply:
      "I can't run SQL or shell commands - I only use the app's own actions " +
      "for planning, scheduling and reporting.",
  },
  {
    id: "mass_deletion",
    all: [
      // \w* on each stem so the inflections ("deleting", "wiping") land too.
      /\b(delet|wip|eras|purg|nuk|destroy|remov)\w*\b/i,
      /\b(all|every|everything|entire|whole)\b[^.?!]{0,25}\b(videos?|posts?|jobs?|accounts?|data|database|workspace|history)\b/i,
    ],
    reply:
      "I can't delete anything, least of all in bulk. Videos are deleted one " +
      "at a time from the Recent page, which is deliberate.",
  },
  {
    id: "impersonation",
    any: [
      /\b(impersonate|impersonating|deep ?fake|voice clone|clone (his|her|their|the ceo'?s?) voice)\b/i,
      /\b(fake|fabricat(e|ed)|invent(ed)?|made[- ]up)\b[^.?!]{0,25}\b(testimonials?|reviews?|endorsements?|customer quotes?|before and afters?)\b/i,
      // Narrow on purpose: "make it sound like a friend recommends it" is an
      // ordinary UGC brief, "make it look like their CEO said it" is not.
      /\b(pretend|make it (look|seem|sound) like)\b[^.?!]{0,40}\b(said|says|endorsed|tweeted|posted|works? (at|for)|an official (statement|partner|account))\b/i,
      /\bpose as\b[^.?!]{0,30}\b(a |an |the )?(doctor|lawyer|nurse|pharmacist|financial advis(o|e)r|official)\b/i,
    ],
    reply:
      "I won't write content that puts words in a real person's or brand's " +
      "mouth, or invents testimonials. Tell me what's actually true about the " +
      "product and I'll build the videos around that.",
  },
  {
    id: "unsupported_claims",
    any: [
      /\b(cures?|curing|treats?|heals?)\b[^.?!]{0,25}\b(cancer|diabetes|autism|hiv|aids|covid|depression|infertility)\b/i,
      /\bmiracle (cure|drug|treatment|pill)\b/i,
      /\bguarantee(d|s)?\b[^.?!]{0,30}\b(returns?|profits?|income|roi|results|weight loss|cure|passive income)\b/i,
      /\b(get rich quick|risk[- ]free (investment|returns?)|(double|triple) your (money|investment|crypto))\b/i,
      /\blose \d+\s*(lbs?|pounds?|kgs?|kilos?)\b[^.?!]{0,25}\bin \d+\s*(day|week)/i,
    ],
    reply:
      "I can't make guaranteed health or money claims - platforms pull that " +
      "content and it puts the accounts at risk. I can write the same idea as " +
      "what the product does and what customers actually report.",
  },
  {
    id: "illicit",
    any: [
      /\b(counterfeit|knock[- ]?off (luxury|designer)|fake (ids?|passports?|documents?|diplomas?))\b/i,
      /\b(stolen (accounts?|cards?|logins?)|carding|cracked accounts?)\b/i,
      /\b(cocaine|meth(amphetamine)?|heroin|fentanyl|mdma)\b/i,
      /\b(ghost gun|untraceable (gun|firearm)|3d[- ]printed (gun|firearm)|silencers?)\b/i,
      /\b(phishing (kit|page|site|email)|malware|ransomware|ddos|hack(ing)? (service|someone'?s? account))\b/i,
      /\b(money laundering|launder (money|funds)|pump and dump)\b/i,
    ],
    reply:
      "I won't make content promoting that. If I've misread what you're " +
      "selling, describe the product plainly and I'll plan the videos.",
  },
  {
    id: "platform_abuse",
    any: [
      // Buying and farming only. "generate more engagement" is the whole
      // point of the product, so the verb list stays off it.
      /\b(buy|buying|purchas\w*|sell|selling|farm|farming)\b[^.?!]{0,25}\b(followers?|likes?|views?|subscribers?|engagement)\b/i,
      /\b(bot|fake) (accounts?|followers?|engagement|comments?)\b/i,
      /\b(mass|bulk|automated) (dms?|messages?|comments?|follows?)\b/i,
      /\b(bypass|evad|circumvent|get around|work around|sneak past|trick|beat)\w*\b[^.?!]{0,30}\b(shadow ?ban|moderation|content polic(y|ies)|community guidelines|detection|spam filter|the algorithm'?s? (filters?|rules?))\b/i,
    ],
    reply:
      "I won't help with engagement farming or getting around platform rules - " +
      "that's what gets connected accounts banned. I can help make the posts " +
      "themselves better instead.",
  },
  {
    id: "harassment",
    any: [
      /\b(dox+ing|dox+)\b/i,
      /\b(harass|humiliat|sham|ruin|destroy|expos|embarrass)\w*\b[^.?!]{0,30}\b(my|this|that|his|her|their)\s+(ex|boss|coworker|colleague|neighbou?r|teacher|classmate|landlord|roommate)\b/i,
      /\b(call ?out|target|attack) (video|campaign)\b[^.?!]{0,30}\b(about|on|against)\s+(my|this|that)\s+(ex|boss|coworker|neighbou?r)\b/i,
    ],
    reply:
      "I won't make content aimed at a specific private person. If this is " +
      "about a business dispute you're part of, keep it to your own experience " +
      "and I can help you say it fairly.",
  },
  {
    id: "adult_content",
    any: [
      // "food porn" and its cousins are ordinary content vocabulary, so the
      // bare word only counts when nothing like that precedes it.
      /\bnsfw\b|\bpornographic\b|(?<!\b(?:food|car|nature|book|plant|design|architecture|travel|gear|interior)[\s-])\bporn\b|\bsexually explicit\b|\bexplicit nudity\b|\berotica\b/i,
    ],
    reply:
      "The connected platforms don't allow that, so I can't plan it. I can do " +
      "suggestive-free versions of the same product angle if that's useful.",
  },
];

function ruleHits(rule, text) {
  if (rule.any) return rule.any.some((re) => re.test(text));
  return rule.all.every((re) => re.test(text));
}

// "Make me 500 videos" is not malice, it is a misunderstanding of what one
// turn can do, so it gets its own reply rather than a refusal.
const BULK_PATTERN = /\b(\d[\d,]{1,6})\s*(?:more\s+)?(videos?|posts?|clips?|reels?|shorts?)\b/gi;

function bulkAsk(text) {
  for (const match of text.matchAll(BULK_PATTERN)) {
    const asked = Number(match[1].replace(/,/g, ""));
    if (Number.isFinite(asked) && asked > LIMITS.videosPerRequest) return asked;
  }
  return 0;
}

/* ------------------------------------------------------------- moderation */

// Categories that stop a request outright. Effectively everything the
// endpoint reports, because none of it is something a planner should be
// quietly turning into a public post - a flag in a category outside this list
// is treated as a pass rather than a guess.
const BLOCKING_CATEGORIES = [
  "sexual",
  "sexual/minors",
  "harassment",
  "harassment/threatening",
  "hate",
  "hate/threatening",
  "illicit",
  "illicit/violent",
  "self-harm",
  "self-harm/intent",
  "self-harm/instructions",
  "violence",
  "violence/graphic",
];

const CATEGORY_REPLIES = {
  sexual: "The connected platforms don't allow sexual content, so I can't plan it.",
  "sexual/minors": "I won't produce that under any framing.",
  harassment: "I won't write content that attacks or demeans someone.",
  hate: "I won't write content that attacks a group of people.",
  illicit: "I won't make content promoting something illegal.",
  "self-harm": "I can't help with that here. If you're struggling, please talk to someone you trust or a local crisis line.",
  violence: "I won't write content built around violence - it would be pulled by every platform anyway.",
};

function replyForCategory(category) {
  return (
    CATEGORY_REPLIES[category] ||
    CATEGORY_REPLIES[category.split("/")[0]] ||
    "I can't help with that here - it's outside what I can publish to your accounts."
  );
}

// One extra round trip per turn. It fails open on transport errors: the
// deterministic rules above have already run, the model has its own
// instructions, and an OpenAI blip should degrade the filter rather than
// take the assistant down. A flagged result, in contrast, always blocks.
async function moderate(text) {
  if (!config.moderationEnabled || !config.openaiApiKey) return null;
  try {
    const res = await fetch(`${config.openaiApiBase}/moderations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: config.moderationModel, input: text.slice(0, 4000) }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.warn(`[guardrails] moderation unavailable (${res.status}) - allowing`);
      return null;
    }
    const data = await res.json();
    const result = data.results?.[0];
    if (!result?.flagged) return null;
    const hit = BLOCKING_CATEGORIES.find((c) => result.categories?.[c]);
    return hit || null;
  } catch (err) {
    console.warn(`[guardrails] moderation failed (${err.message}) - allowing`);
    return null;
  }
}

/* ---------------------------------------------------------------- screens */

const ALLOWED = { allowed: true };

function blocked(category, reply) {
  return { allowed: false, category, reply };
}

const CAPS = {
  message: LIMITS.messageChars,
  brief: LIMITS.briefChars,
  caption: LIMITS.captionChars,
};

// Screens one piece of user-written text. `kind` only picks the size cap and
// the wording of the complaint - a chat message, a creative brief and a
// caption all get the same rules, because each of the last two is what
// actually becomes a public post.
export async function screenText(text, { kind = "message" } = {}) {
  const value = String(text || "").trim();
  if (!value) return blocked("empty", "There's nothing in that message.");

  const cap = CAPS[kind] ?? LIMITS.messageChars;
  if (value.length > cap) {
    return blocked(
      "too_long",
      `That ${kind} is ${value.length} characters and I cap them at ${cap}. ` +
        "Trim it to the part you want acted on."
    );
  }

  for (const rule of RULES) {
    if (ruleHits(rule, value)) return blocked(rule.id, rule.reply);
  }

  const asked = bulkAsk(value);
  if (asked) {
    return blocked(
      "bulk",
      `${asked} at once is more than I'll schedule in one go - the cap is ` +
        `${LIMITS.videosPerRequest}. Ask for a batch that size and we can keep going from there.`
    );
  }

  const flagged = await moderate(value);
  if (flagged) return blocked(`moderation:${flagged}`, replyForCategory(flagged));

  return ALLOWED;
}

// Validates the conversation the client replayed, before any of it is sent
// on. Only the newest user message is screened for content - earlier turns
// were screened when they were sent, and re-screening them would let one
// borderline message keep re-blocking a conversation that moved on.
export async function screenConversation(messages) {
  if (!Array.isArray(messages) || !messages.length) {
    return blocked("empty", "There's nothing to answer.");
  }
  if (messages.length > LIMITS.messages) {
    return blocked(
      "too_many_messages",
      "This conversation has run long. Start a new chat and I'll pick it up fresh."
    );
  }

  const total = messages.reduce((sum, m) => sum + String(m?.content || "").length, 0);
  if (total > LIMITS.conversationChars) {
    return blocked(
      "conversation_too_long",
      "This conversation is too long for me to carry. Start a new chat with " +
        "just what you need now."
    );
  }

  const latest = [...messages].reverse().find((m) => m?.role === "user");
  if (!latest) return blocked("empty", "There's nothing to answer.");

  return screenText(latest.content, { kind: "message" });
}

// The same screen, applied to what the model decided to plan. The user's
// message having passed does not mean the brief the model built from it did:
// this is the last point before text becomes a rendered, published video.
export async function screenBrief(brief) {
  return screenText(brief, { kind: "brief" });
}

/* ------------------------------------------------------------ rate limits */

// Per-client sliding windows, in memory. This is a single-operator app on a
// single process, so a Map is the right size of solution - it exists to stop
// a stuck loop or a held-down key from burning the OpenAI budget, not to
// defend against a distributed attacker.
const hits = new Map();

function windowCount(times, now, span) {
  let n = 0;
  for (const t of times) if (now - t < span) n++;
  return n;
}

export function checkRate(key = "default") {
  const now = Date.now();
  const times = (hits.get(key) || []).filter((t) => now - t < 3600000);

  if (windowCount(times, now, 60000) >= LIMITS.turnsPerMinute) {
    hits.set(key, times);
    return { ok: false, retryAfter: 30, reply: "You're sending these faster than I can think. Give it a few seconds." };
  }
  if (times.length >= LIMITS.turnsPerHour) {
    hits.set(key, times);
    return { ok: false, retryAfter: 600, reply: "That's a lot of turns in an hour - taking a short break so the API bill doesn't run away. Try again shortly." };
  }

  times.push(now);
  hits.set(key, times);

  // Cheap sweep so idle keys don't accumulate forever.
  if (hits.size > 500) {
    for (const [k, v] of hits) if (!v.some((t) => now - t < 3600000)) hits.delete(k);
  }
  return { ok: true };
}

/* ----------------------------------------------------- tool argument sanity */

// Hostnames that are never a product page, only a way to make the server
// fetch something on the caller's behalf.
const BLOCKED_HOSTS = /^(localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i;
const PRIVATE_IPV4 =
  /^(0|10|127)\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\.|^192\.168\.|^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./;

// The assistant picks the product URL out of conversation text, and the
// pipeline later fetches it server-side, so this is where a model talked into
// "read http://169.254.169.254/…" gets stopped.
//
// Literal addresses and obvious internal names only: a public hostname that
// resolves to a private address still gets through, because the resolution
// happens at fetch time in scrape.js and re-resolving here would only move
// the race. That check belongs next to the fetch, which every caller shares.
export function assertSafeProductUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`"${value.slice(0, 80)}" is not a valid URL`);
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error("A product URL has to be http or https");
  if (url.username || url.password) throw new Error("Product URLs cannot carry credentials");

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTS.test(host) || PRIVATE_IPV4.test(host) || host === "::1" || /^f[cd][0-9a-f]{2}:/i.test(host)) {
    throw new Error("That address is on the server's own network, not a product page");
  }
  if (url.port && !["80", "443", "8080"].includes(url.port)) {
    throw new Error(`Port ${url.port} is not a product page - use the public URL`);
  }
  return url.toString();
}

/* ----------------------------------------------------------- date sanity */

// Dates the model passes to plan_videos or reschedule_video. A model that
// misreads "next year" can otherwise park a render a decade out, where it
// sits in the queue forever.
export function assertSaneDate(date) {
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed)) throw new Error(`"${date}" is not a valid date`);
  const days = (parsed - Date.now()) / 86400000;
  if (days < -LIMITS.scheduleDaysBehind) {
    throw new Error(`${date} is in the past - pick an upcoming date`);
  }
  if (days > LIMITS.scheduleDaysAhead) {
    throw new Error(`${date} is more than a year out - that's further ahead than I schedule`);
  }
  return date;
}
