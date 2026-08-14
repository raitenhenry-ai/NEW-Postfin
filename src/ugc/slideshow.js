import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import config from "../config.js";
import { formatReferencesBlock, visionUserContent } from "./references.js";

// The slideshow ad format.
//
// This is the other thing short-form advertising is made of: not a talking
// head, but a stack of images that hard-cut on the beat, each carrying one
// big line of text, with a voiceover underneath. It is what "how I make $10k
// a month dropshipping", tool comparisons and app promos are almost always
// shot as, and it is the format that works for software - there is nothing
// physical to film, so the ad is made of screens, mockups and text.
//
// Three stages, each usable on its own:
//   planSlideshow()          - the model writes slides: overlay, voiceover
//                              line, and an image prompt per slide
//   generateSlideImages()    - OpenAI's image model draws each slide
//   renderSlideshowVideo()   - ffmpeg cuts them into a 1080x1920 mp4
//
// The rules encoded in the prompt are the format's, not ours: the first
// slide is the whole ad (most viewers decide inside ~2 seconds), overlay
// text has to read with the sound off, and everything has to sit inside the
// safe zone or the platform UI covers it.

const W = 1080;
const H = 1920;
const FPS = 30;

// Safe zone, from the platforms' own overlay templates: the caption block and
// action rail eat the bottom and right of the frame. Overlay text lives in
// the upper-middle band, which is also where the format puts it.
const SAFE = { top: 140, bottom: 400, left: 60, right: 180 };
const TEXT_TOP = 380;

// Rough average advance width of a bold sans glyph, as a fraction of the
// font size. Used to work out how many characters fit inside the safe width
// before drawtext - which has no wrapping of its own - is handed the line.
const GLYPH_WIDTH = 0.62;

const MIN_SLIDE_SECONDS = 2.2;
const MAX_SLIDE_SECONDS = 6;

// How many slide images to draw at once. The image API is slow and rate
// limited; two in flight roughly halves the wall clock without tripping it.
const IMAGE_CONCURRENCY = 2;

/* --------------------------------------------------------------- angles */

// The recognisable shapes this format comes in. The planner is told to build
// the slide order out of the one that was picked, which is what keeps a
// comparison ad from drifting into a generic feature list.
const ANGLES = {
  tool_comparison:
    "A comparison. Name the alternatives people already use, give each its own " +
    "slide with the specific thing it gets wrong, then land on this product as " +
    "the one that fixes it. Never invent a competitor's pricing or misconduct - " +
    "compare on capability only.",
  money_method:
    "A method walkthrough - 'how I make X doing Y'. Open on the result, then " +
    "each slide is one step of the method, with the product as the step that " +
    "does the heavy lifting. Never promise earnings or guarantee outcomes; " +
    "talk about what the method is, not what the viewer will make.",
  problem_solution:
    "Problem first. Open on the frustration in the viewer's own words, spend a " +
    "slide making it worse, then show the product resolving it.",
  feature_demo:
    "A walkthrough. Each slide is one screen or step of actually using the " +
    "product, in the order a real user would hit them.",
  before_after:
    "Before and after. Show the messy way it was done, then the same job after " +
    "the product, and end on the difference.",
  listicle:
    "A numbered list - '5 things I wish I knew'. One point per slide, the " +
    "product appearing as the point that matters most.",
};

export function slideshowAngles() {
  return Object.keys(ANGLES);
}

export function slideshowConfigured() {
  return Boolean(config.fontPath);
}

/* -------------------------------------------------------------- planning */

// What the model is told about drawing slides. AI image models still garble
// small text, and our overlay is burned in afterwards at a known size inside
// the safe zone - so the art is asked to stay wordless and leave room for it.
const IMAGE_RULES =
  "imagePrompt: a detailed prompt for the image model, 5-10 sentences. Cover " +
  "the setting, time of day, lighting, camera distance and angle, what is " +
  "happening, who is in frame, materials, and mood. One concrete scene, not " +
  "a collage. It must contain NO text, NO words, NO numbers, NO logos and NO " +
  "user-interface labels - the caption is burned in afterwards - and must " +
  "leave the upper third visually calm so the caption can sit on it. Shoot " +
  "it like a real phone photo or a real screen capture, not like a stock advert.";

