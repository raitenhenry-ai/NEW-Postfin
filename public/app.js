/* Sidebar chrome and the shared day/post modal.
   Page data comes from the per-page scripts; this file only owns layout. */

const THEME_KEY = "pf-theme";

function getTheme() {
  try {
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function applyTheme(theme) {
  const light = theme === "light";
  document.documentElement.classList.toggle("theme-light", light);
  document.body?.classList.toggle("theme-light", light);
  const toggle = document.getElementById("theme-toggle");
  if (toggle) {
    toggle.setAttribute("aria-checked", light ? "true" : "false");
    toggle.classList.toggle("is-light", light);
    // Sun in dark mode (click for light); moon in light mode (click for dark).
    toggle.setAttribute("aria-label", light ? "Switch to dark mode" : "Switch to light mode");
  }
}

function setTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
  applyTheme(theme);
}

applyTheme(getTheme());

const sidebar = document.getElementById("sidebar");
const logoBtn = document.getElementById("logo-btn");
const collapseBtn = document.getElementById("collapse-btn");

// Theme control sits above the foot divider as a sun / moon icon.
(function mountThemeToggle() {
  const foot = document.querySelector(".sidebar-foot");
  if (!foot || document.getElementById("theme-toggle")) return;

  const wrap = document.createElement("div");
  wrap.className = "theme-toggle-wrap";
  wrap.innerHTML = `
    <button type="button" class="theme-toggle" id="theme-toggle" role="switch" aria-checked="false" aria-label="Switch to light mode">
      <svg class="theme-toggle-icon theme-toggle-sun" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.75"/>
        <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.05 5.05l1.56 1.56M17.39 17.39l1.56 1.56M18.95 5.05l-1.56 1.56M6.61 17.39l-1.56 1.56" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
      </svg>
      <svg class="theme-toggle-icon theme-toggle-moon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M19.5 13.4A7.5 7.5 0 0110.6 4.5 7.6 7.6 0 0012 19.5 7.6 7.6 0 0019.5 13.4z" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/>
      </svg>
    </button>`;
  const divider = foot.querySelector(".divider");
  foot.insertBefore(wrap, divider || foot.firstChild);

  const toggle = wrap.querySelector("#theme-toggle");
  toggle.addEventListener("click", () => {
    setTheme(getTheme() === "light" ? "dark" : "light");
  });
  applyTheme(getTheme());
})();

function setExpanded(expanded) {
  sidebar.classList.toggle("expanded", expanded);
  document.body.classList.toggle("sidebar-expanded", expanded);
  logoBtn.setAttribute("aria-expanded", String(expanded));
  logoBtn.setAttribute("aria-label", expanded ? "Logo" : "Expand sidebar");
  sessionStorage.setItem("sidebar-expanded", expanded ? "1" : "0");
}

if (sessionStorage.getItem("sidebar-expanded") === "1") {
  setExpanded(true);
}

logoBtn.addEventListener("click", () => {
  if (!sidebar.classList.contains("expanded")) {
    setExpanded(true);
  }
});

collapseBtn.addEventListener("click", () => {
  setExpanded(false);
});

/* ---------- day / post modal ----------
   Opened by dashboard.js with real jobs; kept here because the markup lives
   in every page's shell. */

const dayModal = document.getElementById("day-modal");
const dayModalTitle = document.getElementById("day-modal-title");
const dayModalBody = document.getElementById("day-modal-body");
const dayModalBack = document.getElementById("day-modal-back");

let modalContext = { day: null, mode: "list" };

function openModal() {
  if (!dayModal) return;
  dayModal.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeDayModal() {
  if (!dayModal) return;
  dayModal.hidden = true;
  document.body.style.overflow = "";
  modalContext = { day: null, mode: "list" };
  if (dayModalBack) dayModalBack.hidden = true;
}

// Exposed so page scripts can drive the modal without owning its markup.
window.PostfinModal = {
  open: openModal,
  close: closeDayModal,
  get context() {
    return modalContext;
  },
  set context(next) {
    modalContext = next;
  },
  get elements() {
    return { modal: dayModal, title: dayModalTitle, body: dayModalBody, back: dayModalBack };
  },
};

dayModal?.querySelectorAll("[data-close-modal]").forEach((el) => {
  el.addEventListener("click", closeDayModal);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeDayModal();
});

/* ---------- automated plan button ----------
   Sits in the dashboard's calendar toolbar and links through to the
   calendar's edit mode. Its label depends on whether anything is planned,
   which is only known once dashboard.js has loaded the calendar - so that
   script calls syncAutomatedPlanBtn() with the real count. */

const automatedPlanBtn = document.getElementById("automated-plan-btn");

function syncAutomatedPlanBtn(hasPlan) {
  if (!automatedPlanBtn) return;
  const label = hasPlan ? "Edit my automated plan" : "Start my automated plan";
  const labelEl = automatedPlanBtn.querySelector(".automated-plan-label");
  if (labelEl) labelEl.textContent = label;
  automatedPlanBtn.setAttribute("aria-label", label);
}

window.PostfinPlanButton = { sync: syncAutomatedPlanBtn };

if (automatedPlanBtn) {
  automatedPlanBtn.addEventListener("click", () => {
    try {
      localStorage.setItem("cal-mode", "edit");
    } catch {
      /* ignore */
    }
  });
}
