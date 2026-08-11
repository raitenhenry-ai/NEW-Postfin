import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import config from "../config.js";

// Cutaways for avatar videos.
//
// HeyGen can only ever give back a person in front of a background, which is
// why an avatar ad on its own reads as a talking head with a screenshot
// stuck behind her. Real UGC ads are not shot that way: the creator says a
// line, the video cuts to her hands actually using the thing, then cuts
// back, and the voice runs unbroken underneath.
//
// That cut is something we can do ourselves. The script already says, line
// by line, whether the creator is on camera or the video should cut away;
// the image model draws the product being used, from the product's own
// photos; and ffmpeg lays those shots over the finished HeyGen clip for the
// span of their line, leaving its audio untouched.
//
// The only hard part is knowing when each line is spoken. HeyGen returns one
// mp4 and no timings, so the spans are estimated from how long each line
// takes to say and then snapped to the pauses the speech actually contains.

const W = 1080;
const H = 1920;

// A cutaway shorter than this is a flicker rather than a shot.
const MIN_CUTAWAY_SECONDS = 0.9;

// How far from an estimated boundary to look for a real pause to snap to.
const SNAP_WINDOW_SECONDS = 0.7;

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(stderr);
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

// Where the speech pauses. HeyGen leaves a gap between lines, so these are
// very close to the real line boundaries.
async function silenceBoundaries(videoPath) {
  try {
    const stderr = await run(config.ffmpegPath, [
      "-i", videoPath, "-af", "silencedetect=noise=-32dB:d=0.22", "-f", "null", "-",
    ]);
    return [...stderr.matchAll(/silence_(?:start|end):\s*([\d.]+)/g)]
      .map((m) => Number(m[1]))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

// Split a duration across lines by how long each takes to say. Characters
// are a good enough proxy: the same voice reading twice the text takes
// about twice as long.
export function lineSpans(lines, duration, boundaries = []) {
  const weights = lines.map((line) => Math.max(8, String(line || "").length));
  const total = weights.reduce((a, b) => a + b, 0) || 1;

  const spans = [];
  let at = 0;
  for (const weight of weights) {
    const end = at + (weight / total) * duration;
    spans.push({ start: at, end });
    at = end;
  }

  // Nudge each boundary onto the nearest real pause, when there is one close
  // by, so a cut lands between sentences rather than inside a word.
  for (let i = 0; i < spans.length - 1; i++) {
    const edge = spans[i].end;
    const near = boundaries
      .filter((b) => Math.abs(b - edge) <= SNAP_WINDOW_SECONDS)
      .sort((a, b) => Math.abs(a - edge) - Math.abs(b - edge))[0];
    if (near !== undefined && near > spans[i].start + 0.4 && near < spans[i + 1].end - 0.4) {
      spans[i].end = near;
      spans[i + 1].start = near;
    }
  }
  return spans;
}

// Lays each cutaway image over the finished clip for the span of its line.
// `shots` is [{ index, image }] naming which line each image belongs to.
// Audio is copied untouched - the voice never stops, which is what makes it
// read as one continuous take rather than a slideshow with a face in it.
export async function spliceCutaways({ videoPath, outPath, lines, shots }) {
  const usable = (shots || []).filter((shot) => shot.image && fs.existsSync(shot.image));
  if (!usable.length) return { outPath: videoPath, cutaways: 0 };

  const duration = await probeDuration(videoPath);
  if (!duration) return { outPath: videoPath, cutaways: 0 };

  const spans = lineSpans(lines, duration, await silenceBoundaries(videoPath));
  const cuts = usable
    .map((shot) => ({ ...shot, ...spans[shot.index] }))
    .filter((cut) => cut.start !== undefined && cut.end - cut.start >= MIN_CUTAWAY_SECONDS);
  if (!cuts.length) return { outPath: videoPath, cutaways: 0 };

  const args = ["-y", "-i", videoPath];
  for (const cut of cuts) args.push("-i", cut.image);

  // Each cutaway is cover-fitted to the frame and switched on for its span.
  // A slow push in keeps a still from looking like a freeze.
  const parts = [];
  let chain = "[0:v]null[base0]";
  parts.push(chain);
  cuts.forEach((cut, i) => {
    const seconds = (cut.end - cut.start).toFixed(2);
    parts.push(
      `[${i + 1}:v]scale=${Math.round(W * 1.12)}:${Math.round(H * 1.12)}:force_original_aspect_ratio=increase,` +
      `crop=${Math.round(W * 1.12)}:${Math.round(H * 1.12)},` +
      `zoompan=z='min(1+0.0008*on,1.09)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':` +
      `s=${W}x${H}:fps=30,trim=duration=${seconds},setpts=PTS-STARTPTS+${cut.start.toFixed(2)}/TB[cut${i}]`
    );
    parts.push(
      `[base${i}][cut${i}]overlay=0:0:enable='between(t,${cut.start.toFixed(2)},${cut.end.toFixed(2)})'[base${i + 1}]`
    );
  });

  args.push(
    "-filter_complex", `${parts.join(";")};[base${cuts.length}]format=yuv420p[v]`,
    "-map", "[v]", "-map", "0:a?",
    "-c:v", "libx264", "-preset", config.videoPreset, "-crf", String(config.videoCrf),
    "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-c:a", "copy", "-movflags", "+faststart",
    outPath
  );
  await run(config.ffmpegPath, args);
  return { outPath, cutaways: cuts.length, spans };
}

export const cutawayInternals = { probeDuration, silenceBoundaries };
