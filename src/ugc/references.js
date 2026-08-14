import fs from "node:fs";
import path from "node:path";
import config from "../config.js";

// Reference links and images the user pinned on a calendar post. They are
// creative direction for the script / slideshow writers - the same material
// the Prompt tab shows as part of the brief.

const MAX_REF_IMAGES = 6;
const MAX_DATA_URL_BYTES = 4 * 1024 * 1024;
const VISION_MIME = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export function listReferences(settings = {}) {
  return (Array.isArray(settings.references) ? settings.references : [])
    .map((raw) => ({
      kind: raw?.kind === "image" ? "image" : "link",
      url: String(raw?.url || "").trim(),
      name: String(raw?.name || "").trim() || null,
    }))
    .filter((r) => r.url);
}

// Text block appended to briefs / prompt displays so the model (and the
// user reading the Prompt tab) sees the same references.
export function formatReferencesBlock(settings = {}, product = null) {
  const parts = [];
  const refs = listReferences(settings);
  if (refs.length) {
    const lines = refs.map((ref) => {
      if (ref.kind === "image") {
        return `- Image${ref.name ? ` (${ref.name})` : ""}: ${ref.url}`;
      }
      return `- Link${ref.name ? ` (${ref.name})` : ""}: ${ref.url}`;
    });
    parts.push(
      "References (match the look, vibe, and framing of these - do not copy " +
        "their text or claim their results):\n" +
        lines.join("\n")
    );
  }

  const productImage = product?.images?.[0] || null;
  if (productImage) {
    parts.push(
      `Main product image (lead with this look):\n${productImage}`
    );
  }
  return parts.join("\n\n");
}

export function referenceImageUrls(settings = {}) {
  return listReferences(settings)
    .filter((r) => r.kind === "image")
    .map((r) => r.url)
    .slice(0, MAX_REF_IMAGES);
}

// OpenAI has to fetch http(s) image URLs itself. Local uploads live on this
// server, so inline them as data URLs rather than hoping their crawler can
// reach us.
export function visionImageUrl(src) {
  try {
    const parsed = new URL(String(src), config.baseUrl);
    const match = parsed.pathname.match(/\/ugc-media\/uploads\/([^/]+)$/);
    if (!match) return String(src);
    const file = path.join(config.ugcDir, "uploads", path.basename(match[1]));
    if (!fs.existsSync(file)) return String(src);
    const buf = fs.readFileSync(file);
    if (!buf.length || buf.length > MAX_DATA_URL_BYTES) return String(src);
    const mime = VISION_MIME[path.extname(file).toLowerCase()] || "image/jpeg";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return String(src || "");
  }
}

// Build a chat user turn: plain text, or text + product photos + reference
// images the model can actually see.
export function visionUserContent(text, product = null, settings = {}) {
  const productImages = (product?.images || []).slice(0, 5);
  const refImages = referenceImageUrls(settings);
  const urls = [...productImages, ...refImages].map(visionImageUrl).filter(Boolean);
  if (!urls.length) return text;

  const notes = [];
  if (productImages.length) {
    notes.push(
      `The next ${productImages.length} image(s) are the product photos, in order ` +
        "(photo 0 first). Refer to them by index in the storyboard."
    );
  }
  if (refImages.length) {
    notes.push(
      `The last ${refImages.length} image(s) are creative references the user ` +
        "picked (posts / products they like). Match their vibe and framing; " +
        "do not recreate them as-is."
    );
  }

  return [
    { type: "text", text: `${text}\n\n${notes.join(" ")}` },
    ...urls.map((url) => ({ type: "image_url", image_url: { url, detail: "low" } })),
  ];
}
