import config from "../config.js";
import { formatReferencesBlock, visionUserContent } from "./references.js";

// How many product photos to show the model and make available as scene
// backgrounds. More costs vision tokens for diminishing benefit.
const MAX_VISION_IMAGES = 5;

// Turns scraped product data into a UGC-style talking script plus the
// caption/hashtags used when posting. Uses the OpenAI chat model when a key
// is configured; otherwise falls back to a decent template so the pipeline
// still works end to end.

const TONES = {
  casual: "casual and friendly, like recommending it to a close friend",
  excited: "high-energy and enthusiastic, genuinely hyped about the find",
  professional: "polished and confident, like a knowledgeable reviewer",
  storytelling: "personal storytelling - a before/after experience with the product",
};

export function toneOptions() {
  return Object.keys(TONES);
}

// Video style angles - the "trending styles" the studio UI offers.
const STYLES = {
  product_pov: "Show the product being used in real everyday situations (product POV angle).",
  grwm: "Frame it as a get-ready-with-me routine where the product is the star step.",
  unboxing: "Frame it as a satisfying unboxing with a reveal moment.",
  before_after: "Lean on the before/after transformation the product delivers.",
  demo: "A quick, punchy demo of exactly how the product works.",
};

export function styleOptions() {
  return Object.keys(STYLES);
}

// Describes the subject of the video to the model. A job either has a
// scraped product, a planned concept from a written brief, or both - when
// both are present the concept steers the angle and the product supplies
// the facts.
function subjectBlock(product, settings) {
  const parts = [];
  const concept = settings.concept;

  if (concept?.title) parts.push(`Video concept: ${concept.title}`);
  if (concept?.angle) parts.push(`Angle: ${concept.angle}`);
  if (concept?.talkingPoints?.length) {
    parts.push(`Cover these points:\n- ${concept.talkingPoints.join("\n- ")}`);
  }
  if (settings.brief) parts.push(`Overall brief: ${settings.brief}`);

  if (product) {
    parts.push(
      `Product: ${product.name}` +
        (product.brand ? `\nBrand: ${product.brand}` : "") +
        (product.price ? `\nPrice: ${product.price} ${product.currency || ""}` : "") +
        (product.site ? `\nStore: ${product.site}` : "") +
        `\n\nProduct description:\n${product.description || "(none found)"}`
    );
  }
  return parts.join("\n\n");
}

// The user turn, with the product photos attached when there are any, so
// the model writes copy and visual direction from what the product actually
// looks like rather than from its name alone.
function visionContent(product, settings) {
  const text = subjectBlock(product, settings);
  const images = (product?.images || []).slice(0, MAX_VISION_IMAGES);
  if (!images.length) return text;

  return [
    {
      type: "text",
      text:
        `${text}\n\nThe product photos follow, in order - photo 0 first. ` +
        "Refer to them by index in the storyboard.",
    },
    ...images.map((url) => ({ type: "image_url", image_url: { url, detail: "low" } })),
  ];
}

// One entry per spoken line: what is on screen, and whether the creator is
// on camera for it or the video cuts away to the product being used.
function shapeStoryboard(raw, expectedLength, product) {
  const entries = (Array.isArray(raw) ? raw : []).map((entry) => ({
    visual: String(entry?.visual || "").trim().slice(0, 1500),
    // Anything not explicitly a product shot keeps the creator on camera,
    // which is the safe default - a cutaway with nothing to cut to is worse
    // than a talking head.
    shot: entry?.shot === "product" ? "product" : "creator",
  }));

  while (entries.length < expectedLength) {
    entries.push({ visual: "", shot: "creator" });
  }
  const shaped = entries.slice(0, expectedLength);

  // The first line is the scroll-stopper and belongs on a face; the last is
  // the call to action, which lands better from a person than from a photo.
  if (shaped[0]) shaped[0].shot = "creator";
  if (shaped.length > 2 && shaped.at(-1)) shaped.at(-1).shot = "creator";

  // Nothing to cut away to without photos of the product, so an all-creator
  // storyboard is left alone.
  if (!product?.images?.length) {
    for (const entry of shaped) entry.shot = "creator";
  }
  return shaped;
}

