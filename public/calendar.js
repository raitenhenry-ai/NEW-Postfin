(() => {
  const grid = document.getElementById("cal-grid");
  if (!grid) return;

  const monthText = document.getElementById("cal-month-text");
  const selectionLabel = document.getElementById("cal-selection-label");
  const chatTitle = document.getElementById("cal-chat-title");
  const dayPanel = document.getElementById("cal-chat-messages");
  const dateChips = document.getElementById("cal-date-chips");
  const attachChips = document.getElementById("cal-attach-chips");
  const attachInput = document.getElementById("cal-attach-input");
  const plusBtn = document.getElementById("cal-composer-plus");
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
  const platformBtnLabel = document.getElementById("cal-platform-label");
  const platformMenu = document.getElementById("cal-platform-menu");
  const hint = document.getElementById("cal-hint");
  const shell = document.querySelector(".cal-shell");
  const calBoard = document.getElementById("cal-board");
  const dayPopup = document.getElementById("cal-day-popup");
  const dayPopupDrag = document.getElementById("cal-day-popup-drag");
  const dayPopupDate = document.getElementById("cal-day-popup-date");
  const dayPopupCount = document.getElementById("cal-day-popup-count");
  const dayPopupList = document.getElementById("cal-day-popup-list");
  const dayPopupClose = document.getElementById("cal-day-popup-close");
  const dayPopupTimePicker = document.getElementById("cal-day-popup-time-picker");
  const dayPopupTimeBtn = document.getElementById("cal-day-popup-time-btn");
  const dayPopupTimeMenu = document.getElementById("cal-day-popup-time-menu");
  const PRODUCT_KEY = "cal-product-url";
  const FORMAT_KEY = "cal-output-format";
  const PLATFORM_KEY = "cal-target-platforms";
  const POPUP_SIZE_KEY = "cal-day-popup-size";
  const POPUP_MIN_W = 300;
  const POPUP_MIN_H = 280;
  const PLATFORM_PICKER_LABELS = {
    tiktok: "TikTok",
    youtube: "YouTube",
    instagram: "Instagram",
    facebook: "Facebook",
    x: "X",
    threads: "Threads",
    pinterest: "Pinterest",
    linkedin: "LinkedIn",
  };
  const PLATFORM_PICKER_SHORT = {
    tiktok: "TT",
    youtube: "YT",
    instagram: "IG",
    facebook: "FB",
    x: "X",
    threads: "Th",
    pinterest: "Pin",
    linkedin: "Li",
  };
  const PLATFORM_CHECK =
    '<span class="cal-platform-check" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none"><path d="M3.5 8.2L6.4 11.1L12.5 4.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';

  function loadSelectedPlatforms() {
    try {
      const raw = JSON.parse(localStorage.getItem(PLATFORM_KEY) || "[]");
      if (!Array.isArray(raw)) return new Set();
      return new Set(raw.filter((p) => typeof p === "string" && p));
    } catch {
      const legacy = localStorage.getItem("cal-target-platform");
      return legacy ? new Set([legacy]) : new Set();
    }
  }
  const FORMAT_ICONS = {
    slideshow:
      '<svg viewBox="0 0 16 16" fill="none"><rect x="2.5" y="3.5" width="11" height="9" rx="1.5" stroke="currentColor" stroke-width="1.4"/><circle cx="5.75" cy="6.5" r="1" fill="currentColor"/><path d="M2.75 10.5l2.8-2.4 2.1 1.7 2.4-2.6 3.2 3.3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    video:
      '<svg viewBox="0 0 16 16" fill="none"><rect x="2.5" y="3.5" width="11" height="9" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M7 6.2v3.6L10.2 8 7 6.2z" fill="currentColor"/></svg>',
  };
  let selectedProductUrl = localStorage.getItem(PRODUCT_KEY) || "";
  let attachedUpload = null;
  let selectedFormat = localStorage.getItem(FORMAT_KEY) === "slideshow" ? "slideshow" : "video";
  let selectedPlatforms = loadSelectedPlatforms(); // empty Set => all linked
  let linkedPlatforms = [];
  let linkedPlatformsLoaded = false;
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

  const { api, escapeHtml, PLATFORM_LABELS, platformIcon, toast } = window.Postfin;

  function platformChoices() {
    return linkedPlatforms;
  }

  function platformName(key) {
    return PLATFORM_PICKER_LABELS[key] || PLATFORM_LABELS[key] || key;
  }

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

  function formatPopupDate(key) {
    const d = parseKey(key);
    return d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }

  function formatPopupTime(ms) {
    return new Date(ms).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function focusedPopupPost() {
    if (!dayPopupKey) return null;
    const posts = events[dayPopupKey] || [];
    if (dayPopupEventIndex != null && posts[dayPopupEventIndex]) return posts[dayPopupEventIndex];
    return posts[0] || null;
  }

  function popupPostTimestamp(post) {
    const ms = Number(post?.scheduledAt || post?.at);
    return Number.isFinite(ms) && ms > 0 ? ms : Date.now();
  }

  function canEditPopupDay(key = dayPopupKey) {
    return Boolean(key) && !isPastKey(key);
  }

  function canEditPopupTime(post) {
    return canEditPopupDay() && popupMode === "edit" && post && post.jobStatus !== "posted";
  }

  function positionPopupTimeMenu() {
    if (!dayPopupTimeMenu || !dayPopupTimeBtn || dayPopupTimeMenu.hidden) return;
    const rect = dayPopupTimeBtn.getBoundingClientRect();
    const gap = 6;
    const width = Math.max(148, Math.round(rect.width));
    let left = Math.round(rect.left);
    let top = Math.round(rect.bottom + gap);
    const maxLeft = window.innerWidth - width - 8;
    left = Math.max(8, Math.min(left, maxLeft));
    const menuH = dayPopupTimeMenu.offsetHeight || 240;
    if (top + menuH > window.innerHeight - 8 && rect.top - gap - menuH > 8) {
      top = Math.round(rect.top - gap - menuH);
    }
    dayPopupTimeMenu.style.left = `${left}px`;
    dayPopupTimeMenu.style.top = `${top}px`;
    dayPopupTimeMenu.style.width = `${width}px`;
  }

  function setPopupTimeMenuOpen(open) {
    if (!dayPopupTimePicker || !dayPopupTimeBtn || !dayPopupTimeMenu) return;
    if (open) {
      const post = focusedPopupPost();
      if (!canEditPopupTime(post)) return;
      renderPopupTimeMenu(post);
      if (dayPopupTimeMenu.parentElement !== document.body) {
        document.body.appendChild(dayPopupTimeMenu);
      }
    }
    dayPopupTimePicker.classList.toggle("open", open);
    dayPopupTimeBtn.classList.toggle("open", open);
    dayPopupTimeBtn.setAttribute("aria-expanded", open ? "true" : "false");
    dayPopupTimeMenu.hidden = !open;
    dayPopup?.classList.toggle("is-time-open", open);
    if (open) {
      positionPopupTimeMenu();
      const active = dayPopupTimeMenu.querySelector(".active");
      active?.scrollIntoView({ block: "center" });
      positionPopupTimeMenu();
    } else if (dayPopupTimePicker && dayPopupTimeMenu.parentElement !== dayPopupTimePicker) {
      dayPopupTimePicker.appendChild(dayPopupTimeMenu);
    }
  }

  function renderPopupTimeMenu(post) {
    if (!dayPopupTimeMenu || !post) return;
    const current = popupPostTimestamp(post);
    const now = Date.now();
    dayPopupTimeMenu.innerHTML = "";
    for (let mins = 0; mins < 24 * 60; mins += 15) {
      const slot = new Date(current);
      slot.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
      const at = slot.getTime();
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cal-day-popup-time-option";
      btn.setAttribute("role", "option");
      btn.textContent = formatPopupTime(at);
      const active = Math.abs(at - current) < 60 * 1000;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
      if (at <= now) {
        btn.disabled = true;
      } else {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          setPopupTimeMenuOpen(false);
          applyPopupTime(post, at);
        });
      }
      dayPopupTimeMenu.appendChild(btn);
    }
  }

  function syncPopupTimeSwitcher() {
    const post = focusedPopupPost();
    const locked = !canEditPopupTime(post);
    dayPopupTimePicker?.classList.toggle("is-locked", locked || !post);
    dayPopupTimePicker?.classList.toggle("is-empty", !post);
    if (dayPopupTimeBtn) dayPopupTimeBtn.disabled = locked || !post;
    if (locked || !post) setPopupTimeMenuOpen(false);
  }

  async function applyPopupTime(post, scheduledAt) {
    if (!post?.id) return;
    if (scheduledAt <= Date.now()) {
      toast("Pick a time in the future", "error");
      return;
    }
    try {
      await api(`/api/jobs/${post.id}`, {
        method: "PATCH",
        body: { scheduledAt },
      });
      post.scheduledAt = scheduledAt;
      post.at = scheduledAt;
      post.time = formatPopupTime(scheduledAt);
      if (dayPopupCount) dayPopupCount.textContent = post.time;
      await loadEvents();
      render();
    } catch (err) {
      toast(err.message || "Could not change that time", "error");
    }
  }

  function clampPopupPosition(left, top) {
    if (!calBoard || !dayPopup) return { left, top };
    const board = calBoard.getBoundingClientRect();
    const width = dayPopup.offsetWidth || 420;
    const height = dayPopup.offsetHeight || 180;
    const pad = 8;
    return {
      left: Math.max(pad, Math.min(left, board.width - width - pad)),
      top: Math.max(pad, Math.min(top, board.height - height - pad)),
    };
  }

  function loadPopupSize() {
    try {
      const raw = JSON.parse(localStorage.getItem(POPUP_SIZE_KEY) || "null");
      if (!raw || typeof raw !== "object") return null;
      const width = Number(raw.width);
      const height = Number(raw.height);
      if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
      return { width, height };
    } catch {
      return null;
    }
  }

  function persistPopupSize(width, height) {
    localStorage.setItem(POPUP_SIZE_KEY, JSON.stringify({
      width: Math.round(width),
      height: Math.round(height),
    }));
  }

  function clampPopupSize(width, height, left, top) {
    if (!calBoard) return { width, height };
    const board = calBoard.getBoundingClientRect();
    const pad = 8;
    const maxW = Math.max(POPUP_MIN_W, board.width - (left ?? pad) - pad);
    const maxH = Math.max(POPUP_MIN_H, board.height - (top ?? pad) - pad);
    return {
      width: Math.min(Math.max(POPUP_MIN_W, width), maxW),
      height: Math.min(Math.max(POPUP_MIN_H, height), maxH),
    };
  }

  function applyPopupSize(size) {
    if (!dayPopup) return;
    if (!size) {
      dayPopup.classList.remove("is-sized");
      dayPopup.style.width = "";
      dayPopup.style.height = "";
      return;
    }
    const next = clampPopupSize(size.width, size.height, dayPopup.offsetLeft || 8, dayPopup.offsetTop || 8);
    dayPopup.classList.add("is-sized");
    dayPopup.style.width = `${Math.round(next.width)}px`;
    dayPopup.style.height = `${Math.round(next.height)}px`;
  }

  function placeDayPopupBeside(cell) {
    if (!calBoard || !dayPopup || !cell) return;
    const board = calBoard.getBoundingClientRect();
    const rect = cell.getBoundingClientRect();
    const width = dayPopup.offsetWidth || 420;
    const gap = 10;
    let left = rect.right - board.left + gap;
    if (left + width > board.width - 8) {
      left = rect.left - board.left - width - gap;
    }
    let top = rect.top - board.top;
    const pos = clampPopupPosition(left, top);
    dayPopup.style.left = `${Math.round(pos.left)}px`;
    dayPopup.style.top = `${Math.round(pos.top)}px`;
  }

  function closeDayPopup() {
    dayPopupKey = null;
    dayPopupEventIndex = null;
    if (!dayPopup) return;
    setPopupTimeMenuOpen(false);
    closePopupPlatformMenus();
    dayPopup.hidden = true;
    dayPopupList && (dayPopupList.innerHTML = "");
  }

  // Add new render models here as they ship.
  const MODEL_OPTIONS = [
    { id: "heygen", label: "HeyGen avatar" },
  ];

  function resolveModelId(post) {
    const id = String(post?.provider || "").toLowerCase();
    if (MODEL_OPTIONS.some((m) => m.id === id)) return id;
    return MODEL_OPTIONS[0]?.id || "heygen";
  }

  function captionWithHashtags(post) {
    const caption = String(post?.caption || "").trim();
    const tags = String(post?.hashtags || "").trim();
    if (caption && tags) return `${caption}\n\n${tags}`;
    return caption || tags || "";
  }

  function splitCaptionHashtags(text) {
    const raw = String(text || "").replace(/\r\n/g, "\n").trim();
    const trailing = raw.match(/^(.*?)\s*((?:#\S+\s*)+)$/s);
    if (trailing) {
      return {
        caption: trailing[1].trim(),
        hashtags: trailing[2].trim().split(/\s+/).filter(Boolean),
      };
    }
    return { caption: raw, hashtags: [] };
  }

  function postPromptText(post) {
    const prompt = String(post?.prompt || "").trim();
    const brief = String(post?.brief || "").trim();
    return prompt || brief || "";
  }

  function setPopupMode(next) {
    if (!canEditPopupDay() && next !== "view") next = "view";
    popupMode = next === "view" ? "view" : "edit";
    dayPopup?.classList.toggle("is-past-day", !canEditPopupDay());
    dayPopup?.querySelectorAll("[data-popup-mode]").forEach((btn) => {
      const mode = btn.getAttribute("data-popup-mode");
      btn.classList.toggle("is-on", mode === popupMode);
      if (mode === "edit") btn.disabled = !canEditPopupDay();
    });
    dayPopup?.classList.toggle("is-viewing", popupMode === "view");
    dayPopup?.querySelectorAll(".cal-day-editor-title, .cal-day-editor-text").forEach((el) => {
      el.readOnly = popupMode === "view";
    });
    dayPopup?.querySelectorAll(".cal-day-popup-model, .cal-day-editor-platforms").forEach((el) => {
      el.disabled = popupMode === "view";
    });
    if (popupMode === "view") {
      dayPopup?.querySelectorAll(".cal-day-editor-platform-menu").forEach((menu) => {
        menu.hidden = true;
      });
      dayPopup?.querySelectorAll(".cal-day-editor-platforms").forEach((btn) => {
        btn.setAttribute("aria-expanded", "false");
      });
    }
    const save = dayPopup?.querySelector(".cal-day-editor-save");
    if (save) save.hidden = popupMode === "view";
    syncPopupTimeSwitcher();
  }

  function setPopupTab(next) {
    popupTab = ["prompt", "caption", "model", "reference"].includes(next) ? next : "prompt";
    dayPopupList?.querySelectorAll("[data-editor-tab]").forEach((btn) => {
      const on = btn.getAttribute("data-editor-tab") === popupTab;
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    dayPopupList?.querySelectorAll("[data-editor-panel]").forEach((panel) => {
      panel.hidden = panel.getAttribute("data-editor-panel") !== popupTab;
    });
  }

  async function savePopupPost(key, postIndex) {
    if (!canEditPopupDay(key)) {
      toast("Past posts can't be edited", "error");
      return;
    }
    const post = events[key]?.[postIndex];
    const editor = dayPopupList?.querySelector(".cal-day-editor");
    if (!post?.id || !editor) return;
    const title = editor.querySelector(".cal-day-editor-title")?.value || "";
    const prompt = editor.querySelector('[data-editor-panel="prompt"] textarea')?.value || "";
    const captionRaw = editor.querySelector('[data-editor-panel="caption"] textarea')?.value || "";
    const { caption, hashtags } = splitCaptionHashtags(captionRaw);
    const model = editor.querySelector(".cal-day-popup-model")?.value;
    const platforms = [...editor.querySelectorAll("[data-popup-platform].is-on")]
      .map((btn) => btn.getAttribute("data-popup-platform"))
      .filter((p) => platformChoices().includes(p));
    const saveBtn = editor.querySelector(".cal-day-editor-save");
    if (!platforms.length) {
      toast(platformChoices().length ? "Pick at least one linked platform" : "No social accounts are linked", "error");
      return;
    }
    if (saveBtn) saveBtn.disabled = true;
    try {
      const payload = { title, caption, hashtags, platforms };
      if (!String(post.prompt || "").trim()) payload.brief = prompt;
      await api(`/api/jobs/${post.id}`, {
        method: "PATCH",
        body: payload,
      });
      post.title = title.slice(0, 120);
      post.caption = caption;
      post.hashtags = hashtags.join(" ");
      if (payload.brief != null) {
        post.brief = prompt;
        post.prompt = prompt;
      }
      post.platforms = platforms;
      if (model && MODEL_OPTIONS.some((m) => m.id === model)) post.provider = model;
      toast("Saved");
      await loadEvents();
      render();
    } catch (err) {
      toast(err.message || "Could not save", "error");
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  function modelSelectHtml(selectedId) {
    return `
      <select class="cal-day-popup-model" aria-label="Model">
        ${MODEL_OPTIONS.map((m) => `
          <option value="${escapeHtml(m.id)}"${m.id === selectedId ? " selected" : ""}>${escapeHtml(m.label)}</option>
        `).join("")}
      </select>`;
  }

  function editorPlatformChoices() {
    return platformChoices();
  }

  function initialPopupPlatforms(post) {
    const linked = platformChoices();
    const list = (post.platforms || []).filter((p) => linked.includes(p));
    return list.length ? list : [...linked];
  }

  function popupPlatformPickerHtml(post) {
    const choices = editorPlatformChoices();
    const selected = new Set(initialPopupPlatforms(post));
    const items = choices.length
      ? choices.map((p) => `
          <button type="button" class="cal-day-editor-platform-item${selected.has(p) ? " is-on" : ""}" role="menuitemcheckbox" data-popup-platform="${escapeHtml(p)}" aria-checked="${selected.has(p) ? "true" : "false"}">
            <span class="cal-day-editor-platform-icon">${platformIcon(p)}</span>
            <span>${escapeHtml(platformName(p))}</span>
            ${PLATFORM_CHECK}
          </button>
        `).join("")
      : `<p class="cal-platform-menu-empty">No accounts linked</p>`;
    return `
      <div class="cal-day-editor-platform-picker">
        <button type="button" class="cal-day-editor-platforms" aria-haspopup="menu" aria-expanded="false" aria-label="Post to"${choices.length ? "" : " disabled"}>
          <span class="cal-day-editor-platforms-label">${escapeHtml(choices.length ? platformLabel({ platforms: [...selected] }) : "No accounts")}</span>
          <svg class="cal-day-editor-platforms-caret" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <div class="cal-day-editor-platform-menu" role="menu" hidden>
          ${items}
        </div>
      </div>`;
  }

  function closePopupPlatformMenus() {
    dayPopup?.querySelectorAll(".cal-day-editor-platform-menu").forEach((menu) => {
      menu.hidden = true;
    });
    dayPopup?.querySelectorAll(".cal-day-editor-platforms").forEach((btn) => {
      btn.setAttribute("aria-expanded", "false");
    });
  }

  function syncPopupPlatformPicker(picker) {
    const selected = [...picker.querySelectorAll("[data-popup-platform].is-on")]
      .map((btn) => btn.getAttribute("data-popup-platform"));
    const label = picker.querySelector(".cal-day-editor-platforms-label");
    if (label) label.textContent = platformLabel({ platforms: selected });
  }

  function bindPopupPlatformPicker(editor) {
    const picker = editor?.querySelector(".cal-day-editor-platform-picker");
    const btn = picker?.querySelector(".cal-day-editor-platforms");
    const menu = picker?.querySelector(".cal-day-editor-platform-menu");
    if (!picker || !btn || !menu) return;

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (popupMode === "view") return;
      const open = menu.hidden;
      closePopupPlatformMenus();
      menu.hidden = !open;
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });

    menu.addEventListener("click", (e) => {
      const item = e.target.closest("[data-popup-platform]");
      if (!item) return;
      e.preventDefault();
      e.stopPropagation();
      const turningOn = !item.classList.contains("is-on");
      if (!turningOn && picker.querySelectorAll("[data-popup-platform].is-on").length <= 1) return;
      item.classList.toggle("is-on", turningOn);
      item.setAttribute("aria-checked", turningOn ? "true" : "false");
      syncPopupPlatformPicker(picker);
    });
  }

  function renderPopupEditor(key, posts, postIndex) {
    const post = posts[postIndex];
    if (!post) return "";
    const prompt = postPromptText(post);
    const caption = captionWithHashtags(post);
    const modelId = resolveModelId(post);
    const switcher = posts.length > 1
      ? `<div class="cal-day-editor-switcher">${posts.map((p, i) => `
          <button type="button" class="cal-day-editor-switch${i === postIndex ? " is-on" : ""}" data-switch-post="${i}">${escapeHtml(p.title || "Untitled")}</button>
        `).join("")}</div>`
      : "";
    return `
      <div class="cal-day-editor" data-post-index="${postIndex}">
        ${switcher}
        <div class="cal-day-editor-title-row">
          <input class="cal-day-editor-title" type="text" maxlength="120" value="${escapeHtml(post.title || "")}" placeholder="Post title">
          ${popupPlatformPickerHtml(post)}
        </div>
        <div class="cal-day-editor-tabs" role="tablist" aria-label="Post fields">
          <button type="button" role="tab" data-editor-tab="prompt">Prompt</button>
          <button type="button" role="tab" data-editor-tab="reference">Reference</button>
          <button type="button" role="tab" data-editor-tab="caption">Caption</button>
          <button type="button" role="tab" data-editor-tab="model">Model</button>
        </div>
        <div class="cal-day-editor-panel" data-editor-panel="prompt">
          <span class="cal-day-editor-label">Prompt</span>
          <div class="cal-day-editor-box">
            <textarea class="cal-day-editor-text" placeholder="Script not generated yet.">${escapeHtml(prompt)}</textarea>
          </div>
        </div>
        <div class="cal-day-editor-panel" data-editor-panel="reference" hidden>
          <span class="cal-day-editor-label">Reference</span>
          <button type="button" class="cal-day-editor-reference-add">
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
            <span>Add a reference image or link</span>
          </button>
        </div>
        <div class="cal-day-editor-panel" data-editor-panel="caption" hidden>
          <span class="cal-day-editor-label">Caption</span>
          <div class="cal-day-editor-box">
            <textarea class="cal-day-editor-text" placeholder="Caption and hashtags">${escapeHtml(caption)}</textarea>
          </div>
        </div>
        <div class="cal-day-editor-panel" data-editor-panel="model" hidden>
          <span class="cal-day-editor-label">Model</span>
          ${modelSelectHtml(modelId)}
        </div>
        <button type="button" class="cal-day-editor-save">Save</button>
      </div>`;
  }

  function openDayPopup(key, cell, eventIndex = null, { fresh = true } = {}) {
    if (!dayPopup || !dayPopupList || !key) return;
    dayPopupKey = key;
    dayPopupEventIndex = Number.isInteger(eventIndex) ? eventIndex : null;
    const posts = events[key] || [];
    const focusIndex = dayPopupEventIndex != null && posts[dayPopupEventIndex]
      ? dayPopupEventIndex
      : (posts.length ? 0 : null);

    if (dayPopupDate) dayPopupDate.textContent = formatPopupDate(key);
    if (dayPopupCount) {
      const post = focusIndex != null ? posts[focusIndex] : null;
      dayPopupCount.textContent = post?.time || (posts.length ? `${posts.length} posts` : "No posts");
    }
    syncPopupTimeSwitcher();
    setPopupTimeMenuOpen(false);

    if (!posts.length) {
      dayPopupList.innerHTML = `<p class="cal-day-popup-empty">Nothing scheduled this day.</p>`;
    } else {
      dayPopupList.innerHTML = renderPopupEditor(key, posts, focusIndex);
      const editor = dayPopupList.querySelector(".cal-day-editor");
      editor?.querySelectorAll("[data-editor-tab]").forEach((btn) => {
        btn.addEventListener("click", () => setPopupTab(btn.getAttribute("data-editor-tab")));
      });
      editor?.querySelectorAll("[data-switch-post]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const next = Number(btn.getAttribute("data-switch-post"));
          openDayPopup(key, cell || grid.querySelector(`.cal-cell[data-date="${key}"]`), next, { fresh: false });
        });
      });
      editor?.querySelector(".cal-day-editor-save")?.addEventListener("click", () => {
        savePopupPost(key, focusIndex);
      });
      editor?.querySelector(".cal-day-popup-model")?.addEventListener("change", (e) => {
        const next = e.target.value;
        if (!MODEL_OPTIONS.some((m) => m.id === next)) return;
        if (events[key]?.[focusIndex]) events[key][focusIndex].provider = next;
      });
      editor?.querySelector(".cal-day-popup-model")?.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
      });
      bindPopupPlatformPicker(editor);
    }

    if (fresh) {
      popupTab = "prompt";
      popupMode = canEditPopupDay(key) ? "edit" : "view";
    } else if (!canEditPopupDay(key)) {
      popupMode = "view";
    }
    dayPopup.hidden = false;
    applyPopupSize(loadPopupSize());
    setPopupTab(popupTab);
    setPopupMode(popupMode);
    placeDayPopupBeside(cell || grid.querySelector(`.cal-cell[data-date="${key}"]`));
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
  let selectedEvent = null; // { id, key, index, videoId, title, time }
  let popupMode = "edit";
  let popupTab = "prompt";
  let drag = null;
  let dayPopupKey = null;
  let dayPopupEventIndex = null;
  let popupDrag = null;
  let popupResize = null;
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
      selectedEvent: selectedEvent
        ? {
            id: selectedEvent.id,
            key: selectedEvent.key,
            index: selectedEvent.index,
            videoId: selectedEvent.videoId,
            title: selectedEvent.title,
            time: selectedEvent.time,
          }
        : null,
      messages: conversation.map(({ role, content, actions, questions, answered, imageUrls }) => ({
        role,
        content,
        ...(imageUrls?.length ? { imageUrls } : {}),
        ...(actions?.length ? { actions } : {}),
        ...(questions?.length ? { questions } : {}),
        ...(answered ? { answered: true } : {}),
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
      ...(m.imageUrls?.length ? { imageUrls: m.imageUrls } : {}),
      ...(m.actions?.length ? { actions: m.actions } : {}),
      ...(m.questions?.length ? { questions: m.questions } : {}),
      ...(m.answered ? { answered: true } : {}),
    }));
    selected.clear();
    (chat.selectedDates || []).forEach((key) => {
      if (!isPastKey(key)) selected.add(key);
    });
    selectedEvent = chat.selectedEvent?.videoId
      ? { ...chat.selectedEvent }
      : null;
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

  function pinCalendarEvent(ev, key, index, { toggleOff = false } = {}) {
    const eventId = eventIdentity(ev, key, index);
    if (toggleOff && isEditMode() && selectedEvent?.id === eventId) {
      selectedEvent = null;
      render();
      closeDayPopup();
      return;
    }
    const videoId = Number(ev?.id);
    const pinned = {
      id: eventId,
      key,
      index,
      videoId: Number.isFinite(videoId) && videoId > 0 ? videoId : null,
      title: ev?.title || "Untitled",
      time: ev?.time || "",
    };
    if (!isEditMode()) setMode("edit");
    selectedEvent = pinned;
    selected.clear();
    drag = null;
    grid.classList.remove("is-dragging");
    setChatCollapsed(false);
    render();
    openDayPopup(key, grid.querySelector(`.cal-cell[data-date="${key}"]`), index);
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
        post.format === "slideshow"
          ? `AI slideshow${post.slideCount ? ` · ${post.slideCount} slides` : ""}`
          : "HeyGen avatar";
      const statusEl = detail.querySelector(".cal-post-status");
      statusEl.textContent =
        `${post.jobStatus}${post.accountCount ? ` \u00b7 ${post.accountCount} account(s)` : ""}`;
      // A failed video that only says "failed" sends you to the logs; say why.
      // A video that rendered with something missing says that too.
      const note = post.error || post.warning;
      if (note) {
        const why = document.createElement("span");
        why.className = post.error ? "cal-post-error" : "cal-post-warning";
        why.textContent = note;
        statusEl.after(why);
      }
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

    if (field) {
      field.placeholder = selectedEvent
        ? "Ask to edit this video"
        : "Ask for videos, or anything about your posts";
    }

    const keys = [...selected].sort();
    if (!keys.length && !selectedEvent) {
      dateChips.hidden = true;
      dateChips.innerHTML = "";
      return;
    }

    dateChips.hidden = false;
    dateChips.innerHTML = "";

    if (selectedEvent) {
      const chip = document.createElement("div");
      chip.className = "cal-date-chip cal-event-chip";
      chip.innerHTML = `
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="2.5" y="3.5" width="11" height="9" rx="1.6" stroke="currentColor" stroke-width="1.4"/>
          <path d="M6.6 6.2v3.2L10.2 8 6.6 6.2z" fill="currentColor"/>
        </svg>
        <span class="cal-date-chip-label"></span>
        <button type="button" class="cal-date-chip-remove" aria-label="Remove event">
          <svg viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M3 3l6 6M9 3L3 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </button>
      `;
      chip.querySelector(".cal-date-chip-label").textContent = "selected post";
      chip.querySelector(".cal-date-chip-remove").addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        selectedEvent = null;
        render();
        closeDayPopup();
      });
      dateChips.appendChild(chip);
    }
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
        closeDayPopup();
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
    if (selectedEvent) {
      selectionLabel.textContent = `Editing ${selectedEvent.title || "this video"}`;
    } else if (!keys.length) selectionLabel.textContent = "No dates selected";
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
    closeDayPopup();
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
        // Wheel stays local; blank space in this list still bubbles for day select.
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
          // Event click: outline that event + open the day popup (not the whole cell).
          row.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            e.stopPropagation();
          });
          row.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            pinCalendarEvent(ev, key, index, { toggleOff: true });
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
    if (e.target.closest(".cal-event-row")) return;

    if (isViewMode()) {
      setFocusedDay(cell.dataset.date);
      applySelectionClasses();
      openDayPopup(cell.dataset.date, cell);
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

  dayPopupClose?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeDayPopup();
  });

  dayPopup?.querySelector(".cal-day-popup-mode")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-popup-mode]");
    if (!btn || btn.disabled) return;
    e.preventDefault();
    e.stopPropagation();
    const next = btn.getAttribute("data-popup-mode");
    if (next === "edit" && !canEditPopupDay()) return;
    setPopupMode(next);
  });

  dayPopupTimeBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (dayPopupTimeBtn.disabled) return;
    const open = dayPopupTimeBtn.getAttribute("aria-expanded") !== "true";
    setPopupTimeMenuOpen(open);
  });

  dayPopupTimeMenu?.addEventListener("click", (e) => e.stopPropagation());
  dayPopupTimePicker?.addEventListener("click", (e) => e.stopPropagation());

  dayPopupDrag?.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !dayPopup || !calBoard) return;
    if (e.target.closest(".cal-day-popup-close")) return;
    e.preventDefault();
    e.stopPropagation();
    const board = calBoard.getBoundingClientRect();
    popupDrag = {
      offsetX: e.clientX - board.left - dayPopup.offsetLeft,
      offsetY: e.clientY - board.top - dayPopup.offsetTop,
    };
    dayPopupDrag.setPointerCapture?.(e.pointerId);
  });

  dayPopupDrag?.addEventListener("pointermove", (e) => {
    if (!popupDrag || !dayPopup || !calBoard) return;
    const board = calBoard.getBoundingClientRect();
    const pos = clampPopupPosition(
      e.clientX - board.left - popupDrag.offsetX,
      e.clientY - board.top - popupDrag.offsetY
    );
    dayPopup.style.left = `${Math.round(pos.left)}px`;
    dayPopup.style.top = `${Math.round(pos.top)}px`;
  });

  const endPopupDrag = () => { popupDrag = null; };
  dayPopupDrag?.addEventListener("pointerup", endPopupDrag);
  dayPopupDrag?.addEventListener("pointercancel", endPopupDrag);

  dayPopup?.querySelectorAll("[data-popup-resize]").forEach((handle) => {
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !dayPopup || !calBoard) return;
      e.preventDefault();
      e.stopPropagation();
      popupDrag = null;
      popupResize = {
        edge: handle.getAttribute("data-popup-resize") || "se",
        startX: e.clientX,
        startY: e.clientY,
        startW: dayPopup.offsetWidth,
        startH: dayPopup.offsetHeight,
      };
      dayPopup.classList.add("is-resizing");
      handle.setPointerCapture?.(e.pointerId);
    });
    handle.addEventListener("pointermove", (e) => {
      if (!popupResize || !dayPopup) return;
      const dx = e.clientX - popupResize.startX;
      const dy = e.clientY - popupResize.startY;
      let width = popupResize.startW;
      let height = popupResize.startH;
      if (popupResize.edge.includes("e")) width += dx;
      if (popupResize.edge.includes("s")) height += dy;
      const next = clampPopupSize(width, height, dayPopup.offsetLeft, dayPopup.offsetTop);
      dayPopup.classList.add("is-sized");
      dayPopup.style.width = `${Math.round(next.width)}px`;
      dayPopup.style.height = `${Math.round(next.height)}px`;
    });
    const endPopupResize = () => {
      if (!popupResize || !dayPopup) {
        popupResize = null;
        return;
      }
      persistPopupSize(dayPopup.offsetWidth, dayPopup.offsetHeight);
      dayPopup.classList.remove("is-resizing");
      popupResize = null;
    };
    handle.addEventListener("pointerup", endPopupResize);
    handle.addEventListener("pointercancel", endPopupResize);
  });

  dayPopup?.addEventListener("pointerdown", (e) => e.stopPropagation());

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (dayPopupTimeMenu && !dayPopupTimeMenu.hidden) {
      setPopupTimeMenuOpen(false);
      return;
    }
    closeDayPopup();
  });

  modeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      setMode(btn.getAttribute("data-cal-mode"));
      setModeMenuOpen(false);
      closeDayPopup();
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

  document.addEventListener("click", (e) => {
    setModeMenuOpen(false);
    setMonthMenuOpen(false);
    setHistoryMenuOpen(false);
    if (!dayPopupTimePicker?.contains(e.target) && !dayPopupTimeMenu?.contains(e.target)) {
      setPopupTimeMenuOpen(false);
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      setModeMenuOpen(false);
      setMonthMenuOpen(false);
      setHistoryMenuOpen(false);
      setPopupTimeMenuOpen(false);
    }
  });

  syncModeSwitcher();
  saveMode(mode);

  document.getElementById("cal-prev")?.addEventListener("click", () => {
    view = new Date(view.getFullYear(), view.getMonth() - 1, 1);
    closeDayPopup();
    render();
    loadEvents().then(render);
  });

  document.getElementById("cal-next")?.addEventListener("click", () => {
    view = new Date(view.getFullYear(), view.getMonth() + 1, 1);
    closeDayPopup();
    render();
    loadEvents().then(render);
  });

  function syncSendState() {
    if (!sendBtn || !field) return;
    sendBtn.disabled = assistantBusy || !(field.value.trim() || attachedUpload);
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
      <div class="cal-agent-empty">
        <img class="cal-agent-mark" src="agent-mark.png" alt="" aria-hidden="true">
      </div>`;
  }

  function renderThread(pending) {
    if (!dayPanel) return;
    stopLoadingShuffle();
    if (!conversation.length && !pending) {
      renderAgentEmpty();
      return;
    }
    const bubbles = conversation.map((m, index) => `
      <div class="cal-msg is-${m.role}">
        ${m.role === "user" ? renderMsgImages(m.imageUrls) : ""}
        <div class="cal-msg-body">${
          m.role === "assistant" ? formatReply(m.content) : escapeHtml(m.content)
        }</div>
        ${m.actions?.length ? renderActions(m.actions) : ""}
        ${askable(m, index) ? renderAsk(m, index) : ""}
      </div>`).join("");

    dayPanel.innerHTML = `
      <div class="cal-thread">
        ${bubbles}
        ${pending ? `<div class="cal-msg is-assistant cal-msg-loading"><p class="cal-loading-status" aria-live="polite"></p></div>` : ""}
      </div>`;
    bindAsk();
    dayPanel.scrollTop = dayPanel.scrollHeight;
    if (pending) startLoadingShuffle();
  }

  /* ---------- multiple-choice questions ---------- */

  // The assistant asks before it generates, so a vague brief turns into a
  // couple of taps instead of a guessed video. Picks are staged on the
  // message itself and sent as one ordinary reply, which is all the server
  // needs - it keeps no session.

  // Only the newest question is still live: once the conversation has moved
  // past it - answered by tapping, or by typing something else - its options
  // are history, and leaving them clickable would send a reply to a question
  // the assistant has stopped waiting on.
  function askable(msg, index) {
    return Boolean(msg?.questions?.length) && !msg.answered && index === conversation.length - 1;
  }

  function askPicks(msg, qIndex) {
    return msg.picked?.[qIndex] || [];
  }

  // One question with one answer sends on tap; anything else waits for
  // Continue, so a set of questions goes back as a single reply.
  function askNeedsContinue(msg) {
    return msg.questions.length > 1 || msg.questions.some((entry) => entry.allowMultiple);
  }

  function askComplete(msg) {
    return msg.questions.every((entry, i) => askPicks(msg, i).length > 0);
  }

  function renderAsk(msg, msgIndex) {
    const multi = askNeedsContinue(msg);
    const blocks = msg.questions.map((entry, qIndex) => `
      <div class="cal-ask-q">
        ${msg.questions.length > 1 || entry.question !== msg.content
          ? `<p class="cal-ask-label">${escapeHtml(entry.question)}</p>`
          : ""}
        <div class="cal-ask-options" role="group" aria-label="${escapeHtml(entry.question)}">
          ${entry.options.map((option, oIndex) => `
            <button type="button" class="cal-ask-chip${
              askPicks(msg, qIndex).includes(option.label) ? " is-picked" : ""
            }" data-ask-msg="${msgIndex}" data-ask-q="${qIndex}" data-ask-option="${oIndex}"
              aria-pressed="${askPicks(msg, qIndex).includes(option.label) ? "true" : "false"}">
              <span class="cal-ask-chip-label">${escapeHtml(option.label)}</span>
              ${option.hint ? `<span class="cal-ask-chip-hint">${escapeHtml(option.hint)}</span>` : ""}
            </button>`).join("")}
        </div>
      </div>`).join("");

    return `
      <div class="cal-ask">
        ${blocks}
        <div class="cal-ask-foot">
          <span class="cal-ask-hint">${
            multi ? "Pick one for each, or just type your answer." : "Or type your own answer."
          }</span>
          ${multi
            ? `<button type="button" class="cal-ask-send" data-ask-send="${msgIndex}"${
                askComplete(msg) ? "" : " disabled"
              }>Continue</button>`
            : ""}
        </div>
      </div>`;
  }

  function bindAsk() {
    dayPanel?.querySelectorAll("[data-ask-option]").forEach((btn) => {
      btn.addEventListener("click", () => {
        pickAnswer(
          Number(btn.getAttribute("data-ask-msg")),
          Number(btn.getAttribute("data-ask-q")),
          Number(btn.getAttribute("data-ask-option"))
        );
      });
    });
    dayPanel?.querySelectorAll("[data-ask-send]").forEach((btn) => {
      btn.addEventListener("click", () => {
        sendAnswers(Number(btn.getAttribute("data-ask-send")));
      });
    });
  }

  function pickAnswer(msgIndex, qIndex, optionIndex) {
    const msg = conversation[msgIndex];
    if (!askable(msg, msgIndex) || assistantBusy) return;
    const entry = msg.questions[qIndex];
    const label = entry?.options?.[optionIndex]?.label;
    if (!label) return;

    msg.picked ??= {};
    if (entry.allowMultiple) {
      const current = askPicks(msg, qIndex);
      msg.picked[qIndex] = current.includes(label)
        ? current.filter((pick) => pick !== label)
        : [...current, label];
    } else {
      msg.picked[qIndex] = [label];
    }

    if (!askNeedsContinue(msg)) {
      sendAnswers(msgIndex);
      return;
    }
    renderThread(false);
  }

  function sendAnswers(msgIndex) {
    const msg = conversation[msgIndex];
    if (!askable(msg, msgIndex) || assistantBusy || !askComplete(msg)) return;

    // One question reads as a plain answer; several are labelled so the
    // assistant can tell which answer belongs to which question.
    const text = msg.questions.length === 1
      ? askPicks(msg, 0).join(", ")
      : msg.questions
          .map((entry, i) => `${entry.question} — ${askPicks(msg, i).join(", ")}`)
          .join("\n");

    msg.answered = true;
    delete msg.picked;
    renderThread(false);
    persistActiveChat();
    submitMessage(text);
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
        // Say which format was made. Getting this wrong is invisible until
        // the render finishes, by which point it is the wrong video.
        const made = a.result.format === "slideshow"
          ? `AI slideshow${a.result.angle ? ` · ${a.result.angle.replace(/_/g, " ")}` : ""}`
          : "HeyGen avatar video";
        const header = `<li class="cal-action-note">${escapeHtml(made)}</li>`;
        return header + (a.result.videos || []).map((v) => `
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
      if (a.name === "edit_video") {
        const fields = (a.result.updated || []).join(", ");
        return `<li class="cal-action-note">Updated video ${a.result.videoId}${
          fields ? ` · ${escapeHtml(fields)}` : ""
        }</li>`;
      }
      if (a.name === "regenerate_video") {
        return `<li class="cal-action-note">Rewriting and re-rendering video ${a.result.videoId}</li>`;
      }
      if (a.name === "delete_video") {
        const gone = a.result.deleted || [];
        if (!gone.length) return "";
        return `<li class="cal-action-note">Deleted ${gone.length} video${
          gone.length === 1 ? "" : "s"
        } · ${escapeHtml(gone.map((v) => v.title).join(", "))}</li>`;
      }
      if (a.name === "retry_video") return `<li class="cal-action-note">Re-queued video ${a.result.videoId}</li>`;
      if (a.name === "post_video_now") {
        return `<li class="cal-action-note">Posted to ${a.result.posted} account(s), ${a.result.failed} failed</li>`;
      }
      return "";
    }).filter(Boolean).join("");
    return lines ? `<ul class="cal-plan-list">${lines}</ul>` : "";
  }

  function renderMsgImages(urls) {
    const srcs = (Array.isArray(urls) ? urls : [])
      .map((u) => String(u || "").trim())
      .filter((u) => u.startsWith("/ugc-media/") || /^https?:\/\//i.test(u));
    if (!srcs.length) return "";
    return `<div class="cal-msg-images">${srcs.map((src) =>
      `<img src="${escapeHtml(src)}" alt="">`
    ).join("")}</div>`;
  }

  async function sendToAssistant(text) {
    const imageUrls = attachedUpload
      ? [attachedUpload.url || attachedUpload.path].filter(Boolean)
      : [];
    attachedUpload = null;
    renderAttachChip();
    syncSendState();

    conversation.push({
      role: "user",
      content: text,
      ...(imageUrls.length ? { imageUrls } : {}),
    });
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
          imageUrls,
          selectedVideo: selectedEvent?.videoId
            ? {
                id: selectedEvent.videoId,
                title: selectedEvent.title || "",
                date: selectedEvent.key || "",
              }
            : null,
          outputFormat: selectedFormat,
          platforms: [...selectedPlatforms],
        },
      });

      conversation.push({
        role: "assistant",
        content: reply.reply || "(no reply)",
        actions: reply.actions,
        // Present only when the assistant stopped to ask something; the
        // thread renders them as choices under the bubble.
        ...(reply.questions?.length ? { questions: reply.questions } : {}),
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

  // The composer and the assistant's choice chips both land here, so a
  // tapped answer behaves exactly like a typed one.
  async function submitMessage(text) {
    if (!text || assistantBusy) return;

    if (!isEditMode()) {
      toast("Switch to Edit mode to use the assistant", "error");
      return;
    }

    assistantBusy = true;
    syncSendState();
    resizeField();
    syncChatCancel();

    try {
      await sendToAssistant(text);
    } finally {
      assistantBusy = false;
      syncSendState();
      syncChatCancel();
    }
  }

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!field || assistantBusy) return;
    const typed = field.value.trim();
    const text = typed || (attachedUpload ? "Look at this screenshot." : "");
    if (!text) return;
    field.value = "";
    submitMessage(text);
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
      setLinkedPlatforms(data.connectedPlatforms);
    } catch (err) {
      toast(`Couldn't load the calendar: ${err.message}`, "error");
      events = {};
      setLinkedPlatforms([]);
    }
    if (dayPopupKey && dayPopup && !dayPopup.hidden) {
      openDayPopup(
        dayPopupKey,
        grid.querySelector(`.cal-cell[data-date="${dayPopupKey}"]`),
        dayPopupEventIndex,
        { fresh: false }
      );
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
      <a class="cal-product-menu-foot" href="products.html">Manage products</a>
    `;
  }

  function setSelectedProduct(url) {
    selectedProductUrl = url || "";
    localStorage.setItem(PRODUCT_KEY, selectedProductUrl);
    syncProductPill();
    renderProductMenu();
    syncSendState();
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

  function setLinkedPlatforms(list) {
    linkedPlatformsLoaded = true;
    linkedPlatforms = (Array.isArray(list) ? list : [])
      .map((p) => String(p || "").toLowerCase())
      .filter((p) => PLATFORM_LABELS[p] || PLATFORM_PICKER_LABELS[p]);
    selectedPlatforms = new Set([...selectedPlatforms].filter((p) => linkedPlatforms.includes(p)));
    if (selectedPlatforms.size >= linkedPlatforms.length) selectedPlatforms = new Set();
    persistSelectedPlatforms();
    renderPlatformMenu();
    syncPlatformPicker();
  }

  function setPlatformMenuOpen(open) {
    if (!platformMenu || !platformBtn) return;
    platformMenu.hidden = !open;
    platformBtn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function platformPickerLabel() {
    const choices = platformChoices();
    if (!linkedPlatformsLoaded) return "All platforms";
    if (!choices.length) return "No accounts";
    if (choices.length === 1) return platformName(choices[0]);
    if (!selectedPlatforms.size || selectedPlatforms.size >= choices.length) {
      return "All platforms";
    }
    const picked = choices.filter((p) => selectedPlatforms.has(p));
    if (picked.length === 1) return platformName(picked[0]);
    return picked.map((p) => PLATFORM_PICKER_SHORT[p] || platformName(p)).join(" · ");
  }

  function persistSelectedPlatforms() {
    localStorage.setItem(PLATFORM_KEY, JSON.stringify([...selectedPlatforms]));
  }

  function renderPlatformMenu() {
    if (!platformMenu) return;
    const choices = platformChoices();
    if (!choices.length) {
      platformMenu.innerHTML = `<p class="cal-platform-menu-empty">No accounts linked</p>`;
      return;
    }
    const allRow = choices.length > 1
      ? `<button type="button" class="cal-platform-menu-item" role="menuitemcheckbox" data-platform="all" aria-checked="false">
           <span>All platforms</span>
           ${PLATFORM_CHECK}
         </button>`
      : "";
    platformMenu.innerHTML = allRow + choices.map((p) => `
      <button type="button" class="cal-platform-menu-item" role="menuitemcheckbox" data-platform="${escapeHtml(p)}" aria-checked="false">
        <span>${escapeHtml(platformName(p))}</span>
        ${PLATFORM_CHECK}
      </button>
    `).join("");
  }

  function syncPlatformPicker() {
    const choices = platformChoices();
    const allOn = !choices.length
      || !selectedPlatforms.size
      || selectedPlatforms.size >= choices.length;
    if (platformBtnLabel) platformBtnLabel.textContent = platformPickerLabel();
    platformBtn?.toggleAttribute("disabled", linkedPlatformsLoaded && !choices.length);
    platformMenu?.querySelectorAll("[data-platform]").forEach((btn) => {
      const key = btn.getAttribute("data-platform");
      const on = key === "all" ? allOn : selectedPlatforms.has(key);
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-checked", on ? "true" : "false");
    });
  }

  function toggleSelectedPlatform(platform) {
    const choices = platformChoices();
    if (platform === "all") {
      selectedPlatforms = new Set();
      persistSelectedPlatforms();
      syncPlatformPicker();
      return;
    }
    if (!choices.includes(platform)) return;
    if (selectedPlatforms.has(platform)) selectedPlatforms.delete(platform);
    else selectedPlatforms.add(platform);
    if (selectedPlatforms.size >= choices.length) selectedPlatforms = new Set();
    persistSelectedPlatforms();
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

  function renderAttachChip() {
    if (!attachChips) return;
    if (!attachedUpload) {
      attachChips.hidden = true;
      attachChips.innerHTML = "";
      return;
    }
    attachChips.hidden = false;
    attachChips.innerHTML = `
      <div class="cal-date-chip cal-attach-chip">
        <img src="${escapeHtml(attachedUpload.path || attachedUpload.url)}" alt="">
        <span class="cal-date-chip-label">${escapeHtml(attachedUpload.name)}</span>
        <button type="button" class="cal-date-chip-remove" aria-label="Remove attachment">
          <svg viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M3 3l6 6M9 3L3 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </button>
      </div>`;
    attachChips.querySelector(".cal-date-chip-remove")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      attachedUpload = null;
      renderAttachChip();
      syncSendState();
    });
  }

  const ACCEPT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
  const MAX_ATTACH_BYTES = 6 * 1024 * 1024;

  function mimeFor(file) {
    if (ACCEPT_TYPES.has(file.type)) return file.type;
    const name = String(file.name || "").toLowerCase();
    if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
    if (name.endsWith(".png")) return "image/png";
    if (name.endsWith(".webp")) return "image/webp";
    if (name.endsWith(".gif")) return "image/gif";
    return file.type || "";
  }

  function readFileAsPayload(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({
        filename: file.name,
        mime: file.type,
        data: String(reader.result || ""),
      });
      reader.onerror = () => reject(new Error("Could not read that file"));
      reader.readAsDataURL(file);
    });
  }

  async function attachFile(file) {
    if (!file) return;
    const mime = mimeFor(file);
    if (!ACCEPT_TYPES.has(mime)) {
      toast("Upload a JPEG, PNG, WebP, or GIF image.", "error");
      return;
    }
    if (file.size > MAX_ATTACH_BYTES) {
      toast("Keep uploads under 6 MB.", "error");
      return;
    }
    plusBtn?.classList.add("is-busy");
    plusBtn?.setAttribute("aria-busy", "true");
    try {
      const payload = await readFileAsPayload(file);
      payload.mime = mime;
      const result = await api("/api/uploads", { method: "POST", body: payload });
      attachedUpload = {
        url: result.url,
        path: result.path,
        name: result.name || file.name,
      };
      renderAttachChip();
      syncSendState();
      toast(`Attached ${attachedUpload.name}`);
    } catch (err) {
      toast(err.message || "Could not upload that file", "error");
    } finally {
      plusBtn?.classList.remove("is-busy");
      plusBtn?.removeAttribute("aria-busy");
      if (attachInput) attachInput.value = "";
    }
  }

  plusBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (assistantBusy) return;
    attachInput?.click();
  });

  attachInput?.addEventListener("change", () => {
    const file = attachInput.files?.[0];
    if (file) attachFile(file);
  });

  form?.addEventListener("dragover", (e) => {
    if (![...e.dataTransfer.types].includes("Files")) return;
    e.preventDefault();
    form.classList.add("is-drop");
  });
  form?.addEventListener("dragleave", () => form.classList.remove("is-drop"));
  form?.addEventListener("drop", (e) => {
    form.classList.remove("is-drop");
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    e.preventDefault();
    attachFile(file);
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
    e.preventDefault();
    toggleSelectedPlatform(item.getAttribute("data-platform"));
    // Keep the menu open so multiple platforms can be toggled.
  });

  document.addEventListener("click", (e) => {
    if (!productPicker?.contains(e.target)) setProductMenuOpen(false);
    if (!formatPicker?.contains(e.target) && !formatMenu?.contains(e.target)) {
      setFormatMenuOpen(false);
    }
    if (!platformPicker?.contains(e.target)) setPlatformMenuOpen(false);
    if (!e.target.closest(".cal-day-editor-platform-picker")) closePopupPlatformMenus();
  });

  window.addEventListener("resize", () => {
    positionFormatMenu();
    positionPopupTimeMenu();
    if (!dayPopup || dayPopup.hidden) return;
    applyPopupSize(loadPopupSize() || {
      width: dayPopup.offsetWidth,
      height: dayPopup.offsetHeight,
    });
    const pos = clampPopupPosition(dayPopup.offsetLeft, dayPopup.offsetTop);
    dayPopup.style.left = `${Math.round(pos.left)}px`;
    dayPopup.style.top = `${Math.round(pos.top)}px`;
  });
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
