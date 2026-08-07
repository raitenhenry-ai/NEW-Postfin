(() => {
  const grid = document.getElementById("cal-grid");
  if (!grid) return;

  const monthText = document.getElementById("cal-month-text");
  const selectionLabel = document.getElementById("cal-selection-label");
  const chatTitle = document.getElementById("cal-chat-title");
  const dayPanel = document.getElementById("cal-chat-messages");
  const dateChips = document.getElementById("cal-date-chips");
  const form = document.getElementById("cal-chat-form");
  const field = document.getElementById("cal-chat-field");
  const sendBtn = document.getElementById("cal-chat-send");
  const hint = document.getElementById("cal-hint");
  const shell = document.querySelector(".cal-shell");
  const modeButtons = document.querySelectorAll("[data-cal-mode]");

  const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  const { api, escapeHtml, PLATFORM_LABELS, toast } = window.Postfin;

  // Jobs keyed by YYYY-MM-DD, filled from /api/calendar.
  let events = {};

  // One job can go to several platforms, but a calendar row only has space
  // for one name - show the first and count the rest.
  function platformLabel(post) {
    const list = post.platforms || [];
    if (!list.length) return "No platform";
    const first = PLATFORM_LABELS[list[0]] || list[0];
    return list.length > 1 ? `${first} +${list.length - 1}` : first;
  }

  // The detail panel has room for the full list.
  function platformLabelFull(post) {
    const list = post.platforms || [];
    if (!list.length) return "No platform selected";
    return list.map((p) => PLATFORM_LABELS[p] || p).join(", ");
  }

  function platformKey(name) {
    return String(name || "").toLowerCase().replace(/\s+/g, "");
  }

  function keyFromDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function parseKey(key) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function formatShort(key) {
    const d = parseKey(key);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  function formatRangeLabel(startKey, endKey) {
    if (startKey === endKey) return formatShort(startKey);
    return `${formatShort(startKey)} – ${formatShort(endKey)}`;
  }

  function groupDateRanges(keys) {
    const sorted = [...keys].sort();
    if (!sorted.length) return [];

    const ranges = [];
    let rangeKeys = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const key = sorted[i];
      const prevDate = parseKey(rangeKeys[rangeKeys.length - 1]);
      const expected = new Date(prevDate);
      expected.setDate(expected.getDate() + 1);
      if (keyFromDate(expected) === key) {
        rangeKeys.push(key);
      } else {
        ranges.push({
          start: rangeKeys[0],
          end: rangeKeys[rangeKeys.length - 1],
          keys: rangeKeys,
        });
        rangeKeys = [key];
      }
    }

    ranges.push({
      start: rangeKeys[0],
      end: rangeKeys[rangeKeys.length - 1],
      keys: rangeKeys,
    });
    return ranges;
  }

  function formatLong(key) {
    const d = parseKey(key);
    return d.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }

  function keysInRange(a, b) {
    const from = a < b ? a : b;
    const to = a < b ? b : a;
    const out = [];
    const cursor = new Date(from);
    while (cursor <= to) {
      out.push(keyFromDate(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return out;
  }

  const now = new Date();
  let view = new Date(now.getFullYear(), now.getMonth(), 1);
  let mode = "view";
  const selected = new Set();
  let focused = keyFromDate(now);
  let openedPost = null;
  let drag = null;

  function setFocusedDay(key) {
    if (focused !== key) openedPost = null;
    focused = key;
  }

  function renderDayPanel() {
    if (!dayPanel) return;

    if (mode === "agent") {
      dayPanel.innerHTML = `
        <div class="cal-day-empty">
          Select dates on the calendar, then describe what you want the AI agent to create.
        </div>
      `;
      return;
    }

    if (!focused) {
      dayPanel.innerHTML = `<div class="cal-day-empty">Pick a day to see posts.</div>`;
      return;
    }

    const posts = events[focused] || [];
    if (!posts.length) {
      dayPanel.innerHTML = `
        <div class="cal-day-empty">
          No posts scheduled for ${formatLong(focused)}.
        </div>
      `;
      return;
    }

    dayPanel.innerHTML = "";
    const canEdit = mode === "edit";

    if (openedPost != null && posts[openedPost]) {
      const post = posts[openedPost];
      const detail = document.createElement("div");
      detail.className = `cal-post-detail is-${platformKey(post.platforms[0] || "")}`;

      // A slot can only be moved while the video is still waiting to go out.
      const canReschedule = canEdit && post.jobStatus !== "posted";
      const slotValue = post.scheduledAt
        ? new Date(post.scheduledAt - new Date().getTimezoneOffset() * 60000)
            .toISOString().slice(0, 16)
        : "";

      detail.innerHTML = `
        <button type="button" class="cal-post-back" id="cal-post-back">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3.5L5.5 8 10 12.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          All posts
        </button>
        <header class="cal-post-detail-head">
          ${canEdit ? `<input class="cal-post-title-input" data-field="title" type="text">` : `<h3 class="cal-post-title"></h3>`}
          <p class="cal-post-summary"></p>
        </header>
        <div class="cal-post-fields">
          <section>
            <h4>Product</h4>
            <p class="cal-post-product"></p>
          </section>
          <section>
            <h4>Renderer</h4>
            <p class="cal-post-model"></p>
          </section>
          <section>
            <h4>${post.scheduledAt ? "Scheduled for" : "Posted"}</h4>
            ${canReschedule
              ? `<input class="cal-post-field-input" data-field="scheduledAt" type="datetime-local" value="${slotValue}">`
              : `<p class="cal-post-date"></p>`}
          </section>
          <section>
            <h4>Status</h4>
            <p class="cal-post-status"></p>
          </section>
          <section>
            <h4>Caption</h4>
            ${canEdit ? `<textarea class="cal-post-field-input" data-field="caption" rows="3"></textarea>` : `<p class="cal-post-caption"></p>`}
          </section>
          <section>
            <h4>Hashtags</h4>
            ${canEdit ? `<textarea class="cal-post-field-input" data-field="hashtags" rows="2"></textarea>` : `<p class="cal-post-hashtags"></p>`}
          </section>
          <section>
            <h4>Prompt</h4>
            <p class="cal-post-prompt"></p>
          </section>
          ${post.videoUrl ? `<section><h4>Video</h4><video class="cal-post-video" src="${escapeHtml(post.videoUrl)}" controls playsinline></video></section>` : ""}
        </div>
        ${canEdit ? `<div class="cal-post-actions"><button type="button" class="pf-btn" data-action="save">Save changes</button><span class="cal-post-saved" hidden>Saved</span></div>` : ""}
      `;

      detail.querySelector(".cal-post-summary").textContent =
        `${platformLabelFull(post)} \u00b7 ${post.time}`;
      detail.querySelector(".cal-post-product").textContent =
        post.productName || post.productUrl || "\u2014";
      detail.querySelector(".cal-post-model").textContent =
        post.provider === "heygen" ? "HeyGen avatar" : "Built-in renderer";
      detail.querySelector(".cal-post-status").textContent =
        `${post.jobStatus}${post.accountCount ? ` \u00b7 ${post.accountCount} account(s)` : ""}`;
      detail.querySelector(".cal-post-prompt").textContent = post.prompt || "Script not generated yet.";
      const dateEl = detail.querySelector(".cal-post-date");
      if (dateEl) dateEl.textContent = `${formatLong(focused)} \u00b7 ${post.time}`;

      if (canEdit) {
        detail.querySelector('[data-field="title"]').value = post.title || "";
        detail.querySelector('[data-field="caption"]').value = post.caption || "";
        detail.querySelector('[data-field="hashtags"]').value = post.hashtags || "";

        // Edits are staged locally and written on Save, so a stray keystroke
        // doesn't fire a request per character.
        const saveBtn = detail.querySelector('[data-action="save"]');
        saveBtn.addEventListener("click", async () => {
          const body = {
            title: detail.querySelector('[data-field="title"]').value,
            caption: detail.querySelector('[data-field="caption"]').value,
            hashtags: detail.querySelector('[data-field="hashtags"]').value,
          };
          const slot = detail.querySelector('[data-field="scheduledAt"]');
          if (slot && slot.value) body.scheduledAt = new Date(slot.value).getTime();

          saveBtn.disabled = true;
          try {
            await api(`/api/jobs/${post.id}`, { method: "PATCH", body });
            toast("Saved");
            await loadEvents();
            render();
          } catch (err) {
            toast(err.message, "error");
          } finally {
            saveBtn.disabled = false;
          }
        });
      } else {
        detail.querySelector(".cal-post-title").textContent = post.title;
        detail.querySelector(".cal-post-caption").textContent = post.caption || "\u2014";
        detail.querySelector(".cal-post-hashtags").textContent = post.hashtags || "\u2014";
      }

      detail.querySelector("#cal-post-back").addEventListener("click", () => {
        openedPost = null;
        renderDayPanel();
      });
      dayPanel.appendChild(detail);
      return;
    }

    const list = document.createElement("div");
    list.className = "cal-post-list";
    posts.forEach((post, index) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `cal-post-item is-${platformKey(post.platforms[0] || "")}`;
      btn.innerHTML = `
        <i class="cal-post-item-bar" aria-hidden="true"></i>
        <span class="cal-post-item-copy">
          <span class="cal-post-item-title"></span>
          <span class="cal-post-item-meta">
            <span class="cal-post-item-platform"></span>
            <span class="cal-post-item-time"></span>
          </span>
        </span>
        <svg class="cal-post-item-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      `;
      btn.querySelector(".cal-post-item-title").textContent = post.title;
      btn.querySelector(".cal-post-item-platform").textContent = platformLabel(post);
      btn.querySelector(".cal-post-item-time").textContent = post.time;
      btn.addEventListener("click", () => {
        openedPost = index;
        renderDayPanel();
      });
      list.appendChild(btn);
    });
    dayPanel.appendChild(list);
  }

  function renderDateChips() {
    if (!dateChips) return;

    if (mode !== "agent") {
      dateChips.hidden = true;
      dateChips.innerHTML = "";
      return;
    }

    if (field) field.placeholder = "Describe your idea";

    const keys = [...selected].sort();
    if (!keys.length) {
      dateChips.hidden = true;
      dateChips.innerHTML = "";
      return;
    }

    dateChips.hidden = false;
    dateChips.innerHTML = "";
    groupDateRanges(keys).forEach((range) => {
      const chip = document.createElement("div");
      chip.className = "cal-date-chip";
      chip.innerHTML = `
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="2.5" y="3.5" width="11" height="10" rx="2" stroke="currentColor" stroke-width="1.4"/>
          <path d="M2.5 6.5h11M5.5 2v2.5M10.5 2v2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
        <span class="cal-date-chip-label"></span>
        <button type="button" class="cal-date-chip-remove" aria-label="Remove dates">
          <svg viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M3 3l6 6M9 3L3 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </button>
      `;
      chip.querySelector(".cal-date-chip-label").textContent = formatRangeLabel(range.start, range.end);
      chip.querySelector(".cal-date-chip-remove").addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        range.keys.forEach((key) => selected.delete(key));
        applySelectionClasses();
      });
      dateChips.appendChild(chip);
    });
  }

  function updateChrome() {
    const isAgent = mode === "agent";
    const isBrowse = mode === "view" || mode === "edit";

    shell?.classList.toggle("is-agent", isAgent);
    shell?.classList.toggle("is-edit", mode === "edit");
    shell?.classList.toggle("is-view", mode === "view");
    grid.classList.toggle("edit-mode", isAgent);
    grid.classList.toggle("view-mode", isBrowse);

    modeButtons.forEach((btn) => {
      const on = btn.dataset.calMode === mode;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });

    if (hint) {
      if (mode === "agent") {
        hint.textContent = "AI Agent · click or drag across days to select · ⌘/Ctrl-drag to add";
      } else if (mode === "edit") {
        hint.textContent = "Edit mode · open a post to edit title, caption, prompt, and more";
      } else {
        hint.textContent = "View mode · today’s posts open automatically · click any day to inspect";
      }
    }

    if (chatTitle) {
      chatTitle.textContent = isAgent ? "AI Agent" : mode === "edit" ? "Edit posts" : "Day posts";
    }

    renderDateChips();

    if (isBrowse) {
      selectionLabel.textContent = focused
        ? formatLong(focused)
        : "Select a day";
      renderDayPanel();
      return;
    }

    const keys = [...selected].sort();
    if (!keys.length) selectionLabel.textContent = "No dates selected";
    else if (keys.length === 1) selectionLabel.textContent = `Planning ${formatShort(keys[0])}`;
    else selectionLabel.textContent = `${keys.length} dates selected`;
    renderDayPanel();
  }

  function applySelectionClasses() {
    grid.querySelectorAll(".cal-cell").forEach((cell) => {
      const key = cell.dataset.date;
      cell.classList.toggle("selected", mode === "agent" && selected.has(key));
      cell.classList.toggle("focused", (mode === "view" || mode === "edit") && focused === key);
    });
    updateChrome();
  }

  function setMode(next) {
    if (next === mode) return;
    mode = next;
    drag = null;
    grid.classList.remove("is-dragging");

    if (mode === "view" || mode === "edit") {
      selected.clear();
      openedPost = null;
      if (!focused) focused = keyFromDate(new Date());
      const d = parseKey(focused);
      view = new Date(d.getFullYear(), d.getMonth(), 1);
    } else {
      focused = null;
      openedPost = null;
    }
    render();
  }

  function render() {
    const year = view.getFullYear();
    const month = view.getMonth();
    monthText.textContent = `${MONTHS[month]} ${year}`;
    grid.setAttribute("aria-label", `${MONTHS[month]} ${year}`);

    const first = new Date(year, month, 1);
    const start = new Date(first);
    start.setDate(first.getDate() - first.getDay());

    const todayKey = keyFromDate(new Date());
    grid.innerHTML = "";

    for (let i = 0; i < 42; i++) {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      const key = keyFromDate(date);
      const inMonth = date.getMonth() === month;
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "cal-cell";
      cell.dataset.date = key;
      cell.setAttribute("role", "gridcell");
      if (!inMonth) cell.classList.add("muted");
      if (key === todayKey) cell.classList.add("today");
      if (mode === "agent" && selected.has(key)) cell.classList.add("selected");
      if ((mode === "view" || mode === "edit") && focused === key) cell.classList.add("focused");

      const num = document.createElement("span");
      num.className = "cal-cell-num";
      num.textContent = String(date.getDate());
      cell.appendChild(num);

      const dayEvents = events[key] || [];
      if (dayEvents.length) {
        const list = document.createElement("div");
        list.className = "cal-cell-events";
        list.addEventListener("mousedown", (e) => e.stopPropagation());
        list.addEventListener("touchstart", (e) => e.stopPropagation(), { passive: true });
        list.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
        dayEvents.forEach((ev) => {
          const row = document.createElement("div");
          row.className = `cal-event-row is-${platformKey(ev.platforms[0] || "")}`;
          row.innerHTML = `
            <i class="cal-event-bar" aria-hidden="true"></i>
            <span class="cal-event-title"></span>
            <span class="cal-event-platform"></span>
            <span class="cal-event-time"></span>
          `;
          row.querySelector(".cal-event-title").textContent = ev.title;
          row.querySelector(".cal-event-platform").textContent = platformLabel(ev);
          row.querySelector(".cal-event-time").textContent = ev.time;
          list.appendChild(row);
        });
        cell.appendChild(list);
      }

      grid.appendChild(cell);
    }
    updateChrome();
  }

  function cellFromPoint(x, y) {
    const el = document.elementFromPoint(x, y);
    return el?.closest?.(".cal-cell") || null;
  }

  function beginDrag(key, e) {
    if (mode !== "agent") return;
    const additive = e.metaKey || e.ctrlKey;
    drag = {
      anchor: key,
      current: key,
      additive,
      snapshot: additive ? new Set(selected) : new Set(),
    };

    if (!additive) selected.clear();
    selected.add(key);
    applySelectionClasses();
    grid.classList.add("is-dragging");
  }

  function updateDrag(key) {
    if (mode !== "agent" || !drag || !key || key === drag.current) return;
    drag.current = key;

    const range = keysInRange(parseKey(drag.anchor), parseKey(key));
    selected.clear();
    drag.snapshot.forEach((k) => selected.add(k));
    range.forEach((k) => selected.add(k));
    applySelectionClasses();
  }

  function endDrag() {
    if (!drag) return;
    drag = null;
    grid.classList.remove("is-dragging");
  }

  grid.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const cell = e.target.closest(".cal-cell");
    if (!cell) return;

    if (mode === "view" || mode === "edit") {
      setFocusedDay(cell.dataset.date);
      applySelectionClasses();
      return;
    }

    e.preventDefault();
    grid.setPointerCapture?.(e.pointerId);
    beginDrag(cell.dataset.date, e);
  });

  grid.addEventListener("pointermove", (e) => {
    if (!drag || mode !== "agent") return;
    const cell = cellFromPoint(e.clientX, e.clientY);
    if (cell?.dataset.date) updateDrag(cell.dataset.date);
  });

  grid.addEventListener("pointerup", endDrag);
  grid.addEventListener("pointercancel", endDrag);
  window.addEventListener("pointerup", endDrag);

  modeButtons.forEach((btn) => {
    btn.addEventListener("click", () => setMode(btn.dataset.calMode));
  });

  document.getElementById("cal-prev")?.addEventListener("click", async () => {
    view = new Date(view.getFullYear(), view.getMonth() - 1, 1);
    render();
    await loadEvents();
    render();
  });

  document.getElementById("cal-next")?.addEventListener("click", async () => {
    view = new Date(view.getFullYear(), view.getMonth() + 1, 1);
    render();
    await loadEvents();
    render();
  });

  document.getElementById("cal-today")?.addEventListener("click", () => {
    const current = new Date();
    view = new Date(current.getFullYear(), current.getMonth(), 1);
    const key = keyFromDate(current);
    if (mode === "agent") {
      selected.clear();
      selected.add(key);
    } else {
      setFocusedDay(key);
    }
    render();
  });

  function syncSendState() {
    if (!sendBtn || !field) return;
    sendBtn.disabled = !field.value.trim();
  }

  function resizeField() {
    if (!field) return;
    field.style.height = "auto";
    const next = Math.min(field.scrollHeight, 160);
    field.style.height = `${next}px`;
  }

  field?.addEventListener("input", () => {
    syncSendState();
    resizeField();
  });

  field?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form?.requestSubmit();
    }
  });

  // The agent box turns a product URL plus a set of selected days into one
  // scheduled video per day. The pipeline needs a real product page to
  // scrape, so a prompt without a URL can't be actioned.
  const URL_PATTERN = /https?:\/\/[^\s]+/i;

  function agentMessage(html, kind = "info") {
    if (!dayPanel) return;
    dayPanel.innerHTML = `<div class="cal-day-empty ${kind === "error" ? "is-error" : ""}">${html}</div>`;
  }

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!field || !field.value.trim()) return;

    const text = field.value.trim();
    const match = text.match(URL_PATTERN);
    if (!match) {
      toast("Include the product URL you want a video made from", "error");
      agentMessage("Paste the product page URL in your message - the generator scrapes it for the name, price and images.", "error");
      return;
    }

    const days = [...selected].sort();
    if (!days.length) {
      toast("Select at least one day on the calendar", "error");
      return;
    }

    const productUrl = match[0];
    // Keep whatever the user wrote around the URL as the video's title.
    const title = text.replace(URL_PATTERN, "").trim().slice(0, 120) || undefined;

    if (sendBtn) sendBtn.disabled = true;
    agentMessage(`Scheduling ${days.length} video${days.length === 1 ? "" : "s"}...`);

    const results = [];
    for (const key of days) {
      // 9am local on each selected day, unless that has already passed today.
      const when = parseKey(key);
      when.setHours(9, 0, 0, 0);
      const scheduledAt = when.getTime() > Date.now() ? when.getTime() : Date.now() + 60000;
      try {
        await api("/api/jobs", {
          method: "POST",
          body: { productUrl, title, scheduledAt, platforms: [] },
        });
        results.push({ key, ok: true });
      } catch (err) {
        results.push({ key, ok: false, error: err.message });
      }
    }

    const failed = results.filter((r) => !r.ok);
    if (failed.length) {
      toast(`${failed.length} of ${results.length} failed: ${failed[0].error}`, "error");
    } else {
      toast(`Scheduled ${results.length} video${results.length === 1 ? "" : "s"}`);
      field.value = "";
      selected.clear();
    }

    if (sendBtn) sendBtn.disabled = false;
    syncSendState();
    resizeField();
    await loadEvents();
    render();
  });

  // Pulls the jobs for the visible month plus a month of padding either
  // side, so scrolling between months rarely needs a fetch.
  async function loadEvents() {
    const start = new Date(view.getFullYear(), view.getMonth() - 1, 1).getTime();
    const end = new Date(view.getFullYear(), view.getMonth() + 2, 0, 23, 59, 59).getTime();
    try {
      const data = await api(`/api/calendar?start=${start}&end=${end}`);
      events = Object.fromEntries(
        Object.entries(data.days).map(([key, day]) => [key, day.posts])
      );
    } catch (err) {
      toast(`Couldn't load the calendar: ${err.message}`, "error");
      events = {};
    }
  }

  syncSendState();
  resizeField();
  render();
  loadEvents().then(render);
})();
