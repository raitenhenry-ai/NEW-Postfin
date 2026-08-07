/* Analytics: three live charts, engagement totals and the recent grid.
   The drawing code is unchanged; the numbers come from /api/analytics. */
(() => {
  const { api, escapeHtml, platformIcon, PLATFORM_LABELS, fmtCompact, fmtDelta,
          deltaClass, fmtDuration, fmtRelative, toast, errorBlock, emptyBlock } = window.Postfin;

  const RANGE_OPTIONS = {
    "1h": { label: "Last hour" },
    "24h": { label: "Last 24 hours" },
    "7d": { label: "Last 7 days" },
    "30d": { label: "Last 30 days" },
    custom: { label: "Custom" },
  };

  // Per-chart colours. Purely presentational - the values are all live.
  const PALETTE = {
    views: { color: "#4f8cff", fillTop: "rgba(79, 140, 255, 0.36)", fillBottom: "rgba(79, 140, 255, 0)" },
    followers: { color: "#3dd68c", fillTop: "rgba(61, 214, 140, 0.32)", fillBottom: "rgba(61, 214, 140, 0)" },
    comments: { color: "#c084fc", fillTop: "rgba(192, 132, 252, 0.32)", fillBottom: "rgba(192, 132, 252, 0)" },
  };

  let platform = "all";
  let rangeKey = "30d";
  let customDays = 14;
  let axisLabels = [];
  let payload = null;
  let loading = false;
  const instances = new Map();

  /* ---------- scale helpers ---------- */

  // Round the axis maximum up to something readable (1/2/2.5/5 × 10ⁿ) so the
  // gridlines land on sensible numbers whatever the data looks like.
  function niceMax(value) {
    if (!value || value <= 0) return 10;
    const exponent = Math.floor(Math.log10(value));
    const magnitude = Math.pow(10, exponent);
    const normalized = value / magnitude;
    const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
    return step * magnitude;
  }

  function buildScale(values) {
    const max = niceMax(Math.max(...values, 0));
    const steps = 4;
    const labels = [];
    for (let i = steps; i >= 0; i--) {
      labels.push(fmtCompact((max * i) / steps, 1));
    }
    return { max: max || 1, yLabels: labels };
  }

  function labelForTimestamp(ms) {
    const d = new Date(ms);
    if (rangeKey === "1h" || rangeKey === "24h") {
      return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    }
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  function visibleAxisLabels(labels) {
    if (labels.length <= 4) return labels;
    const picks = [0, Math.floor((labels.length - 1) / 3), Math.floor(((labels.length - 1) * 2) / 3), labels.length - 1];
    return picks.map((i) => labels[i]);
  }

  function activeConfig(chartKey) {
    const chart = payload?.charts?.[chartKey];
    if (!chart) return null;
    const values = chart.series.map((p) => p.v);
    return {
      ...PALETTE[chartKey],
      ...buildScale(values),
      values,
      total: fmtCompact(chart.total, chart.total >= 1000 ? 2 : 0),
      delta: fmtDelta(chart.delta),
      deltaClass: deltaClass(chart.delta),
      format: (n) => fmtCompact(n, 1),
    };
  }

  /* ---------- drawing (unchanged) ---------- */

  function catmullRom(p0, p1, p2, p3, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      0.5 *
      (2 * p1 +
        (-p0 + p2) * t +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
        (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
    );
  }

  function buildCurve(points, samplesPerSeg = 28) {
    const curve = [];
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i - 1] || points[i];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2] || p2;
      for (let s = 0; s < samplesPerSeg; s++) {
        const t = s / samplesPerSeg;
        curve.push({
          x: catmullRom(p0.x, p1.x, p2.x, p3.x, t),
          y: catmullRom(p0.y, p1.y, p2.y, p3.y, t),
          value: catmullRom(p0.value, p1.value, p2.value, p3.value, t),
          dayIndex: i + t,
        });
      }
    }
    const last = points[points.length - 1];
    curve.push({ x: last.x, y: last.y, value: last.value, dayIndex: points.length - 1 });
    return curve;
  }

  function nearestOnCurve(curve, x) {
    let best = curve[0];
    let bestDist = Math.abs(curve[0].x - x);
    for (let i = 1; i < curve.length; i++) {
      const dist = Math.abs(curve[i].x - x);
      if (dist < bestDist) {
        bestDist = dist;
        best = curve[i];
      }
    }
    return best;
  }

  function pointLabel(dayIndex) {
    if (!axisLabels.length) return "";
    const clamped = Math.min(axisLabels.length - 1, Math.max(0, dayIndex));
    return axisLabels[Math.round(clamped)] || "";
  }

  function paint(instance, hoverX) {
    const { canvas, ctx, config, pad, plotW, plotH, cssWidth, cssHeight, points, curve, tooltip } = instance;

    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const steps = config.yLabels.length - 1;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= steps; i++) {
      const y = pad.top + (plotH * i) / steps;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + plotW, y);
      ctx.stroke();
    }

    const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH);
    gradient.addColorStop(0, config.fillTop);
    gradient.addColorStop(1, config.fillBottom);

    ctx.beginPath();
    curve.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.lineTo(points[points.length - 1].x, pad.top + plotH);
    ctx.lineTo(points[0].x, pad.top + plotH);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.beginPath();
    curve.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.strokeStyle = config.color;
    ctx.lineWidth = 2.25;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();

    if (hoverX == null) {
      tooltip.hidden = true;
      return;
    }

    const clampedX = Math.min(pad.left + plotW, Math.max(pad.left, hoverX));
    const hit = nearestOnCurve(curve, clampedX);
    const label = pointLabel(hit.dayIndex);
    const valueText = config.format(hit.value);

    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
    ctx.lineWidth = 1;
    ctx.moveTo(hit.x, pad.top);
    ctx.lineTo(hit.x, pad.top + plotH);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.arc(hit.x, hit.y, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = "#0b0b0b";
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = config.color;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(hit.x, hit.y, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = config.color;
    ctx.fill();

    tooltip.hidden = false;
    tooltip.innerHTML = `<strong>${valueText}</strong><span>${label}</span>`;

    const tipW = tooltip.offsetWidth || 72;
    const tipH = tooltip.offsetHeight || 40;
    let left = hit.x - tipW / 2;
    left = Math.max(4, Math.min(cssWidth - tipW - 4, left));
    let top = hit.y - tipH - 14;
    if (top < 4) top = hit.y + 14;
    tooltip.style.transform = `translate(${left}px, ${top}px)`;

    if (instance.valueEl) instance.valueEl.textContent = valueText;
  }

  function setupCard(card) {
    const key = card.dataset.chart;
    const config = activeConfig(key);
    if (!config) return;

    const canvas = card.querySelector(".analytics-canvas");
    const yEl = card.querySelector(".analytics-chart-y");
    const plot = card.querySelector(".analytics-chart-plot");
    const xEl = card.querySelector(".analytics-chart-x");
    const valueEl = card.querySelector(".analytics-chart-value");
    const deltaEl = card.querySelector(".analytics-chart-delta");
    if (!canvas || !yEl || !plot) return;

    let tooltip = plot.querySelector(".analytics-tooltip");
    if (!tooltip) {
      tooltip = document.createElement("div");
      tooltip.className = "analytics-tooltip";
      tooltip.hidden = true;
      plot.insertBefore(tooltip, canvas.nextSibling);
    }

    if (valueEl) valueEl.textContent = config.total;
    if (deltaEl) {
      deltaEl.textContent = config.delta;
      deltaEl.className = `analytics-chart-delta ${config.deltaClass}`.trim();
    }
    yEl.innerHTML = config.yLabels.map((label) => `<span>${label}</span>`).join("");
    if (xEl) {
      xEl.innerHTML = visibleAxisLabels(axisLabels).map((label) => `<span>${label}</span>`).join("");
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssWidth = canvas.clientWidth || 320;
    const cssHeight = canvas.clientHeight || 178;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const pad = { top: 10, right: 10, bottom: 10, left: 4 };
    const plotW = cssWidth - pad.left - pad.right;
    const plotH = cssHeight - pad.top - pad.bottom;

    const divisor = Math.max(1, config.values.length - 1);
    const points = config.values.map((value, i) => ({
      x: pad.left + (i / divisor) * plotW,
      y: pad.top + plotH - (value / config.max) * plotH,
      value,
    }));
    const curve = buildCurve(points, 32);

    const instance = {
      card, canvas, ctx, config, pad, plotW, plotH, cssWidth, cssHeight,
      points, curve, tooltip, valueEl, hoverX: null,
    };
    instances.set(card, instance);
    paint(instance, null);

    const onMove = (clientX) => {
      const rect = canvas.getBoundingClientRect();
      instance.hoverX = clientX - rect.left;
      paint(instance, instance.hoverX);
    };

    const onLeave = () => {
      instance.hoverX = null;
      paint(instance, null);
      if (valueEl) valueEl.textContent = config.total;
    };

    plot.onpointerdown = (e) => {
      plot.setPointerCapture?.(e.pointerId);
      onMove(e.clientX);
    };
    plot.onpointermove = (e) => onMove(e.clientX);
    plot.onpointerup = () => {};
    plot.onpointerleave = onLeave;
    plot.onpointercancel = onLeave;
  }

  /* ---------- panels ---------- */

  function updateTotals() {
    const data = payload?.totals || {};
    document.querySelectorAll(".analytics-total-card[data-total]").forEach((card) => {
      const entry = data[card.dataset.total];
      const valueEl = card.querySelector(".analytics-total-value");
      const deltaEl = card.querySelector(".analytics-total-delta");
      if (valueEl) valueEl.textContent = entry ? fmtCompact(entry.value, entry.value >= 1000 ? 2 : 0) : "—";
      if (deltaEl) {
        deltaEl.textContent = entry ? fmtDelta(entry.delta) : "";
        deltaEl.className = `analytics-total-delta ${entry ? deltaClass(entry.delta) : ""}`.trim();
      }
    });
  }

  function renderRecent() {
    const grid = document.querySelector(".analytics-recent-grid");
    if (!grid) return;
    const videos = payload?.recentVideos || [];
    if (!videos.length) {
      grid.innerHTML = emptyBlock("No videos published yet.");
      return;
    }
    const playIcon = `<svg viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M4.2 2.8v6.4L9.5 6 4.2 2.8z" fill="currentColor"/></svg>`;
    const heartIcon = `<svg viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M6 10.2S2.2 7.6 2.2 4.9A2.15 2.15 0 0 1 6 3.7a2.15 2.15 0 0 1 3.8 1.2C9.8 7.6 6 10.2 6 10.2z" fill="currentColor"/></svg>`;
    const commentIcon = `<svg viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.2 2.4h7.6a1 1 0 0 1 1 1v4.2a1 1 0 0 1-1 1H6.2L4 10.2V8.6H2.2a1 1 0 0 1-1-1V3.4a1 1 0 0 1 1-1z" fill="currentColor"/></svg>`;

    grid.innerHTML = videos.map((v) => `
      <article class="recent-video-card">
        <div class="recent-video-thumb">
          ${v.thumb
            ? `<img src="${escapeHtml(v.thumb)}" alt="" loading="lazy">`
            : `<div class="video-thumb-fallback" aria-hidden="true"></div>`}
          <span class="recent-video-platform">${v.platforms?.[0] ? platformIcon(v.platforms[0]) : ""}</span>
          <div class="recent-video-stats">
            <span>${playIcon}${fmtCompact(v.views, 1)}</span>
            <span>${heartIcon}${fmtCompact(v.likes, 1)}</span>
            <span>${commentIcon}${fmtCompact(v.comments, 1)}</span>
          </div>
        </div>
        <h3>${escapeHtml(v.title)}</h3>
        <p>${escapeHtml(fmtRelative(v.createdAt))} · ${fmtDuration(v.durationSeconds)}</p>
      </article>`).join("");
  }

  // Only offer platform tabs for platforms that actually have an account.
  async function buildPlatformTabs() {
    const wrap = document.querySelector(".analytics-platform-switch");
    if (!wrap) return;
    try {
      const { platforms } = await api("/api/connectors");
      const connected = platforms.filter((p) => p.accounts.length);
      wrap.innerHTML = [
        `<button type="button" class="analytics-platform-btn active" data-platform="all" aria-selected="true">All</button>`,
        ...connected.map((p) => `
          <button type="button" class="analytics-platform-btn" data-platform="${p.key}" aria-selected="false">
            ${escapeHtml(p.label)}
          </button>`),
      ].join("");
      wrap.querySelectorAll(".analytics-platform-btn").forEach((btn) => {
        btn.addEventListener("click", () => setPlatform(btn.dataset.platform));
      });
    } catch {
      // Leave whatever tabs the markup shipped with.
    }
  }

  function renderAll() {
    if (!payload) return;
    axisLabels = (payload.charts.views.series || []).map((p) => labelForTimestamp(p.t));
    document.querySelectorAll(".analytics-chart-card[data-chart]").forEach(setupCard);
    updateTotals();
    renderRecent();
  }

  /* ---------- data ---------- */

  async function load() {
    if (loading) return;
    loading = true;
    document.querySelector(".analytics-charts")?.classList.add("is-loading");
    try {
      const params = new URLSearchParams({ range: rangeKey });
      if (platform !== "all") params.set("platform", platform);
      if (rangeKey === "custom") params.set("days", String(customDays));
      payload = await api(`/api/analytics?${params}`);
      renderAll();
    } catch (err) {
      console.error(err);
      const grid = document.querySelector(".analytics-recent-grid");
      if (grid) grid.innerHTML = errorBlock(`Couldn't load analytics: ${err.message}`);
      toast(err.message, "error");
    } finally {
      loading = false;
      document.querySelector(".analytics-charts")?.classList.remove("is-loading");
    }
  }

  function setPlatform(next) {
    if (next === platform) return;
    platform = next;
    document.querySelectorAll(".analytics-platform-btn").forEach((btn) => {
      const on = btn.dataset.platform === platform;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    load();
  }

  /* ---------- range menu ---------- */

  function showCustomInput() {
    const customBtn = document.getElementById("analytics-custom-btn");
    const customRow = document.getElementById("analytics-custom-row");
    const input = document.getElementById("analytics-custom-days");
    if (customBtn) customBtn.hidden = true;
    if (customRow) customRow.hidden = false;
    if (input) {
      input.value = String(customDays);
      requestAnimationFrame(() => {
        input.focus();
        input.select();
      });
    }
  }

  function hideCustomInput() {
    const customBtn = document.getElementById("analytics-custom-btn");
    const customRow = document.getElementById("analytics-custom-row");
    if (rangeKey === "custom") return;
    if (customBtn) customBtn.hidden = false;
    if (customRow) customRow.hidden = true;
  }

  function applyCustomDays(raw) {
    customDays = Math.max(1, Math.min(365, Number.parseInt(raw, 10) || customDays));
    setRange("custom");
  }

  function setRange(next) {
    if (!RANGE_OPTIONS[next]) return;
    rangeKey = next;

    const labelEl = document.getElementById("analytics-range-label");
    if (labelEl) {
      labelEl.textContent = next === "custom" ? `Last ${customDays} days` : RANGE_OPTIONS[next].label;
    }

    document.querySelectorAll("#analytics-range-menu [data-range]").forEach((btn) => {
      btn.setAttribute("aria-selected", btn.dataset.range === rangeKey ? "true" : "false");
    });

    const customBtn = document.getElementById("analytics-custom-btn");
    const customRow = document.getElementById("analytics-custom-row");
    if (next === "custom") {
      if (customBtn) customBtn.hidden = true;
      if (customRow) customRow.hidden = false;
    } else {
      if (customBtn) customBtn.hidden = false;
      if (customRow) customRow.hidden = true;
    }

    closeRangeMenu();
    load();
  }

  function openRangeMenu() {
    const menu = document.getElementById("analytics-range-menu");
    const btn = document.getElementById("analytics-range-btn");
    if (!menu || !btn) return;
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    if (rangeKey === "custom") showCustomInput();
    else hideCustomInput();
  }

  function closeRangeMenu() {
    const menu = document.getElementById("analytics-range-menu");
    const btn = document.getElementById("analytics-range-btn");
    if (!menu || !btn) return;
    menu.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  }

  document.querySelectorAll(".analytics-platform-btn").forEach((btn) => {
    btn.addEventListener("click", () => setPlatform(btn.dataset.platform));
  });

  document.getElementById("analytics-range-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const menu = document.getElementById("analytics-range-menu");
    if (menu?.hidden) openRangeMenu();
    else closeRangeMenu();
  });

  document.querySelectorAll("#analytics-range-menu [data-range]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const key = btn.dataset.range;
      if (key === "custom") {
        showCustomInput();
        return;
      }
      setRange(key);
    });
  });

  document.getElementById("analytics-custom-row")?.addEventListener("click", (e) => e.stopPropagation());

  const customInput = document.getElementById("analytics-custom-days");
  customInput?.addEventListener("click", (e) => e.stopPropagation());
  customInput?.addEventListener("pointerdown", (e) => e.stopPropagation());
  customInput?.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      applyCustomDays(customInput.value);
    }
    if (e.key === "Escape" && rangeKey !== "custom") {
      hideCustomInput();
    }
  });
  customInput?.addEventListener("blur", () => {
    if (document.getElementById("analytics-custom-row")?.hidden) return;
    setTimeout(() => {
      if (document.getElementById("analytics-custom-row")?.hidden) return;
      if (document.activeElement === customInput) return;
      applyCustomDays(customInput.value);
    }, 120);
  });

  document.addEventListener("click", (e) => {
    const wrap = document.getElementById("analytics-range");
    if (wrap && !wrap.contains(e.target)) closeRangeMenu();
  });

  // Pull fresh numbers from the platform APIs, then redraw.
  document.getElementById("analytics-refresh")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    try {
      const result = await api("/api/metrics/refresh", { method: "POST", body: {} });
      toast(`Collected ${result.posts} post + ${result.accounts} account snapshot(s)`);
      await load();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      e.target.disabled = false;
    }
  });

  buildPlatformTabs();
  load();

  window.addEventListener("resize", () => {
    clearTimeout(window.__analyticsResize);
    window.__analyticsResize = setTimeout(renderAll, 80);
  });
})();