function subjectFor(product, settings) {
  const parts = [];
  const concept = settings.concept;
  if (concept?.title) parts.push(`Video concept: ${concept.title}`);
  if (concept?.angle) parts.push(`Angle: ${concept.angle}`);
  if (concept?.talkingPoints?.length) {
    parts.push(`Cover these points:\n- ${concept.talkingPoints.join("\n- ")}`);
  }
  if (settings.brief) parts.push(`Brief: ${settings.brief}`);
  if (product) {
    parts.push(
      `Product: ${product.name}` +
        (product.brand ? `\nBrand: ${product.brand}` : "") +
        (product.price ? `\nPrice: ${product.price} ${product.currency || ""}` : "") +
        (product.site ? `\nStore: ${product.site}` : "") +
        `\n\nDescription:\n${product.description || "(none found)"}`
    );
  }
  const refs = formatReferencesBlock(settings, product);
  if (refs) parts.push(refs);
  return parts.join("\n\n");
}

export async function planSlideshow(product, settings = {}) {
  const slideCount = Math.max(3, Math.min(10, Number(settings.slides) || config.ugc.slides));
  const angle = ANGLES[settings.angle] ? settings.angle : defaultAngle(product, settings);
  const photoCount = Math.min(product?.images?.length || 0, 6);

  if (!config.openaiApiKey) return templateSlideshow(product, settings, slideCount, angle);

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
            "You write short-form slideshow ads - the TikTok/Reels format where " +
            "still images hard-cut every few seconds, each carrying one large line " +
            "of text, with a voiceover underneath. " +
            `Plan exactly ${slideCount} slides. ` +
            'Reply with JSON only: {"slides": [{"overlay": string, "spoken": string, ' +
            '"imagePrompt": string, "useProductPhoto": number}], "caption": string, ' +
            '"hashtags": string[], "styleNote": string}. ' +
            // The hook is the ad. Everything else is read by people the hook
            // already stopped.
            "Slide 1 is the hook and decides whether the rest is ever seen: make it " +
            "a specific, concrete claim or tension, never a greeting and never the " +
            "product name on its own. The last slide is the call to action. The " +
            "slides between them carry the argument. " +
            "overlay: the words burned on screen, at most 8 words, no hashtags, no " +
            "emoji, readable with the sound off - on its own it should still tell " +
            "the story slide by slide. " +
            "spoken: what the voiceover says over this slide, one natural sentence " +
            "of at most 18 words, written to be heard rather than read. It should " +
            "carry the detail the overlay had no room for, not repeat it verbatim. " +
            IMAGE_RULES + " " +
            (photoCount
              ? "useProductPhoto: 1 when this slide should show the product itself, " +
                "0 when it should not. There are real photos of it, and on a slide " +
                "marked 1 they are handed to the image model as references so it " +
                "recreates the product accurately inside your scene. So describe " +
                "the scene around the product - where it is, who is holding it, the " +
                "light, the surface - and do NOT describe what the product looks " +
                "like: the photos decide that. Most slides that mention the product " +
                "should be 1. "
              : "useProductPhoto: always 0 - there are no photos of this subject. ") +
            "caption: 1-2 sentences for the post text. " +
            "hashtags: 6-10 lowercase hashtags starting with #. " +
            "styleNote: one short phrase describing the visual look shared by every " +
            "slide, e.g. 'warm handheld iPhone photos, morning kitchen light'. It is " +
            "prepended to every image prompt so the slides look like one ad. " +
            `Structure: ${ANGLES[angle]} ` +
            (settings.tone ? `Voice: ${settings.tone}. ` : "") +
            "Never invent specs, prices, medical claims, earnings or discounts, and " +
            "never put a competitor's name in the overlay text unless the brief did.",
        },
        {
          role: "user",
          content: visionUserContent(
            subjectFor(product, settings) || "Write a slideshow ad.",
            product,
            settings
          ),
        },
      ],
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Slideshow planning failed (${res.status}): ${JSON.stringify(data).slice(0, 300)}`);
  }

  const parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}");
  const slides = shapeSlides(parsed.slides, photoCount);
  if (slides.length < 2) {
    throw new Error("The slideshow planner returned no usable slides - try rewording the brief");
  }

  return finishScript({
    slides,
    styleNote: String(parsed.styleNote || "").trim().slice(0, 200),
    caption: String(parsed.caption || product?.name || settings.concept?.title || "New video")
      .trim().slice(0, 500),
    hashtags: (Array.isArray(parsed.hashtags) ? parsed.hashtags : [])
      .map((h) => String(h).trim().toLowerCase())
      .filter(Boolean)
      .map((h) => (h.startsWith("#") ? h : `#${h}`))
      .slice(0, 12),
    angle,
    tone: settings.tone || "casual",
    generatedBy: "openai",
  });
}

