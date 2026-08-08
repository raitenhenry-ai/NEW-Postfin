/* Shared API client and formatting helpers.
   Loaded before every page script; everything hangs off window.Postfin. */
(() => {
  const PLATFORM_LABELS = {
    tiktok: "TikTok",
    instagram: "Instagram",
    youtube: "YouTube",
    facebook: "Facebook",
    x: "X",
    threads: "Threads",
    pinterest: "Pinterest",
    linkedin: "LinkedIn",
  };

  // Brand colours for the platforms that have no bundled PNG icon; they get
  // a lettermark badge instead of a fake logo.
  const PLATFORM_COLORS = {
    facebook: "#1877f2",
    x: "#111111",
    threads: "#000000",
    pinterest: "#e60023",
    linkedin: "#0a66c2",
    tiktok: "#25f4ee",
    instagram: "#dd2a7b",
    youtube: "#ff0000",
  };

  const ICON_FILES = new Set(["tiktok", "instagram", "youtube"]);

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // An <img> where we ship the logo, a coloured lettermark everywhere else.
  function platformIcon(key) {
    if (ICON_FILES.has(key)) {
      return `<img src="icons/${key}.png" alt="${escapeHtml(PLATFORM_LABELS[key] || key)}">`;
    }
    const label = PLATFORM_LABELS[key] || key || "?";
    const color = PLATFORM_COLORS[key] || "#6d7688";
    const letter = label.charAt(0).toUpperCase();
    return `<svg viewBox="0 0 32 32" role="img" aria-label="${escapeHtml(label)}">
      <rect width="32" height="32" rx="8" fill="${color}"></rect>
      <text x="16" y="21" text-anchor="middle" font-size="15" font-weight="700"
            font-family="-apple-system, Segoe UI, Roboto, sans-serif" fill="#fff">${letter}</text>
    </svg>`;
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      headers: options.body ? { "Content-Type": "application/json" } : {},
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // A non-JSON body means the request never reached the API. The usual
      // cause is that only the contents of public/ got deployed, so a static
      // host answers /api/* with its own 404 page: the pages render but
      // nothing loads. Say that outright rather than "unexpected response".
      if (/^\s*<(!doctype|html)/i.test(text)) {
        throw new Error(
          "The Postfin API isn't running - the pages are being served without their backend. " +
            "This app needs the Node server (npm start, or the included Dockerfile); " +
            "a static-only host serves public/ but not /api."
        );
      }
      throw new Error(`Unexpected response from ${path} (HTTP ${res.status})`);
    }
    if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
    return data;
  }

  /* ---------- formatting ---------- */

  function fmtCompact(n, digits = 1) {
    const value = Number(n) || 0;
    const abs = Math.abs(value);
    if (abs >= 1e9) return `${trim(value / 1e9, digits)}B`;
    if (abs >= 1e6) return `${trim(value / 1e6, digits)}M`;
    if (abs >= 1e3) return `${trim(value / 1e3, digits)}K`;
    return String(Math.round(value));
  }

  function trim(value, digits) {
    return Number(value.toFixed(digits)).toString();
  }

  function fmtInt(n) {
    return (Number(n) || 0).toLocaleString("en-US");
  }

  function fmtSigned(n) {
    const value = Number(n) || 0;
    return `${value >= 0 ? "+" : ""}${value.toLocaleString("en-US")}`;
  }

  function fmtMoney(n, digits = 2) {
    return `$${(Number(n) || 0).toFixed(digits)}`;
  }

  // A delta chip, or an empty string when there's nothing meaningful to
  // show - the backend sends null when it has no baseline to compare with.
  function fmtDelta(delta) {
    if (delta === null || delta === undefined || !Number.isFinite(delta)) return "";
    const pct = delta * 100;
    const arrow = delta >= 0 ? "↗" : "↘";
    const magnitude = Math.abs(pct) >= 100 ? Math.round(pct) : Math.round(pct * 10) / 10;
    return `${arrow} ${magnitude}%`;
  }

  function deltaClass(delta) {
    if (delta === null || delta === undefined || !Number.isFinite(delta)) return "";
    return delta >= 0 ? "up" : "down";
  }

  function fmtDuration(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function fmtDateTime(ms) {
    if (!ms) return "—";
    return new Date(ms).toLocaleString("en-US", {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
  }

  function fmtRelative(ms) {
    if (!ms) return "—";
    const diff = Date.now() - Number(ms);
    const mins = Math.round(diff / 60000);
    if (Math.abs(mins) < 1) return "just now";
    if (Math.abs(mins) < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (Math.abs(hours) < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (Math.abs(days) < 30) return `${days}d ago`;
    return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  function dateKey(d) {
    const date = d instanceof Date ? d : new Date(d);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  // The browser's IANA zone, sent with any request that buckets by day. The
  // server runs in UTC, so without it a "day" is cut on the wrong midnight
  // and every date label lands one day off for anyone west of Greenwich.
  function timeZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    } catch {
      return null;
    }
  }

  /* ---------- transient messages ---------- */

  let toastTimer = null;
  function toast(message, kind = "info") {
    let el = document.getElementById("pf-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "pf-toast";
      el.className = "pf-toast";
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.dataset.kind = kind;
    el.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("visible"), 4200);
  }

  // Standard "this panel couldn't load" markup, so a failed fetch shows a
  // reason instead of leaving the section blank forever.
  function errorBlock(message) {
    return `<div class="pf-empty pf-error">${escapeHtml(message)}</div>`;
  }

  function emptyBlock(message) {
    return `<div class="pf-empty">${escapeHtml(message)}</div>`;
  }

  window.Postfin = {
    api, escapeHtml, platformIcon, PLATFORM_LABELS, PLATFORM_COLORS,
    fmtCompact, fmtInt, fmtSigned, fmtMoney, fmtDelta, deltaClass,
    fmtDuration, fmtDateTime, fmtRelative, dateKey, timeZone,
    toast, errorBlock, emptyBlock,
  };
})();
