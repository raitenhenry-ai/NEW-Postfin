/* Dashboard: stat tiles, the embedded content calendar, top accounts,
   top videos and suggestions - all from /api/dashboard and /api/calendar. */
(() => {
  const {
    api, escapeHtml, platformIcon, PLATFORM_LABELS, fmtCompact, fmtInt, fmtSigned,
    fmtMoney, fmtDelta, deltaClass, fmtDuration, dateKey, toast, errorBlock, emptyBlock,
  } = window.Postfin;

  const DAY_MS = 86400000;

  // The Monday of the week containing `date` - the week grid runs Mon..Sun.
  function startOfWeek(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const offset = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - offset);
    return d;
  }

  let calendarDays = {};
  let weekStart = startOfWeek(new Date());
  let monthCursor = new Date();

  /* ---------- stat tiles ---------- */

  function fillStats(stats) {
    const set = (key, value, delta, { animate = true } = {}) => {
      const card = document.querySelector(`[data-stat="${key}"]`);
      if (!card) return;
      const valueEl = card.querySelector(".stat-value");
      const deltaEl = card.querySelector(".stat-up");
      valueEl.textContent = value;
      if (animate && window.PostfinCountUp) window.PostfinCountUp.animateStat(valueEl, 1100);
      if (deltaEl) {
        const chip = fmtDelta(delta);
        deltaEl.textContent = chip;
        deltaEl.className = `stat-up ${deltaClass(delta)}`.trim();
      }
    };

    set("views", fmtCompact(stats.views.value, 1), stats.views.delta);
    // CPM has no source unless the operator configured rates, so it shows a
    // dash rather than a made-up number.
    set("cpm", stats.cpm.configured ? fmtMoney(stats.cpm.value) : "—", null, {
      animate: stats.cpm.configured,
    });
    set("followers", fmtSigned(stats.followers.value), stats.followers.delta);
    set("videosPosted", fmtInt(stats.videosPosted.value), null);

    const cpmCard = document.querySelector('[data-stat="cpm"]');
    if (cpmCard && !stats.cpm.configured) {
      const meta = cpmCard.querySelector(".stat-up");
      if (meta) {
        meta.textContent = "Set ESTIMATED_CPM";
        meta.className = "stat-up muted";
      }
    }
  }

  /* ---------- calendar ---------- */

  // Every job that falls on a given day, flattened one entry per platform so
  // the week grid (which has a row per platform) can index into it.
  function postsOn(key) {
    return calendarDays[key]?.posts || [];
  }

  function platformsInWindow() {
    const seen = new Set();
    for (const day of Object.values(calendarDays)) {
      for (const post of day.posts) {
        for (const p of post.platforms) seen.add(p);
      }
    }
    return [...seen];
  }

  function renderWeek() {
    const grid = document.getElementById("dash-week-grid");
    if (!grid) return;

    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      return d;
    });

    const platforms = platformsInWindow();
    if (!platforms.length) {
      grid.innerHTML = emptyBlock("No posts this week. Schedule one to fill the calendar.");
      grid.classList.add("is-empty");
      return;
    }
    grid.classList.remove("is-empty");

    const header = [
      '<div class="calendar-corner"></div>',
      ...days.map((d) => {
        const label = d.toLocaleDateString("en-US", { weekday: "short" });
        const sub = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        return `<button type="button" class="calendar-day" data-date="${dateKey(d)}">${label}<br><span>${sub}</span></button>`;
      }),
    ].join("");

    const rows = platforms.map((platform) => {
      const cells = days.map((d) => {
        const key = dateKey(d);
        const chips = postsOn(key)
          .filter((p) => p.platforms.includes(platform))
          .map((p) => `
            <div class="post-chip">
              <span class="post-time">${escapeHtml(p.time)}</span>
              <span class="post-title">${escapeHtml(p.title)}</span>
              <span class="post-dot ${p.status}"></span>
            </div>`)
          .join("");
        return `<button type="button" class="calendar-cell" data-date="${key}">${chips}</button>`;
      }).join("");

      return `
        <div class="calendar-platform" title="${escapeHtml(PLATFORM_LABELS[platform] || platform)}">
          <span class="platform-badge" aria-hidden="true">${platformIcon(platform)}</span>
        </div>${cells}`;
    }).join("");

    grid.innerHTML = header + rows;
    grid.querySelectorAll("[data-date]").forEach((el) => {
      el.addEventListener("click", () => openDay(el.dataset.date));
    });
  }

  function renderDay() {
    const header = document.getElementById("dash-day-header");
    const list = document.getElementById("dash-day-list");
    if (!header || !list) return;

    const today = new Date();
    const key = dateKey(today);
    header.textContent = today.toLocaleDateString("en-US", {
      weekday: "long", month: "short", day: "numeric",
    });

    const posts = postsOn(key);
    if (!posts.length) {
      list.innerHTML = emptyBlock("Nothing scheduled today.");
      return;
    }
    list.innerHTML = posts.map((post, i) => dayPostRow(post, i)).join("");
    list.querySelectorAll("[data-post-index]").forEach((btn) => {
      btn.addEventListener("click", () => openPostDetail(key, Number(btn.dataset.postIndex), false));
    });
  }

  function dayPostRow(post, index) {
    const icon = post.platforms[0] ? platformIcon(post.platforms[0]) : platformIcon("");
    return `
      <button type="button" class="day-post day-post-btn" data-post-index="${index}">
        <span class="platform-badge" aria-hidden="true">${icon}</span>
        <div class="day-post-copy">
          <span class="post-time">${escapeHtml(post.time)} · ${fmtDuration(post.durationSeconds)}</span>
          <span class="post-title">${escapeHtml(post.title)}</span>
        </div>
        <span class="post-dot ${post.status}"></span>
        <span class="suggestion-chevron" aria-hidden="true">›</span>
      </button>`;
  }

  function renderMonth() {
    const grid = document.getElementById("dash-month-grid");
    if (!grid) return;

    const year = monthCursor.getFullYear();
    const month = monthCursor.getMonth();
    const first = new Date(year, month, 1);
    // Grid starts on the Monday on or before the 1st.
    const start = new Date(first);
    start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
    const todayKey = dateKey(new Date());

    const cells = [];
    for (let i = 0; i < 35; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = dateKey(d);
      const posts = postsOn(key);
      const classes = ["month-cell"];
      if (d.getMonth() !== month) classes.push("muted");
      if (key === todayKey) classes.push("today");

      if (!posts.length) {
        cells.push(`<div class="${classes.join(" ")}"><span>${d.getDate()}</span></div>`);
        continue;
      }
      classes.push("has-posts");
      const dots = [...new Set(posts.map((p) => p.status))]
        .map((status) => `<i class="${status}"></i>`).join("");
      cells.push(`
        <button type="button" class="${classes.join(" ")}" data-date="${key}">
          <span>${d.getDate()}</span>
          <div class="month-dots">${dots}</div>
        </button>`);
    }

    grid.innerHTML = cells.join("");
    grid.querySelectorAll("[data-date]").forEach((el) => {
      el.addEventListener("click", () => openDay(el.dataset.date));
    });
  }

  /* ---------- day / post modal ---------- */

  function openDay(key) {
    const modal = window.PostfinModal;
    const { title, body, back } = modal.elements;
    const day = calendarDays[key];
    const posts = day?.posts || [];

    modal.context = { day: key, mode: "list" };
    if (back) back.hidden = true;
    title.textContent = day?.label || key;

    body.innerHTML = posts.length
      ? `<p class="day-modal-subtitle">${posts.length} post${posts.length === 1 ? "" : "s"}</p>
         <div class="day-modal-list">${posts.map((p, i) => dayPostRow(p, i)).join("")}</div>`
      : emptyBlock("Nothing scheduled on this day.");

    body.querySelectorAll("[data-post-index]").forEach((btn) => {
      btn.addEventListener("click", () => openPostDetail(key, Number(btn.dataset.postIndex), true));
    });
    modal.open();
  }

  function openPostDetail(key, index, fromList) {
    const modal = window.PostfinModal;
    const { title, body, back } = modal.elements;
    const day = calendarDays[key];
    const post = day?.posts?.[index];
    if (!post) return;

    modal.context = { day: key, mode: "detail", index, fromList };
    if (back) back.hidden = !fromList;
    title.textContent = post.title;

    const platformList = post.platforms.length
      ? post.platforms.map((p) => PLATFORM_LABELS[p] || p).join(", ")
      : "No platforms yet";

    body.innerHTML = `
      <article class="post-detail">
        <div class="post-detail-top">
          <span class="platform-badge" aria-hidden="true">${post.platforms[0] ? platformIcon(post.platforms[0]) : platformIcon("")}</span>
          <div class="post-detail-copy">
            <span class="post-time">${escapeHtml(day.label)}</span>
            <span class="post-title">${escapeHtml(post.title)}</span>
          </div>
          <span class="post-dot ${post.status}"></span>
        </div>

        <div class="post-meta-grid">
          <div class="post-meta-item">
            <span class="post-field-label">Post time</span>
            <span class="post-meta-value">${escapeHtml(post.time)}</span>
          </div>
          <div class="post-meta-item">
            <span class="post-field-label">Duration</span>
            <span class="post-meta-value">${fmtDuration(post.durationSeconds)}</span>
          </div>
          <div class="post-meta-item">
            <span class="post-field-label">Platforms</span>
            <span class="post-meta-value">${escapeHtml(platformList)}</span>
          </div>
          <div class="post-meta-item">
            <span class="post-field-label">Renderer</span>
            <span class="post-meta-value">${escapeHtml(post.provider === "heygen" ? "HeyGen avatar" : "Built-in renderer")}</span>
          </div>
        </div>

        ${post.videoUrl ? `<video class="post-video" src="${escapeHtml(post.videoUrl)}" controls playsinline></video>` : ""}

        <div>
          <span class="post-field-label">Video prompt</span>
          <p class="post-prompt">${escapeHtml(post.prompt) || "<em>Script not generated yet.</em>"}</p>
        </div>
        <div>
          <label class="post-field-label" for="caption-${post.id}">Caption</label>
          <textarea class="post-caption" id="caption-${post.id}">${escapeHtml(post.caption)}</textarea>
          <button type="button" class="pf-btn" id="save-caption-${post.id}">Save caption</button>
        </div>
        <div class="post-detail-actions">
          ${post.productUrl ? `<a class="pf-btn ghost" href="${escapeHtml(post.productUrl)}" target="_blank" rel="noopener">Product page</a>` : ""}
          <button type="button" class="pf-btn ghost" data-action="post-now">Post now</button>
        </div>
      </article>`;

    const saveBtn = body.querySelector(`#save-caption-${post.id}`);
    saveBtn?.addEventListener("click", async () => {
      const caption = body.querySelector(`#caption-${post.id}`).value;
      saveBtn.disabled = true;
      try {
        await api(`/api/jobs/${post.id}`, { method: "PATCH", body: { caption } });
        post.caption = caption;
        toast("Caption saved");
      } catch (err) {
        toast(err.message, "error");
      } finally {
        saveBtn.disabled = false;
      }
    });

    body.querySelector('[data-action="post-now"]')?.addEventListener("click", async (e) => {
      e.target.disabled = true;
      try {
        const result = await api(`/api/jobs/${post.id}/post`, { method: "POST", body: {} });
        toast(`Posted to ${result.posted} account(s), ${result.failed} failed`);
        await load();
      } catch (err) {
        toast(err.message, "error");
      } finally {
        e.target.disabled = false;
      }
    });

    modal.open();
  }

  document.getElementById("day-modal-back")?.addEventListener("click", () => {
    const ctx = window.PostfinModal.context;
    if (ctx.day != null) openDay(ctx.day);
  });

  /* ---------- side panels ---------- */

  function renderAccounts(accounts) {
    const list = document.getElementById("dash-accounts");
    if (!list) return;
    if (!accounts.length) {
      list.innerHTML = emptyBlock("No accounts connected yet.");
      return;
    }
    list.innerHTML = accounts.map((a) => `
      <li class="account-row">
        <span class="account-icon" aria-hidden="true">${platformIcon(a.platform)}</span>
        <div class="account-info">
          <span class="account-name">${escapeHtml(a.displayName || PLATFORM_LABELS[a.platform])}</span>
          <span class="account-handle">${escapeHtml(PLATFORM_LABELS[a.platform] || a.platform)}</span>
        </div>
        <div class="account-metric">
          <span class="account-views">${fmtCompact(a.views, 1)}</span>
          <span class="account-metric-label">views</span>
        </div>
      </li>`).join("");
  }

  function renderVideos(videos) {
    const grid = document.getElementById("dash-videos");
    if (!grid) return;
    if (!videos.length) {
      grid.innerHTML = emptyBlock("No videos yet. Paste a product URL to make one.");
      return;
    }
    grid.innerHTML = videos.slice(0, 3).map((v) => `
      <article class="video-card">
        <div class="video-thumb">
          ${v.thumb
            ? `<img src="${escapeHtml(v.thumb)}" alt="" loading="lazy">`
            : `<div class="video-thumb-fallback" aria-hidden="true"></div>`}
          <span class="video-rank">${v.rank}</span>
          <span class="video-duration">${fmtDuration(v.durationSeconds)}</span>
        </div>
        <div class="video-meta">
          <h3>${escapeHtml(v.title)}</h3>
          <p class="video-subtitle">${escapeHtml(v.subtitle || "")}</p>
          <p class="video-views">${fmtCompact(v.views, 1)} views</p>
          <p class="video-cpm">${v.cpm !== null ? `CPM ${fmtMoney(v.cpm)}` : ""}</p>
        </div>
      </article>`).join("");
  }

  function renderSuggestions(suggestions) {
    const list = document.getElementById("dash-suggestions");
    if (!list) return;
    const sparkle = `
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M12 3.5l1.55 4.75L18.5 9.8l-4.95 1.55L12 16.1l-1.55-4.75L5.5 9.8l4.95-1.55L12 3.5z" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/>
        <path d="M18.2 14.8l.85 2.55 2.55.85-2.55.85-.85 2.55-.85-2.55-2.55-.85 2.55-.85.85-2.55z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
      </svg>`;
    list.innerHTML = suggestions.map((s) => `
      <a class="suggestion-row" href="${escapeHtml(s.href)}">
        <span class="suggestion-icon" aria-hidden="true">${sparkle}</span>
        <span class="suggestion-text">${escapeHtml(s.text)}</span>
        <span class="suggestion-chevron" aria-hidden="true">›</span>
      </a>`).join("");
  }

  /* ---------- schedule dialog ---------- */

  function openScheduleDialog() {
    const modal = window.PostfinModal;
    const { title, body, back } = modal.elements;
    if (back) back.hidden = true;
    title.textContent = "Schedule a video";

    // Default the picker to this time tomorrow.
    const when = new Date(Date.now() + DAY_MS);
    when.setSeconds(0, 0);
    const local = new Date(when.getTime() - when.getTimezoneOffset() * 60000)
      .toISOString().slice(0, 16);

    body.innerHTML = `
      <form class="pf-form" id="schedule-form">
        <label class="post-field-label" for="sched-url">Product URL</label>
        <input class="pf-input" id="sched-url" type="url" required
               placeholder="https://store.example/product">

        <label class="post-field-label" for="sched-title">Title <span class="pf-optional">(optional)</span></label>
        <input class="pf-input" id="sched-title" type="text" placeholder="Named automatically from the product">

        <label class="post-field-label" for="sched-when">Publish at</label>
        <input class="pf-input" id="sched-when" type="datetime-local" value="${local}">

        <label class="post-field-label">Platforms</label>
        <div class="pf-checks" id="sched-platforms"></div>

        <div class="pf-form-row">
          <div>
            <label class="post-field-label" for="sched-tone">Tone</label>
            <select class="pf-input" id="sched-tone"></select>
          </div>
          <div>
            <label class="post-field-label" for="sched-style">Style</label>
            <select class="pf-input" id="sched-style"></select>
          </div>
        </div>

        <p class="pf-hint" id="sched-hint"></p>
        <button class="pf-btn" type="submit" id="sched-submit">Create &amp; schedule</button>
      </form>`;
    modal.open();

    // Fill the options from what this deployment can actually do.
    api("/api/overview").then((overview) => {
      const checks = document.getElementById("sched-platforms");
      const connected = Object.entries(overview.accounts)
        .filter(([, list]) => list.length);

      checks.innerHTML = connected.length
        ? connected.map(([key, list]) => `
            <label class="pf-check">
              <input type="checkbox" value="${key}" checked>
              <span class="platform-badge" aria-hidden="true">${platformIcon(key)}</span>
              ${escapeHtml(PLATFORM_LABELS[key] || key)}
              <em>${list.length} account${list.length === 1 ? "" : "s"}</em>
            </label>`).join("")
        : emptyBlock("No accounts connected - connect one first.");

      const tone = document.getElementById("sched-tone");
      tone.innerHTML = overview.generator.tones
        .map((t) => `<option value="${t}">${t}</option>`).join("");
      const style = document.getElementById("sched-style");
      style.innerHTML = (overview.generator.styles || [])
        .map((s) => `<option value="${s}">${s.replace(/_/g, " ")}</option>`).join("");

      const hint = document.getElementById("sched-hint");
      hint.textContent = overview.generator.openaiConfigured
        ? `Scripts written by AI · ${overview.generator.provider === "heygen" ? "HeyGen avatar" : "built-in"} renderer`
        : "No OpenAI key set - scripts fall back to templates.";

      if (!connected.length) {
        document.getElementById("sched-submit").disabled = true;
      }
    }).catch((err) => toast(err.message, "error"));

    document.getElementById("schedule-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const submit = document.getElementById("sched-submit");
      const platforms = [...document.querySelectorAll("#sched-platforms input:checked")]
        .map((el) => el.value);
      const whenValue = document.getElementById("sched-when").value;

      submit.disabled = true;
      try {
        await api("/api/jobs", {
          method: "POST",
          body: {
            productUrl: document.getElementById("sched-url").value.trim(),
            title: document.getElementById("sched-title").value.trim() || undefined,
            scheduledAt: whenValue ? new Date(whenValue).getTime() : null,
            platforms,
            tone: document.getElementById("sched-tone").value,
            style: document.getElementById("sched-style").value,
          },
        });
        toast("Scheduled - generating the video now");
        window.PostfinModal.close();
        await load();
      } catch (err) {
        toast(err.message, "error");
      } finally {
        submit.disabled = false;
      }
    });
  }

  document.getElementById("dash-schedule-btn")?.addEventListener("click", openScheduleDialog);

  /* ---------- view switching ---------- */

  const calButtons = document.querySelectorAll("[data-cal-view]");
  const calViews = document.querySelectorAll(".calendar-view");

  calButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const view = btn.dataset.calView;
      calButtons.forEach((b) => {
        b.classList.toggle("active", b === btn);
        b.setAttribute("aria-selected", b === btn ? "true" : "false");
      });
      calViews.forEach((panel) => {
        panel.hidden = panel.dataset.view !== view;
      });
    });
  });

  /* ---------- load ---------- */

  async function load() {
    try {
      const start = startOfWeek(new Date()).getTime() - 40 * DAY_MS;
      const end = start + 120 * DAY_MS;
      const [dashboard, calendar] = await Promise.all([
        api("/api/dashboard"),
        api(`/api/calendar?start=${start}&end=${end}`),
      ]);

      calendarDays = calendar.days;
      // "Start" vs "Edit my automated plan" depends on whether anything is
      // actually planned.
      window.PostfinPlanButton?.sync(
        Object.values(calendarDays).some((day) => day.posts.length)
      );
      fillStats(dashboard.stats);
      renderAccounts(dashboard.topAccounts);
      renderVideos(dashboard.topVideos);
      renderSuggestions(dashboard.suggestions);
      renderWeek();
      renderDay();
      renderMonth();
    } catch (err) {
      console.error(err);
      const grid = document.getElementById("dash-week-grid");
      if (grid) grid.innerHTML = errorBlock(`Couldn't load the dashboard: ${err.message}`);
      toast(err.message, "error");
    }
  }

  load();
})();
