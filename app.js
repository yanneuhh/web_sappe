let items = [];
let isAdmin = false;

const grid = document.querySelector("#itemsGrid");
const resultCount = document.querySelector("#resultCount");
const heroCount = document.querySelector("#heroCount");
const categoryFilter = document.querySelector("#categoryFilter");
const sortSelect = document.querySelector("#sortSelect");
const searchInput = document.querySelector("#searchInput");
const minPriceInput = document.querySelector("#minPriceInput");
const maxPriceInput = document.querySelector("#maxPriceInput");
const itemDialog = document.querySelector("#itemDialog");
const loginDialog = document.querySelector("#loginDialog");
const itemForm = document.querySelector("#itemForm");
const loginForm = document.querySelector("#loginForm");
const adminLoginButton = document.querySelector("#adminLoginButton");
const openFormButton = document.querySelector("#openFormButton");
const logoutButton = document.querySelector("#logoutButton");
const adminStatus = document.querySelector("#adminStatus");
const loginError = document.querySelector("#loginError");
const formError = document.querySelector("#formError");

adminLoginButton.addEventListener("click", () => loginDialog.showModal());
openFormButton.addEventListener("click", () => itemDialog.showModal());
logoutButton.addEventListener("click", logout);
document.querySelector("#closeLoginButton").addEventListener("click", () => loginDialog.close());
document.querySelector("#closeFormButton").addEventListener("click", () => itemDialog.close());
document.querySelector("#clearFiltersButton").addEventListener("click", clearFilters);

[categoryFilter, sortSelect, searchInput, minPriceInput, maxPriceInput].forEach((control) => {
  control.addEventListener("input", render);
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";

  const response = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: document.querySelector("#passwordInput").value }),
  });

  if (!response.ok) {
    loginError.textContent = "Mot de passe incorrect.";
    return;
  }

  isAdmin = true;
  loginForm.reset();
  loginDialog.close();
  updateAdminUi();
  render();
});

itemForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  formError.textContent = "";

  const newItem = {
    name: document.querySelector("#nameInput").value.trim(),
    price: Number(document.querySelector("#priceInput").value),
    category: document.querySelector("#itemCategoryInput").value,
    source: document.querySelector("#sourceInput").value.trim() || "Lien externe",
    url: document.querySelector("#urlInput").value.trim(),
    image: document.querySelector("#imageInput").value.trim(),
  };

  const response = await fetch("/api/items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(newItem),
  });

  if (!response.ok) {
    formError.textContent = "Ajout refuse. Reconnecte-toi en admin.";
    return;
  }

  const savedItem = await response.json();
  items = [savedItem, ...items];
  itemForm.reset();
  itemDialog.close();
  render();
});

grid.addEventListener("click", async (event) => {
  const deleteButton = event.target.closest("[data-delete-id]");
  if (!deleteButton) return;

  event.preventDefault();
  event.stopPropagation();

  if (!isAdmin) return;

  const itemId = deleteButton.dataset.deleteId;
  const item = items.find((candidate) => candidate.id === itemId);
  if (!item) return;

  const confirmed = window.confirm(`Supprimer "${item.name}" ?`);
  if (!confirmed) return;

  const response = await fetch(`/api/items/${encodeURIComponent(itemId)}`, { method: "DELETE" });
  if (!response.ok) {
    window.alert("Suppression refusee. Reconnecte-toi en admin.");
    return;
  }

  items = items.filter((candidate) => candidate.id !== itemId);
  render();
});

async function bootstrap() {
  const [itemsResponse, sessionResponse] = await Promise.all([fetch("/api/items"), fetch("/api/session")]);
  items = await itemsResponse.json();
  const session = await sessionResponse.json();
  isAdmin = Boolean(session.isAdmin);
  updateAdminUi();
  render();
}

async function logout() {
  await fetch("/api/logout", { method: "POST" });
  isAdmin = false;
  updateAdminUi();
  render();
}

function updateAdminUi() {
  document.body.classList.toggle("is-admin", isAdmin);
  openFormButton.hidden = !isAdmin;
  logoutButton.hidden = !isAdmin;
  adminLoginButton.hidden = isAdmin;
  adminStatus.textContent = isAdmin ? "Mode admin" : "Lecture seule";
}

function clearFilters() {
  categoryFilter.value = "all";
  sortSelect.value = "newest";
  searchInput.value = "";
  minPriceInput.value = "";
  maxPriceInput.value = "";
  render();
}

function getVisibleItems() {
  const query = searchInput.value.trim().toLowerCase();
  const minPrice = Number(minPriceInput.value || 0);
  const maxPrice = Number(maxPriceInput.value || Number.MAX_SAFE_INTEGER);

  return items
    .filter((item) => {
      const matchesCategory = categoryFilter.value === "all" || item.category === categoryFilter.value;
      const matchesQuery = [item.name, item.source, item.category].join(" ").toLowerCase().includes(query);
      const matchesPrice = item.price >= minPrice && item.price <= maxPrice;
      return matchesCategory && matchesQuery && matchesPrice;
    })
    .sort((a, b) => {
      if (sortSelect.value === "price-asc") return a.price - b.price;
      if (sortSelect.value === "price-desc") return b.price - a.price;
      if (sortSelect.value === "name") return a.name.localeCompare(b.name);
      return b.createdAt - a.createdAt;
    });
}

function render() {
  const visibleItems = getVisibleItems();
  const label = visibleItems.length > 1 ? "items" : "item";

  resultCount.textContent = `- ${visibleItems.length} ${label}`;
  heroCount.textContent = `${items.length} ${items.length > 1 ? "pieces" : "piece"}`;

  if (!visibleItems.length) {
    grid.innerHTML = `<div class="empty-state">Aucune piece ne correspond aux filtres.</div>`;
    return;
  }

  grid.innerHTML = visibleItems.map(createItemCard).join("");
}

function createItemCard(item) {
  return `
    <article class="item-shell">
      <a class="item-card" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">
        <div class="image-frame">
          <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" loading="lazy" />
        </div>
        <div class="item-info">
          <span class="item-title">${escapeHtml(item.name)}</span>
          <span class="item-meta">
            <span>${formatPrice(item.price)}</span>
            <span class="item-source">${escapeHtml(item.source)}</span>
          </span>
        </div>
      </a>
      ${isAdmin ? `<button class="delete-button" type="button" data-delete-id="${escapeHtml(item.id)}">Supprimer</button>` : ""}
    </article>
  `;
}

function formatPrice(price) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(price);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

bootstrap().catch(() => {
  grid.innerHTML = `<div class="empty-state">Impossible de charger le catalogue.</div>`;
});
