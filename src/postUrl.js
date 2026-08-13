// Public profile / page URL for a connected account, when we have enough
// to build one. Prefer a @username in displayName; fall back to platform ids.
export function accountProfileUrl({ platform, displayName, externalId } = {}) {
  const handle = String(displayName || "").trim().replace(/^@/, "");
  const id = externalId != null ? String(externalId) : "";
  const enc = encodeURIComponent;

  switch (platform) {
    case "instagram":
      return handle ? `https://www.instagram.com/${enc(handle)}/` : null;
    case "threads":
      return handle ? `https://www.threads.net/@${enc(handle)}` : null;
    case "tiktok":
      // TikTok often stores a display name, not the unique @id — only link
      // when it looks like a handle (no spaces).
      return handle && !/\s/.test(handle) ? `https://www.tiktok.com/@${enc(handle)}` : null;
    case "x":
      return handle ? `https://x.com/${enc(handle)}` : null;
    case "youtube":
      if (id) return `https://www.youtube.com/channel/${enc(id)}`;
      return handle ? `https://www.youtube.com/@${enc(handle)}` : null;
    case "facebook":
      return id ? `https://www.facebook.com/${enc(id)}` : null;
    case "linkedin":
      if (id.startsWith("org:")) {
        return `https://www.linkedin.com/company/${enc(id.slice(4))}/`;
      }
      return null;
    case "pinterest":
      return handle ? `https://www.pinterest.com/${enc(handle)}/` : null;
    case "reddit":
      return handle ? `https://www.reddit.com/user/${enc(handle)}/` : null;
    default:
      return null;
  }
}

// Builds the public link to a published post from what the platforms give
// us. public_post_id holds a full permalink where the platform provides one
// (Instagram/Threads) or the public video id (TikTok); platform_video_id
// holds the id returned at publish time.
export function postUrl(u) {
  const id = u.platform_video_id;
  const pub = u.public_post_id;
  if (pub && /^https?:\/\//i.test(pub)) return pub;
  switch (u.platform) {
    case "youtube":
      return id ? `https://youtu.be/${encodeURIComponent(id)}` : null;
    case "facebook":
      return id ? `https://www.facebook.com/reel/${encodeURIComponent(id)}` : null;
    case "x":
      // /i/status resolves without needing the handle.
      return id ? `https://x.com/i/status/${encodeURIComponent(id)}` : null;
    case "pinterest":
      return id ? `https://www.pinterest.com/pin/${encodeURIComponent(id)}/` : null;
    case "linkedin":
      return id ? `https://www.linkedin.com/feed/update/${encodeURIComponent(id)}/` : null;
    case "tiktok": {
      if (!pub) return null;
      const handle = String(u.account_name || u.accountName || "").replace(/^@/, "");
      return handle ? `https://www.tiktok.com/@${handle}/video/${encodeURIComponent(pub)}` : null;
    }
    default:
      // instagram/threads permalinks arrive via public_post_id (handled above).
      return null;
  }
}
