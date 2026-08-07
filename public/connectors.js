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

  function render(data) {
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
            ${p.configured
              ? ""
              : `<code class="connector-hint">redirect URI: ${escapeHtml(p.redirectUri)}</code>`}
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
