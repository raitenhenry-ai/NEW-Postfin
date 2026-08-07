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
  const modeSwitcher = document.getElementById("cal-mode-switcher");
  const modeSwitcherBtn = document.getElementById("cal-mode-switcher-btn");
  const modeSwitcherLabel = document.getElementById("cal-mode-switcher-label");
  const modeSwitcherIcon = document.getElementById("cal-mode-switcher-icon");
  const modeMenu = document.getElementById("cal-mode-menu");
  const monthPicker = document.getElementById("cal-month-picker");
  const monthLabelBtn = document.getElementById("cal-month-label");
  const monthMenu = document.getElementById("cal-month-menu");
  const monthMenuGrid = document.getElementById("cal-month-menu-grid");
  const yearText = document.getElementById("cal-year-text");

  const VIEW_ICON =
    '<svg viewBox="0 0 16 16" fill="none"><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8z" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.4"/></svg>';
  const EDIT_ICON =
    '<svg viewBox="0 0 16 16" fill="none"><path d="M9.2 3.2l3.6 3.6M3 13l1.1-3.9L11.4 1.8a1.3 1.3 0 0 1 1.8 0l1 1a1.3 1.3 0 0 1 0 1.8L6.9 11.9 3 13z" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/></svg>';

  const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const MONTHS_SHORT = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
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

  // Which platform colours a row.
  function primaryPlatform(post) {
    return (post.platforms || [])[0] || "";
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

  function dayAfter(key) {
    const d = parseKey(key);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + 1);
    return keyFromDate(d);
  }

  function groupDateRanges(keys) {
    // One chip per connected stretch of days — month boundaries do not split chips.
    const sorted = [...new Set(keys)].sort();
    if (!sorted.length) return [];

    const ranges = [];
    let rangeKeys = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const key = sorted[i];
      if (dayAfter(rangeKeys[rangeKeys.length - 1]) === key) {
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

  function connectedBlock(key, set) {
    if (!set.has(key)) return [];
    let start = parseKey(key);
    let end = parseKey(key);

    for (;;) {
      const prev = new Date(start);
      prev.setDate(prev.getDate() - 1);
      const prevKey = keyFromDate(prev);
      if (!set.has(prevKey)) break;
      start = prev;
    }

    for (;;) {
      const next = new Date(end);
      next.setDate(next.getDate() + 1);
      const nextKey = keyFromDate(next);
      if (!set.has(nextKey)) break;
      end = next;
    }

    return keysInRange(start, end);
  }

  const MODE_KEY = "cal-mode";
  const MODES = new Set(["view", "edit"]);

  function loadMode() {
    try {
      const saved = localStorage.getItem(MODE_KEY);
      if (saved === "agent") return "view";
      return MODES.has(saved) ? saved : "view";
    } catch {
      return "view";
    }
  }

  function saveMode(next) {
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      /* ignore */
    }
  }

  const now = new Date();
  let view = new Date(now.getFullYear(), now.getMonth(), 1);
  let mode = loadMode();
  let pickerYear = view.getFullYear();
  const selected = new Set();
  let focused = mode === "edit" ? null : keyFromDate(now);
  let openedPost = null;
  let editingPost = null;
  let drag = null;

  function isEditMode() {
    return mode === "edit";
  }

  function isViewMode() {
    return mode === "view";
  }

  function setFocusedDay(key) {
    if (focused !== key) openedPost = null;
    focused = key;
  }

  function renderDayPanel() {
    if (!dayPanel) return;

    if (isEditMode()) {
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

    if (openedPost != null && posts[openedPost]) {
      const post = posts[openedPost];
      const detail = document.createElement("div");
      detail.className = `cal-post-detail is-${platformKey(primaryPlatform(post))}`;

      // The panel reads as a summary by default; "Edit post" swaps the
      // editable fields in. A slot can only be moved while the video is
      // still waiting to go out.
      const editing = editingPost === openedPost;
      const canReschedule = editing && post.jobStatus !== "posted";
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
          ${editing
            ? `<input class="cal-post-title-input" data-field="title" type="text">`
            : `<h3 class="cal-post-title"></h3>`}
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
            <h4>${post.scheduledAt ? "Scheduled for" : "Date posted"}</h4>
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
            ${editing
              ? `<textarea class="cal-post-field-input" data-field="caption" rows="3"></textarea>`
              : `<p class="cal-post-caption"></p>`}
          </section>
          <section>
            <h4>Hashtags</h4>
            ${editing
              ? `<textarea class="cal-post-field-input" data-field="hashtags" rows="2"></textarea>`
              : `<p class="cal-post-hashtags"></p>`}
          </section>
          <section>
            <h4>Prompt</h4>
            <p class="cal-post-prompt"></p>
          </section>
          ${post.videoUrl
            ? `<section><h4>Video</h4><video class="cal-post-video" src="${escapeHtml(post.videoUrl)}" controls playsinline preload="metadata"></video></section>`
            : ""}
        </div>
        <div class="cal-post-actions">
          ${editing
            ? `<button type="button" class="pf-btn" data-action="save">Save changes</button>
               <button type="button" class="pf-btn ghost" data-action="cancel">Cancel</button>`
            : `<button type="button" class="pf-btn ghost" data-action="edit">Edit post</button>`}
        </div>
      `;

      detail.querySelector(".cal-post-summary").textContent =
        `${platformLabelFull(post)} \u00b7 ${post.time}`;
      detail.querySelector(".cal-post-product").textContent =
        post.productName || post.productUrl || "\u2014";
      detail.querySelector(".cal-post-model").textContent =
        post.provider === "heygen" ? "HeyGen avatar" : "Built-in renderer";
      detail.querySelector(".cal-post-status").textContent =
        `${post.jobStatus}${post.accountCount ? ` \u00b7 ${post.accountCount} account(s)` : ""}`;
      detail.querySelector(".cal-post-prompt").textContent =
        post.prompt || "Script not generated yet.";
      const dateEl = detail.querySelector(".cal-post-date");
      if (dateEl) dateEl.textContent = `${formatLong(focused)} \u00b7 ${post.time}`;

      if (editing) {
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
            editingPost = null;
            await loadEvents();
            render();
          } catch (err) {
            toast(err.message, "error");
            saveBtn.disabled = false;
          }
        });

        detail.querySelector('[data-action="cancel"]').addEventListener("click", () => {
          editingPost = null;
          renderDayPanel();
        });
      } else {
        detail.querySelector(".cal-post-title").textContent = post.title;
        detail.querySelector(".cal-post-caption").textContent = post.caption || "\u2014";
        detail.querySelector(".cal-post-hashtags").textContent = post.hashtags || "\u2014";
        detail.querySelector('[data-action="edit"]').addEventListener("click", () => {
          editingPost = openedPost;
          renderDayPanel();
        });
      }

      detail.querySelector("#cal-post-back").addEventListener("click", () => {
        openedPost = null;
        editingPost = null;
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
      btn.className = `cal-post-item is-${platformKey(primaryPlatform(post))}`;
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

    if (!isEditMode()) {
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

  function syncModeSwitcher() {
    if (modeSwitcherLabel) {
      modeSwitcherLabel.textContent = mode === "edit" ? "Edit" : "View";
    }
    if (modeSwitcherIcon) {
      modeSwitcherIcon.innerHTML = mode === "edit" ? EDIT_ICON : VIEW_ICON;
    }
    modeMenu?.querySelectorAll("[data-cal-mode]").forEach((btn) => {
      const on = btn.getAttribute("data-cal-mode") === mode;
      btn.setAttribute("aria-checked", on ? "true" : "false");
    });
  }

  function setModeMenuOpen(open) {
    if (!modeSwitcher || !modeSwitcherBtn || !modeMenu) return;
    modeSwitcher.classList.toggle("open", open);
    modeSwitcherBtn.setAttribute("aria-expanded", open ? "true" : "false");
    modeMenu.hidden = !open;
  }

  function renderMonthMenu() {
    if (!monthMenuGrid || !yearText) return;
    yearText.textContent = String(pickerYear);
    monthMenuGrid.innerHTML = "";
    MONTHS_SHORT.forEach((label, index) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cal-month-option";
      btn.textContent = label;
      btn.setAttribute("role", "option");
      const active = pickerYear === view.getFullYear() && index === view.getMonth();
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
      btn.addEventListener("click", () => {
        view = new Date(pickerYear, index, 1);
        setMonthMenuOpen(false);
        render();
        loadEvents().then(render);
      });
      monthMenuGrid.appendChild(btn);
    });
  }

  function setMonthMenuOpen(open) {
    if (!monthPicker || !monthLabelBtn || !monthMenu) return;
    if (open) {
      pickerYear = view.getFullYear();
      renderMonthMenu();
      setModeMenuOpen(false);
    }
    monthPicker.classList.toggle("open", open);
    monthLabelBtn.setAttribute("aria-expanded", open ? "true" : "false");
    monthMenu.hidden = !open;
  }

  function updateChrome() {
    const editing = isEditMode();
    const viewing = isViewMode();

    shell?.classList.toggle("is-agent", editing);
    shell?.classList.toggle("is-edit", editing);
    shell?.classList.toggle("is-view", viewing);
    grid.classList.toggle("edit-mode", editing);
    grid.classList.toggle("view-mode", viewing);

    modeButtons.forEach((btn) => {
      const on = btn.getAttribute("data-cal-mode") === mode;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    syncModeSwitcher();

    if (hint) {
      if (editing) {
        hint.textContent = "Edit mode · drag to select a range · click a highlighted block to clear all connected days";
      } else {
        hint.textContent = "View mode · click any day to inspect posts";
      }
    }

    if (chatTitle) {
      chatTitle.textContent = editing ? "AI Agent" : "Day posts";
    }

    renderDateChips();

    if (viewing) {
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
      cell.classList.toggle("selected", isEditMode() && selected.has(key));
      cell.classList.toggle("focused", isViewMode() && focused === key);
    });
    updateChrome();
  }

  function setMode(next) {
    if (!MODES.has(next)) return;
    if (next === mode) {
      saveMode(mode);
      return;
    }
    mode = next;
    saveMode(mode);
    drag = null;
    grid.classList.remove("is-dragging");
    openedPost = null;

    if (isViewMode()) {
      selected.clear();
      if (!focused) focused = keyFromDate(new Date());
      const d = parseKey(focused);
      view = new Date(d.getFullYear(), d.getMonth(), 1);
    } else {
      focused = null;
      selected.clear();
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
      if (isEditMode() && selected.has(key)) cell.classList.add("selected");
      if (isViewMode() && focused === key) cell.classList.add("focused");

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
          row.className = `cal-event-row is-${platformKey(primaryPlatform(ev))}`;
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

  function applyDragSelection(endKey) {
    if (!drag || !endKey) return;
    drag.current = endKey;
    selected.clear();
    drag.snapshot.forEach((k) => selected.add(k));
    keysInRange(parseKey(drag.anchor), parseKey(endKey)).forEach((k) => selected.add(k));
    applySelectionClasses();
  }

  function beginDrag(key) {
    if (!isEditMode()) return;

    // Clicking any day in a connected highlighted block clears the whole block.
    if (selected.has(key)) {
      const block = connectedBlock(key, selected);
      block.forEach((k) => selected.delete(k));
      drag = null;
      applySelectionClasses();
      return;
    }

    drag = {
      anchor: key,
      current: key,
      snapshot: new Set(selected),
    };

    applyDragSelection(key);
    grid.classList.add("is-dragging");
  }

  function updateDrag(key) {
    if (!isEditMode() || !drag || !key || key === drag.current) return;
    applyDragSelection(key);
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

    if (isViewMode()) {
      setFocusedDay(cell.dataset.date);
      applySelectionClasses();
      return;
    }

    e.preventDefault();
    grid.setPointerCapture?.(e.pointerId);
    beginDrag(cell.dataset.date);
  });

  grid.addEventListener("pointermove", (e) => {
    if (!drag || !isEditMode()) return;
    const cell = cellFromPoint(e.clientX, e.clientY);
    if (cell?.dataset.date) updateDrag(cell.dataset.date);
  });

  grid.addEventListener("pointerup", endDrag);
  grid.addEventListener("pointercancel", endDrag);
  window.addEventListener("pointerup", endDrag);

  modeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      setMode(btn.getAttribute("data-cal-mode"));
      setModeMenuOpen(false);
    });
  });

  modeSwitcherBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = modeSwitcherBtn.getAttribute("aria-expanded") !== "true";
    setModeMenuOpen(open);
    if (open) setMonthMenuOpen(false);
  });

  modeMenu?.addEventListener("click", (e) => e.stopPropagation());

  monthLabelBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = monthLabelBtn.getAttribute("aria-expanded") !== "true";
    setMonthMenuOpen(open);
  });

  monthMenu?.addEventListener("click", (e) => e.stopPropagation());

  document.getElementById("cal-year-prev")?.addEventListener("click", (e) => {
    e.stopPropagation();
    pickerYear -= 1;
    renderMonthMenu();
  });

  document.getElementById("cal-year-next")?.addEventListener("click", (e) => {
    e.stopPropagation();
    pickerYear += 1;
    renderMonthMenu();
  });

  document.addEventListener("click", () => {
    setModeMenuOpen(false);
    setMonthMenuOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      setModeMenuOpen(false);
      setMonthMenuOpen(false);
    }
  });

  syncModeSwitcher();
  saveMode(mode);

  document.getElementById("cal-prev")?.addEventListener("click", () => {
    view = new Date(view.getFullYear(), view.getMonth() - 1, 1);
    render();
    loadEvents().then(render);
  });

  document.getElementById("cal-next")?.addEventListener("click", () => {
    view = new Date(view.getFullYear(), view.getMonth() + 1, 1);
    render();
    loadEvents().then(render);
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

  // Edit mode turns a product URL plus a set of selected days into one
  // scheduled video per day. The pipeline needs a real product page to
  // scrape, so a message without a URL can't be actioned.
  const URL_PATTERN = /https?:\/\/[^\s]+/i;

  function agentMessage(text, kind = "info") {
    if (!dayPanel) return;
    dayPanel.innerHTML =
      `<div class="cal-day-empty ${kind === "error" ? "is-error" : ""}">${escapeHtml(text)}</div>`;
  }

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!field || !field.value.trim()) return;

    if (!isEditMode()) {
      toast("Switch to Edit mode to plan new videos", "error");
      return;
    }

    const text = field.value.trim();
    const match = text.match(URL_PATTERN);
    if (!match) {
      toast("Include the product URL you want a video made from", "error");
      agentMessage(
        "Paste the product page URL in your message - the generator scrapes it for the name, price and images.",
        "error"
      );
      return;
    }

    const days = [...selected].sort();
    if (!days.length) {
      toast("Select at least one day on the calendar", "error");
      return;
    }

    const productUrl = match[0];
    // Whatever the user wrote around the URL becomes the video's title.
    const title = text.replace(URL_PATTERN, "").trim().slice(0, 120) || undefined;

    if (sendBtn) sendBtn.disabled = true;
    agentMessage(`Scheduling ${days.length} video${days.length === 1 ? "" : "s"}...`);

    const results = [];
    for (const key of days) {
      // 9am local on each selected day, unless that has already passed.
      const when = parseKey(key);
      when.setHours(9, 0, 0, 0);
      const scheduledAt = when.getTime() > Date.now() ? when.getTime() : Date.now() + 60000;
      try {
        await api("/api/jobs", {
          method: "POST",
          body: { productUrl, title, scheduledAt, platforms: [] },
        });
        results.push({ ok: true });
      } catch (err) {
        results.push({ ok: false, error: err.message });
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

  const CHAT_KEY = "cal-chat-collapsed";
  const calBody = document.querySelector(".cal-body");
  const chatHideBtn = document.getElementById("cal-chat-hide");
  const chatShowBtn = document.getElementById("cal-chat-show");

  function setChatCollapsed(collapsed) {
    calBody?.classList.toggle("chat-collapsed", collapsed);
    if (chatHideBtn) chatHideBtn.hidden = collapsed;
    if (chatShowBtn) chatShowBtn.hidden = !collapsed;
    try {
      localStorage.setItem(CHAT_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  function loadChatCollapsed() {
    try {
      return localStorage.getItem(CHAT_KEY) === "1";
    } catch {
      return false;
    }
  }

  chatHideBtn?.addEventListener("click", () => setChatCollapsed(true));
  chatShowBtn?.addEventListener("click", () => setChatCollapsed(false));
  setChatCollapsed(loadChatCollapsed());

  // Pulls the jobs for the visible month plus a month of padding either
  // side, so stepping between months rarely needs a fetch.
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
