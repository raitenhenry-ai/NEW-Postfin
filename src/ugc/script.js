import config from "../config.js";

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

// The words that name the item, used to spot a shot that shows the product
// without saying so. The brand is dropped - it names the maker, not the
// thing - and so are short filler words.
function productNouns(product) {
  const brand = String(product?.brand || "").toLowerCase();
  return String(product?.name || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3 && w !== brand);
}

// One shot per spoken line. The image index is clamped to the photos that
// actually exist, so a hallucinated index can't point at a missing asset,
// and a shot that claims to contain the product but names no photo is
// pointed at the first one rather than being generated from text alone -
// text-only generation would invent a different-looking product.
function shapeStoryboard(raw, expectedLength, product) {
  const imageCount = Math.min(product?.images?.length || 0, MAX_VISION_IMAGES);
  const nouns = productNouns(product);

  const entries = (Array.isArray(raw) ? raw : []).map((entry, i) => {
    const index = Number(entry?.imageIndex);
    const valid = Number.isInteger(index) && index >= 0 && index < imageCount;
    const shotText = String(entry?.shot || entry?.visual || "");
    // A shot the model marked product-free but that describes the product
    // anyway would be generated from text, and the generator would invent a
    // different-looking item. If the item is named, use the real photos.
    const mentioned = nouns.some((n) => shotText.toLowerCase().includes(n));
    const wantsProduct = (entry?.productInShot !== false || mentioned) && imageCount > 0;
    return {
      beat: String(entry?.beat || BEATS[i]?.[0] || "").trim().slice(0, 40),
      shot: shotText.trim().slice(0, 500),
      productInShot: Boolean(wantsProduct),
      imageIndex: valid ? index : wantsProduct ? 0 : -1,
    };
  });

  // Pad or trim so the storyboard lines up with the spoken lines. Padding
  // cycles through the photos rather than repeating one.
  while (entries.length < expectedLength) {
    const i = entries.length;
    entries.push({
      beat: BEATS[i]?.[0] || "shot",
      shot: "",
      productInShot: imageCount > 0,
      imageIndex: imageCount ? i % imageCount : -1,
    });
  }
  return entries.slice(0, expectedLength);
}

// UGC ad beats. The timings matter: viewers decide inside ~1.7s and 71%
// are gone by 3s, so the hook has to land before anything else happens, and
// the whole thing stays under 30s with the demo taking the largest share.
const BEATS = [
  ["hook", "0-3s",
    "Open on the problem, a blunt claim, or an unexpected visual. Never the " +
    "brand name or a logo. Specific beats clever."],
  ["problem", "3-10s",
    "The pain in the viewer's own words, with the detail that makes it theirs."],
  ["solution", "10-16s",
    "What the product is and the one thing it changes. The reveal."],
  ["demo", "16-24s",
    "It being used, close up. The longest beat. Show, do not describe."],
  ["cta", "24-28s", "One action, said plainly."],
];

export async function generateScript(product, settings = {}) {
  const tone = TONES[settings.tone] ? settings.tone : "casual";
  if (!config.openaiApiKey) return templateScript(product, tone, settings);

  const beatSpec = BEATS.map(([name, at, what]) => `${name} (${at}): ${what}`).join(" ");

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
            "You write UGC ad scripts for TikTok/Reels/Shorts - the kind a real " +
            "customer films on their phone. Not a brand advert, not a voiceover " +
            "essay. " +
            (product
              ? "The product is physically in the video, in someone's hands, being " +
                "used. Every shot shows something happening with it. "
              : "There is no product; the shots have to carry the topic visually. ") +
            'Reply with JSON only: {"hook": string, "scenes": [{"text": string}], ' +
            '"cta": string, "caption": string, "hashtags": string[], ' +
            '"storyboard": [{"beat": string, "shot": string, "productInShot": boolean, ' +
            '"imageIndex": number}]}. ' +
            `Beats, one storyboard entry each, in order: ${beatSpec} ` +
            "hook is the first spoken line; scenes are the spoken lines for problem, " +
            "solution and demo in that order; cta is the last. So scenes has exactly " +
            "3 entries and storyboard has exactly 5. " +

            // The failure mode of generated UGC is generic specificity - copy
            // that sounds concrete but says nothing checkable. These rules
            // exist to force detail that could only come from this product.
            "WRITING RULES. Max 12 words per spoken line. Contractions, " +
            "half-sentences, the way people actually talk. No emoji in the " +
            "spoken lines. " +
            "Ban these outright: amazing, game-changing, obsessed, literally " +
            "changed my life, must-have, elevate, unlock, seamless, effortless, " +
            "revolutionary, 'trust me'. " +
            "Every claim must be checkable from the product information given - " +
            "a number, a material, a time, a texture, something visible in the " +
            "photos. Vague enthusiasm is worse than saying nothing. If you do " +
            "not know a detail, describe what you can actually see. " +
            "One small negative or hesitation somewhere in the script reads as " +
            "honest and outperforms uniform praise. " +

            // Shot direction, aimed at a video generator rather than a human
            // crew - and at footage that reads as filmed, not produced.
            "SHOT RULES. shot is direction for a video generator: subject, " +
            "action, framing, lighting, in one or two sentences. It must " +
            "describe motion, not a still frame. " +
            "Shoot it like a phone: handheld with slight shake, a real cluttered " +
            "room or counter, natural window light, shallow depth, vertical 9:16. " +
            "Hands in frame doing the action. No studio lighting, no seamless " +
            "backdrop, no product-on-white, no text overlays, no logos. " +
            "Small imperfections are wanted - they are what makes it read as " +
            "real rather than as an advert. " +
            (product
              ? "productInShot: true for solution, demo and cta at minimum. " +
                "imageIndex: which supplied photo shows the item for that shot, " +
                "0-based, or -1 when the product is not in that shot. "
              : "productInShot: always false. imageIndex: always -1. ") +

            "caption: 1-2 sentences of post text, may include 1-2 emoji. " +
            "hashtags: 6-10 lowercase hashtags starting with #, mixing " +
            "product-specific and discovery tags. " +
            `Voice: ${TONES[tone]}. ` +
            (STYLES[settings.style] ? `Angle: ${STYLES[settings.style]} ` : "") +
            "Never invent specs, medical claims, prices or discounts that were not given.",
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

// Full spoken text, used for the voiceover / avatar input.
export function spokenText(script) {
  return [script.hook, ...script.scenes, script.cta].filter(Boolean).join(" ");
}

// Post caption assembled the same way the shortform tool builds captions.
export function captionText(script, product) {
  return [script.caption, script.hashtags?.join(" "), product?.url]
    .filter(Boolean)
    .join("\n\n");
}
