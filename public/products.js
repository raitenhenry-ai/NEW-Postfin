(() => {
  const { api, escapeHtml, fmtRelative, errorBlock, emptyBlock } = window.Postfin;

  const list = document.getElementById("products-list");
  const status = document.getElementById("products-status");

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

  function productRow(product) {
    const name = product.name || hostLabel(product.url);
    const meta = [
      product.brand,
      priceLabel(product),
      `${product.videoCount} video${product.videoCount === 1 ? "" : "s"}`,
      product.lastUsedAt ? `Last used ${fmtRelative(product.lastUsedAt)}` : "",
    ].filter(Boolean).join(" · ");

    const thumb = product.image
      ? `<img class="product-thumb" src="${escapeHtml(product.image)}" alt="" loading="lazy">`
      : `<span class="product-thumb is-empty" aria-hidden="true"></span>`;

    return `
      <li class="product-row">
        ${thumb}
        <div class="product-copy">
          <span class="product-name">${escapeHtml(name)}</span>
          <span class="product-meta">${escapeHtml(meta)}</span>
        </div>
        <a class="product-link" href="${escapeHtml(product.url)}" target="_blank" rel="noopener">
          Open
        </a>
      </li>`;
  }

  async function load() {
    status.innerHTML = "";
    list.innerHTML = "";
    try {
      const data = await api("/api/products");
      const products = data.products || [];
      if (!products.length) {
        status.innerHTML = emptyBlock(
          "No products yet. Plan a video with a product URL and it will show up here."
        );
        return;
      }
      list.innerHTML = products.map(productRow).join("");
    } catch (err) {
      status.innerHTML = errorBlock(err.message || "Couldn't load products");
    }
  }

  load();
})();
