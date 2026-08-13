import * as tiktok from "./tiktok.js";
import * as instagram from "./instagram.js";
import * as youtube from "./youtube.js";
import { platforms } from "../accounts.js";

const ADAPTERS = {
  tiktok,
  instagram,
  youtube,
};

// Platform id used for stats APIs. TikTok needs the public video id.
export function statsId(post) {
  if (post.platform === "tiktok") return post.public_post_id || null;
  return post.platform_video_id || null;
}

// Prefer dedicated adapters; fall back to platform.fetchStats for others.
export async function fetchAnalyticsForAccount(account, posts) {
  const platform = account.platform;
  const keyed = posts
    .map((post) => ({ post, statsId: statsId(post) }))
    .filter((e) => e.statsId);

  if (!keyed.length) return {};

  const adapter = ADAPTERS[platform];
  if (adapter?.getPostAnalyticsBatch) {
    return adapter.getPostAnalyticsBatch(account, keyed);
  }

  const mod = platforms[platform];
  if (!mod?.fetchStats) return {};
  return mod.fetchStats(account, keyed.map((e) => e.statsId));
}

export function hasAnalyticsAdapter(platform) {
  return Boolean(ADAPTERS[platform] || platforms[platform]?.fetchStats);
}
