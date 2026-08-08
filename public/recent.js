/* Recent: every generated video newest first, with its per-account publish
   results and the actions that move a stuck job along. */
(() => {
  const { api, escapeHtml, platformIcon, PLATFORM_LABELS, fmtCompact,
          fmtRelative, fmtDateTime, toast, errorBlock, emptyBlock } = window.Postfin;

  const feed = document.getElementById("recent-feed");

  // Jobs that are mid-pipeline get polled so the page follows along.
  const ACTIVE = ["queued", "scraping", "scripting", "rendering", "posting"];
  let pollTimer = null;

  // Job statuses (queued/rendering/ready/posted/failed) and post statuses
  // (pending/posting/done/failed) both land here.
  function statusChip(status) {
    const tone = status === "posted" || status === "done" ? "green"
      : status === "failed" ? "red"
      : status === "ready" ? "amber" : "blue";
    return `<span class="recent-status is-${tone}">${escapeHtml(status)}</span>`;
  }

  function postRow(post) {
    const metrics = post.views !== null
      ? `<span class="recent-post-metric">${fmtCompact(post.views, 1)} views</span>`
      : "";
    const link = post.url
      ? `<a class="recent-post-link" href="${escapeHtml(post.url)}" target="_blank" rel="noopener">View</a>`
      : "";
    return `
      <li class="recent-post ${post.status === "failed" ? "is-failed" : ""}">
        <span class="platform-badge" aria-hidden="true">${platformIcon(post.platform)}</span>
        <span class="recent-post-account">${escapeHtml(post.accountName || PLATFORM_LABELS[post.platform] || post.platform)}</span>
        ${statusChip(post.status)}
        ${metrics}
        ${link}
        ${post.error ? `<span class="recent-post-error" title="${escapeHtml(post.error)}">${escapeHtml(post.error)}</span>` : ""}
      </li>`;
  }

  function aboutText(job) {
    if (job.brief) return job.brief;
    if (job.script?.caption) return job.script.caption;
    if (job.concept?.angle) return job.concept.angle;
    return "";
  }

  function thumbBlock(job) {
    const img = job.product?.images?.[0];
    if (img) {
      return job.videoUrl
        ? `<a class="recent-card-thumb" href="${escapeHtml(job.videoUrl)}" target="_blank" rel="noopener" aria-label="Open video">
             <img src="${escapeHtml(img)}" alt="" loading="lazy">
           </a>`
        : `<div class="recent-card-thumb"><img src="${escapeHtml(img)}" alt="" loading="lazy"></div>`;
    }
    if (job.videoUrl) {
      return `<a class="recent-card-thumb" href="${escapeHtml(job.videoUrl)}" target="_blank" rel="noopener" aria-label="Open video">
        <video src="${escapeHtml(job.videoUrl)}" muted playsinline preload="metadata"></video>
      </a>`;
    }
    return `<div class="recent-card-thumb video-thumb-fallback" aria-hidden="true"></div>`;
  }

  function jobCard(job) {
    const when = job.scheduledAt && job.status !== "posted"
      ? `Scheduled for ${escapeHtml(fmtDateTime(job.scheduledAt))}`
      : `Created ${escapeHtml(fmtRelative(job.createdAt))}`;
    const about = aboutText(job);
    const failedPosts = job.posts.filter((p) => p.status === "failed").length;

    return `
      <article class="recent-card" data-job="${job.id}">
        <div class="recent-card-main">
          ${thumbBlock(job)}
          <div class="recent-card-copy">
            <div class="recent-card-title-row">
              <h3>${escapeHtml(job.title)}</h3>
              ${statusChip(job.status)}
            </div>
            <p class="recent-card-meta">${when} · ${escapeHtml(job.provider === "heygen" ? "HeyGen" : "built-in")}</p>
            ${about ? `<p class="recent-card-about">${escapeHtml(about)}</p>` : ""}
            ${job.productUrl
              ? `<a class="recent-card-product" href="${escapeHtml(job.productUrl)}" target="_blank" rel="noopener">${escapeHtml(job.productUrl)}</a>`
              : ""}
            ${job.error ? `<p class="recent-card-error">${escapeHtml(job.error)}</p>` : ""}
            ${job.posts.length
              ? `<ul class="recent-posts">${job.posts.map(postRow).join("")}</ul>`
              : `<p class="recent-card-meta">Not published yet.</p>`}
            <div class="recent-card-actions">
              <button type="button" class="pf-btn danger" data-action="delete">Delete</button>
            </div>
          </div>
        </div>
      </article>`;
  }

  async function act(jobId, action, button) {
    const calls = {
      retry: () => api(`/api/jobs/${jobId}/retry`, { method: "POST", body: {} }),
      post: () => api(`/api/jobs/${jobId}/post`, { method: "POST", body: {} }),
      "post-failed": () => api(`/api/jobs/${jobId}/post`, { method: "POST", body: { onlyFailed: true } }),
      regenerate: () => api(`/api/jobs/${jobId}/regenerate`, { method: "POST", body: {} }),
      delete: () => api(`/api/jobs/${jobId}`, { method: "DELETE" }),
    };
    if (action === "delete" && !confirm("Delete this video and its post history?")) return;
    if (action === "regenerate" && !confirm("Throw away the script and video and start over?")) return;

    button.disabled = true;
    try {
      const result = await calls[action]();
      if (action === "post" || action === "post-failed") {
        toast(`Posted to ${result.posted}, failed ${result.failed}, skipped ${result.skipped}`);
      } else {
        toast("Done");
      }
      await load();
    } catch (err) {
      toast(err.message, "error");
      button.disabled = false;
    }
  }

  function bind() {
    feed.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const jobId = btn.closest("[data-job]").dataset.job;
        act(jobId, btn.dataset.action, btn);
      });
    });
  }

  async function load() {
    try {
      const jobs = await api("/api/recent");
      feed.innerHTML = jobs.length
        ? jobs.map(jobCard).join("")
        : emptyBlock("No videos yet. Schedule one from the dashboard or the calendar.");
      bind();

      // Keep refreshing while anything is still working.
      clearTimeout(pollTimer);
      if (jobs.some((j) => ACTIVE.includes(j.status))) {
        pollTimer = setTimeout(load, 5000);
      }
    } catch (err) {
      feed.innerHTML = errorBlock(`Couldn't load recent activity: ${err.message}`);
    }
  }

  document.getElementById("recent-refresh")?.addEventListener("click", load);
  load();
})();