// A software brief has nothing to film, so it defaults to the walkthrough;
// anything with a product page defaults to problem/solution.
function defaultAngle(product, settings) {
  const text = `${settings.brief || ""} ${settings.concept?.angle || ""}`.toLowerCase();
  if (/\bvs\b|versus|compare|comparison|alternative/.test(text)) return "tool_comparison";
  if (/\$\d|\bmake money|income|side hustle|dropship/.test(text)) return "money_method";
  if (!product && /app|software|tool|saas|platform|dashboard/.test(text)) return "feature_demo";
  return "problem_solution";
}

function shapeSlides(raw, photoCount) {
  return (Array.isArray(raw) ? raw : [])
    .map((slide) => {
      // Written as a flag now, but scripts planned before this was a flag
      // carry a photo index - any non-negative number means the same thing:
      // this slide is about the product.
      const raw = slide?.useProductPhoto ?? slide?.showsProduct;
      const showsProduct = raw === true || (Number.isFinite(Number(raw)) && Number(raw) >= 0 && Number(raw) !== 0)
        || raw === 1 || raw === "1";
      return {
        overlay: String(slide?.overlay || "").trim().slice(0, 90),
        spoken: String(slide?.spoken || "").trim().slice(0, 220),
        imagePrompt: String(slide?.imagePrompt || "").trim().slice(0, 2500),
        showsProduct: Boolean(showsProduct && photoCount),
      };
    })
    .filter((slide) => slide.overlay || slide.spoken)
    .slice(0, 10);
}

// The slideshow script has to be a normal script as well: captions, spoken
// text and the calendar's preview all read the same fields whichever format
// produced them.
function finishScript({ slides, styleNote, caption, hashtags, angle, tone, generatedBy }) {
  const spoken = slides.map((s) => s.spoken || s.overlay).filter(Boolean);
  return {
    format: "slideshow",
    angle,
    tone,
    hook: slides[0]?.overlay || spoken[0] || "",
    scenes: spoken.slice(1, -1),
    cta: slides.at(-1)?.spoken || slides.at(-1)?.overlay || "",
    caption,
    hashtags: hashtags.length ? hashtags : ["#fyp", "#foryou", "#smallbusiness"],
    styleNote,
    slides,
    generatedBy,
  };
}

// Without a key there is no planner - but the format still works, because a
// slideshow is mostly text. The brief becomes the slides and the renderer
// draws them on gradients.
function templateSlideshow(product, settings, slideCount, angle) {
  const concept = settings.concept || {};
  const topic = concept.title || product?.name || settings.brief || "this";
  const points = (concept.talkingPoints || []).filter(Boolean);
  const body = points.length
    ? points
    : [
        concept.angle || `Here is what nobody tells you about ${topic}.`,
        "I tried it for a week and it changed how I work.",
        product?.price ? `It costs ${product.price} ${product.currency || ""}`.trim() : "It takes minutes to set up.",
      ];

  const slides = [
    { overlay: `Nobody talks about ${topic}`, spoken: `Nobody talks about ${topic}.` },
    ...body.slice(0, Math.max(1, slideCount - 2)).map((point) => ({
      overlay: String(point).split(/[.!?]/)[0].slice(0, 60),
      spoken: String(point).slice(0, 200),
    })),
    {
      overlay: product?.site ? `Get it at ${product.site}` : "Follow for more",
      spoken: product?.site ? `Get it at ${product.site}.` : "Follow for more like this.",
    },
  ].map((slide) => ({ ...slide, imagePrompt: "", showsProduct: false }));

  return finishScript({
    slides,
    styleNote: "",
    caption: concept.title || String(settings.brief || topic).slice(0, 200),
    hashtags: ["#fyp", "#foryou", "#tips", "#howto"],
    angle,
    tone: settings.tone || "casual",
    generatedBy: "template",
  });
}

