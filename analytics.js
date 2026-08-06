(() => {
  const RANGE_OPTIONS = {
    "1h": { label: "Last hour", points: 12 },
    "24h": { label: "Last 24 hours", points: 12 },
    "7d": { label: "Last 7 days", points: 7 },
    "30d": { label: "Last 30 days", points: 8 },
    custom: { label: "Custom", points: 8 },
  };

  let platform = "all";
  let rangeKey = "30d";
  let customDays = 14;
  let axisLabels = [];
  const instances = new Map();

  const platformData = {
    all: {
      views: {
        color: "#4f8cff",
        fillTop: "rgba(79, 140, 255, 0.36)",
        fillBottom: "rgba(79, 140, 255, 0)",
        max: 160000,
        yLabels: ["160K", "120K", "80K", "40K", "0"],
        total: "439.4K",
        delta: "↑ 22.8%",
        values: [76740, 74880, 83550, 105920, 127960, 115940, 138780, 159220],
        format: (n) => formatCompact(n, 1),
      },
      followers: {
        color: "#3dd68c",
        fillTop: "rgba(61, 214, 140, 0.32)",
        fillBottom: "rgba(61, 214, 140, 0)",
        max: 8000,
        yLabels: ["8K", "6K", "4K", "2K", "0"],
        total: "6.64K",
        delta: "↑ 19.1%",
        values: [4220, 4560, 5045, 5590, 6175, 6705, 7270, 7815],
        format: (n) => formatCompact(n, 2),
      },
      comments: {
        color: "#c084fc",
        fillTop: "rgba(192, 132, 252, 0.32)",
        fillBottom: "rgba(192, 132, 252, 0)",
        max: 2000,
        yLabels: ["2K", "1.5K", "1K", "0.5K", "0"],
        total: "12.4K",
        delta: "↑ 27.4%",
        values: [980, 760, 840, 1180, 1320, 1090, 1280, 1510],
        format: (n) => formatCompact(n, 2),
      },
    },
    tiktok: {
      views: {
        color: "#69c9ff",
        fillTop: "rgba(105, 201, 255, 0.36)",
        fillBottom: "rgba(105, 201, 255, 0)",
        max: 40000,
        yLabels: ["40K", "30K", "20K", "10K", "0"],
        total: "128.7K",
        delta: "↑ 24.6%",
        values: [20140, 17680, 20950, 27120, 34860, 31240, 36180, 41920],
        format: (n) => formatCompact(n, 1),
      },
      followers: {
        color: "#a78bfa",
        fillTop: "rgba(167, 139, 250, 0.34)",
        fillBottom: "rgba(167, 139, 250, 0)",
        max: 3000,
        yLabels: ["3K", "2K", "1K", "0"],
        total: "2.34K",
        delta: "↑ 18.7%",
        values: [1480, 1610, 1795, 2040, 2310, 2555, 2810, 3040],
        format: (n) => formatCompact(n, 2),
      },
      comments: {
        color: "#f472b6",
        fillTop: "rgba(244, 114, 182, 0.34)",
        fillBottom: "rgba(244, 114, 182, 0)",
        max: 500,
        yLabels: ["500", "400", "300", "200", "100", "0"],
        total: "3.07K",
        delta: "↑ 32.1%",
        values: [310, 180, 240, 340, 390, 300, 360, 450],
        format: (n) => formatCompact(n, 2),
      },
    },
    youtube: {
      views: {
        color: "#ff4d4d",
        fillTop: "rgba(255, 77, 77, 0.34)",
        fillBottom: "rgba(255, 77, 77, 0)",
        max: 80000,
        yLabels: ["80K", "60K", "40K", "20K", "0"],
        total: "214.3K",
        delta: "↑ 16.2%",
        values: [38200, 35100, 42800, 51200, 58900, 54600, 63800, 72100],
        format: (n) => formatCompact(n, 1),
      },
      followers: {
        color: "#fb923c",
        fillTop: "rgba(251, 146, 60, 0.32)",
        fillBottom: "rgba(251, 146, 60, 0)",
        max: 2000,
        yLabels: ["2K", "1.5K", "1K", "0.5K", "0"],
        total: "1.18K",
        delta: "↑ 11.4%",
        values: [820, 870, 940, 1010, 1085, 1140, 1210, 1295],
        format: (n) => formatCompact(n, 2),
      },
      comments: {
        color: "#f87171",
        fillTop: "rgba(248, 113, 113, 0.32)",
        fillBottom: "rgba(248, 113, 113, 0)",
        max: 600,
        yLabels: ["600", "450", "300", "150", "0"],
        total: "4.18K",
        delta: "↑ 21.8%",
        values: [420, 290, 360, 480, 540, 450, 510, 590],
        format: (n) => formatCompact(n, 2),
      },
    },
    instagram: {
      views: {
        color: "#e879f9",
        fillTop: "rgba(232, 121, 249, 0.34)",
        fillBottom: "rgba(232, 121, 249, 0)",
        max: 50000,
        yLabels: ["50K", "40K", "30K", "20K", "10K", "0"],
        total: "96.4K",
        delta: "↑ 29.3%",
        values: [18400, 22100, 19800, 27600, 34200, 30100, 38800, 45200],
        format: (n) => formatCompact(n, 1),
      },
      followers: {
        color: "#f58529",
        fillTop: "rgba(245, 133, 41, 0.32)",
        fillBottom: "rgba(245, 133, 41, 0)",
        max: 4000,
        yLabels: ["4K", "3K", "2K", "1K", "0"],
        total: "3.12K",
        delta: "↑ 22.5%",
        values: [1920, 2080, 2310, 2540, 2780, 3010, 3250, 3480],
        format: (n) => formatCompact(n, 2),
      },
      comments: {
        color: "#dd2a7b",
        fillTop: "rgba(221, 42, 123, 0.32)",
        fillBottom: "rgba(221, 42, 123, 0)",
        max: 600,
        yLabels: ["600", "500", "400", "300", "200", "100", "0"],
        total: "5.16K",
        delta: "↑ 27.9%",
        values: [280, 340, 250, 420, 460, 370, 490, 560],
        format: (n) => formatCompact(n, 2),
      },
    },
  };

  const engagementTotals = {
    all: {
      likes: { value: "54.1K", delta: "↑ 18.2%" },
      comments: { value: "12.4K", delta: "↑ 27.4%" },
      saves: { value: "21.6K", delta: "↑ 29.1%" },
      shares: { value: "15.8K", delta: "↑ 17.6%" },
    },
    tiktok: {
      likes: { value: "28.4K", delta: "↑ 22.1%" },
      comments: { value: "3.07K", delta: "↑ 32.1%" },
      saves: { value: "9.84K", delta: "↑ 34.2%" },
      shares: { value: "6.12K", delta: "↑ 19.8%" },
    },
    youtube: {
      likes: { value: "14.9K", delta: "↑ 12.4%" },
      comments: { value: "4.18K", delta: "↑ 21.8%" },
      saves: { value: "5.42K", delta: "↑ 16.5%" },
      shares: { value: "5.91K", delta: "↑ 14.2%" },
    },
    instagram: {
      likes: { value: "10.8K", delta: "↑ 19.7%" },
      comments: { value: "5.16K", delta: "↑ 27.9%" },
      saves: { value: "6.34K", delta: "↑ 38.6%" },
      shares: { value: "3.77K", delta: "↑ 18.3%" },
    },
  };

  function formatCompact(n, digits) {
    if (n >= 1000) return `${(n / 1000).toFixed(digits)}K`;
    return String(Math.round(n));
  }

  function getCharts() {
    return platformData[platform];
  }

  function buildAxisLabels() {
    const now = new Date();
    if (rangeKey === "1h") {
      return Array.from({ length: 12 }, (_, i) => {
        const d = new Date(now.getTime() - (11 - i) * 5 * 60 * 1000);
        return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      });
    }
    if (rangeKey === "24h") {
      return Array.from({ length: 12 }, (_, i) => {
        const d = new Date(now.getTime() - (11 - i) * 2 * 60 * 60 * 1000);
        return d.toLocaleTimeString("en-US", { hour: "numeric" });
      });
    }
    if (rangeKey === "7d") {
      return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(now);
        d.setDate(now.getDate() - (6 - i));
        return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      });
    }
    if (rangeKey === "custom") {
      const days = Math.max(1, customDays);
      const count = Math.min(12, Math.max(4, Math.min(days, 12)));
      return Array.from({ length: count }, (_, i) => {
        const d = new Date(now);
        d.setDate(now.getDate() - Math.round(((count - 1 - i) * (days - 1)) / Math.max(1, count - 1)));
        return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      });
    }
    // 30d
    return Array.from({ length: 8 }, (_, i) => {
      const d = new Date(now);
      d.setDate(now.getDate() - Math.round((7 - i) * (29 / 7)));
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    });
  }

  function visibleAxisLabels(labels) {
    if (labels.length <= 4) return labels;
    const picks = [0, Math.floor((labels.length - 1) / 3), Math.floor(((labels.length - 1) * 2) / 3), labels.length - 1];
    return picks.map((i) => labels[i]);
  }

  function resampleValues(base, count) {
    if (base.length === count) return [...base];
    if (count === 1) return [base[base.length - 1]];
    const out = [];
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const pos = t * (base.length - 1);
      const left = Math.floor(pos);
      const right = Math.min(base.length - 1, left + 1);
      const frac = pos - left;
      out.push(base[left] * (1 - frac) + base[right] * frac);
    }
    // slight range-based noise shape so ranges feel distinct
    const scale =
      rangeKey === "1h" ? 0.08 :
      rangeKey === "24h" ? 0.22 :
      rangeKey === "7d" ? 0.55 :
      rangeKey === "custom" ? Math.min(1, customDays / 30) :
      1;
    const last = base[base.length - 1];
    return out.map((v, i) => {
      const blend = last * (1 - scale) + v * scale;
      const wave = 1 + Math.sin(i * 1.7) * 0.03;
      return Math.max(0, blend * wave);
    });
  }

  function activeConfig(chartKey) {
    const base = getCharts()[chartKey];
    if (!base) return null;
    let count = RANGE_OPTIONS[rangeKey].points;
    if (rangeKey === "custom") {
      count = Math.min(12, Math.max(4, Math.min(customDays, 12)));
    }
    const values = resampleValues(base.values, count);
    return { ...base, values };
  }

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

  function dayLabel(dayIndex) {
    if (!axisLabels.length) return "";
    const clamped = Math.min(axisLabels.length - 1, Math.max(0, dayIndex));
    const day = Math.floor(clamped);
    const frac = clamped - day;
    const base = axisLabels[day] || "";
    if (rangeKey === "1h" || rangeKey === "24h" || rangeKey === "custom") return base;
    if (frac < 0.15 || day >= axisLabels.length - 1) return base;
    const hours = Math.round(frac * 24);
    const h = hours % 24;
    const suffix = h >= 12 ? "PM" : "AM";
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return `${base} · ${hour12}:00 ${suffix}`;
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
    const label = dayLabel(hit.dayIndex);
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
    if (deltaEl) deltaEl.textContent = config.delta;
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

    const points = config.values.map((value, i) => ({
      x: pad.left + (i / (config.values.length - 1)) * plotW,
      y: pad.top + plotH - (value / config.max) * plotH,
      value,
    }));
    const curve = buildCurve(points, 32);

    const instance = {
      card,
      canvas,
      ctx,
      config,
      pad,
      plotW,
      plotH,
      cssWidth,
      cssHeight,
      points,
      curve,
      tooltip,
      valueEl,
      hoverX: null,
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

  function updateTotals() {
    const data = engagementTotals[platform] || engagementTotals.all;
    document.querySelectorAll(".analytics-total-card[data-total]").forEach((card) => {
      const key = card.dataset.total;
      const entry = data[key];
      if (!entry) return;
      const valueEl = card.querySelector(".analytics-total-value");
      const deltaEl = card.querySelector(".analytics-total-delta");
      if (valueEl) valueEl.textContent = entry.value;
      if (deltaEl) deltaEl.textContent = entry.delta;
    });
  }

  function renderAll() {
    axisLabels = buildAxisLabels();
    document.querySelectorAll(".analytics-chart-card[data-chart]").forEach(setupCard);
    updateTotals();
  }

  function setPlatform(next) {
    if (!platformData[next] || next === platform) return;
    platform = next;
    document.querySelectorAll(".analytics-platform-btn").forEach((btn) => {
      const on = btn.dataset.platform === platform;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    renderAll();
  }

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
    const days = Math.max(1, Math.min(365, Number.parseInt(raw, 10) || customDays));
    customDays = days;
    setRange("custom");
  }

  function setRange(next) {
    if (!RANGE_OPTIONS[next]) return;
    rangeKey = next;

    const labelEl = document.getElementById("analytics-range-label");
    if (labelEl) {
      labelEl.textContent =
        next === "custom" ? `Last ${customDays} days` : RANGE_OPTIONS[next].label;
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
    renderAll();
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

  document.getElementById("analytics-custom-row")?.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  const customInput = document.getElementById("analytics-custom-days");
  customInput?.addEventListener("click", (e) => e.stopPropagation());
  customInput?.addEventListener("pointerdown", (e) => e.stopPropagation());
  customInput?.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      applyCustomDays(customInput.value);
    }
    if (e.key === "Escape") {
      if (rangeKey !== "custom") {
        const customBtn = document.getElementById("analytics-custom-btn");
        const customRow = document.getElementById("analytics-custom-row");
        if (customBtn) customBtn.hidden = false;
        if (customRow) customRow.hidden = true;
      }
    }
  });
  customInput?.addEventListener("blur", () => {
    if (document.getElementById("analytics-custom-row")?.hidden) return;
    // Defer so clicking another option can win
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

  requestAnimationFrame(renderAll);
  window.addEventListener("resize", () => {
    clearTimeout(window.__analyticsResize);
    window.__analyticsResize = setTimeout(renderAll, 80);
  });
})();
