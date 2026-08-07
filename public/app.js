/* Sidebar chrome and the shared day/post modal.
   Page data comes from the per-page scripts; this file only owns layout. */

const sidebar = document.getElementById("sidebar");
const logoBtn = document.getElementById("logo-btn");
const collapseBtn = document.getElementById("collapse-btn");

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