/* ---------------------------------------------------------------- images */

// How the slide art should look, appended to every prompt. The planner
// writes what is in the shot; this decides how it is shot, and it is the
// same on every slide so six images read as one ad rather than six stock
// photos. "Shot on a phone" matters: polished studio lighting is the tell
// that an ad is an ad, and this format lives or dies on looking like
// something a person posted.
const LOOK =
  "Vertical 9:16 photograph, shot on a modern phone camera, natural available " +
  "light, shallow depth of field, realistic colours and skin tones, slight " +
  "handheld imperfection. Not a studio product shot, not an advertisement, no " +
  "watermark, no border, no collage. Keep the top third of the frame simple " +
  "and uncluttered. Absolutely no text, letters, numbers, captions, labels, " +
  "logos or user-interface writing anywhere in the image.";

// How long one image is allowed to take, and how many times a request that
// failed for a reason that might pass is tried again.
const IMAGE_TIMEOUT_MS = Number(process.env.OPENAI_IMAGE_TIMEOUT_MS || 150000);
const IMAGE_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [2000, 6000];

// Errors that no number of retries will fix, and that will fail every other
// slide the same way: a key that cannot use this model, an unverified
// organisation, a model name that does not exist, exhausted billing.
// gpt-image-1 in particular is gated behind organisation verification, which
// is the single most common reason slide art silently stops appearing.
function permanentImageFailure(status, message) {
  if ([401, 403, 404].includes(status)) return true;
  return /must be verified|verify your organization|does not exist|do not have access|billing|quota|insufficient_quota/i
    .test(message);
}

// A content refusal is deterministic: the same prompt gets the same answer,
// so retrying it only spends time and money to be told no again. It is not
// permanent though - the next slide's prompt may be perfectly fine.
function contentRefusal(status, message) {
  return status === 400 || /safety system|moderation|content_policy/i.test(message);
}

class ImageError extends Error {
  constructor(message, { permanent = false, retryable = true, status = 0 } = {}) {
    super(message);
    this.permanent = permanent;
    this.retryable = retryable;
    this.status = status;
  }
}

function imagePrompt(prompt, styleNote) {
  return [styleNote, prompt, LOOK].filter(Boolean).join(" ").slice(0, 3800);
}

// One request to the image API, with a timeout. Throws ImageError so the
// caller can tell "try again" apart from "this will never work".
async function requestImage(prompt, styleNote, outPath, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(`${config.openaiApiBase}/images/generations`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.ugc.imageModel,
        prompt: imagePrompt(prompt, styleNote),
        n: 1,
        size: options.size || config.ugc.imageSize,
        quality: options.quality || config.ugc.imageQuality,
      }),
    });
  } catch (err) {
    throw new ImageError(
      err.name === "AbortError"
        ? `The image model did not answer within ${Math.round(IMAGE_TIMEOUT_MS / 1000)}s`
        : `Could not reach the image API: ${err.message || err}`
    );
  } finally {
    clearTimeout(timer);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.error?.message || JSON.stringify(data).slice(0, 300);
    throw new ImageError(`${config.ugc.imageModel} refused (${res.status}): ${detail}`, {
      permanent: permanentImageFailure(res.status, detail),
      retryable: !contentRefusal(res.status, detail),
      status: res.status,
    });
  }

  return writeImage(data, outPath);
}

// gpt-image-1 always answers with base64; the older models answer with a
// URL, so both are accepted.
async function writeImage(data, outPath) {
  const entry = data.data?.[0];
  if (entry?.b64_json) {
    fs.writeFileSync(outPath, Buffer.from(entry.b64_json, "base64"));
    return outPath;
  }
  if (entry?.url) {
    const image = await fetch(entry.url);
    if (!image.ok) throw new ImageError(`Could not download the generated image (${image.status})`);
    fs.writeFileSync(outPath, Buffer.from(await image.arrayBuffer()));
    return outPath;
  }
  throw new ImageError("The image model returned no image");
}

