// Instagram analytics adapter — per-media insights (Graph API).

const GRAPH = "https://graph.instagram.com";

export async function getPostAnalyticsBatch(account, posts) {
  const out = {};
  for (const post of posts) {
    const id = post.statsId;
    if (!id) continue;
    let got = null;
    for (const metricSet of ["views,likes,comments,shares,saved", "plays,likes,comments,shares,saved"]) {
      const res = await fetch(
        `${GRAPH}/${id}/insights?metric=${metricSet}&access_token=${account.access_token}`
      );
      if (res.status === 429) {
        const err = new Error("Instagram rate limited");
        err.code = "RATE_LIMIT";
        throw err;
      }
      const data = await res.json();
      if (!res.ok) continue;
      const byName = Object.fromEntries(
        (data.data || []).map((m) => [m.name, Number(m.values?.[0]?.value || 0)])
      );
      got = {
        views: byName.views ?? byName.plays ?? 0,
        likes: byName.likes ?? 0,
        comments: byName.comments ?? 0,
        shares: byName.shares ?? 0,
        saves: byName.saved ?? 0,
      };
      break;
    }
    if (got) out[id] = got;
  }
  return out;
}
