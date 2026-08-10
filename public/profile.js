/* Profile: the signed-in account plus this workspace's configuration -
   which integrations are live, and what the pipeline has produced. */
(() => {
  const { api, escapeHtml, platformIcon, PLATFORM_LABELS, fmtInt,
          fmtRelative, toast, errorBlock } = window.Postfin;

  const page = document.getElementById("profile-page");

  function statusDot(on, label) {
    return `<span class="profile-flag is-${on ? "on" : "off"}">${escapeHtml(label)}</span>`;
  }

  function render(data) {
    const initial = (data.user.name || "?").charAt(0).toUpperCase();

    const platformRows = Object.entries(data.integrations.platforms).map(([key, configured]) => `
      <li class="profile-platform ${configured ? "" : "is-off"}">
        <span class="platform-badge" aria-hidden="true">${platformIcon(key)}</span>
        <span class="profile-platform-name">${escapeHtml(PLATFORM_LABELS[key] || key)}</span>
        ${statusDot(configured, configured ? "credentials set" : "not configured")}
      </li>`).join("");

    const totals = [
      ["Videos created", data.totals.jobs],
      ["Videos rendered", data.totals.videosReady],
      ["Posts published", data.totals.posted],
      ["Failed posts", data.totals.failedPosts],
      ["Connected accounts", data.totals.connectedAccounts],
      ["Scheduled ahead", data.totals.scheduled],
    ].map(([label, value]) => `
      <div class="profile-stat">
        <span class="profile-stat-value">${fmtInt(value)}</span>
        <span class="profile-stat-label">${escapeHtml(label)}</span>
      </div>`).join("");

    const metrics = data.metrics;
    const collection = metrics.enabled
      ? `Every ${metrics.intervalMinutes} min · last run ${escapeHtml(fmtRelative(metrics.at))}` +
        (metrics.at ? ` · ${metrics.posts} post + ${metrics.accounts} account snapshot(s)` : " · not run yet")
      : "Disabled (METRICS_INTERVAL_MINUTES=0)";

    page.innerHTML = `
      <div class="profile-card">
        <span class="profile-card-avatar">${escapeHtml(initial)}</span>
        <div class="profile-card-copy">
          <h2>${escapeHtml(data.user.name)}</h2>
          <p>${escapeHtml(data.user.email || "Signed in without an email (auth disabled)")}</p>
          <span class="profile-role">${escapeHtml(data.user.role)}</span>
        </div>
        ${data.user.email ? `<form method="post" action="/logout"><button class="pf-btn ghost" type="submit">Sign out</button></form>` : ""}
      </div>

      <section class="profile-section">
        <h2>Workspace</h2>
        <dl class="profile-defs">
          <dt>Public URL</dt><dd>${escapeHtml(data.workspace.baseUrl)}</dd>
          <dt>Renderer</dt><dd>${escapeHtml(data.workspace.provider === "heygen" ? "HeyGen avatar" : "Built-in ffmpeg")}</dd>
          <dt>Video length</dt><dd>${data.workspace.videoSeconds}s</dd>
          <dt>Accounts per platform</dt><dd>${data.workspace.maxAccountsPerPlatform} max</dd>
          <dt>Metrics collection</dt><dd>${collection}</dd>
        </dl>
      </section>

      <section class="profile-section">
        <h2>Totals</h2>
        <div class="profile-stats">${totals}</div>
      </section>

      <section class="profile-section">
        <h2>Generation</h2>
        <div class="profile-flags">
          ${statusDot(data.integrations.openai, data.integrations.openai ? "OpenAI connected" : "No OpenAI key - template scripts")}
          ${statusDot(data.integrations.heygen, data.integrations.heygen ? "HeyGen key set" : "No HeyGen key - built-in renderer")}
        </div>
        ${data.integrations.heygen ? `
          <div class="profile-heygen">
            <button type="button" class="pf-btn ghost" id="heygen-test">Test HeyGen connection</button>
            <span class="profile-heygen-result" id="heygen-result"></span>
          </div>` : ""}
        ${data.integrations.openai ? `
          <div class="profile-heygen">
            <button type="button" class="pf-btn ghost" id="images-test">Test slide image generation</button>
            <span class="profile-heygen-result" id="images-result"></span>
          </div>
          <p class="pf-hint">Slideshows draw their slides with the image model. Access to it is
            separate from the rest of the API - OpenAI gates it behind organisation verification -
            so a key that writes scripts can still be unable to draw a slide. This costs about a cent.</p>` : ""}
      </section>

      <section class="profile-section">
        <h2>Platform credentials</h2>
        <ul class="profile-platforms">${platformRows}</ul>
        <p class="pf-hint">Credentials come from the environment. Connect individual accounts on the
          <a href="connectors.html">Connectors</a> page.</p>
      </section>`;
  }

  // Checks the key works now, rather than finding out when a render fails
  // 15 minutes into a scheduled post.
  function bindHeygenTest() {
    const btn = document.getElementById("heygen-test");
    const out = document.getElementById("heygen-result");
    btn?.addEventListener("click", async () => {
      btn.disabled = true;
      out.textContent = "Checking…";
      out.className = "profile-heygen-result";
      try {
        const result = await api("/api/heygen/test", { method: "POST", body: {} });
        out.textContent = `Connected · ${result.avatarCount} avatar(s) available`;
        out.className = "profile-heygen-result is-ok";
      } catch (err) {
        out.textContent = err.message;
        out.className = "profile-heygen-result is-error";
      } finally {
        btn.disabled = false;
      }
    });
  }

  // Same idea for slide art, which fails for its own reasons.
  function bindImageTest() {
    const btn = document.getElementById("images-test");
    const out = document.getElementById("images-result");
    btn?.addEventListener("click", async () => {
      btn.disabled = true;
      out.textContent = "Drawing a test image…";
      out.className = "profile-heygen-result";
      try {
        const result = await api("/api/images/test", { method: "POST", body: {} });
        out.textContent =
          `${result.model} works · ${result.seconds}s · slides render at ` +
          `${result.slideSize} ${result.slideQuality}`;
        out.className = "profile-heygen-result is-ok";
      } catch (err) {
        out.textContent = err.message;
        out.className = "profile-heygen-result is-error";
      } finally {
        btn.disabled = false;
      }
    });
  }

  api("/api/profile")
    .then((data) => { render(data); bindHeygenTest(); bindImageTest(); })
    .catch((err) => {
      page.innerHTML = errorBlock(`Couldn't load your profile: ${err.message}`);
      toast(err.message, "error");
    });
})();