// The same request, but with the product's own photos attached as
// references. The model is not pasting them in - it redraws the product
// inside the scene it was asked for, which is the only way to get the
// product into a shot that was never photographed: a real dashboard on a
// laptop on a kitchen table, the real bottle held under a real tap.
//
// Sent as multipart to the edits endpoint, which is what accepts reference
// images. input_fidelity=high is what holds a logo, a label or a
// screenshot's interface together; newer image models always work that way
// and reject the parameter, so a refusal naming it retries without.
async function requestImageWithReferences(prompt, styleNote, references, outPath, options = {}) {
  const form = new FormData();
  form.append("model", config.ugc.imageModel);
  form.append("prompt", referencePrompt(prompt, styleNote));
  form.append("n", "1");
  form.append("size", options.size || config.ugc.imageSize);
  form.append("quality", options.quality || config.ugc.imageQuality);
  if (!options.noFidelity) form.append("input_fidelity", config.ugc.imageFidelity);

  for (const [i, file] of references.entries()) {
    const bytes = fs.readFileSync(file);
    const type = file.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
    form.append("image[]", new Blob([bytes], { type }), `reference${i}${path.extname(file) || ".png"}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${config.openaiApiBase}/images/edits`, {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${config.openaiApiKey}` },
      body: form,
    });
  } catch (err) {
    throw new ImageError(
      err.name === "AbortError"
        ? `The image model did not answer within ${Math.round(IMAGE_TIMEOUT_MS / 1000)}s`
        : `Could not reach the image API: ${err.message || err}`
    );
  } finally {
    clearTimeout(timer);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.error?.message || JSON.stringify(data).slice(0, 300);
    // Models that always work at high fidelity reject the setting outright.
    if (!options.noFidelity && /input_fidelity/i.test(detail)) {
      return requestImageWithReferences(prompt, styleNote, references, outPath, {
        ...options, noFidelity: true,
      });
    }
    throw new ImageError(`${config.ugc.imageModel} refused (${res.status}): ${detail}`, {
      permanent: permanentImageFailure(res.status, detail),
      retryable: !contentRefusal(res.status, detail),
      status: res.status,
    });
  }

  return writeImage(data, outPath);
}

// What the model is told when it has the product in front of it. The scene
// is ours; the product is theirs, and must survive the redraw exactly.
function referencePrompt(prompt, styleNote) {
  return [
    styleNote,
    "Recreate the product shown in the reference images faithfully - the same " +
      "shape, proportions, colours, materials and branding, and for a screenshot " +
      "or app interface the same layout, and the same text where it appears on " +
      "the product itself. Do not copy the reference framing: place the recreated " +
      "product naturally into this scene:",
    prompt,
    LOOK,
  ].filter(Boolean).join(" ").slice(0, 3800);
}

// One slide image, retried through rate limits and hiccups. Returns the
// written path.
async function generateSlideImage(prompt, styleNote, outPath, references = []) {
  let last;
  for (let attempt = 0; attempt < IMAGE_ATTEMPTS; attempt++) {
    try {
      return references.length
        ? await requestImageWithReferences(prompt, styleNote, references, outPath)
        : await requestImage(prompt, styleNote, outPath);
    } catch (err) {
      last = err;
      // A 429 or a 500 is worth waiting out; a 403 or a safety refusal never is.
      if (err.permanent || err.retryable === false || attempt === IMAGE_ATTEMPTS - 1) break;
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[attempt] ?? 6000));
    }
  }
  throw last;
}

// Draws every slide that needs drawing, a couple at a time.
//
// Two different failures, treated differently. One slide the model refused to
// draw is worth a gradient card - the video is still an ad. A key that cannot
// use the image model at all is not: it would produce six gradient cards and
// no explanation, so the first permanent failure stops the run and is
// reported, rather than burning five more requests to arrive at the same
// answer more slowly.
export async function generateSlideImages(script, dir, productPhotos = []) {
  return generateSceneImages(
    script.slides.map((slide) => ({
      prompt: slide.imagePrompt,
      withProduct: slide.showsProduct,
    })),
    { dir, styleNote: script.styleNote, productPhotos }
  );
}

// The same drawing, for any list of scenes - the slideshow's slides, or the
// shots an avatar video cuts away to. Each item is { prompt, withProduct },
// and a withProduct item is drawn with the product's own photos in hand.
export async function generateSceneImages(items, { dir, styleNote = "", productPhotos = [] }) {
  fs.mkdirSync(dir, { recursive: true });
  const images = new Array(items.length).fill(null);

  // Up to four references: enough for the model to see the product from
  // more than one angle without the request becoming unwieldy.
  const references = productPhotos.filter((p) => p && fs.existsSync(p)).slice(0, 4);

  const queue = [];
  items.forEach((item, i) => {
    if (item.prompt) queue.push(i);
  });

  const failures = [];
  let stopped = null;
  let cursor = 0;

  const worker = async () => {
    while (cursor < queue.length && !stopped) {
      const i = queue[cursor++];
      const target = path.join(dir, `slide${i}.png`);
      const item = items[i];
      // Scenes that show the product are drawn with its photos in hand.
      const refs = item.withProduct ? references : [];
      try {
        images[i] = await generateSlideImage(item.prompt, styleNote, target, refs);
      } catch (err) {
        const message = err.message || String(err);
        failures.push({ slide: i + 1, message });
        console.warn(`[slideshow] slide ${i + 1} image failed:`, message);
        if (err.permanent) stopped = message;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(IMAGE_CONCURRENCY, queue.length) }, worker)
  );

  return {
    images,
    requested: queue.length,
    generated: queue.filter((i) => images[i]).length,
    // How many were drawn with the product's own photos in hand.
    fromReferences: queue.filter((i) => items[i].withProduct && images[i]).length,
    references: references.length,
    failures,
    // Set when the account itself cannot generate images - the caller turns
    // this into a failed job rather than a video full of blank cards.
    blocked: stopped,
  };
}

// Explicit check that this key can actually generate images, for the same
// reason the HeyGen key has one: otherwise a misconfiguration surfaces as a
// failed render after a week of videos was scheduled on it. Runs at the
// cheapest size and quality - about a cent - and reports the API's own words,
// which for gpt-image-1 is usually the organisation-verification message.
export async function testImageGeneration() {
  if (!config.openaiApiKey) {
    return { ok: false, error: "OPENAI_API_KEY is not set", permanent: true };
  }

  const dir = path.join(config.ugcDir, "image-test");
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `probe-${process.pid}.png`);
  const started = Date.now();

  try {
    await requestImage(
      "A plain ceramic mug on a wooden table beside a sunlit window.",
      "",
      target,
      { size: "1024x1024", quality: "low" }
    );
    return {
      ok: true,
      model: config.ugc.imageModel,
      seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
      bytes: fs.statSync(target).size,
      // What real slides will be generated at, which is not what was probed.
      slideSize: config.ugc.imageSize,
      slideQuality: config.ugc.imageQuality,
    };
  } catch (err) {
    return {
      ok: false,
      model: config.ugc.imageModel,
      error: err.message || String(err),
      permanent: Boolean(err.permanent),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/* ----------------------------------------------------------------- audio */

async function makeVoiceover(text, outPath, voice) {
  if (!config.openaiApiKey || !text) return null;
  const res = await fetch(`${config.openaiApiBase}/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.ugc.ttsModel,
      voice: voice || config.ugc.ttsVoice,
      input: text.slice(0, 2000),
      response_format: "mp3",
    }),
  });
  if (!res.ok) {
    throw new Error(`Voiceover failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`);
  }
  fs.writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
  return outPath;
}

