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

  const events = {
    "2026-06-01": [
      {
        time: "10:00 AM",
        title: "Morning routine tips",
        platform: "TikTok",
        product: "AuraGlow Morning Stack",
        model: "Nova Clip 2.5",
        caption:
          "My 5-minute morning that actually sticks ☀️\nSave this if your mornings feel chaotic.",
        hashtags: "#morningroutine #ugc #productivity #selfcare #auraGlow",
        prompt:
          "Create a hyper-authentic UGC morning-routine TikTok (15–20s, vertical 9:16). Hook in the first 1.5s with messy bed + phone alarm + on-screen text “the morning that fixed my energy.” Jump-cut through: water, AuraGlow stack scoop into shaker, quick face splash, outfit grab, walking-out door. Natural phone mic audio, slight handheld shake, daylight through blinds. End on product hero in hand with soft CTA “comment ROUTINE for the checklist.” Keep it raw creator energy, not polished ad.",
      },
    ],
    "2026-06-06": [
      {
        time: "9:00 AM",
        title: "Protein bowl",
        platform: "TikTok",
        product: "FitFuel Protein Bowl Kit",
        model: "Nova Clip 2.5",
        caption:
          "High protein bowl in under 10 minutes 🥗💪\nSave this for your next meal prep day.",
        hashtags: "#highprotein #mealprep #healthyrecipes #fitfuel #ugc",
        prompt:
          "Shoot a bright 15–20s vertical cooking clip assembling a high-protein bowl. Open on a clean counter with raw ingredients (chicken, rice, greens, eggs, FitFuel sauce). Fast chop-and-build jump cuts, hands in frame, appetizing overhead angles. Punchy on-screen protein grams each step. Finish with plated overhead hero + calorie/protein callout and soft save CTA. Natural daylight, high-contrast food UGC, no talking head.",
      },
    ],
    "2026-06-08": [
      {
        time: "10:00 AM",
        title: "iPhone Tricks You Didn't Know",
        platform: "TikTok",
        product: "iPhone 16 Pro",
        model: "Aura Reel Pro",
        caption:
          "iPhone tricks that feel illegal to know 📱\nWhich one are you trying first?",
        hashtags: "#iphonetricks #techhacks #appletips #viral #ugc",
        prompt:
          "Make a fast, scroll-stopping tech UGC TikTok teaching 3 iPhone tricks. Cold open with shocked face + text “stop using your iPhone wrong.” Demo each trick in under 4s with big numbered overlays, screen recordings + face cam cutaways. Punchy trending audio, snappy cuts, end with “part 2?” comment bait. Keep casual bedroom lighting and creator energy — educational but addictive.",
      },
      {
        time: "12:00 PM",
        title: "3 Easy Breakfast Ideas",
        platform: "YouTube",
        product: "MorningFuel Breakfast Bundle",
        model: "Director Longform X",
        caption:
          "3 high-protein breakfasts you can make half-asleep 🍳\nFull recipes in the description.",
        hashtags: "#breakfastideas #highprotein #mealprep #youtubeshorts #morningfuel",
        prompt:
          "Produce a YouTube Short / mid-form cooking video covering 3 easy high-protein breakfasts. Hook with finished plates first, then rapid recipe builds with ingredient callouts and macros on screen. Warm kitchen lighting, overhead + 45° angles, friendly voiceover. End each idea with a plated hero and soft subscribe CTA. Feels like a trusted creator meal-prep channel, not a brand studio.",
      },
      {
        time: "4:30 PM",
        title: "High Protein Dinner Recipe",
        platform: "Instagram",
        product: "LeanChef Dinner Kit",
        model: "Aura Reel Pro",
        caption:
          "High protein dinner that tastes like cheat day 🔥\nSave this for busy weeknights.",
        hashtags: "#highproteindinner #fitnessfood #reels #leanchef #mealideas",
        prompt:
          "Film an Instagram Reel of a high-protein dinner build: fridge pull, sizzle pan shot, plating montage, first-bite reaction. Use trending audio pacing, text overlays for protein grams, and a clean fridge-light aesthetic. End on a plated hero with LeanChef kit visible in soft background and a save sticker cue. Authentic kitchen UGC, slightly imperfect, highly shareable.",
      },
    ],
    "2026-06-17": [
      {
        time: "12:30 PM",
        title: "High protein dinner idea",
        platform: "TikTok",
        product: "MacroChef Skillet Kit",
        model: "Nova Clip 2.5",
        caption:
          "Dinner macros without the boring chicken vibe 🍗\nComment “dinner” for the exact plate.",
        hashtags: "#macrofriendly #dinnerideas #tiktokfood #macrochef #ugc",
        prompt:
          "Create a viral dinner-idea TikTok: hook with juicy plated close-up, then reverse-build the recipe in jump cuts. Overlay macros (P/C/F) big and readable. Handheld phone footage, steam, sizzle ASMR, creator talking casually off-camera. Close with MacroChef kit cameo and CTA to duet with their plate.",
      },
      {
        time: "3:00 PM",
        title: "Gym meal prep",
        platform: "Instagram",
        product: "PrepPro Containers",
        model: "Aura Reel Pro",
        caption:
          "Sunday prep that carries the whole week 💪\nContainers linked in bio.",
        hashtags: "#mealprep #gymfood #fitnessreels #preppro #bulkprep",
        prompt:
          "Shoot a satisfying meal-prep Reel: grocery dump, batch cook montage, PrepPro container packing, fridge overview. Chapter-style text titles, portion counts on screen, upbeat audio. End with weekly plan graphic and save CTA. Clean countertop UGC, bright daylight, creator hands only.",
      },
      {
        time: "7:00 PM",
        title: "Night macros",
        platform: "YouTube",
        product: "NightFuel Protein Blend",
        model: "Director Longform X",
        caption:
          "How I hit protein at night without wrecking sleep 🌙\nFull routine below.",
        hashtags: "#nightroutine #protein #fitnessyoutube #nightfuel #macros",
        prompt:
          "Film a calm nighttime protein routine video: kitchen pour of NightFuel, shaker, quick snack plate, talking-to-camera tips on late macros + sleep. Soft warm lamps, intimate creator vibe, clear on-screen tips. End with subscribe CTA and product in frame. Long enough for depth but paced for retention.",
      },
    ],
    "2026-06-23": [
      {
        time: "3:00 PM",
        title: "Summer vibe",
        platform: "Instagram",
        product: "Solara Summer Set",
        model: "Aura Reel Pro",
        caption:
          "Summer energy loading… ☀️\nWhat’s your go-to warm weather vibe?",
        hashtags: "#summerstyle #aesthetic #summervibes #solara #ugc",
        prompt:
          "Film a warm golden-hour lifestyle Reel featuring Solara Summer Set. Soft outdoor light, gentle movement, fabric/hair slow-mo, one snack insert, wide establishing shot. Soft dissolves, peach/amber grade, music-led pacing, no dialogue. End on chill end card with minimal text.",
      },
    ],
    "2026-07-06": [
      {
        time: "11:00 AM",
        title: "Healthy tips",
        platform: "TikTok",
        product: "VitalDay Greens",
        model: "Nova Clip 2.5",
        caption:
          "3 healthy tips that don’t feel like a personality 😤\nTry #2 today.",
        hashtags: "#healthytips #wellness #vitalday #ugc #greens",
        prompt:
          "Make a punchy tips TikTok with 3 health habits. Face-cam hooks, quick demos with VitalDay Greens in tip #2, bold text overlays, trending sound. Keep skeptical-funny tone that converts well for UGC. End with “follow for part 2” CTA.",
      },
    ],
    "2026-08-06": [
      {
        time: "9:30 AM",
        title: "Desk stretch reset",
        platform: "TikTok",
        product: "MotionEase Desk Kit",
        model: "Nova Clip 2.5",
        caption:
          "60-second desk reset your back will thank you 💻\nSave before your next meeting.",
        hashtags: "#deskstretch #wfh #mobility #motionease #ugc",
        prompt:
          "Create a raw WFH UGC TikTok: creator at messy desk, text hook “your back at 3pm vs after this.” Demo 3 stretches with MotionEase band visible, countdown overlays, slight humor. Natural laptop light + window light. End with soft CTA to comment STRETCH for the full sequence.",
      },
      {
        time: "1:00 PM",
        title: "Creator lunch haul",
        platform: "Instagram",
        product: "FreshCart Protein Box",
        model: "Aura Reel Pro",
        caption:
          "What I actually eat between edits 🥗\nHigh protein, low decision fatigue.",
        hashtags: "#creatorlife #lunchideas #freshcart #reels #highprotein",
        prompt:
          "Film an Instagram Reel lunch haul: unbox FreshCart Protein Box, overhead ingredient reveal, quick assemble, first bite. Trendy audio, text callouts for macros, casual apartment kitchen. End with save CTA and product label readable in final frame.",
      },
      {
        time: "6:15 PM",
        title: "UGC hook formulas that convert",
        platform: "YouTube",
        product: "ClipForge Hook Pack",
        model: "Director Longform X",
        caption:
          "The hook formulas I reuse for viral UGC 📈\nSteal these for your next brand video.",
        hashtags: "#ugctips #contentcreator #hooks #clipforge #youtubecreator",
        prompt:
          "Produce a YouTube creator-education video breaking down 5 UGC hook formulas that drive watch time. Cold open with a before/after retention graph mock, then demo each hook with example clips and ClipForge templates on screen. Talking-head + screen inserts, clear chapters, examples of pattern interrupts, curiosity gaps, and product-first opens. Close with a downloadable checklist CTA and soft product mention for ClipForge Hook Pack. Retention-first pacing, conversational, highly actionable.",
      },
    ],
  };

  const MODEL_OPTIONS = [
    "Nova Clip 2.5",
    "Aura Reel Pro",
    "Director Longform X",
  ];

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
      detail.className = `cal-post-detail is-${platformKey(post.platform)}`;
      detail.innerHTML = `
        <button type="button" class="cal-post-back" id="cal-post-back">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3.5L5.5 8 10 12.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          All posts
        </button>
        <header class="cal-post-detail-head">
          <h3 class="cal-post-title"></h3>
          <p class="cal-post-summary"></p>
        </header>
        <div class="cal-post-fields">
          <section>
            <h4>Product</h4>
            <p class="cal-post-product"></p>
          </section>
          <section>
            <h4>Model</h4>
            <p class="cal-post-model"></p>
          </section>
          <section>
            <h4>Date posted</h4>
            <p class="cal-post-date"></p>
          </section>
          <section>
            <h4>Caption</h4>
            <p class="cal-post-caption"></p>
          </section>
          <section>
            <h4>Hashtags</h4>
            <p class="cal-post-hashtags"></p>
          </section>
          <section>
            <h4>Prompt</h4>
            <p class="cal-post-prompt"></p>
          </section>
        </div>
      `;

      detail.querySelector(".cal-post-summary").textContent = `${post.platform} · ${post.time}`;
      detail.querySelector(".cal-post-date").textContent = `${formatLong(focused)} · ${post.time}`;
      detail.querySelector(".cal-post-title").textContent = post.title;
      detail.querySelector(".cal-post-product").textContent = post.product;
      detail.querySelector(".cal-post-model").textContent = post.model || "—";
      detail.querySelector(".cal-post-caption").textContent = post.caption;
      detail.querySelector(".cal-post-hashtags").textContent = post.hashtags;
      detail.querySelector(".cal-post-prompt").textContent = post.prompt;

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
      btn.className = `cal-post-item is-${platformKey(post.platform)}`;
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
      btn.querySelector(".cal-post-item-platform").textContent = post.platform;
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
          row.className = `cal-event-row is-${platformKey(ev.platform)}`;
          row.innerHTML = `
            <i class="cal-event-bar" aria-hidden="true"></i>
            <span class="cal-event-title"></span>
            <span class="cal-event-platform"></span>
            <span class="cal-event-time"></span>
          `;
          row.querySelector(".cal-event-title").textContent = ev.title;
          row.querySelector(".cal-event-platform").textContent = ev.platform;
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
  });

  document.getElementById("cal-next")?.addEventListener("click", () => {
    view = new Date(view.getFullYear(), view.getMonth() + 1, 1);
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

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!field || !field.value.trim()) return;
    field.value = "";
    syncSendState();
    resizeField();
  });

  const CHAT_KEY = "cal-chat-collapsed";
  const calBody = document.querySelector(".cal-body");
  const chatToggleBtn = document.getElementById("cal-chat-toggle");

  function setChatCollapsed(collapsed) {
    calBody?.classList.toggle("chat-collapsed", collapsed);
    chatToggleBtn?.setAttribute("aria-pressed", collapsed ? "false" : "true");
    chatToggleBtn?.setAttribute(
      "aria-label",
      collapsed ? "Show chat panel" : "Hide chat and expand calendar"
    );
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

  chatToggleBtn?.addEventListener("click", () => {
    const collapsed = !calBody?.classList.contains("chat-collapsed");
    setChatCollapsed(collapsed);
  });
  setChatCollapsed(loadChatCollapsed());

  syncSendState();
  resizeField();
  render();
})();
