import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import config from "../config.js";

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
  "imagePrompt: what the image model should draw for this slide. Describe one " +
  "concrete scene in a sentence or two. It must contain NO text, NO words, NO " +
  "numbers, NO logos and NO user-interface labels - the caption is added " +
  "afterwards - and must leave the upper third visually calm so the caption " +
  "can sit on it. Shoot it like a real phone photo or a real screen capture, " +
  "not like a stock advert.";

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
              ? `useProductPhoto: this product has ${photoCount} real photos, indexed 0-${photoCount - 1}. ` +
                "Set it to the index of the photo to use for this slide when a real " +
                "photo of the product beats a drawn one - which is most slides that " +
                "show the product itself. Use -1 to generate the image instead. " +
                "Still write an imagePrompt either way, as the fallback. "
              : "useProductPhoto: always -1 - there are no real photos of this subject. ") +
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
          content: subjectFor(product, settings) || "Write a slideshow ad.",
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
      const index = Number(slide?.useProductPhoto);
      return {
        overlay: String(slide?.overlay || "").trim().slice(0, 90),
        spoken: String(slide?.spoken || "").trim().slice(0, 220),
        imagePrompt: String(slide?.imagePrompt || "").trim().slice(0, 600),
        // A hallucinated index would point at a photo that isn't there.
        productImage:
          Number.isInteger(index) && index >= 0 && index < photoCount ? index : -1,
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
  ].map((slide) => ({ ...slide, imagePrompt: "", productImage: -1 }));

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

// One slide image. Returns the written path, or null when generation is off
// or fails - the renderer draws a gradient card instead, which is a real
// slideshow look rather than a broken one.
async function generateSlideImage(prompt, styleNote, outPath) {
  if (!config.openaiApiKey || !prompt) return null;

  const res = await fetch(`${config.openaiApiBase}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.ugc.imageModel,
      prompt: [styleNote, prompt, "No text, no words, no letters, no logos anywhere in the image."]
        .filter(Boolean)
        .join(" "),
      n: 1,
      size: config.ugc.imageSize,
      quality: config.ugc.imageQuality,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Image generation failed (${res.status}): ${JSON.stringify(data).slice(0, 300)}`);
  }

  // gpt-image-1 always answers with base64; the older models answer with a
  // URL, so both are accepted.
  const entry = data.data?.[0];
  if (entry?.b64_json) {
    fs.writeFileSync(outPath, Buffer.from(entry.b64_json, "base64"));
    return outPath;
  }
  if (entry?.url) {
    const image = await fetch(entry.url);
    if (!image.ok) throw new Error(`Could not download the generated image (${image.status})`);
    fs.writeFileSync(outPath, Buffer.from(await image.arrayBuffer()));
    return outPath;
  }
  throw new Error("The image model returned no image");
}

// Draws every slide that needs drawing, a couple at a time. A slide that
// fails falls back to its gradient rather than failing the whole video: one
// missing picture is worth far less than the render.
export async function generateSlideImages(script, dir, productPhotos = []) {
  fs.mkdirSync(dir, { recursive: true });
  const out = new Array(script.slides.length).fill(null);

  const queue = [];
  script.slides.forEach((slide, i) => {
    const photo = productPhotos[slide.productImage];
    if (slide.productImage >= 0 && photo && fs.existsSync(photo)) {
      out[i] = photo;
      return;
    }
    if (slide.imagePrompt) queue.push(i);
  });

  let cursor = 0;
  const worker = async () => {
    while (cursor < queue.length) {
      const i = queue[cursor++];
      const target = path.join(dir, `slide${i}.png`);
      try {
        out[i] = await generateSlideImage(script.slides[i].imagePrompt, script.styleNote, target);
      } catch (err) {
        console.warn(`[slideshow] slide ${i + 1} image failed:`, err.message || err);
        out[i] = null;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(IMAGE_CONCURRENCY, queue.length) }, worker)
  );

  return out;
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

  const filter =
    `[0:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,` +
    `crop=${W * 2}:${H * 2},` +
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
