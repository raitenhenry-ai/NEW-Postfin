import { q, q1 } from "../db.js";

const METRICS = ["views", "likes", "comments", "shares", "saves"];

/**
 * Views (etc.) gained in a window = latest − closest snapshot at/before sinceMs.
 * If no baseline exists, uses the first observed snapshot after sinceMs
 * (never invents pre-Postfin history).
 */
export async function metricGainsSince(sinceMs, platform = null) {
  const params = [];
  let platformFilter = "";
  if (platform) {
    platformFilter = "AND p.platform = ?";
    params.push(platform);
  }

  // Latest snapshot per post.
  const latest = await q(
    `SELECT p.id AS post_id, p.platform, p.posted_at,
            m.views, m.likes, m.comments, m.shares, m.saves, m.collected_at
     FROM ugc_posts p
     JOIN post_metrics m ON m.post_id = p.id
     WHERE p.status = 'done'
       ${platformFilter}
       AND m.collected_at = (
         SELECT MAX(m2.collected_at) FROM post_metrics m2 WHERE m2.post_id = p.id
       )`,
    params
  );

  const gains = Object.fromEntries(METRICS.map((k) => [k, 0]));
  let postsWithData = 0;

  for (const row of latest) {
    const baselineParams = [row.post_id, sinceMs];
    let baseline = await q1(
      `SELECT views, likes, comments, shares, saves, collected_at
       FROM post_metrics
       WHERE post_id = ? AND collected_at <= ?
       ORDER BY collected_at DESC LIMIT 1`,
      baselineParams
    );
    if (!baseline) {
      baseline = await q1(
        `SELECT views, likes, comments, shares, saves, collected_at
         FROM post_metrics
         WHERE post_id = ? AND collected_at > ?
         ORDER BY collected_at ASC LIMIT 1`,
        baselineParams
      );
    }
    if (!baseline) continue;

    postsWithData++;
    for (const key of METRICS) {
      const delta = Number(row[key] || 0) - Number(baseline[key] || 0);
      gains[key] += Math.max(0, delta);
    }
  }

  return { ...gains, postsWithData };
}

/** All-time gain: latest − first snapshot per post. */
export async function metricGainsAllTime(platform = null) {
  const params = [];
  let platformFilter = "";
  if (platform) {
    platformFilter = "AND p.platform = ?";
    params.push(platform);
  }

  const rows = await q(
    `SELECT p.id AS post_id,
            latest.views AS lv, latest.likes AS ll, latest.comments AS lc,
            latest.shares AS ls, latest.saves AS lsa,
            first.views AS fv, first.likes AS fl, first.comments AS fc,
            first.shares AS fs, first.saves AS fsa
     FROM ugc_posts p
     JOIN post_metrics latest ON latest.post_id = p.id AND latest.collected_at = (
       SELECT MAX(m2.collected_at) FROM post_metrics m2 WHERE m2.post_id = p.id
     )
     JOIN post_metrics first ON first.post_id = p.id AND first.collected_at = (
       SELECT MIN(m3.collected_at) FROM post_metrics m3 WHERE m3.post_id = p.id
     )
     WHERE p.status = 'done' ${platformFilter}`,
    params
  );

  const gains = Object.fromEntries(METRICS.map((k) => [k, 0]));
  for (const row of rows) {
    gains.views += Math.max(0, Number(row.lv || 0) - Number(row.fv || 0));
    gains.likes += Math.max(0, Number(row.ll || 0) - Number(row.fl || 0));
    gains.comments += Math.max(0, Number(row.lc || 0) - Number(row.fc || 0));
    gains.shares += Math.max(0, Number(row.ls || 0) - Number(row.fs || 0));
    gains.saves += Math.max(0, Number(row.lsa || 0) - Number(row.fsa || 0));
  }
  return { ...gains, postsWithData: rows.length };
}

export async function postsPublishedInRange(sinceMs, platform = null) {
  const params = [sinceMs];
  let platformFilter = "";
  if (platform) {
    platformFilter = "AND platform = ?";
    params.push(platform);
  }
  const row = await q1(
    `SELECT COUNT(*) AS n FROM ugc_posts
     WHERE status = 'done' AND posted_at > ? ${platformFilter}`,
    params
  );
  return Number(row?.n || 0);
}

export async function postsPublishedAllTime(platform = null) {
  const params = [];
  let platformFilter = "";
  if (platform) {
    platformFilter = "WHERE status = 'done' AND platform = ?";
    params.push(platform);
  } else {
    platformFilter = "WHERE status = 'done'";
  }
  const row = await q1(`SELECT COUNT(*) AS n FROM ugc_posts ${platformFilter}`, params);
  return Number(row?.n || 0);
}

/** Resolve gains for a range key using sinceMs, or all-time. */
export async function gainsForRange(range, platform = null) {
  if (range.key === "all") {
    const gains = await metricGainsAllTime(platform);
    const published = await postsPublishedAllTime(platform);
    return { ...gains, published };
  }
  const gains = await metricGainsSince(range.sinceMs, platform);
  const published = await postsPublishedInRange(range.sinceMs, platform);
  return { ...gains, published };
}