export async function generateScript(product, settings = {}) {
  const tone = TONES[settings.tone] ? settings.tone : "casual";
  if (!config.openaiApiKey) return templateScript(product, tone, settings);

  const res = await fetch(`${config.openaiApiBase}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.openaiChatModel,
      temperature: 0.9,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You write scripts for short UGC-style videos (TikTok/Reels/Shorts), " +
            "spoken to camera by a single creator. " +
            (product
              ? "The creator is holding or showing the product. "
              : "There is no product to show - write it as the creator talking to " +
                "camera about the topic. ") +
            'Reply with JSON only: {"hook": string, "scenes": [{"text": string}], ' +
            '"cta": string, "caption": string, "hashtags": string[], ' +
            '"storyboard": [{"visual": string, "shot": string}]}. ' +
            "hook: a scroll-stopping first line, max 12 words, no hashtags. " +
            (product
              ? "scenes: 3-4 short spoken lines (max 20 words each) covering what the product is, " +
                "the standout benefit, and a personal touch - natural spoken language, no emoji. " +
                "cta: one closing spoken line telling viewers where to get it. "
              : "scenes: 3-4 short spoken lines (max 20 words each) delivering the concept's " +
                "talking points - natural spoken language, no emoji. " +
                "cta: one closing spoken line - a follow/save/comment prompt. ") +
            "caption: 1-2 sentences for the post text, may include 1-2 emoji. " +
            "storyboard: one entry per line of the video, in order, covering the " +
            "hook, then each scene, then the CTA - so its length is scenes.length + 2. " +
            // A talking head for 25 seconds is the thing people scroll past.
            // The ad works when it keeps cutting to the product being used.
            'shot: "creator" when the creator is on camera saying this line, or ' +
            '"product" when the video cuts away to the product being used while ' +
            "she keeps talking over it. Use a product shot for at least a third of " +
            "the lines - any line about what the product does or how it feels to " +
            "use should be one - but keep the first line on the creator, since a " +
            "face is what stops the scroll. " +
            "visual: a detailed image-model prompt for that shot, 5-10 sentences: " +
            "setting, time of day, lighting, camera, what is happening, materials, mood. " +
            "No text, words, numbers or logos in the image. For a creator line, describe " +
            "the room she is standing in, not her face. For a product line, describe the " +
            "product being used in a real moment - hands holding it, fitting it, tapping " +
            "through it, the result of it working - in a real place with real light. " +
            "Never describe what the product looks like; that is taken from its photos. " +
            "hashtags: 6-10 lowercase hashtags starting with #, mixing product-specific and " +
            "discovery tags (#tiktokmademebuyit #fyp style). " +
            `Overall voice: ${TONES[tone]}. ` +
            (STYLES[settings.style] ? `Video angle: ${STYLES[settings.style]} ` : "") +
            "Never invent specs, medical claims or fake discounts.",
        },
        {
          role: "user",
          content: visionContent(product, settings),
        },
      ],
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Script generation failed (${res.status}): ${JSON.stringify(data).slice(0, 300)}`);
  }

  const parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}");
  const scenes = (Array.isArray(parsed.scenes) ? parsed.scenes : [])
    .map((s) => String(s?.text || s || "").trim())
    .filter(Boolean)
    .slice(0, 5);
  if (!parsed.hook || !scenes.length) throw new Error("Script generation returned an empty script");

  return {
    tone,
    hook: String(parsed.hook).trim().slice(0, 120),
    scenes,
    storyboard: shapeStoryboard(parsed.storyboard, scenes.length + 2, product),
    cta: String(
      parsed.cta || (product?.site ? `Get yours at ${product.site}` : "Follow for more")
    ).trim().slice(0, 160),
    caption: String(
      parsed.caption || product?.name || settings.concept?.title || "New video"
    ).trim().slice(0, 500),
    hashtags: (Array.isArray(parsed.hashtags) ? parsed.hashtags : [])
      .map((h) => String(h).trim().toLowerCase())
      .filter(Boolean)
      .map((h) => (h.startsWith("#") ? h : `#${h}`))
      .slice(0, 12),
    generatedBy: "openai",
  };
}

function templateScript(product, tone, settings = {}) {
  // No product means the job came from a written brief, so the concept the
  // planner produced is all there is to work from.
  if (!product) return briefTemplateScript(tone, settings);

  const name = product.name;
  const blurb = (product.description || "").split(/(?<=[.!?])\s+/)[0]?.slice(0, 140);
  return {
    tone,
    hook: `Okay, I have to show you this - ${name}`.slice(0, 120),
    scenes: [
      `So this is the ${name}${product.brand ? ` from ${product.brand}` : ""}.`,
      blurb || `I've been using it every single day and it honestly delivers.`,
      product.price
        ? `And it's only ${product.price} ${product.currency || ""} right now.`.trim()
        : `The quality for the price genuinely surprised me.`,
    ],
    cta: `Grab it at ${product.site} - link in bio.`,
    caption: `${name} - you need this in your life 🔥`,
    storyboard: shapeStoryboard([], 5, product),
    hashtags: [
      "#tiktokmademebuyit", "#musthaves", "#viralproducts", "#fyp",
      "#unboxing", "#productreview", "#shopping",
    ],
    generatedBy: "template",
  };
}

// Fallback for brief-planned videos when there is no OpenAI key. The
// planner's talking points become the scenes; without them the brief itself
// carries the video.
function briefTemplateScript(tone, settings) {
  const concept = settings.concept || {};
  const topic = concept.title || settings.brief || "something worth sharing";
  const points = (concept.talkingPoints || []).filter(Boolean);

  return {
    tone,
    hook: `Let's talk about ${topic}`.slice(0, 120),
    scenes: points.length
      ? points.slice(0, 4).map((p) => String(p).slice(0, 160))
      : [
          concept.angle ? String(concept.angle).slice(0, 160) : `Here's the thing about ${topic}.`,
          "I kept seeing this come up, so I tried it myself.",
          "Honestly, it made more of a difference than I expected.",
        ],
    cta: "Follow for more like this.",
    caption: concept.title || String(settings.brief || topic).slice(0, 200),
    storyboard: shapeStoryboard([], (points.length ? Math.min(points.length, 4) : 3) + 2, null),
    hashtags: ["#fyp", "#foryou", "#tips", "#creator", "#viral", "#howto"],
    generatedBy: "template",
  };
}

// The spoken lines in order: hook, each scene, then the CTA. One per
// storyboard entry, which is what lets a cutaway be placed on a line.
export function spokenLines(script) {
  if (!script) return [];
  return [script.hook, ...(script.scenes || []), script.cta]
    .map((line) => String(line || "").trim())
    .filter(Boolean);
}

// Full spoken text, used for the voiceover / avatar input.
export function spokenText(script) {
  return spokenLines(script).join(" ");
}

// Post caption assembled the same way the shortform tool builds captions.
export function captionText(script, product) {
  return [script.caption, script.hashtags?.join(" "), product?.url]
    .filter(Boolean)
    .join("\n\n");
}
