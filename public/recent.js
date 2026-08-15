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

  // First live post URL - what the title under the tile opens.
  function primaryPostUrl(job) {
    const hit = (job.posts || []).find((p) => p.status === "done" && p.url);
    return hit?.url || null;
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

  // Prefer the rendered mp4 frame over slide / product stills: slide files
  // can go missing after cleanup, and scraped product CDNs often block hotlinks.
  function thumbMedia(job) {
    if (job.videoUrl) {
      return `<video src="${escapeHtml(job.videoUrl)}#t=0.5" muted playsinline preload="metadata"></video>`;
    }
    if (job.slideUrls?.length) {
      return `<img src="${escapeHtml(job.slideUrls[0])}" alt="" loading="lazy" referrerpolicy="no-referrer" data-thumb-fallback="1">`;
    }
    const img = job.product?.images?.[0];
    if (img) {
      return `<img src="${escapeHtml(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-thumb-fallback="1">`;
    }
    return `<div class="video-thumb-fallback" aria-hidden="true"></div>`;
  }

  // State badge on the tile so scheduled / rendering / failed videos read at
  // a glance. Live posts carry no badge - the platform icons say it shipped.
  function tileStatus(job) {
    const posted = (job.posts || []).some((p) => p.status === "done");
    if (posted) return "";
    if (job.status === "failed") {
      return `<span class="recent-tile-status is-red" title="${escapeHtml(job.error || "Failed")}">Failed</span>`;
    }
    if (job.status === "posting") {
      return `<span class="recent-tile-status is-blue">Posting…</span>`;
    }
    if (ACTIVE.includes(job.status)) {
      return `<span class="recent-tile-status is-blue">Generating…</span>`;
    }
    if (job.scheduledAt && job.scheduledAt > Date.now()) {
      return `<span class="recent-tile-status is-amber">Scheduled</span>`;
    }
    return `<span class="recent-tile-status is-amber">Ready</span>`;
  }

  function jobTile(job) {
    const postUrl = primaryPostUrl(job);
    const title = shortCaption(job);
    const caption = postUrl
      ? `<a class="recent-tile-caption is-link" href="${escapeHtml(postUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a>`
      : `<span class="recent-tile-caption">${escapeHtml(title)}</span>`;
    return `
      <div class="recent-tile">
        <button type="button" class="recent-tile-open" data-open="${job.id}" aria-label="${escapeHtml(job.title || title)}">
          <span class="recent-tile-thumb">
            <span class="recent-tile-media">${thumbMedia(job)}</span>
            ${tileStatus(job)}
            ${platformIcons(job)}
          </span>
        </button>
        ${caption}
      </div>`;
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
        ${post.error
          ? `<span class="recent-post-note${post.status === "done" ? " is-warning" : ""}">${escapeHtml(post.error)}</span>`
          : ""}
      </li>`;
  }

  function totalViews(job) {
    return job.posts.reduce((sum, p) => sum + (Number(p.views) || 0), 0);
  }

  // This is where you actually watch it, so it is a real player - the old
  // one had no controls, which made the video unplayable from this page.
  function detailThumb(job) {
    if (job.videoUrl) {
      return `<video src="${escapeHtml(job.videoUrl)}" controls playsinline preload="metadata"></video>`;
    }
    if (job.slideUrls?.length) {
      return `<img src="${escapeHtml(job.slideUrls[0])}" alt="" referrerpolicy="no-referrer">`;
    }
    const img = job.product?.images?.[0];
    if (img) return `<img src="${escapeHtml(img)}" alt="" referrerpolicy="no-referrer">`;
    return `<div class="video-thumb-fallback" aria-hidden="true"></div>`;
  }

  // Said under the player, where there is room for it, rather than inside
  // the fixed-aspect box the media sits in.
  function videoNote(job) {
    if (job.videoUrl) return "";
    if (ACTIVE.includes(job.status)) return "Still generating - this updates itself.";
    if (job.status === "failed") return "This video never rendered.";
    return "No video yet.";
  }

  // The slides themselves, as the images that get posted. This is what a
  // slideshow actually is, so it is shown before the write-up.
  function slideGallery(job) {
    const urls = job.slideUrls || [];
    if (!urls.length) return "";
    return `
      <div class="recent-slide-grid">
        ${urls.map((url, i) => `
          <a class="recent-slide-shot" href="${escapeHtml(url)}" target="_blank" rel="noopener"
             aria-label="Slide ${i + 1}">
            <img src="${escapeHtml(url)}" alt="" loading="lazy">
            <span class="recent-slide-index">${i + 1}</span>
          </a>`).join("")}
      </div>`;
  }

  // A slideshow is worth reading as well as watching: the overlay lines are
  // the ad, and seeing them listed is how you tell whether it is any good
  // without playing 25 seconds of video.
  function slideList(job) {
    const slides = job.script?.slides || [];
    if (job.format !== "slideshow" || !slides.length) return "";
    return `
      <ol class="recent-slides">
        ${slides.map((slide) => `
          <li>
            <span class="recent-slide-overlay">${escapeHtml(slide.overlay || "")}</span>
            ${slide.spoken ? `<span class="recent-slide-spoken">${escapeHtml(slide.spoken)}</span>` : ""}
          </li>`).join("")}
      </ol>`;
  }

  function rendererLabel(job) {
    if (job.format === "slideshow") {
      const count = job.script?.slides?.length;
      return `AI slideshow${count ? ` · ${count} slides` : ""}`;
    }
    return "HeyGen avatar";
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
      <div class="recent-detail-thumb">${detailThumb(job)}</div>
      <div class="recent-detail-meta">
        ${statusChip(job.status)}
        <span>${when} · ${escapeHtml(rendererLabel(job))}</span>
      </div>
      ${job.videoUrl
        ? `<a class="recent-post-link" href="${escapeHtml(job.videoUrl)}" target="_blank" rel="noopener">Open the video file</a>`
        : `<p class="recent-card-meta">${escapeHtml(videoNote(job))}</p>`}
      ${job.slideUrls?.length
        ? `<p class="recent-detail-caption">The ${job.slideUrls.length} slides, as posted:</p>`
        : ""}
      ${slideGallery(job)}
      ${text ? `<p class="recent-detail-caption">${escapeHtml(text)}</p>` : ""}
      ${slideList(job)}
      ${job.productUrl
        ? `<a class="recent-card-product" href="${escapeHtml(job.productUrl)}" target="_blank" rel="noopener">${escapeHtml(job.productUrl)}</a>`
        : ""}
      ${job.error ? `<p class="recent-card-error">${escapeHtml(job.error)}</p>` : ""}
      ${!job.error && job.script?.imageNote
        ? `<p class="recent-card-warning">${escapeHtml(job.script.imageNote)}</p>`
        : ""}
      ${job.posts.length
        ? `<ul class="recent-posts">${job.posts.map(postRow).join("")}</ul>`
        : `<p class="recent-card-meta">Not published yet.</p>`}
      <div class="recent-card-actions">
        ${job.status === "failed"
          ? `<button type="button" class="pf-btn" data-action="retry" data-job="${job.id}">Retry</button>`
          : ""}
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

  async function retryJob(jobId, button) {
    if (button) button.disabled = true;
    try {
      await api(`/api/jobs/${jobId}/retry`, { method: "POST" });
      toast("Retrying");
      closeDetail();
      await load();
    } catch (err) {
      toast(err.message, "error");
      if (button) button.disabled = false;
    }
  }

  async function retryAllFailed(button) {
    const failed = [...jobsById.values()].filter((j) => j.status === "failed");
    if (!failed.length) return;
    button.disabled = true;
    let ok = 0;
    for (const job of failed) {
      try {
        await api(`/api/jobs/${job.id}/retry`, { method: "POST" });
        ok++;
      } catch {
        // Counted below; each job's own error shows once it re-fails.
      }
    }
    toast(ok === failed.length ? `Retrying ${ok} video${ok === 1 ? "" : "s"}` : `Retried ${ok} of ${failed.length}`, ok ? undefined : "error");
    await load();
  }

  function bind() {
    feed.querySelectorAll("[data-open]").forEach((btn) => {
      btn.addEventListener("click", () => openDetail(btn.dataset.open));
    });
    // Broken stills fall back to the mp4 frame, then a blank placeholder.
    feed.querySelectorAll("[data-thumb-fallback]").forEach((img) => {
      img.addEventListener("error", () => {
        const tile = img.closest(".recent-tile");
        const job = jobsById.get(String(tile?.querySelector("[data-open]")?.dataset.open));
        const media = img.closest(".recent-tile-media");
        if (!media) return;
        if (job?.videoUrl) {
          media.innerHTML = `<video src="${escapeHtml(job.videoUrl)}#t=0.5" muted playsinline preload="metadata"></video>`;
        } else {
          media.innerHTML = `<div class="video-thumb-fallback" aria-hidden="true"></div>`;
        }
      });
    });
  }

  async function load() {
    try {
      const jobs = await api("/api/recent");
      jobsById = new Map(jobs.map((j) => [String(j.id), j]));
      const failedCount = jobs.filter((j) => j.status === "failed").length;
      const toolbar = failedCount
        ? `<div class="recent-toolbar">
             <span class="recent-toolbar-note">${failedCount} video${failedCount === 1 ? "" : "s"} failed</span>
             <button type="button" class="pf-btn" data-retry-all>Retry all failed</button>
           </div>`
        : "";
      feed.innerHTML = jobs.length
        ? `${toolbar}<div class="recent-grid">${jobs.map(jobTile).join("")}</div>`
        : emptyBlock("No videos yet. Everything you create shows up here - scheduled, rendering, and live.");
      bind();
      feed.querySelector("[data-retry-all]")?.addEventListener("click", (e) => {
        retryAllFailed(e.currentTarget);
      });

      // Anything still rendering updates itself rather than needing a reload.
      clearTimeout(pollTimer);
      if (jobs.some((j) => ACTIVE.includes(j.status))) pollTimer = setTimeout(load, 5000);
    } catch (err) {
      feed.innerHTML = errorBlock(`Couldn't load recent activity: ${err.message}`);
    }
  }

  modal?.addEventListener("click", (e) => {
    if (e.target.closest("[data-close-modal]")) closeDetail();
    const del = e.target.closest("[data-action='delete']");
    if (del) deleteJob(del.dataset.job, del);
    const retry = e.target.closest("[data-action='retry']");
    if (retry) retryJob(retry.dataset.job, retry);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal && !modal.hidden) closeDetail();
  });

  load();
})();
