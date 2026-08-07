import config from "../config.js";
import { toneOptions, styleOptions } from "./script.js";

// Content planning: turns one written brief plus a set of dates into one
// distinct video concept per date.
//
// This is the step that makes the calendar's composer an actual planner
// rather than a URL field. The brief is creative direction ("a week of
// high-protein breakfast ideas for my supplement brand"); the planner
// decides what each individual video is about so a week of posts covers
// different angles instead of repeating one idea N times.
//
// A product URL is optional. When one is given the concepts are written
// around that product; without one they stand on the brief alone.

const MAX_SLOTS = 30;

export async function planContent({ brief, count, productUrl = "", tone, style }) {
  const slots = Math.max(1, Math.min(MAX_SLOTS, Number(count) || 1));
  const cleanBrief = String(brief || "").trim().slice(0, 2000);
  if (!cleanBrief && !productUrl) {
    throw new Error("Describe what you want, or include a product URL");
  }

  if (!config.openaiApiKey) return templatePlan(cleanBrief, slots, productUrl);

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
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
            "You plan short-form social video content (TikTok/Reels/Shorts) for a creator. " +
            `Given a brief, plan exactly ${slots} DISTINCT video concept(s). ` +
            'Reply with JSON only: {"concepts": [{"title": string, "angle": string, ' +
            '"talkingPoints": string[]}]}. ' +
            "title: 2-5 words, what the video is, no hashtags. " +
            "angle: one sentence describing how this video is shot and what makes it " +
            "different from the others in the set. " +
            "talkingPoints: 2-4 short phrases the creator should cover. " +
            "Every concept must be genuinely different - different hook, different " +
            "sub-topic. Never repeat the same idea with reworded titles. " +
            "Ground everything in the brief; never invent specs, prices, medical " +
            "claims or discounts.",
        },
        {
          role: "user",
          content:
            (cleanBrief ? `Brief: ${cleanBrief}\n` : "") +
            (productUrl ? `Product page: ${productUrl}\n` : "") +
            (tone ? `Tone: ${tone}\n` : "") +
            (style ? `Style: ${style}\n` : "") +
            `\nPlan ${slots} video(s).`,
        },
      ],
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Planning failed (${res.status}): ${JSON.stringify(data).slice(0, 300)}`);
  }

  const parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}");
  const concepts = (Array.isArray(parsed.concepts) ? parsed.concepts : [])
    .map((c) => ({
      title: String(c?.title || "").trim().slice(0, 120),
      angle: String(c?.angle || "").trim().slice(0, 400),
      talkingPoints: (Array.isArray(c?.talkingPoints) ? c.talkingPoints : [])
        .map((t) => String(t).trim())
        .filter(Boolean)
        .slice(0, 6),
    }))
    .filter((c) => c.title);

  if (!concepts.length) throw new Error("The planner returned no concepts - try rewording the brief");

  // The model occasionally returns fewer than asked; pad by cycling so every
  // selected date still gets a video rather than silently dropping days.
  const planned = concepts.length;
  while (concepts.length < slots) {
    const source = concepts[concepts.length % planned];
    concepts.push({ ...source, title: `${source.title} (${concepts.length + 1})` });
  }

  return {
    concepts: concepts.slice(0, slots),
    generatedBy: "openai",
    brief: cleanBrief,
  };
}

// Without an OpenAI key there is nothing to plan with, so each slot gets the
// brief itself as its concept. The script step falls back to templates too,
// so the pipeline still produces a video end to end.
function templatePlan(brief, slots, productUrl) {
  const base = brief || `New video about ${productUrl}`;
  const short = base.split(/(?<=[.!?])\s+/)[0].slice(0, 80) || base.slice(0, 80);
  const concepts = Array.from({ length: slots }, (_, i) => ({
    title: slots === 1 ? short : `${short} (${i + 1}/${slots})`,
    angle: base,
    talkingPoints: [],
  }));
  return { concepts, generatedBy: "template", brief };
}

// Validates the tone/style a caller passed, falling back to the defaults the
// script generator uses.
export function normalizeSettings({ tone, style }) {
  return {
    tone: toneOptions().includes(tone) ? tone : "casual",
    style: styleOptions().includes(style) ? style : "product_pov",
  };
}
