/* Connectors: every platform Postfin can publish to, its credential state,
   and the accounts linked to it. Connect/disconnect run the real OAuth. */
(() => {
  const { api, escapeHtml, platformIcon, fmtRelative, toast, errorBlock } = window.Postfin;

  const list = document.getElementById("connectors-list");
  const status = document.getElementById("connectors-status");

  // The OAuth callback bounces back here with the outcome in the query.
  function showCallbackResult() {
    const params = new URLSearchParams(location.search);
    const connected = params.get("connected");
    const error = params.get("connect_error");
    if (!connected && !error) return;

    if (status) {
      status.innerHTML = error
        ? `<div class="pf-empty pf-error">${escapeHtml(error)}</div>`
        : `<div class="pf-empty pf-ok">Connected ${escapeHtml(connected)} successfully.</div>`;
    }
    if (error) toast(error, "error");
    else toast(`Connected ${connected}`);
    // Drop the query so a refresh doesn't replay the message.
    history.replaceState(null, "", location.pathname);
  }

  // The values the platform dashboards ask for, taken from the running
  // deployment - if BASE_URL is wrong, it is wrong here too and visibly so.
  function renderSetup(data) {
    const setup = document.getElementById("connectors-setup");
    if (!setup) return;
    setup.innerHTML = `
      <div class="connector-setup">
        <h2>Set-up details</h2>
        <p>Paste these into each platform's developer dashboard. They come from
           this deployment's <code>BASE_URL</code>.</p>
        <dl class="connector-setup-defs">
          <dt>App URL</dt>
          <dd><code>${escapeHtml(data.baseUrl)}</code></dd>
          <dt>Redirect URI</dt>
          <dd><code>${escapeHtml(data.baseUrl)}/auth/&lt;platform&gt;/callback</code>
              <span class="pf-hint">the exact value per platform is listed below</span></dd>
          <dt>Meta webhook<br><span class="pf-hint">Instagram · Facebook · Threads</span></dt>
          <dd><code>${escapeHtml(data.metaWebhook.url)}</code>
              <span class="pf-hint">verify token: <code>${escapeHtml(data.metaWebhook.verifyToken)}</code></span></dd>
        </dl>
        ${data.baseUrl.includes("localhost")
          ? `<div class="pf-empty pf-error">BASE_URL is still localhost, so these
             redirect URIs will not work. Set it to this deployment's public URL.</div>`
          : ""}
      </div>`;
  }

  function render(data) {
    renderSetup(data);
    list.innerHTML = data.platforms.map((p) => {
      const atLimit = p.accounts.length >= data.maxAccountsPerPlatform;
      const accounts = p.accounts.map((a) => `
        <li class="connector-account">
          <span class="connector-account-name">${escapeHtml(a.displayName || "Account")}</span>
          <span class="connector-account-meta">connected ${escapeHtml(fmtRelative(a.connectedAt))}</span>
          <button type="button" class="connector-disconnect" data-disconnect="${a.id}">Disconnect</button>
        </li>`).join("");

      // Without API credentials in the environment the OAuth flow can't even
      // start, so the button is replaced by what's missing.
      const action = !p.configured
        ? `<span class="connector-action is-disabled" title="Set the API credentials in .env">Not configured</span>`
        : atLimit
          ? `<span class="connector-action is-disabled">Limit reached</span>`
          : `<a class="connector-action" href="${escapeHtml(p.connectUrl)}">${p.accounts.length ? "Add account" : "Connect"}</a>`;

      return `
        <li class="connector-row ${p.configured ? "" : "is-unconfigured"}">
          <span class="connector-icon">${platformIcon(p.key)}</span>
          <div class="connector-copy">
            <span class="connector-name">${escapeHtml(p.label)}</span>
            <span class="connector-desc">${escapeHtml(p.description)}</span>
            <code class="connector-hint">redirect URI: ${escapeHtml(p.redirectUri)}</code>
            ${accounts ? `<ul class="connector-accounts">${accounts}</ul>` : ""}
          </div>
          ${action}
        </li>`;
    }).join("");

    list.querySelectorAll("[data-disconnect]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Disconnect this account? Scheduled posts to it will fail.")) return;
        btn.disabled = true;
        try {
          await api(`/auth/accounts/${btn.dataset.disconnect}/disconnect`, {
            method: "POST", body: {},
          });
          toast("Account disconnected");
          await load();
        } catch (err) {
          toast(err.message, "error");
          btn.disabled = false;
        }
      });
    });
  }

  async function load() {
    try {
      render(await api("/api/connectors"));
    } catch (err) {
      list.innerHTML = errorBlock(`Couldn't load connectors: ${err.message}`);
    }
  }

  showCallbackResult();
  load();
})();