/* -------------------------------------------------------------- ffmpeg */

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("error", (err) =>
      reject(
        err.code === "ENOENT"
          ? new Error(`${cmd} is not installed - the slideshow format needs ffmpeg on PATH`)
          : err
      )
    );
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with ${code}: ${stderr.slice(-1200)}`));
    });
  });
}

function probeDuration(filePath) {
  return new Promise((resolve) => {
    const proc = spawn(config.ffprobePath, [
      "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", filePath,
    ]);
    let out = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.on("error", () => resolve(0));
    proc.on("close", () => resolve(Number(String(out).trim()) || 0));
  });
}

// drawtext has no word wrap of its own, so lines are broken to a width that
// keeps the block inside the safe zone at the given size.
function wrapText(text, charsPerLine) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (line && (line + " " + word).length > charsPerLine) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function escapeForFilter(value) {
  return String(value).replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

// Slide backgrounds when there is no photo: a two-tone gradient, rotated per
// slide so a run of them doesn't look like one still.
function gradientSource(index, seconds) {
  const hues = ["0x1b1f3b:0x0b0d12", "0x2a1533:0x0d0b16", "0x0f2a33:0x0a1418",
    "0x33241a:0x14100c", "0x1a3326:0x0b1610", "0x2b1420:0x140a10"];
  const [a, b] = hues[index % hues.length].split(":");
  return `gradients=s=${W}x${H}:c0=${a}:c1=${b}:x0=0:y0=0:x1=${W}:y1=${H}:d=${seconds.toFixed(2)}:speed=0.02`;
}

// The text band, drawn one line at a time. drawtext centres a whole block by
// its widest line and leaves the rest ragged, which reads as a mistake at
// this size - a filter per line centres each one.
function overlayFilters(overlay, index, isHook, workDir) {
  if (!config.fontPath || !overlay) return "";

  const fontSize = isHook ? 76 : 64;
  const charsPerLine = Math.floor((W - SAFE.left - SAFE.right) / (fontSize * GLYPH_WIDTH));
  const lines = wrapText(overlay, charsPerLine).slice(0, 4);
  const lineHeight = Math.round(fontSize * 1.26);
  // Balance the block around the upper-middle band rather than hanging it
  // from a fixed top, so a one-line hook and a three-line one sit the same.
  const top = Math.max(SAFE.top + 60, TEXT_TOP + 180 - Math.round((lines.length * lineHeight) / 2));

  return lines.map((line, i) => {
    const file = path.join(workDir, `slide${index}-line${i}.txt`);
    fs.writeFileSync(file, line);
    return (
      `,drawtext=textfile='${escapeForFilter(file)}':fontfile='${escapeForFilter(config.fontPath)}':` +
      `fontsize=${fontSize}:fontcolor=white:` +
      `borderw=5:bordercolor=black@0.85:shadowx=0:shadowy=4:shadowcolor=black@0.55:` +
      `x=(w-text_w)/2:y=${top + i * lineHeight}`
    );
  }).join("");
}

// One slide: image (or gradient), a slow push in, the overlay burned in, and
// its own slice of voiceover. Rendered whole so the concat at the end is a
// stream copy and the audio can never drift out of sync with its slide.
async function renderSlide({ image, overlay, audio, seconds, index, isHook, workDir }) {
  const out = path.join(workDir, `slide${index}.mp4`);
  const duration = seconds.toFixed(2);
  const args = ["-y"];

  if (image) args.push("-loop", "1", "-t", duration, "-i", image);
  else args.push("-f", "lavfi", "-t", duration, "-i", gradientSource(index, seconds));

  // A scrim that fades out down the frame. AI art and product photos are
  // unpredictably bright, and white text on a bright photo is the classic
  // unreadable slideshow; a hard-edged box would be visible as a band.
  args.push("-f", "lavfi", "-t", duration, "-i",
    `gradients=s=${W}x${H}:c0=black@0.78:c1=black@0.0:x0=0:y0=0:x1=0:y1=1150:d=${duration}:speed=0.00001`);

  if (audio) args.push("-i", audio);
  else args.push("-f", "lavfi", "-t", duration, "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");

  // Cover-fit the frame, then push in (or pull out on alternate slides) by a
  // few percent so a still image still reads as motion.
  const zoom = index % 2 === 0
    ? `min(1+0.0009*on,1.10)`
    : `max(1.10-0.0009*on,1.0)`;

  // Cover-fit with just enough overscan to feed the zoom. Working at 2x the
  // output would mean a 33MB frame buffer through zoompan, which is what
  // gets a render OOM-killed on a small instance - and it buys nothing,
  // since the push-in tops out at 10%.
  const overscanW = Math.round(W * 1.15);
  const overscanH = Math.round(H * 1.15);
  const filter =
    `[0:v]scale=${overscanW}:${overscanH}:force_original_aspect_ratio=increase,` +
    `crop=${overscanW}:${overscanH},` +
    `zoompan=z='${zoom}':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${FPS}[bg];` +
    `[1:v]format=rgba[scrim];` +
    `[bg][scrim]overlay=0:0` +
    overlayFilters(overlay, index, isHook, workDir) +
    `,format=yuv420p[v]`;

  args.push(
    "-filter_complex", filter,
    "-map", "[v]", "-map", "2:a",
    "-r", String(FPS),
    "-t", duration,
    "-c:v", "libx264", "-preset", config.videoPreset, "-crf", String(config.videoCrf),
    "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
    out
  );
  await run(config.ffmpegPath, args);
  return out;
}

/* ---------------------------------------------------------- slide images */

// One finished slide as a still 1080x1920 PNG: the art, the scrim, the
// overlay burned in - the same frame the video shows, without the motion.
//
// These are the actual deliverable of the format. A slideshow post is a
// stack of photos the viewer swipes, not a video, and TikTok and Instagram
// both take them as images; the mp4 is what gets posted where only video is
// accepted, and what makes the preview playable.
async function renderSlideStill({ image, overlay, index, isHook, outPath, workDir }) {
  const args = ["-y"];

  if (image) args.push("-i", image);
  else args.push("-f", "lavfi", "-t", "1", "-i", gradientSource(index, 1));

  args.push("-f", "lavfi", "-t", "1", "-i",
    `gradients=s=${W}x${H}:c0=black@0.78:c1=black@0.0:x0=0:y0=0:x1=0:y1=1150:d=1:speed=0.00001`);

  const filter =
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}[bg];` +
    `[1:v]format=rgba[scrim];` +
    `[bg][scrim]overlay=0:0` +
    overlayFilters(overlay, index, isHook, workDir) +
    `,format=rgb24[v]`;

  args.push("-filter_complex", filter, "-map", "[v]", "-frames:v", "1", outPath);
  await run(config.ffmpegPath, args);
  return outPath;
}

