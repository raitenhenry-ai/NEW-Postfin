// YouTube analytics adapter — videos.list statistics (≤50 ids/call).

export async function getPostAnalyticsBatch(account, posts) {
  const out = {};
  const ids = posts.map((p) => p.statsId).filter(Boolean);
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${chunk.join(",")}&maxResults=50`,
      { headers: { Authorization: `Bearer ${account.access_token}` } }
    );
    const data = await res.json();
    if (res.status === 429 || res.status === 403) {
      const err = new Error(`YouTube stats failed (${res.status}): ${JSON.stringify(data)}`);
      err.code = res.status === 429 ? "RATE_LIMIT" : "API_ERROR";
      throw err;
    }
    if (!res.ok) throw new Error(`YouTube stats failed (${res.status}): ${JSON.stringify(data)}`);
    for (const item of data.items || []) {
      out[item.id] = {
        views: Number(item.statistics?.viewCount || 0),
        likes: Number(item.statistics?.likeCount || 0),
        comments: Number(item.statistics?.commentCount || 0),
      };
    }
  }
  return out;
}
