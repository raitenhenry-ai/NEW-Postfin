import crypto from "node:crypto";
import fs from "node:fs";
import config from "../config.js";

// Kling image-to-video provider.
//
// Where HeyGen gives you an avatar reading the script, Kling animates the
// product photos themselves: each shot is a real photo of the product turned
// into a few seconds of motion, directed by the storyboard. That is what
// makes the result read as UGC about a product rather than a talking head.
//
// The shots are stitched together with a voiceover and captions by
// assemble.js - Kling returns silent clips.

const POLL_MS = 10 * 1000;
const MAX_WAIT_MS = 12 * 60 * 1000;

export function klingConfigured() {
  return Boolean(config.kling.accessKey && config.kling.secretKey);
}

// Kling authenticates with a short-lived JWT signed with the secret key,
// not with the key itself, so it has to be minted per request window.
function token() {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: config.kling.accessKey, exp: now + 1800, nbf: now - 5 };

  const b64 = (obj) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  const signingInput = `${b64(header)}.${b64(payload)}`;
  const signature = crypto
    .createHmac("sha256", config.kling.secretKey)
    .update(signingInput)
    .digest("base64url");
  return `${signingInput}.${signature}`;
}

async function call(path, options = {}) {
  if (!klingConfigured()) {
    throw new Error("Kling is not configured - set KLING_ACCESS_KEY and KLING_SECRET_KEY");
  }
  const res = await fetch(`${config.kling.apiBase}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data.code !== undefined && data.code !== 0)) {
    const detail = data.message || JSON.stringify(data).slice(0, 300);
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Kling rejected the credentials (${res.status}): ${detail}`);
    }
    throw new Error(`Kling ${path} failed (${res.status}): ${detail}`);
  }
  return data;
}

// Cheap credential check for the settings UI - lists recent tasks.
export async function testConnection() {
  const data = await call("/v1/videos/image2video?pageNum=1&pageSize=1");
  return { ok: true, tasks: data.data?.length ?? 0 };
}

// How a shot gets the product into frame:
//
//   reference - the product photos are passed as references so the model can
//               place the real item into a scene it generates. This is the
//               only mode that puts the actual product somewhere it was
//               never photographed.
//   image     - the photo is the first frame and is animated from there. The
//               product is unmistakably real, but the scene is whatever the
//               photo already showed.
//   text      - generated purely from the prompt. The model invents whatever
//               it depicts, so this is only for shots with no product in
//               them at all (lifestyle cutaways, hands, backgrounds).
//
// Endpoints differ per mode; the paths are configurable because Kling has
// moved them between versions.
const ENDPOINTS = {
  reference: "/v1/videos/multi-image2video",
  image: "/v1/videos/image2video",
  text: "/v1/videos/text2video",
};

function endpointFor(kind) {
  return ENDPOINTS[kind] || ENDPOINTS.image;
}

// Starts one shot. Returns { taskId, kind } - the kind is needed again to
// poll the right endpoint.
export async function startShot({ kind = "image", imageUrl, imageUrls = [], prompt }) {
  const base = {
    model_name: config.kling.model,
    prompt: String(prompt || "").slice(0, 2500),
    negative_prompt: config.kling.negativePrompt,
    mode: config.kling.mode,
    duration: String(config.kling.shotSeconds),
  };

  let body;
  if (kind === "reference" && imageUrls.length) {
    body = {
      ...base,
      // Reference images of the subject to keep in the generated scene.
      image_list: imageUrls.slice(0, 4).map((url) => ({ image: url })),
    };
  } else if (kind === "text" || (!imageUrl && !imageUrls.length)) {
    body = { ...base, aspect_ratio: "9:16", cfg_scale: config.kling.cfgScale };
  } else {
    body = {
      ...base,
      image: imageUrl || imageUrls[0],
      cfg_scale: config.kling.cfgScale,
    };
  }

  const resolved = kind === "reference" && imageUrls.length
    ? "reference"
    : (!imageUrl && !imageUrls.length) || kind === "text"
      ? "text"
      : "image";

  const data = await call(endpointFor(resolved), {
    method: "POST",
    body: JSON.stringify(body),
  });
  const taskId = data.data?.task_id;
  if (!taskId) throw new Error(`Kling returned no task_id: ${JSON.stringify(data).slice(0, 300)}`);
  return { taskId, kind: resolved };
}

// Polls one shot to completion and writes the mp4 to outPath.
export async function waitForShot(taskId, outPath, kind = "image") {
  const started = Date.now();
  for (;;) {
    const data = await call(`${endpointFor(kind)}/${encodeURIComponent(taskId)}`);
    const status = data.data?.task_status;

    if (status === "succeed") {
      const url = data.data?.task_result?.videos?.[0]?.url;
      if (!url) throw new Error("Kling finished but returned no video URL");
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Downloading the Kling shot failed (${res.status})`);
      fs.writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
      return outPath;
    }
    if (status === "failed") {
      throw new Error(`Kling shot failed: ${data.data?.task_status_msg || "unknown error"}`);
    }
    if (Date.now() - started > MAX_WAIT_MS) {
      throw new Error("Kling shot timed out after 12 minutes");
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

// Renders every shot in the storyboard that has a product photo to animate.
// Shots are submitted first and polled afterwards, so they generate in
// parallel on Kling's side rather than one after another.
export async function renderShots({ shots, workDir }) {
  if (!shots.length) throw new Error("The storyboard produced no shots");
  fs.mkdirSync(workDir, { recursive: true });

  const capped = shots.slice(0, config.kling.maxShots);
  const started = [];
  for (const [i, shot] of capped.entries()) {
    const { taskId, kind } = await startShot(shot);
    started.push({ i, taskId, kind, line: shot.line });
    console.log(`[kling] shot ${i + 1}/${capped.length} submitted (${kind})`);
  }

  const files = [];
  for (const { i, taskId, kind, line } of started) {
    const out = `${workDir}/shot${i}.mp4`;
    await waitForShot(taskId, out, kind);
    files.push({ file: out, line });
  }
  return files;
}
