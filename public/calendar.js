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
  const productPicker = document.getElementById("cal-product-picker");
  const productPillBtn = document.getElementById("cal-product-pill-btn");
  const productPillLabel = document.getElementById("cal-product-pill-label");
  const productMenu = document.getElementById("cal-product-menu");
  const formatPicker = document.getElementById("cal-format-picker");
  const formatBtn = document.getElementById("cal-format-btn");
  const formatBtnIcon = document.getElementById("cal-format-btn-icon");
  const formatMenu = document.getElementById("cal-format-menu");
  const platformPicker = document.getElementById("cal-platform-picker");
  const platformBtn = document.getElementById("cal-platform-btn");
  const platformBtnIcon = document.getElementById("cal-platform-btn-icon");
  const platformBtnLabel = document.getElementById("cal-platform-label");
  const platformMenu = document.getElementById("cal-platform-menu");
  const hint = document.getElementById("cal-hint");
  const shell = document.querySelector(".cal-shell");
  const PRODUCT_KEY = "cal-product-url";
  const FORMAT_KEY = "cal-output-format";
  const PLATFORM_KEY = "cal-target-platform";
  const PLATFORM_OPTS = new Set(["all", "tiktok", "youtube", "instagram"]);
  const PLATFORM_PICKER_LABELS = {
    all: "All platforms",
    tiktok: "TikTok",
    youtube: "YouTube",
    instagram: "Instagram",
  };
  const FORMAT_ICONS = {
    slideshow:
      '<svg viewBox="0 0 16 16" fill="none"><rect x="2.5" y="3.5" width="11" height="9" rx="1.5" stroke="currentColor" stroke-width="1.4"/><circle cx="5.75" cy="6.5" r="1" fill="currentColor"/><path d="M2.75 10.5l2.8-2.4 2.1 1.7 2.4-2.6 3.2 3.3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    video:
      '<svg viewBox="0 0 16 16" fill="none"><rect x="2.5" y="3.5" width="11" height="9" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M7 6.2v3.6L10.2 8 7 6.2z" fill="currentColor"/></svg>',
  };
  let selectedProductUrl = localStorage.getItem(PRODUCT_KEY) || "";
  let selectedFormat = localStorage.getItem(FORMAT_KEY) === "slideshow" ? "slideshow" : "video";
  const savedPlatform = localStorage.getItem(PLATFORM_KEY) || "all";
  let selectedPlatform = PLATFORM_OPTS.has(savedPlatform) ? savedPlatform : "all";
  let productCatalog = [];
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

  // Days before today can't be scheduled, so they can't be selected either.
  function isPastKey(key) {
    return key < keyFromDate(new Date());
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
  let selectedEvent = null; // { id, key, index }
  let eventOutlineIntent = null; // set on pointerdown when a bare event-click may outline
  let drag = null;
  let planAbort = null;
  const chatCancelBtn = document.getElementById("cal-chat-cancel");
  const historyPicker = document.getElementById("cal-history-picker");
  const historyBtn = document.getElementById("cal-history-btn");
  const historyMenu = document.getElementById("cal-history-menu");
  const historyList = document.getElementById("cal-history-list");
  // Sent back whole each turn; the server keeps no session.
  const conversation = [];
  let assistantBusy = false;
  let activeChatId = null;

  const CHATS_KEY = "cal-recent-chats";
  const MAX_CHATS = 20;

  function loadChatStore() {
    try {
      const raw = JSON.parse(localStorage.getItem(CHATS_KEY) || "[]");
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  function saveChatStore(chats) {
    try {
      localStorage.setItem(CHATS_KEY, JSON.stringify(chats.slice(0, MAX_CHATS)));
    } catch {
      /* ignore */
    }
  }

  function chatPreview(messages) {
    const first = messages.find((m) => m.role === "user");
    const text = (first?.content || "Chat").replace(/\s+/g, " ").trim();
    return text.length > 56 ? `${text.slice(0, 55)}…` : text;
  }

  function formatChatWhen(ts) {
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) {
      return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    }
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  function persistActiveChat() {
    if (!conversation.length) return;
    if (!activeChatId) activeChatId = `chat-${Date.now()}`;
    const entry = {
      id: activeChatId,
      updatedAt: Date.now(),
      selectedDates: [...selected].sort(),
      messages: conversation.map(({ role, content, actions }) => ({
        role,
        content,
        ...(actions?.length ? { actions } : {}),
      })),
      preview: chatPreview(conversation),
    };
    const chats = loadChatStore().filter((c) => c.id !== activeChatId);
    chats.unshift(entry);
    saveChatStore(chats);
  }

  function setHistoryMenuOpen(open) {
    if (!historyPicker || !historyBtn || !historyMenu) return;
    if (open) {
      renderHistoryMenu();
      setModeMenuOpen(false);
      setMonthMenuOpen(false);
    }
    historyPicker.classList.toggle("open", open);
    historyBtn.classList.toggle("is-on", open);
    historyBtn.setAttribute("aria-expanded", open ? "true" : "false");
    historyMenu.hidden = !open;
  }

  function renderHistoryMenu() {
    if (!historyList) return;
    const chats = loadChatStore();
    if (!chats.length) {
      historyList.innerHTML = `<p class="cal-history-empty">No recent chats yet.</p>`;
      return;
    }
    historyList.innerHTML = chats.map((c) => `
      <button type="button" class="cal-history-item${c.id === activeChatId ? " is-active" : ""}" role="menuitem" data-chat-id="${escapeHtml(c.id)}">
        <span class="cal-history-item-preview">${escapeHtml(c.preview || "Chat")}</span>
        <span class="cal-history-item-meta">${escapeHtml(formatChatWhen(c.updatedAt))}${
          c.selectedDates?.length ? ` · ${c.selectedDates.length} day${c.selectedDates.length === 1 ? "" : "s"}` : ""
        }</span>
      </button>`).join("");

    historyList.querySelectorAll("[data-chat-id]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        openRecentChat(btn.getAttribute("data-chat-id"));
      });
    });
  }

  function openRecentChat(id) {
    const chat = loadChatStore().find((c) => c.id === id);
    if (!chat) return;

    if (activeChatId !== chat.id) persistActiveChat();

    if (!isEditMode()) {
      mode = "edit";
      saveMode(mode);
      focused = null;
      setChatCollapsed(false);
    }

    if (planAbort) {
      planAbort.abort();
      planAbort = null;
    }

    activeChatId = chat.id;
    conversation.length = 0;
    chat.messages.forEach((m) => conversation.push({
      role: m.role,
      content: m.content,
      ...(m.actions?.length ? { actions: m.actions } : {}),
    }));
    selected.clear();
    (chat.selectedDates || []).forEach((key) => {
      if (!isPastKey(key)) selected.add(key);
    });
    assistantBusy = false;
    setComposerActive(false);
    setHistoryMenuOpen(false);
    render();
    renderThread(false);
    syncChatCancel();
  }

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

  function eventIdentity(ev, key, index) {
    return ev?.id != null ? `id:${ev.id}` : `${key}:${index}`;
  }

  function clearSelectedEvent() {
    selectedEvent = null;
  }

  function syncChatCancel() {
    if (!chatCancelBtn) return;
    const show = isEditMode() && (conversation.length > 0 || assistantBusy);
    chatCancelBtn.hidden = !show;
  }

  function setComposerActive(on) {
    form?.classList.toggle("is-typing", Boolean(on));
  }

  function cancelChat() {
    if (planAbort) {
      planAbort.abort();
      planAbort = null;
    }
    persistActiveChat();
    conversation.length = 0;
    activeChatId = null;
    assistantBusy = false;
    drag = null;
    grid.classList.remove("is-dragging");
    setComposerActive(false);
    if (field) {
      field.value = "";
      resizeField();
      syncSendState();
    }
    applySelectionClasses();
  }

  function renderDayPanel() {
    if (!dayPanel) return;

    if (isEditMode()) {
      if (conversation.length) {
        renderThread(false);
        return;
      }
      renderAgentEmpty();
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

    if (field) field.placeholder = "Ask for videos, or anything about your posts";

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

  const viewToolBtn = document.getElementById("cal-view-tool");
  const chatToggleBtn = document.getElementById("cal-chat-toggle");
  const calBody = document.querySelector(".cal-body");
  const CHAT_KEY = "cal-chat-collapsed";

  function setChatCollapsed(collapsed) {
    calBody?.classList.toggle("chat-collapsed", collapsed);
    try {
      localStorage.setItem(CHAT_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
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

    // Eye = View, chat = Edit
    const onView = isViewMode();
    const onEdit = isEditMode();
    viewToolBtn?.classList.toggle("is-on", onView);
    viewToolBtn?.setAttribute("aria-pressed", onView ? "true" : "false");
    chatToggleBtn?.classList.toggle("is-on", onEdit);
    chatToggleBtn?.setAttribute("aria-pressed", onEdit ? "true" : "false");
    chatToggleBtn?.setAttribute(
      "aria-label",
      onEdit ? "Edit mode" : "Switch to Edit mode"
    );
  }

  function setModeMenuOpen(open) {
    if (!modeSwitcher || !modeSwitcherBtn || !modeMenu) return;
    if (open) setHistoryMenuOpen(false);
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
      setHistoryMenuOpen(false);
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

    syncChatCancel();
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
    if (isEditMode()) persistActiveChat();
    mode = next;
    saveMode(mode);
    drag = null;
    grid.classList.remove("is-dragging");
    openedPost = null;
    clearSelectedEvent();

    if (planAbort) {
      planAbort.abort();
      planAbort = null;
    }
    conversation.length = 0;
    activeChatId = null;
    assistantBusy = false;
    setComposerActive(false);

    if (isViewMode()) {
      selected.clear();
      if (!focused) focused = keyFromDate(new Date());
      const d = parseKey(focused);
      view = new Date(d.getFullYear(), d.getMonth(), 1);
    } else {
      focused = null;
      selected.clear();
      // Edit needs the side panel for the composer
      setChatCollapsed(false);
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
      if (key < todayKey) cell.classList.add("past");
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
        list.addEventListener("pointerdown", (e) => {
          // Only steal the gesture when outlining an event (no days selected).
          // Otherwise let day select/drag work like normal.
          if (isEditMode() && selected.size === 0 && e.target.closest(".cal-event-row")) {
            e.stopPropagation();
          }
        });
        list.addEventListener("mousedown", (e) => {
          if (isEditMode() && selected.size === 0 && e.target.closest(".cal-event-row")) {
            e.stopPropagation();
          }
        });
        list.addEventListener("touchstart", (e) => {
          if (isEditMode() && selected.size === 0 && e.target.closest(".cal-event-row")) {
            e.stopPropagation();
          }
        }, { passive: true });
        list.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
        dayEvents.forEach((ev, index) => {
          const row = document.createElement("button");
          row.type = "button";
          const eventId = eventIdentity(ev, key, index);
          const isSelected = selectedEvent?.id === eventId;
          row.className = `cal-event-row is-${platformKey(primaryPlatform(ev))}${isSelected ? " is-selected" : ""}`;
          row.setAttribute("aria-pressed", isSelected ? "true" : "false");
          row.dataset.eventId = eventId;
          row.innerHTML = `
            <i class="cal-event-bar" aria-hidden="true"></i>
            <span class="cal-event-title"></span>
            <span class="cal-event-platform"></span>
            <span class="cal-event-time"></span>
          `;
          row.querySelector(".cal-event-title").textContent = ev.title;
          row.querySelector(".cal-event-platform").textContent = platformLabel(ev);
          row.querySelector(".cal-event-time").textContent = ev.time;
          row.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            // Edit only, and only when no days are highlighted.
            if (!isEditMode() || selected.size > 0) return;
            const id = eventIdentity(ev, key, index);
            selectedEvent = selectedEvent?.id === id ? null : { id, key, index };
            render();
          });
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
    keysInRange(parseKey(drag.anchor), parseKey(endKey)).forEach((k) => {
      if (!isPastKey(k)) selected.add(k);
    });
    applySelectionClasses();
  }

  function beginDrag(key) {
    if (!isEditMode()) return;
    if (isPastKey(key)) return;

    const hadEvent = Boolean(selectedEvent);
    clearSelectedEvent();

    // Clicking any day in a connected highlighted block clears the whole block.
    if (selected.has(key)) {
      const block = connectedBlock(key, selected);
      block.forEach((k) => selected.delete(k));
      drag = null;
      if (hadEvent) render();
      else applySelectionClasses();
      return;
    }

    drag = {
      anchor: key,
      current: key,
      snapshot: new Set(selected),
    };

    applyDragSelection(key);
    grid.classList.add("is-dragging");
    if (hadEvent) render();
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

  historyBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = historyBtn.getAttribute("aria-expanded") !== "true";
    setHistoryMenuOpen(open);
  });
  historyMenu?.addEventListener("click", (e) => e.stopPropagation());

  document.addEventListener("click", () => {
    setModeMenuOpen(false);
    setMonthMenuOpen(false);
    setHistoryMenuOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      setModeMenuOpen(false);
      setMonthMenuOpen(false);
      setHistoryMenuOpen(false);
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
    setComposerActive(true);
  });

  field?.addEventListener("focus", () => setComposerActive(true));

  // Gradient only while using the composer itself — not the product pill.
  form?.addEventListener("pointerdown", () => {
    if (isEditMode()) setComposerActive(true);
  });

  document.addEventListener("pointerdown", (e) => {
    if (form?.contains(e.target)) return;
    setComposerActive(false);
  });

  field?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form?.requestSubmit();
    }
  });

  /* ---------- assistant ---------- */

  const URL_PATTERN = /https?:\/\/[^\s]+/i;

  const LOADING_LINES = [
    "cooking up your schedule...",
    "putting it all together...",
    "working some magic...",
    "getting things ready...",
    "making a game plan...",
    "letting Postfin cook...",
    "building your plan...",
    "getting everything lined up...",
    "making things happen...",
    "setting things in motion...",
    "connecting the dots...",
    "figuring out the details...",
    "getting everything in place...",
    "putting the pieces together...",
    "planning things out...",
    "making it all click...",
    "working behind the scenes...",
    "getting things organized...",
    "doing the heavy lifting...",
    "making a few adjustments...",
    "getting everything dialed in...",
    "finding the right balance...",
    "making your plan smarter...",
    "sorting things out...",
    "getting things moving...",
    "turning ideas into action...",
    "making the pieces fit...",
    "building something good...",
    "getting the gears turning...",
    "mapping things out...",
    "putting AI to work...",
    "letting AI handle it...",
    "thinking things through...",
    "getting the details right...",
    "making some moves...",
    "doing the boring stuff...",
    "making it look easy...",
    "getting everything sorted...",
    "working on it...",
    "giving it some thought...",
    "making the magic happen...",
    "getting it just right...",
    "bringing it all together...",
    "working out the details...",
    "crunching the numbers...",
    "making some calculations...",
    "finding what works...",
    "getting things in order...",
    "building behind the scenes...",
    "making something great...",
    "Postfin is cooking...",
    "Postfin is on it...",
    "Postfin is thinking...",
    "Postfin is working...",
    "Postfin is planning...",
    "Postfin is building...",
    "Postfin is figuring it out...",
    "Postfin is making moves...",
    "Postfin is doing its thing...",
    "Postfin has a plan...",
    "letting the fin cook...",
    "the fin is cooking...",
    "making waves...",
    "getting ready to make waves...",
    "keeping things moving...",
    "building momentum...",
    "setting the pace...",
    "finding the sweet spot...",
    "getting into the flow...",
    "making everything flow...",
    "turning the gears...",
    "firing things up...",
    "warming things up...",
    "powering things up...",
    "spinning things up...",
    "putting things into motion...",
    "making a few tweaks...",
    "fine-tuning everything...",
    "adding the finishing touches...",
    "checking everything twice...",
    "polishing things up...",
    "almost done cooking...",
    "something good is brewing...",
    "something good is cooking...",
    "good things are loading...",
    "getting something good ready...",
    "preparing something good...",
    "your plan is taking shape...",
    "everything is coming together...",
    "almost there...",
    "nearly ready...",
    "finishing things up...",
    "wrapping things up...",
    "just about ready...",
    "one sec, we’re cooking...",
    "give us a second...",
    "hang tight, we’re working...",
    "just putting things together...",
    "getting the final details right...",
    "ready when you are...",
  ];
  let loadingTimer = null;
  let loadingFadeTimer = null;
  let loadingLineIndex = -1;

  function stopLoadingShuffle() {
    if (loadingTimer) {
      clearInterval(loadingTimer);
      loadingTimer = null;
    }
    if (loadingFadeTimer) {
      clearTimeout(loadingFadeTimer);
      loadingFadeTimer = null;
    }
  }

  function pickLoadingLine() {
    if (LOADING_LINES.length < 2) return LOADING_LINES[0] || "working on it...";
    let next = Math.floor(Math.random() * LOADING_LINES.length);
    if (next === loadingLineIndex) {
      next = (next + 1) % LOADING_LINES.length;
    }
    loadingLineIndex = next;
    return LOADING_LINES[next];
  }

  function startLoadingShuffle() {
    stopLoadingShuffle();
    const el = dayPanel?.querySelector(".cal-loading-status");
    if (!el) return;
    el.textContent = pickLoadingLine();
    el.classList.remove("is-fading");
    loadingTimer = setInterval(() => {
      const status = dayPanel?.querySelector(".cal-loading-status");
      if (!status) {
        stopLoadingShuffle();
        return;
      }
      status.classList.add("is-fading");
      loadingFadeTimer = setTimeout(() => {
        status.textContent = pickLoadingLine();
        status.classList.remove("is-fading");
      }, 320);
    }, 2200);
  }

  function renderAgentEmpty() {
    if (!dayPanel) return;
    stopLoadingShuffle();
    dayPanel.innerHTML = `
      <div class="cal-agent-empty" aria-hidden="true">
        <img class="cal-agent-mark" src="agent-mark.jpg" alt="">
      </div>`;
  }

  function renderThread(pending) {
    if (!dayPanel) return;
    stopLoadingShuffle();
    if (!conversation.length && !pending) {
      renderAgentEmpty();
      return;
    }
    const bubbles = conversation.map((m) => `
      <div class="cal-msg is-${m.role}">
        <div class="cal-msg-body">${
          m.role === "assistant" ? formatReply(m.content) : escapeHtml(m.content)
        }</div>
        ${m.actions?.length ? renderActions(m.actions) : ""}
      </div>`).join("");

    dayPanel.innerHTML = `
      <div class="cal-thread">
        ${bubbles}
        ${pending ? `<div class="cal-msg is-assistant cal-msg-loading"><p class="cal-loading-status" aria-live="polite"></p></div>` : ""}
      </div>`;
    dayPanel.scrollTop = dayPanel.scrollHeight;
    if (pending) startLoadingShuffle();
  }

  // Light formatting only - the assistant is told to answer in plain
  // sentences, so this just keeps line breaks and links.
  function formatReply(text) {
    return escapeHtml(text)
      .replace(URL_PATTERN, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`)
      .replace(/\n/g, "<br>");
  }

  // A compact note of what the assistant actually changed, so the user can
  // see the effect without trusting the prose.
  function renderActions(actions) {
    const done = actions.filter((a) => a.ok);
    if (!done.length) return "";
    const lines = done.map((a) => {
      if (a.name === "plan_videos") {
        return (a.result.videos || []).map((v) => `
          <li class="cal-plan-item">
            <span class="cal-plan-date">${escapeHtml(
              new Date(v.scheduledAt).toLocaleDateString("en-US", {
                weekday: "short", month: "short", day: "numeric",
              })
            )}</span>
            <span class="cal-plan-copy">
              <strong>${escapeHtml(v.title)}</strong>
              ${v.angle ? `<span>${escapeHtml(v.angle)}</span>` : ""}
            </span>
          </li>`).join("");
      }
      if (a.name === "reschedule_video") {
        return `<li class="cal-action-note">Moved video ${a.result.videoId} to ${
          escapeHtml(new Date(a.result.scheduledFor).toLocaleString("en-US", {
            weekday: "short", month: "short", day: "numeric",
            hour: "numeric", minute: "2-digit",
          }))}</li>`;
      }
      if (a.name === "edit_video") return `<li class="cal-action-note">Updated video ${a.result.videoId}</li>`;
      if (a.name === "retry_video") return `<li class="cal-action-note">Re-queued video ${a.result.videoId}</li>`;
      if (a.name === "post_video_now") {
        return `<li class="cal-action-note">Posted to ${a.result.posted} account(s), ${a.result.failed} failed</li>`;
      }
      return "";
    }).filter(Boolean).join("");
    return lines ? `<ul class="cal-plan-list">${lines}</ul>` : "";
  }

  async function sendToAssistant(text) {
    conversation.push({ role: "user", content: text });
    persistActiveChat();
    renderThread(true);
    syncChatCancel();

    planAbort = new AbortController();
    const { signal } = planAbort;

    try {
      const reply = await api("/api/chat", {
        method: "POST",
        signal,
        body: {
          messages: conversation.map(({ role, content }) => ({ role, content })),
          selectedDates: [...selected].sort(),
          // Sent so "Friday" means the user's Friday, not the server's.
          offsetMinutes: -new Date().getTimezoneOffset(),
          productUrl: selectedProductUrl || "",
          outputFormat: selectedFormat,
          platforms: selectedPlatform === "all" ? [] : [selectedPlatform],
        },
      });

      conversation.push({
        role: "assistant",
        content: reply.reply || "(no reply)",
        actions: reply.actions,
      });
      persistActiveChat();
      renderThread(false);

      // Keep locked dates highlighted; refresh events if the schedule changed.
      if (reply.changed) {
        await loadEvents();
        render();
        renderThread(false);
      }
    } catch (err) {
      if (err?.name === "AbortError") {
        renderThread(false);
        return;
      }
      conversation.push({ role: "assistant", content: `⚠ ${err.message}` });
      persistActiveChat();
      renderThread(false);
      toast(err.message, "error");
    } finally {
      planAbort = null;
      syncChatCancel();
    }
  }

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!field || !field.value.trim() || assistantBusy) return;

    if (!isEditMode()) {
      toast("Switch to Edit mode to use the assistant", "error");
      return;
    }

    const text = field.value.trim();
    field.value = "";

    assistantBusy = true;
    if (sendBtn) sendBtn.disabled = true;
    syncSendState();
    resizeField();
    syncChatCancel();

    try {
      await sendToAssistant(text);
    } finally {
      assistantBusy = false;
      if (sendBtn) sendBtn.disabled = false;
      syncSendState();
      syncChatCancel();
    }
  });

  chatCancelBtn?.addEventListener("click", () => {
    cancelChat();
  });

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

  function productLabelFor(url) {
    const product = productCatalog.find((p) => p.url === url);
    return product?.name || product?.site || "Link product";
  }

  function setProductMenuOpen(open) {
    if (!productMenu || !productPillBtn) return;
    productMenu.hidden = !open;
    productPillBtn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function syncProductPill() {
    if (!productPillLabel) return;
    productPillLabel.textContent = selectedProductUrl
      ? productLabelFor(selectedProductUrl)
      : "Link product";
  }

  function renderProductMenu() {
    if (!productMenu) return;
    const items = productCatalog.slice(0, 20).map((product) => {
      const label = product.name || product.site || product.url;
      const initial = escapeHtml((label || "?").charAt(0).toUpperCase());
      const media = product.image
        ? `<img src="${escapeHtml(product.image)}" alt="">`
        : `<span class="cal-product-menu-item-fallback">${initial}</span>`;
      const on = product.url === selectedProductUrl ? " is-on" : "";
      return `
        <button type="button" class="cal-product-menu-item${on}" role="option" data-url="${escapeHtml(product.url)}" aria-selected="${product.url === selectedProductUrl ? "true" : "false"}">
          ${media}
          <span>${escapeHtml(label)}</span>
        </button>`;
    }).join("");

    productMenu.innerHTML = `
      ${items || `<p class="cal-product-menu-empty">No products yet — add one first</p>`}
      ${selectedProductUrl ? `<button type="button" class="cal-product-menu-item" data-url="">Clear product</button>` : ""}
      <a class="cal-product-menu-foot" href="products.html">Manage products</a>
    `;
  }

  function setSelectedProduct(url) {
    selectedProductUrl = url || "";
    localStorage.setItem(PRODUCT_KEY, selectedProductUrl);
    syncProductPill();
    renderProductMenu();
  }

  async function loadProductOptions() {
    try {
      const data = await api("/api/products");
      productCatalog = (data.products || []).filter((p) => p.url);
      if (selectedProductUrl && !productCatalog.some((p) => p.url === selectedProductUrl)) {
        selectedProductUrl = "";
        localStorage.setItem(PRODUCT_KEY, "");
      }
    } catch {
      productCatalog = [];
    }
    syncProductPill();
    renderProductMenu();
  }

  function positionFormatMenu() {
    if (!formatMenu || !formatBtn || formatMenu.hidden) return;
    const rect = formatBtn.getBoundingClientRect();
    const gap = 6;
    formatMenu.style.left = `${Math.round(rect.left + rect.width / 2)}px`;
    formatMenu.style.top = `${Math.round(rect.top - gap)}px`;
    formatMenu.style.transform = "translate(-50%, -100%)";
  }

  function setFormatMenuOpen(open) {
    if (!formatMenu || !formatBtn) return;
    if (open) {
      if (formatMenu.parentElement !== document.body) {
        document.body.appendChild(formatMenu);
      }
      formatMenu.hidden = false;
      formatBtn.setAttribute("aria-expanded", "true");
      positionFormatMenu();
    } else {
      formatMenu.hidden = true;
      formatBtn.setAttribute("aria-expanded", "false");
      if (formatPicker && formatMenu.parentElement !== formatPicker) {
        formatPicker.appendChild(formatMenu);
      }
    }
  }

  function syncFormatPicker() {
    if (formatBtnIcon) formatBtnIcon.innerHTML = FORMAT_ICONS[selectedFormat] || FORMAT_ICONS.video;
    formatMenu?.querySelectorAll("[data-format]").forEach((btn) => {
      const on = btn.getAttribute("data-format") === selectedFormat;
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-checked", on ? "true" : "false");
    });
    formatBtn?.setAttribute(
      "title",
      selectedFormat === "slideshow" ? "Slideshow generation" : "Video generation"
    );
    formatBtn?.setAttribute(
      "aria-label",
      selectedFormat === "slideshow" ? "Slideshow · slideshow generation" : "Video · video generation"
    );
  }

  function setSelectedFormat(format) {
    selectedFormat = format === "slideshow" ? "slideshow" : "video";
    localStorage.setItem(FORMAT_KEY, selectedFormat);
    syncFormatPicker();
  }

  function setPlatformMenuOpen(open) {
    if (!platformMenu || !platformBtn) return;
    platformMenu.hidden = !open;
    platformBtn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function syncPlatformPicker() {
    if (platformBtnLabel) platformBtnLabel.textContent = PLATFORM_PICKER_LABELS[selectedPlatform] || "All platforms";
    if (platformBtnIcon) {
      if (selectedPlatform === "all") {
        platformBtnIcon.hidden = true;
        platformBtnIcon.innerHTML = "";
      } else {
        platformBtnIcon.hidden = false;
        platformBtnIcon.innerHTML = `<img src="icons/${selectedPlatform}.png" alt="">`;
      }
    }
    platformMenu?.querySelectorAll("[data-platform]").forEach((btn) => {
      const on = btn.getAttribute("data-platform") === selectedPlatform;
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-checked", on ? "true" : "false");
    });
  }

  function setSelectedPlatform(platform) {
    selectedPlatform = PLATFORM_OPTS.has(platform) ? platform : "all";
    localStorage.setItem(PLATFORM_KEY, selectedPlatform);
    syncPlatformPicker();
  }

  productPillBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    setFormatMenuOpen(false);
    setPlatformMenuOpen(false);
    setProductMenuOpen(productMenu?.hidden !== false);
  });

  productMenu?.addEventListener("click", (e) => {
    const item = e.target.closest("[data-url]");
    if (!item) return;
    e.preventDefault();
    setSelectedProduct(item.getAttribute("data-url") || "");
    setProductMenuOpen(false);
  });

  formatBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    setProductMenuOpen(false);
    setPlatformMenuOpen(false);
    setFormatMenuOpen(formatMenu?.hidden !== false);
  });

  formatMenu?.addEventListener("click", (e) => {
    const item = e.target.closest("[data-format]");
    if (!item) return;
    setSelectedFormat(item.getAttribute("data-format"));
    setFormatMenuOpen(false);
  });

  platformBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    setProductMenuOpen(false);
    setFormatMenuOpen(false);
    setPlatformMenuOpen(platformMenu?.hidden !== false);
  });

  platformMenu?.addEventListener("click", (e) => {
    const item = e.target.closest("[data-platform]");
    if (!item) return;
    setSelectedPlatform(item.getAttribute("data-platform"));
    setPlatformMenuOpen(false);
  });

  document.addEventListener("click", (e) => {
    if (!productPicker?.contains(e.target)) setProductMenuOpen(false);
    if (!formatPicker?.contains(e.target) && !formatMenu?.contains(e.target)) {
      setFormatMenuOpen(false);
    }
    if (!platformPicker?.contains(e.target)) setPlatformMenuOpen(false);
  });

  window.addEventListener("resize", positionFormatMenu);
  document.getElementById("cal-chat-messages")?.addEventListener("scroll", () => {
    if (formatMenu && !formatMenu.hidden) setFormatMenuOpen(false);
  }, { passive: true });

  syncFormatPicker();
  syncPlatformPicker();
  syncSendState();
  resizeField();
  render();
  loadProductOptions();
  loadEvents().then(render);
})();
