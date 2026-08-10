/* Analytics: three live charts, engagement totals and the recent grid.
   The numbers come from /api/analytics, which returns each point as the
   interval it covers - the labels and the hover readout are both taken from
   that rather than reconstructed here. */
(() => {
  const { api, escapeHtml, platformIcon, PLATFORM_LABELS, fmtCompact, fmtSigned,
          fmtDelta, deltaClass, fmtDuration, fmtRelative, timeZone, toast,
          errorBlock, emptyBlock } = window.Postfin;

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
  let tipLabels = [];
  let payload = null;
  let rangeMeta = null;
  let requestId = 0;
  const instances = new Map();

  /* ---------- scale helpers ---------- */

  // Pick the gridline spacing first, then derive the axis maximum from it.
  //
  // Fixing the count at four instead divided small maxima into fractions -
  // a peak of 2 became 2 / 1.5 / 1 / 0.5 / 0, which the compact formatter
  // rounded to "2, 2, 1, 1, 0": two gridlines both claiming to be 2. Every
  // metric here is a count, so the step is always a whole number.
  function niceStep(peak, maxLines) {
    if (!(peak > 0)) return 1;
    for (let exponent = 0; exponent < 15; exponent++) {
      const magnitude = Math.pow(10, exponent);
      for (const unit of [1, 2, 5]) {
        const step = unit * magnitude;
        if (Math.ceil(peak / step) <= maxLines) return step;
      }
    }
    return Math.ceil(peak / maxLines);
  }

  function buildScale(values) {
    const peak = Math.max(...values, 0);
    const step = niceStep(peak, 5);
    const steps = Math.max(1, Math.ceil(peak / step));
    const labels = [];
    for (let i = steps; i >= 0; i--) labels.push(fmtCompact(step * i, 1));
    return { max: step * steps, yLabels: labels };
  }

  // A point covers [t, end). Day-wide buckets are named after the day they
  // cover; shorter buckets are named for the instant the reading was taken,
  // which is the bucket's end. Reading `labelStyle` off the payload rather
  // than the range key keeps short custom windows - which bucket by the hour
  // - from being labelled with the same date four times over.
  function labelForPoint(point, long = false) {
    const style = rangeMeta?.labelStyle || "date";
    const at = new Date(style === "date" ? point.t : point.end);
    if (style === "time") return at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    if (style === "datetime") {
      return at.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric" });
    }
    const label = at.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    // Long ranges bucket several days together; the tooltip names the span so
    // the number isn't read as belonging to that one day.
    if (!long) return label;
    const last = new Date(point.end - 1).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return last === label ? label : `${label} – ${last}`;
  }

  // Indices whose labels get drawn on the x axis: the ends plus two inside.
  function axisPicks(count) {
    if (count <= 4) return [...Array(count).keys()];
    const last = count - 1;
    return [...new Set([0, Math.round(last / 3), Math.round((last * 2) / 3), last])];
  }

  function activeConfig(chartKey) {
    const chart = payload?.charts?.[chartKey];
    if (!chart) return null;
    // Buckets from before the first snapshot hold no reading, so they carry
    // null rather than zero. They keep their slot on the time axis - the
    // line just doesn't start until the data does, instead of climbing out
    // of a zero that was never real.
    const values = chart.series.map((p) => (p.observed === false ? null : p.v));
    return {
      ...PALETTE[chartKey],
      ...buildScale(values.filter((v) => v != null)),
      values,
      // The headline is the change across the selected window; the lifetime
      // running total rides underneath it as context.
      gain: fmtSigned(chart.gain ?? 0),
      total: `${fmtCompact(chart.total, chart.total >= 1000 ? 2 : 0)} total`,
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

  // The smoothed curve is for the stroke only. The readout comes off the real
  // points, so a tooltip never pairs a date with an interpolated value that
  // was never collected.
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function buildCurve(points, samplesPerSeg = 28) {
    const curve = [];
    const minY = Math.min(...points.map((p) => p.y));
    const maxY = Math.max(...points.map((p) => p.y));
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i - 1] || points[i];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2] || p2;
      for (let s = 0; s < samplesPerSeg; s++) {
        const t = s / samplesPerSeg;
        curve.push({
          x: catmullRom(p0.x, p1.x, p2.x, p3.x, t),
          // Smoothing overshoots on either side of a steep step, which on a
          // follower count reads as a dip that never happened. Clamp it to
          // the span the real points occupy.
          y: clamp(catmullRom(p0.y, p1.y, p2.y, p3.y, t), minY, maxY),
        });
      }
    }
    const last = points[points.length - 1];
    curve.push({ x: last.x, y: last.y });
    return curve;
  }

  // Index of the collected point nearest the cursor. Hovering snaps to it,
  // so the crosshair always sits on a bucket the data actually has.
  function nearestPointIndex(points, x) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const dist = Math.abs(points[i].x - x);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    return best;
  }

  function paint(instance, hoverX) {
    const { canvas, ctx, config, pad, plotW, plotH, cssWidth, cssHeight, points, curve, tooltip } = instance;

    // The canvas can't read CSS variables, so pick the palette at paint time
    // and repaint when the theme flips (observer at the bottom of the file).
    const light = document.body.classList.contains("theme-light");

    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const steps = config.yLabels.length - 1;
    ctx.strokeStyle = light ? "rgba(20, 20, 30, 0.09)" : "rgba(255, 255, 255, 0.06)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= steps; i++) {
      const y = pad.top + (plotH * i) / steps;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + plotW, y);
      ctx.stroke();
    }

    // Nothing has been collected yet - gridlines only, rather than a line
    // pinned to a zero we never measured.
    if (!points.length) {
      tooltip.hidden = true;
      return;
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
    const hit = points[nearestPointIndex(points, clampedX)];
    // `index` is the point's slot in the full window, which is what the
    // labels are keyed by - `points` skips the unmeasured buckets.
    const label = tipLabels[hit.index] || "";
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
    // The headline stays put while hovering. It's the change across the
    // window; swapping in a point's running total would silently switch the
    // number to a different measure.
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
    const totalEl = card.querySelector(".analytics-chart-total");
    const deltaEl = card.querySelector(".analytics-chart-delta");
    if (!canvas || !yEl || !plot) return;

    let tooltip = plot.querySelector(".analytics-tooltip");
    if (!tooltip) {
      tooltip = document.createElement("div");
      tooltip.className = "analytics-tooltip";
      tooltip.hidden = true;
      plot.insertBefore(tooltip, canvas.nextSibling);
    }

    if (valueEl) valueEl.textContent = config.gain;
    if (totalEl) totalEl.textContent = config.total;
    if (deltaEl) {
      deltaEl.textContent = config.delta;
      deltaEl.className = `analytics-chart-delta ${config.deltaClass}`.trim();
    }
    yEl.innerHTML = config.yLabels.map((label) => `<span>${label}</span>`).join("");

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

    // x comes from the position in the full window, so dropping the
    // unmeasured buckets shortens the line instead of stretching what's left
    // across the whole chart.
    const divisor = Math.max(1, config.values.length - 1);
    const xFor = (i) => pad.left + (i / divisor) * plotW;
    const points = config.values
      .map((value, i) => ({ x: xFor(i), y: pad.top + plotH - (value / config.max) * plotH, value, index: i }))
      .filter((p) => p.value != null);
    const curve = buildCurve(points, 32);

    // Each label is placed under the point it names. Spacing them evenly
    // instead put "Aug 5" a third of the way across a chart whose fifth point
    // sits at 28%, so the axis disagreed with the line above it.
    if (xEl) {
      const count = config.values.length;
      xEl.innerHTML = axisPicks(count).map((i) => {
        const anchor = i === 0 ? "0" : i === count - 1 ? "-100%" : "-50%";
        const left = ((xFor(i) / cssWidth) * 100).toFixed(3);
        return `<span style="left:${left}%;transform:translateX(${anchor})">${escapeHtml(axisLabels[i] || "")}</span>`;
      }).join("");
    }

    const instance = {
      card, canvas, ctx, config, pad, plotW, plotH, cssWidth, cssHeight,
      points, curve, tooltip, hoverX: null,
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
      const totalEl = card.querySelector(".analytics-total-lifetime");
      const deltaEl = card.querySelector(".analytics-total-delta");
      // Like the charts: the tile leads with what moved inside the window,
      // with the lifetime figure alongside it.
      if (valueEl) valueEl.textContent = entry ? fmtSigned(entry.value) : "—";
      if (totalEl) {
        totalEl.textContent = entry ? `${fmtCompact(entry.total, entry.total >= 1000 ? 2 : 0)} total` : "";
      }
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

    grid.innerHTML = videos.map((v) => {
      const href = v.url || v.videoUrl || "";
      const openAttrs = href
        ? `href="${escapeHtml(href)}" target="_blank" rel="noopener"`
        : `href="#" aria-disabled="true"`;
      return `
      <a class="recent-video-card" ${openAttrs}>
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
      </a>`;
    }).join("");
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
    const series = payload.charts?.views?.series || [];
    axisLabels = series.map((p) => labelForPoint(p));
    tipLabels = series.map((p) => labelForPoint(p, true));
    document.querySelectorAll(".analytics-chart-card[data-chart]").forEach(setupCard);
    updateTotals();
    renderRecent();
  }

  /* ---------- data ---------- */

  // Every range or platform change refetches. This used to bail out while a
  // request was already in flight, which left the chart showing the previous
  // timeframe's data under the new timeframe's label; the token also drops a
  // slow earlier response so it can't land on top of a newer one.
  async function load() {
    const token = ++requestId;
    document.querySelector(".analytics-charts")?.classList.add("is-loading");
    try {
      const params = new URLSearchParams({ range: rangeKey });
      if (platform !== "all") params.set("platform", platform);
      if (rangeKey === "custom") params.set("days", String(customDays));
      const tz = timeZone();
      if (tz) params.set("tz", tz);

      const next = await api(`/api/analytics?${params}`);
      if (token !== requestId) return;
      payload = next;
      rangeMeta = next.range || null;
      renderAll();
    } catch (err) {
      if (token !== requestId) return;
      console.error(err);
      const grid = document.querySelector(".analytics-recent-grid");
      if (grid) grid.innerHTML = errorBlock(`Couldn't load analytics: ${err.message}`);
      toast(err.message, "error");
    } finally {
      if (token === requestId) {
        document.querySelector(".analytics-charts")?.classList.remove("is-loading");
      }
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