// Every slide as a still, written where they will outlive the render - the
// platforms fetch them over HTTP at publish time, and the UI shows them.
// Returns the filenames, relative to the media directory.
export async function renderSlideImages({ script, images = [], jobId, workDir }) {
  const slides = script.slides || [];
  const dirName = path.join("slides", `job${jobId}`);
  const outDir = path.join(config.ugcDir, dirName);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(workDir, { recursive: true });

  const written = [];
  for (const [i, slide] of slides.entries()) {
    const name = `slide${String(i + 1).padStart(2, "0")}.png`;
    await renderSlideStill({
      image: images[i] || null,
      overlay: slide.overlay,
      index: i,
      isHook: i === 0,
      outPath: path.join(outDir, name),
      workDir,
    });
    written.push(path.join(dirName, name).split(path.sep).join("/"));
  }
  return written;
}

/* ---------------------------------------------------------------- render */

// Builds the finished mp4. `images` is one entry per slide - a file path or
// null for a gradient card. Returns { outputPath, durationSeconds }.
export async function renderSlideshowVideo({ script, images = [], workDir, outputPath, settings = {} }) {
  const slides = script.slides || [];
  if (!slides.length) throw new Error("This video has no slides to render");
  fs.mkdirSync(workDir, { recursive: true });

  // Each slide gets its own voiceover so the cut lands on the sentence
  // rather than in the middle of it.
  const audio = [];
  for (const [i, slide] of slides.entries()) {
    const target = path.join(workDir, `vo${i}.mp3`);
    try {
      audio.push(await makeVoiceover(slide.spoken || slide.overlay, target, settings.voice));
    } catch (err) {
      console.warn(`[slideshow] voiceover for slide ${i + 1} skipped:`, err.message || err);
      audio.push(null);
    }
  }

  const files = [];
  for (const [i, slide] of slides.entries()) {
    const spokenSeconds = audio[i] ? await probeDuration(audio[i]) : 0;
    const seconds = spokenSeconds
      ? Math.min(MAX_SLIDE_SECONDS, Math.max(MIN_SLIDE_SECONDS, spokenSeconds + 0.5))
      : config.ugc.slideSeconds;
    files.push(
      await renderSlide({
        image: images[i] || null,
        overlay: slide.overlay,
        audio: audio[i],
        seconds,
        index: i,
        isHook: i === 0,
        workDir,
      })
    );
  }

  const listFile = path.join(workDir, "slides.txt");
  fs.writeFileSync(listFile, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
  await run(config.ffmpegPath, [
    "-y", "-f", "concat", "-safe", "0", "-i", listFile,
    "-c", "copy", "-movflags", "+faststart", outputPath,
  ]);

  return { outputPath, durationSeconds: await probeDuration(outputPath) };
}
