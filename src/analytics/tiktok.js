// TikTok analytics adapter — batches video query requests (≤20 ids/call).

export async function getPostAnalyticsBatch(account, posts) {
  const out = {};
  const ids = posts.map((p) => p.statsId).filter(Boolean);
  for (let i = 0; i < ids.length; i += 20) {
    const chunk = ids.slice(i, i + 20);
    const res = await fetch(
      "https://open.tiktokapis.com/v2/video/query/?fields=id,view_count,like_count,comment_count,share_count",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${account.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ filters: { video_ids: chunk } }),
      }
    );
    const data = await res.json();
    if (res.status === 429) {
      const err = new Error(`TikTok rate limited: ${JSON.stringify(data.error || data)}`);
      err.code = "RATE_LIMIT";
      throw err;
    }
    if (!res.ok || data.error?.code !== "ok") {
      throw new Error(`TikTok stats failed: ${JSON.stringify(data.error || data)}`);
    }
    for (const v of data.data?.videos || []) {
      out[String(v.id)] = {
        views: Number(v.view_count || 0),
        likes: Number(v.like_count || 0),
        comments: Number(v.comment_count || 0),
        shares: Number(v.share_count || 0),
      };
    }
  }
  return out;
}
