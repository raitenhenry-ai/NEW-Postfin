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
      detail.className = `cal-post-detail is-${platformKey(post.platform)}`;
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
            ${canEdit ? `<input class="cal-post-field-input" data-field="product" type="text">` : `<p class="cal-post-product"></p>`}
          </section>
          <section>
            <h4>Model</h4>
            ${canEdit ? `
              <select class="cal-post-field-input cal-post-model-select" data-field="model">
                ${MODEL_OPTIONS.map((m) => `<option value="${m}">${m}</option>`).join("")}
              </select>
            ` : `<p class="cal-post-model"></p>`}
          </section>
          <section>
            <h4>Date posted</h4>
            <p class="cal-post-date"></p>
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
            ${canEdit ? `<textarea class="cal-post-field-input cal-post-prompt-input" data-field="prompt" rows="8"></textarea>` : `<p class="cal-post-prompt"></p>`}
          </section>
        </div>
      `;

      detail.querySelector(".cal-post-summary").textContent = `${post.platform} · ${post.time}`;
      detail.querySelector(".cal-post-date").textContent = `${formatLong(focused)} · ${post.time}`;

      if (canEdit) {
        detail.querySelector('[data-field="title"]').value = post.title || "";
        detail.querySelector('[data-field="product"]').value = post.product || "";
        const modelSelect = detail.querySelector('[data-field="model"]');
        if (modelSelect) {
          if (post.model && !MODEL_OPTIONS.includes(post.model)) {
            const opt = document.createElement("option");
            opt.value = post.model;
            opt.textContent = post.model;
            modelSelect.appendChild(opt);
          }
          modelSelect.value = post.model || MODEL_OPTIONS[0];
        }
        detail.querySelector('[data-field="caption"]').value = post.caption || "";
        detail.querySelector('[data-field="hashtags"]').value = post.hashtags || "";
        detail.querySelector('[data-field="prompt"]').value = post.prompt || "";
        detail.querySelectorAll("[data-field]").forEach((el) => {
          const sync = () => {
            post[el.dataset.field] = el.value;
          };
          el.addEventListener("input", sync);
          el.addEventListener("change", sync);
        });
      } else {
        detail.querySelector(".cal-post-title").textContent = post.title;
        detail.querySelector(".cal-post-product").textContent = post.product;
        detail.querySelector(".cal-post-model").textContent = post.model || "—";
        detail.querySelector(".cal-post-caption").textContent = post.caption;
        detail.querySelector(".cal-post-hashtags").textContent = post.hashtags;
        detail.querySelector(".cal-post-prompt").textContent = post.prompt;
      }

      detail.querySelector("#cal-post-back").addEventListener("click", () => {
        openedPost = null;
        if (canEdit) render();
        else renderDayPanel();
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

  document.getElementById("cal-prev")?.addEventListener("click", () => {
    view = new Date(view.getFullYear(), view.getMonth() - 1, 1);
    render();
  });

  document.getElementById("cal-next")?.addEventListener("click", () => {
    view = new Date(view.getFullYear(), view.getMonth() + 1, 1);
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

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!field || !field.value.trim()) return;
    field.value = "";
    syncSendState();
    resizeField();
  });

  syncSendState();
  resizeField();
  render();
})();
