/* Recent: vertical video gallery. Click a tile for the full video + details. */
(() => {
  const { api, escapeHtml, platformIcon, PLATFORM_LABELS, fmtCompact,
          fmtRelative, fmtDateTime, toast, errorBlock, emptyBlock } = window.Postfin;

  const feed = document.getElementById("recent-feed");
  const modal = document.getElementById("recent-modal");
  const modalBody = document.getElementById("recent-modal-body");
  const modalTitle = document.getElementById("recent-modal-title");

  const ACTIVE = ["queued", "scraping", "scripting", "rendering", "posting"];
  let pollTimer = null;
  let jobsById = new Map();

  function caption(job) {
    return job.script?.caption || job.brief || job.concept?.angle || job.title || "";
  }

  function shortCaption(job, max = 72) {
    const text = caption(job).replace(/\s+/g, " ").trim();
    if (!text) return "No caption yet";
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  function platformsFor(job) {
    const fromPosts = [...new Set(job.posts.map((p) => p.platform).filter(Boolean))];
    if (fromPosts.length) return fromPosts;
    return job.settings?.platforms || [];
  }

  function platformIcons(job) {
    const keys = platformsFor(job);
    if (!keys.length) return "";
    return `
      <span class="recent-tile-platforms">
        ${keys.map((key) => `
          <span class="recent-tile-app" title="${escapeHtml(PLATFORM_LABELS[key] || key)}" aria-hidden="true">
            ${platformIcon(key)}
          </span>`).join("")}
      </span>`;
  }

  function thumbMedia(job) {
    const img = job.product?.images?.[0];
    if (img) return `<img src="${escapeHtml(img)}" alt="" loading="lazy">`;
    if (job.videoUrl) {
      return `<video src="${escapeHtml(job.videoUrl)}" muted playsinline preload="metadata"></video>`;
    }
    return `<div class="video-thumb-fallback" aria-hidden="true"></div>`;
  }

  function jobTile(job) {
    return `
      <button type="button" class="recent-tile" data-open="${job.id}" aria-label="${escapeHtml(job.title)}">
        <span class="recent-tile-thumb">
          <span class="recent-tile-media">${thumbMedia(job)}</span>
          ${platformIcons(job)}
        </span>
        <span class="recent-tile-caption">${escapeHtml(shortCaption(job))}</span>
      </button>`;
  }

  function statusChip(status) {
    const tone = status === "posted" || status === "done" ? "green"
      : status === "failed" ? "red"
      : status === "ready" ? "amber" : "blue";
    return `<span class="recent-status is-${tone}">${escapeHtml(status)}</span>`;
  }

  function postRow(post) {
    const link = post.url
      ? `<a class="recent-post-link" href="${escapeHtml(post.url)}" target="_blank" rel="noopener">View</a>`
      : "";
    return `
      <li class="recent-post">
        <span class="platform-badge" aria-hidden="true">${platformIcon(post.platform)}</span>
        <span class="recent-post-account">${escapeHtml(post.accountName || PLATFORM_LABELS[post.platform] || post.platform)}</span>
        ${statusChip(post.status)}
        ${link}
      </li>`;
  }

  function totalViews(job) {
    return job.posts.reduce((sum, p) => sum + (Number(p.views) || 0), 0);
  }

  function detailThumb(job) {
    const img = job.product?.images?.[0];
    if (img) return `<img src="${escapeHtml(img)}" alt="">`;
    if (job.videoUrl) {
      return `<video src="${escapeHtml(job.videoUrl)}" muted playsinline preload="metadata"></video>`;
    }
    return `<div class="video-thumb-fallback" aria-hidden="true"></div>`;
  }

  function openDetail(jobId) {
    const job = jobsById.get(String(jobId));
    if (!job || !modal || !modalBody) return;

    const when = job.scheduledAt && job.status !== "posted"
      ? `Scheduled for ${escapeHtml(fmtDateTime(job.scheduledAt))}`
      : `Created ${escapeHtml(fmtRelative(job.createdAt))}`;
    const text = caption(job);
    const views = totalViews(job);
    const viewsLabel = fmtCompact(views, 1);

    if (modalTitle) modalTitle.textContent = job.title || "Video";
    modalBody.innerHTML = `
      <div class="recent-detail-views">
        <span class="recent-detail-views-value">${escapeHtml(viewsLabel)}</span>
        <span class="recent-detail-views-label">views</span>
      </div>
      <div class="recent-detail-thumb">
        ${detailThumb(job)}
        <div class="recent-detail-thumb-views">
          <strong>${escapeHtml(viewsLabel)}</strong>
          <span>views</span>
        </div>
      </div>
      <div class="recent-detail-meta">
        ${statusChip(job.status)}
        <span>${when} · ${escapeHtml(job.provider === "heygen" ? "HeyGen" : "built-in")}</span>
      </div>
      ${text ? `<p class="recent-detail-caption">${escapeHtml(text)}</p>` : ""}
      ${job.productUrl
        ? `<a class="recent-card-product" href="${escapeHtml(job.productUrl)}" target="_blank" rel="noopener">${escapeHtml(job.productUrl)}</a>`
        : ""}
      ${job.error ? `<p class="recent-card-error">${escapeHtml(job.error)}</p>` : ""}
      ${job.posts.length
        ? `<ul class="recent-posts">${job.posts.map(postRow).join("")}</ul>`
        : `<p class="recent-card-meta">Not published yet.</p>`}
      <div class="recent-card-actions">
        <button type="button" class="pf-btn danger" data-action="delete" data-job="${job.id}">Delete</button>
      </div>`;

    modal.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeDetail() {
    if (!modal) return;
    modal.hidden = true;
    document.body.style.overflow = "";
    if (modalBody) modalBody.innerHTML = "";
  }

  async function deleteJob(jobId, button) {
    if (!confirm("Delete this video and its post history?")) return;
    button.disabled = true;
    try {
      await api(`/api/jobs/${jobId}`, { method: "DELETE" });
      toast("Done");
      closeDetail();
      await load();
    } catch (err) {
      toast(err.message, "error");
      button.disabled = false;
    }
  }

  function bind() {
    feed.querySelectorAll("[data-open]").forEach((btn) => {
      btn.addEventListener("click", () => openDetail(btn.dataset.open));
    });
  }

  async function load() {
    try {
      const jobs = await api("/api/recent");
      jobsById = new Map(jobs.map((j) => [String(j.id), j]));
      feed.innerHTML = jobs.length
        ? `<div class="recent-grid">${jobs.map(jobTile).join("")}</div>`
        : emptyBlock("No videos yet. Schedule one from the dashboard or the calendar.");
      bind();

      clearTimeout(pollTimer);
      if (jobs.some((j) => ACTIVE.includes(j.status))) {
        pollTimer = setTimeout(load, 5000);
      }
    } catch (err) {
      feed.innerHTML = errorBlock(`Couldn't load recent activity: ${err.message}`);
    }
  }

  modal?.addEventListener("click", (e) => {
    if (e.target.closest("[data-close-modal]")) closeDetail();
    const del = e.target.closest("[data-action='delete']");
    if (del) deleteJob(del.dataset.job, del);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal && !modal.hidden) closeDetail();
  });

  document.getElementById("recent-refresh")?.addEventListener("click", load);
  load();
})();
