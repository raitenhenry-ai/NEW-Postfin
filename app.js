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

const calButtons = document.querySelectorAll("[data-cal-view]");
const calViews = document.querySelectorAll(".calendar-view");

calButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const view = btn.dataset.calView;

    calButtons.forEach((b) => {
      b.classList.toggle("active", b === btn);
      b.setAttribute("aria-selected", b === btn ? "true" : "false");
    });

    calViews.forEach((panel) => {
      panel.hidden = panel.dataset.view !== view;
    });
  });
});

const monthPosts = {
  6: {
    label: "Monday, Jun 6",
    posts: [
      {
        id: "6-0",
        platform: "tiktok",
        time: "9:00 AM",
        duration: "0:18",
        title: "Protein bowl",
        status: "green",
        credits: 12,
        model: "Nova Clip 2.5",
        prompt:
          "Create a bright 15–20s vertical cooking clip of assembling a high-protein bowl. Open on a clean counter with raw ingredients laid out (chicken, rice, greens, eggs, sauce). Use fast chop-and-build jump cuts, keep hands in frame, and maintain appetizing overhead angles. Add punchy on-screen text for protein grams at each step. End with a plated overhead hero shot, a quick calorie/protein callout, and a soft CTA to save the recipe. Style: high-contrast food content, natural daylight, no talking head.",
        caption:
          "High protein bowl in under 10 minutes 🥗💪\nSave this for your next meal prep day.\n#highprotein #mealprep #healthyrecipes",
      },
    ],
  },
  7: {
    label: "Tuesday, Jun 7",
    posts: [
      {
        id: "7-0",
        platform: "instagram",
        time: "3:00 PM",
        duration: "0:22",
        title: "Summer vibe",
        status: "green",
        credits: 10,
        model: "Aura Reel Pro",
        prompt:
          "Film a warm golden-hour lifestyle reel with soft outdoor light and gentle movement. Include slow-motion fabric/hair moments, a quick outfit or snack insert, and one wide establishing shot. Keep pacing light and aesthetic with soft dissolve transitions. End on a chill end card with minimal text. Avoid hard cuts and keep color grading warm (peach/amber). Music-led pacing, no dialogue.",
        caption:
          "Summer energy loading… ☀️\nWhat’s your go-to warm weather vibe?\n#summerstyle #aesthetic #summervibes",
      },
    ],
  },
  8: {
    label: "Wednesday, Jun 8",
    posts: [
      {
        id: "8-0",
        platform: "tiktok",
        time: "10:00 AM",
        duration: "0:15",
        title: "Quick snack",
        status: "green",
        credits: 8,
        model: "Nova Clip 2.5",
        prompt:
          "Make a fast snack recipe short: exactly 3 ingredients and 3 steps. Start with the finished snack for hook value, then jump-cut the prep with big on-screen numbers (1/2/3). Keep each shot under 2 seconds, finish with a bite/reaction close-up, and add a caption cue to comment for the full list. Bright kitchen lighting, vertical 9:16, energetic beat sync.",
        caption:
          "3-ingredient snack that actually hits 🔥\nComment “recipe” and I’ll drop the full list.\n#quicksnack #easyrecipes #proteinsnack",
      },
      {
        id: "8-1",
        platform: "youtube",
        time: "12:00 PM",
        duration: "8:40",
        title: "Full day eating",
        status: "blue",
        credits: 28,
        model: "Director Longform X",
        prompt:
          "Produce a full-day-of-eating vlog covering breakfast, lunch, snack, and dinner. Use natural talking-to-camera intros for each meal, clean food insert B-roll, and clear macro overlays (protein/carbs/fat/calories). Keep tone friendly and practical. Include grocery context where useful and close with a final daily total graphic plus a soft subscribe CTA. Horizontal 16:9, conversational audio, soft background music under voice.",
        caption:
          "Full day of eating — high protein edition 🍽️\nExact macros + grocery list in the description.\n#fulldayofeating #highprotein #whatieatinaday",
      },
      {
        id: "8-2",
        platform: "instagram",
        time: "4:00 PM",
        duration: "0:24",
        title: "Outfit idea",
        status: "green",
        credits: 11,
        model: "Aura Reel Pro",
        prompt:
          "Shoot an outfit-idea reel with 4 look transitions: mirror selfie, street walk, detail closeups, and a final pose. Use trendy audio pacing and crisp text overlays naming each look. Keep transitions snappy (whip/match cut), emphasize silhouette and color palette, and end with a ‘which look?’ poll sticker prompt on screen.",
        caption:
          "Outfit ideas for this week ✨\nWhich look are you stealing?\n#outfitideas #styleinspo #ootd",
      },
    ],
  },
  9: {
    label: "Thursday, Jun 9",
    posts: [
      {
        id: "9-0",
        platform: "instagram",
        time: "4:00 PM",
        duration: "0:20",
        title: "Outfit idea",
        status: "green",
        credits: 9,
        model: "Aura Reel Pro",
        prompt:
          "Create a clean Get Ready With Me style outfit post: closet pull, try-on, accessories, then final mirror shot. Keep captions short and emphasize silhouette + color palette. Soft indoor light, neutral background, and one product detail insert for shoes/watch. End with a save CTA.",
        caption:
          "Easy fit check for Thursday 👔\nSave for your next low-effort style day.\n#grwm #mensfashion #outfitinspo",
      },
    ],
  },
  10: {
    label: "Friday, Jun 10",
    posts: [
      {
        id: "10-0",
        platform: "tiktok",
        time: "11:30 AM",
        duration: "0:17",
        title: "Gym meal",
        status: "green",
        credits: 10,
        model: "Nova Clip 2.5",
        prompt:
          "Film a post-workout meal short: gym exit transition into kitchen prep, protein-focused plating, and a final ‘macros on screen’ end card. Energetic cuts synced to upbeat audio. Show sweat-to-plate contrast, keep text bold and minimal, and finish with a forkful close-up.",
        caption:
          "Post-gym fuel that keeps you full 🏋️🍗\nProtein first, always.\n#gymmeal #fitnessfood #mealideas",
      },
    ],
  },
  11: {
    label: "Saturday, Jun 11",
    posts: [
      {
        id: "11-0",
        platform: "instagram",
        time: "5:00 PM",
        duration: "0:29",
        title: "Healthy tips",
        status: "blue",
        credits: 14,
        model: "Aura Reel Pro",
        prompt:
          "Build a tip-style video with 5 practical healthy habits, one tip per beat, bold text, and soft lifestyle B-roll. Keep each tip readable in under 3 seconds, use consistent text placement, and end with a CTA to save the post. Calm pacing, clean typography, muted color grade.",
        caption:
          "5 healthy tips that actually stick 🧠💚\nSave this for later and try tip #3 tomorrow.\n#healthytips #wellness #habits",
      },
    ],
  },
  12: {
    label: "Sunday, Jun 12",
    posts: [
      {
        id: "12-0",
        platform: "tiktok",
        time: "6:00 PM",
        duration: "0:21",
        title: "Night routine",
        status: "blue",
        credits: 9,
        model: "Nova Clip 2.5",
        prompt:
          "Capture a calming night routine: dim lighting, skincare/tea/journal moments, soft transitions, optional soft VO. End on lights-out vibe with a ‘wind down’ text card. Slow zooms, warm tungsten tones, no harsh cuts. Keep it intimate and quiet.",
        caption:
          "Sunday night reset 🌙\nProtect your peace before the week starts.\n#nightroutine #sundayreset #selfcare",
      },
      {
        id: "12-1",
        platform: "youtube",
        time: "12:00 PM",
        duration: "11:05",
        title: "Meal prep",
        status: "blue",
        credits: 32,
        model: "Director Longform X",
        prompt:
          "Create a Sunday meal prep guide: grocery haul, batch cook montage, container packing, and fridge overview. Include portion counts and estimated prep time on screen. Add chapter markers energy with clear section titles, show yields per container, and close with a weekly plan recap graphic plus description CTA for the grocery list.",
        caption:
          "Sunday meal prep for the whole week 🍱\nTimestamps + full grocery list below.\n#mealprep #sundayprep #highprotein",
      },
    ],
  },
};

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

