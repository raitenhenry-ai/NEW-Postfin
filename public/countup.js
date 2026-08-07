/* Count-up animation for the stat tiles.
   Values that arrive from the API are marked [data-live]; the page script
   animates those once the data lands, so they're skipped on load. */

function parseStatValue(text) {
  const raw = text.trim();
  const prefix = raw.match(/^[^0-9.-]+/)?.[0] || "";
  const suffix = raw.match(/[A-Za-z%]+$/)?.[0] || "";
  const numberPart = raw.slice(prefix.length, suffix ? raw.length - suffix.length : undefined);
  const decimals = (numberPart.split(".")[1] || "").length;
  const value = parseFloat(numberPart.replace(/,/g, ""));
  const useCommas = numberPart.includes(",");

  return { prefix, suffix, value, decimals, useCommas };
}

function formatStatValue(current, meta) {
  let num;
  if (meta.decimals > 0) {
    num = current.toFixed(meta.decimals);
  } else {
    num = Math.round(current).toString();
  }

  if (meta.useCommas) {
    const [whole, frac] = num.split(".");
    num = Number(whole).toLocaleString("en-US") + (frac != null ? "." + frac : "");
  }

  return meta.prefix + num + meta.suffix;
}

function animateStat(el, duration = 1300) {
  const meta = parseStatValue(el.textContent);
  if (!Number.isFinite(meta.value)) return;

  const start = performance.now();

  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    const current = meta.value * eased;
    el.textContent = formatStatValue(current, meta);
    if (t < 1) requestAnimationFrame(frame);
    else el.textContent = formatStatValue(meta.value, meta);
  }

  el.textContent = formatStatValue(0, meta);
  requestAnimationFrame(frame);
}

window.PostfinCountUp = { animateStat };

document.querySelectorAll(".stat-value:not([data-live])").forEach((el) => animateStat(el, 1300));
