import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import config from "../config.js";
import { spokenText } from "./script.js";

// Turns the silent shots a video model returns into a finished post: shots
// in order, the spoken line burned on each as a caption, an AI voiceover
// over the whole thing, normalised to vertical 1080x1920.

const W = 1080;
const H = 1920;

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with ${code}: ${stderr.slice(-1500)}`));
    });
  });
}

function probeDuration(filePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(config.ffprobePath, [
      "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", filePath,
    ]);
    let out = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.on("error", reject);
    proc.on("close", () => resolve(Number(out.trim()) || 0));
  });
}

// OpenAI text-to-speech; returns the mp3 path, or null without a key.
async function makeVoiceover(text, outPath, voice) {
  if (!config.openaiApiKey) return null;
  const res = await fetch(`${config.openaiApiBase}/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.ugc.ttsModel,
      voice: voice || config.ugc.ttsVoice,
      input: text.slice(0, 4000),
      response_format: "mp3",
    }),
  });
  if (!res.ok) {
    throw new Error(`Voiceover failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  fs.writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
  return outPath;
}

// drawtext has no wrapping of its own.
function wrap(text, width = 24) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > width && line) {
      lines.push(line);
      line = word;
    } else {
      line = (line + " " + word).trim();
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

function escapeFilterPath(p) {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

// Normalises one shot to 1080x1920 and burns its caption in. Model output is
// not reliably vertical, so it is cover-fitted rather than stretched.
async function prepareShot({ file, line, index, workDir }) {
  const out = path.join(workDir, `prepared${index}.mp4`);
  let filter =
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,` +
    `crop=${W}:${H},setsar=1`;

  if (config.fontPath && line) {
    const textFile = path.join(workDir, `caption${index}.txt`);
    fs.writeFileSync(textFile, wrap(line));
    filter +=
      `,drawtext=textfile='${escapeFilterPath(textFile)}':` +
      `fontfile='${escapeFilterPath(config.fontPath)}':` +
      `fontsize=58:fontcolor=white:line_spacing=14:borderw=3:bordercolor=black@0.7:` +
      `box=1:boxcolor=black@0.35:boxborderw=26:x=(w-text_w)/2:y=h-560`;
  }

  await run(config.ffmpegPath, [
    "-y", "-i", file,
    "-filter_complex", `${filter},format=yuv420p[v]`,
    "-map", "[v]", "-an",
    "-r", "25",
    "-c:v", "libx264", "-preset", config.videoPreset, "-crf", String(config.videoCrf),
    "-profile:v", "high",
    out,
  ]);
  return out;
}

// shots: [{ file, line }] in order. Returns { outputPath, durationSeconds }.
export async function assembleVideo({ script, shots, workDir, outputPath, settings = {} }) {
  fs.mkdirSync(workDir, { recursive: true });
  if (!shots.length) throw new Error("No shots to assemble");

  const prepared = [];
  for (const [i, shot] of shots.entries()) {
    prepared.push(await prepareShot({ ...shot, index: i, workDir }));
  }

  const listFile = path.join(workDir, "concat.txt");
  fs.writeFileSync(
    listFile,
    prepared.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n")
  );
  const silent = path.join(workDir, "silent.mp4");
  await run(config.ffmpegPath, [
    "-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", silent,
  ]);

  let voiceover = null;
  try {
    voiceover = await makeVoiceover(
      spokenText(script), path.join(workDir, "voiceover.mp3"), settings.voice
    );
  } catch (err) {
    console.warn("[ugc] voiceover skipped:", err.message || err);
  }

  // The shots and the voiceover are generated independently, so they never
  // line up exactly. The visuals are the timeline: a short voiceover is
  // padded with silence rather than truncating the video, and a long one
  // gets the closing frame held under it rather than being cut mid-sentence.
  const videoSeconds = await probeDuration(silent);
  const audioSeconds = voiceover ? await probeDuration(voiceover) : 0;
  const overrun = Math.max(0, audioSeconds - videoSeconds);

  // Some platforms reject a video with no audio stream at all, so a silent
  // track is muxed in when there is no voiceover.
  const args = ["-y", "-i", silent];
  if (voiceover) args.push("-i", voiceover);
  else args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");

  if (overrun > 0.2) {
    args.push(
      "-vf", `tpad=stop_mode=clone:stop_duration=${overrun.toFixed(2)}`,
      "-c:v", "libx264", "-preset", config.videoPreset, "-crf", String(config.videoCrf),
      "-pix_fmt", "yuv420p"
    );
  } else {
    args.push("-c:v", "copy");
  }

  args.push(
    "-map", "0:v", "-map", "1:a",
    "-af", "apad",
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
    "-shortest", "-movflags", "+faststart",
    outputPath
  );
  await run(config.ffmpegPath, args);

  return { outputPath, durationSeconds: await probeDuration(outputPath) };
}