function renderDayList(day) {
  const data = monthPosts[day];
  if (!data || !dayModal) return;

  modalContext = { day, mode: "list" };
  if (dayModalBack) dayModalBack.hidden = true;
  dayModalTitle.textContent = data.label;
  dayModalBody.innerHTML = `
    <p class="day-modal-subtitle">${data.posts.length} scheduled post${data.posts.length === 1 ? "" : "s"}</p>
    <div class="day-modal-list">
      ${data.posts
        .map(
          (post, index) => `
        <button type="button" class="day-post day-post-btn" data-post-index="${index}">
          <span class="platform-badge" aria-hidden="true">
            <img src="icons/${post.platform}.png" alt="">
          </span>
          <div class="day-post-copy">
            <span class="post-time">${post.time} · ${post.duration}</span>
            <span class="post-title">${post.title}</span>
          </div>
          <span class="post-dot ${post.status}"></span>
          <span class="suggestion-chevron" aria-hidden="true">›</span>
        </button>
      `
        )
        .join("")}
    </div>
  `;

  dayModalBody.querySelectorAll("[data-post-index]").forEach((btn) => {
    btn.addEventListener("click", () => renderPostDetail(day, Number(btn.dataset.postIndex)));
  });

  openModal();
}

function renderPostDetail(day, index, { fromList = true } = {}) {
  const data = monthPosts[day];
  const post = data?.posts[index];
  if (!post || !dayModal) return;

  modalContext = { day, mode: "detail", index, fromList };
  if (dayModalBack) dayModalBack.hidden = !fromList;
  dayModalTitle.textContent = post.title;
  dayModalBody.innerHTML = `
    <article class="post-detail">
      <div class="post-detail-top">
        <span class="platform-badge" aria-hidden="true">
          <img src="icons/${post.platform}.png" alt="">
        </span>
        <div class="post-detail-copy">
          <span class="post-time">${data.label}</span>
          <span class="post-title">${post.title}</span>
        </div>
        <span class="post-dot ${post.status}"></span>
      </div>

      <div class="post-meta-grid">
        <div class="post-meta-item">
          <span class="post-field-label">Post time</span>
          <span class="post-meta-value">${post.time}</span>
        </div>
        <div class="post-meta-item">
          <span class="post-field-label">Duration</span>
          <span class="post-meta-value">${post.duration}</span>
        </div>
        <div class="post-meta-item">
          <span class="post-field-label">Credit cost</span>
          <span class="post-meta-value">${post.credits} credits</span>
        </div>
        <div class="post-meta-item">
          <span class="post-field-label">Video model</span>
          <span class="post-meta-value">${post.model}</span>
        </div>
      </div>

      <div>
        <span class="post-field-label">Video prompt</span>
        <p class="post-prompt">${post.prompt}</p>
      </div>
      <div>
        <label class="post-field-label" for="caption-${post.id}">Caption</label>
        <textarea class="post-caption" id="caption-${post.id}">${post.caption}</textarea>
      </div>
    </article>
  `;

  openModal();
}

