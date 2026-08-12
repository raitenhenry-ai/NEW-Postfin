import fs from "node:fs";
import config from "../config.js";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL =
  `${config.youtube.apiBase}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`;

export function isConfigured() {
  return Boolean(config.youtube.clientId && config.youtube.clientSecret);
}

function redirectUri() {
  return `${config.baseUrl}/auth/youtube/callback`;
}

export function authUrl(state) {
  const params = new URLSearchParams({
    client_id: config.youtube.clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${AUTH_URL}?${params}`;
}

export async function handleCallback(code) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.youtube.clientId,
      client_secret: config.youtube.clientSecret,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`YouTube token exchange failed: ${JSON.stringify(data)}`);

  let externalId = null;
  let displayName = "YouTube channel";
  try {
    const chRes = await fetch(
      "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
      { headers: { Authorization: `Bearer ${data.access_token}` } }
    );
    const ch = await chRes.json();
    if (chRes.ok && ch.items?.length) {
      externalId = ch.items[0].id;
      displayName = ch.items[0].snippet?.title || displayName;
    }
  } catch {
    // Channel lookup is cosmetic; the upload scope is what matters.
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    externalId,
    displayName,
  };
}

export async function refresh(account) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: account.refresh_token,
      client_id: config.youtube.clientId,
      client_secret: config.youtube.clientSecret,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`YouTube token refresh failed: ${JSON.stringify(data)}`);
  return {
    accessToken: data.access_token,
    refreshToken: account.refresh_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
}

// Returns a map of videoId -> {views, likes, comments} for up to 50 ids/call.
export async function fetchStats(account, videoIds) {
  const stats = {};
  for (let i = 0; i < videoIds.length; i += 50) {
    const chunk = videoIds.slice(i, i + 50);
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${chunk.join(",")}&maxResults=50`,
      { headers: { Authorization: `Bearer ${account.access_token}` } }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(`YouTube stats failed (${res.status}): ${JSON.stringify(data)}`);
    for (const item of data.items || []) {
      stats[item.id] = {
        views: Number(item.statistics?.viewCount || 0),
        likes: Number(item.statistics?.likeCount || 0),
        comments: Number(item.statistics?.commentCount || 0),
      };
    }
  }
  return stats;
}

// YouTube rejects a title containing angle brackets outright, and truncates
// past 100 characters. A rejected upload for a reason this trivial is not
// worth the round trip.
function cleanTitle(raw) {
  const text = String(raw || "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
  return (text || "New video").slice(0, 100);
}

export async function uploadClip(account, { filePath, title, description }) {
  const size = fs.statSync(filePath).size;
  const initRes = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${account.access_token}`,
      "Content-Type": "application/json",
      "X-Upload-Content-Length": String(size),
      "X-Upload-Content-Type": "video/mp4",
    },
    body: JSON.stringify({
      snippet: {
        title: cleanTitle(title),
        description: String(description || "").replace(/[<>]/g, "").slice(0, 4900),
        categoryId: "22",
      },
      status: {
        privacyStatus: config.youtube.privacyStatus,
        selfDeclaredMadeForKids: false,
      },
    }),
  });
  if (!initRes.ok) {
    throw new Error(`YouTube upload init failed (${initRes.status}): ${await initRes.text()}`);
  }
  const sessionUrl = initRes.headers.get("location");
  if (!sessionUrl) throw new Error("YouTube upload init returned no session URL");

  const putRes = await fetch(sessionUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${account.access_token}`,
      "Content-Type": "video/mp4",
      "Content-Length": String(size),
    },
    body: fs.createReadStream(filePath),
    duplex: "half",
  });
  const result = await putRes.json().catch(() => ({}));
  if (!putRes.ok) {
    throw new Error(`YouTube upload failed (${putRes.status}): ${JSON.stringify(result)}`);
  }
  if (!result.id) {
    throw new Error(`YouTube accepted the upload but returned no video id: ${JSON.stringify(result).slice(0, 300)}`);
  }

  // A 200 from the upload does not mean the video is live. YouTube rejects
  // videos after the fact, and - the one that catches everyone - an API
  // project that has not been through Google's audit has every upload forced
  // to private no matter what privacyStatus asked for. Both look like a
  // successful post from here unless the video is read back.
  const check = await verifyUpload(account, result.id);
  return { id: result.id, warning: check.warning };
}

// What actually happened to the video, in YouTube's words.
async function verifyUpload(account, videoId) {
  try {
    const res = await fetch(
      `${config.youtube.apiBase}/youtube/v3/videos?part=status&id=${encodeURIComponent(videoId)}`,
      { headers: { Authorization: `Bearer ${account.access_token}` } }
    );
    const data = await res.json();
    const status = data.items?.[0]?.status;
    if (!res.ok || !status) return {};

    if (status.uploadStatus === "rejected" || status.uploadStatus === "failed") {
      throw new Error(
        `YouTube rejected the video (${status.rejectionReason || status.failureReason || status.uploadStatus})`
      );
    }

    const wanted = config.youtube.privacyStatus;
    if (status.privacyStatus && status.privacyStatus !== wanted) {
      return {
        warning:
          `YouTube published this as "${status.privacyStatus}" although "${wanted}" was ` +
          "requested. Google forces every upload private until the API project has " +
          "passed its audit - check the OAuth consent screen and quota status in " +
          "Google Cloud, or set the video public by hand.",
      };
    }
    return {};
  } catch (err) {
    // A rejection is a real failure and propagates; anything else here is
    // only a failed read-back and must not fail a video that did upload.
    if (/YouTube rejected/.test(err.message || "")) throw err;
    return {};
  }
}

// Subscriber count for the connected channel; powers the followers chart.
export async function fetchAudience(account) {
  const res = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?part=statistics&mine=true",
    { headers: { Authorization: `Bearer ${account.access_token}` } }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`YouTube channel stats failed: ${JSON.stringify(data)}`);
  return { followers: Number(data.items?.[0]?.statistics?.subscriberCount || 0) };
}
