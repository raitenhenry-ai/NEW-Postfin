(() => {
  const { api, escapeHtml, fmtRelative, errorBlock, emptyBlock, toast } = window.Postfin;

  const list = document.getElementById("products-list");
  const status = document.getElementById("products-status");
  const form = document.getElementById("products-add");
  const urlInput = document.getElementById("product-url");
  const addBtn = document.getElementById("product-add-btn");
  const hint = document.getElementById("products-add-hint");

  function hostLabel(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  }

  function priceLabel(product) {
    if (product.price == null || product.price === "") return "";
    const amount = product.price;
    const currency = product.currency ? ` ${product.currency}` : "";
    return `${amount}${currency}`.trim();
  }

  function gallery(product) {
    const images = (product.images || []).filter(Boolean).slice(0, 4);
    if (!images.length) {
      return `<div class="product-hero is-empty" aria-hidden="true"></div>`;
    }
    const main = images[0];
    const thumbs = images.slice(1);
    return `
      <div class="product-media">
        <img class="product-hero" src="${escapeHtml(main)}" alt="" loading="lazy">
        ${thumbs.length ? `
          <div class="product-thumbs">
            ${thumbs.map((src) => `
              <img src="${escapeHtml(src)}" alt="" loading="lazy">
            `).join("")}
          </div>` : ""}
      </div>`;
  }

  function productCard(product) {
    const name = product.name || hostLabel(product.url);
    const site = product.site || hostLabel(product.url);
    const price = priceLabel(product);
    const desc = product.description
      ? `<p class="product-desc">${escapeHtml(product.description)}</p>`
      : `<p class="product-desc is-muted">No description scraped yet.</p>`;

    const facts = [
      product.brand ? `<span><strong>Brand</strong>${escapeHtml(product.brand)}</span>` : "",
      price ? `<span><strong>Price</strong>${escapeHtml(price)}</span>` : "",
      site ? `<span><strong>Store</strong>${escapeHtml(site)}</span>` : "",
      `<span><strong>Videos</strong>${product.videoCount} made</span>`,
      product.lastUsedAt
        ? `<span><strong>Activity</strong>${escapeHtml(fmtRelative(product.lastUsedAt))}</span>`
        : "",
    ].filter(Boolean).join("");

    const removeBtn = product.id
      ? `<button type="button" class="pf-btn ghost danger" data-remove="${product.id}">Remove</button>`
      : "";

    return `
      <article class="product-card" data-id="${product.id || ""}">
        ${gallery(product)}
        <div class="product-body">
          <div class="product-body-top">
            <div class="product-titles">
              <h2 class="product-name">${escapeHtml(name)}</h2>
              <a class="product-url" href="${escapeHtml(product.url)}" target="_blank" rel="noopener">
                ${escapeHtml(product.url)}
              </a>
            </div>
            <div class="product-actions">
              <a class="pf-btn ghost" href="${escapeHtml(product.url)}" target="_blank" rel="noopener">Open page</a>
              ${removeBtn}
            </div>
          </div>
          ${desc}
          <div class="product-facts">${facts}</div>
        </div>
      </article>`;
  }

  async function load() {
    status.innerHTML = "";
    list.innerHTML = "";
    try {
      const data = await api("/api/products");
      const products = data.products || [];
      if (!products.length) {
        status.innerHTML = emptyBlock(
          "No products yet. Paste a product URL above to add one."
        );
        return;
      }
      list.innerHTML = products.map(productCard).join("");
    } catch (err) {
      status.innerHTML = errorBlock(err.message || "Couldn't load products");
    }
  }

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const url = urlInput.value.trim();
    if (!url) return;

    addBtn.disabled = true;
    hint.textContent = "Scraping product page…";
    hint.classList.remove("is-error");

    try {
      const result = await api("/api/products", {
        method: "POST",
        body: { url },
      });
      urlInput.value = "";
      hint.textContent = result.updated
        ? "Updated product from that URL."
        : "Product added.";
      toast(result.updated ? "Product updated" : "Product added");
      await load();
    } catch (err) {
      hint.textContent = err.message || "Couldn't add that product";
      hint.classList.add("is-error");
      toast(err.message || "Couldn't add that product", "error");
    } finally {
      addBtn.disabled = false;
    }
  });

  list?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-remove]");
    if (!btn) return;
    const id = btn.getAttribute("data-remove");
    if (!id) return;
    btn.disabled = true;
    try {
      await api(`/api/products/${id}`, { method: "DELETE" });
      toast("Product removed");
      await load();
    } catch (err) {
      toast(err.message || "Couldn't remove product", "error");
      btn.disabled = false;
    }
  });

  load();
})();