dayModalBack?.addEventListener("click", () => {
  if (modalContext.day != null) renderDayList(modalContext.day);
});

document.querySelectorAll(".month-cell[data-day]").forEach((cell) => {
  cell.addEventListener("click", () => renderDayList(cell.dataset.day));
});

document.querySelectorAll(".calendar-day[data-day]").forEach((el) => {
  el.addEventListener("click", () => renderDayList(el.dataset.day));
});

document.querySelectorAll(".calendar-cell[data-day]").forEach((cell) => {
  cell.addEventListener("click", () => renderDayList(cell.dataset.day));
});

document.querySelectorAll(".day-post[data-day][data-post-index]").forEach((el) => {
  el.addEventListener("click", () => {
    renderPostDetail(el.dataset.day, Number(el.dataset.postIndex), { fromList: false });
  });
});

dayModal?.querySelectorAll("[data-close-modal]").forEach((el) => {
  el.addEventListener("click", closeDayModal);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeDayModal();
});

const automatedPlanBtn = document.getElementById("automated-plan-btn");

function hasContentPlan() {
  const chipCount = document.querySelectorAll(".content-calendar .post-chip").length;
  if (chipCount > 0) return true;
  return Object.values(monthPosts).some((day) => day.posts?.length);
}

function syncAutomatedPlanBtn() {
  if (!automatedPlanBtn) return;
  const hasPlan = hasContentPlan();
  const label = hasPlan ? "Edit my automated plan" : "Start my automated plan";
  const labelEl = automatedPlanBtn.querySelector(".automated-plan-label");
  if (labelEl) labelEl.textContent = label;
  automatedPlanBtn.setAttribute("aria-label", label);
}

if (automatedPlanBtn) {
  syncAutomatedPlanBtn();
  automatedPlanBtn.addEventListener("click", () => {
    try {
      localStorage.setItem("cal-mode", "edit");
    } catch {
      /* ignore */
    }
  });
}
