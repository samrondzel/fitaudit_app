const input = document.querySelector("#searchInput");
const suggestions = document.querySelector("#suggestions");
const foodCard = document.querySelector("#foodCard");
const emptyState = document.querySelector("#emptyState");

const foodName = document.querySelector("#foodName");
const foodTitle = document.querySelector("#foodTitle");
const sourceLink = document.querySelector("#sourceLink");
const macros = document.querySelector("#macros");
const vitaminsTable = document.querySelector("#vitaminsTable");
const mineralsTable = document.querySelector("#mineralsTable");
const gramsInput = document.querySelector("#gramsInput");
const addFoodBtn = document.querySelector("#addFoodBtn");

const searchScreen = document.querySelector("#searchScreen");
const todayScreen = document.querySelector("#todayScreen");
const searchTabBtn = document.querySelector("#searchTabBtn");
const todayTabBtn = document.querySelector("#todayTabBtn");
const deficitTabBtn = document.querySelector("#deficitTabBtn");
const todayCount = document.querySelector("#todayCount");

const todayEmpty = document.querySelector("#todayEmpty");
const todayItems = document.querySelector("#todayItems");
const todayMacros = document.querySelector("#todayMacros");
const todayVitaminsTable = document.querySelector("#todayVitaminsTable");
const todayMineralsTable = document.querySelector("#todayMineralsTable");
const clearTodayBtn = document.querySelector("#clearTodayBtn");

const deficitScreen = document.querySelector("#deficitScreen");
const nutrientInput = document.querySelector("#nutrientInput");
const nutrientSuggestions = document.querySelector("#nutrientSuggestions");
const deficitEmpty = document.querySelector("#deficitEmpty");
const deficitCard = document.querySelector("#deficitCard");
const deficitTitle = document.querySelector("#deficitTitle");
const deficitSubtitle = document.querySelector("#deficitSubtitle");
const deficitDonut = document.querySelector("#deficitDonut");
const deficitPercent = document.querySelector("#deficitPercent");
const deficitEaten = document.querySelector("#deficitEaten");
const deficitLeft = document.querySelector("#deficitLeft");
const deficitDaily = document.querySelector("#deficitDaily");
const topProductsEmpty = document.querySelector("#topProductsEmpty");
const topProductsBody = document.querySelector("#topProductsBody");

const STORAGE_KEY = "fitaudit_today_v1";

let debounceTimer = null;
let currentFood = null;
let nutrientDebounceTimer = null;
let currentNutrient = null;
let currentTopProducts = [];

const macroLabels = {
  calories_kcal: ["Калории", "ккал"],
  protein_g: ["Белки", "г"],
  fat_g: ["Жиры", "г"],
  carbs_g: ["Углеводы", "г"],
  water_g: ["Вода", "г"],
  fiber_g: ["Клетчатка", "г"],
};

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function roundSmart(value) {
  if (value === null || value === undefined || value === "") return value;
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  if (Math.abs(n) >= 100) return Math.round(n * 10) / 10;
  if (Math.abs(n) >= 10) return Math.round(n * 100) / 100;
  return Math.round(n * 1000) / 1000;
}

function renderDailyMiniBars() {
  const box = document.getElementById("dailyMiniBars");
  if (!box) return;

  const today = JSON.parse(
    localStorage.getItem("fitaudit_today_v1") || "[]"
  );

  const totals = {};

  today.forEach(item => {
    // Витамины + минералы: уже пересчитанные проценты
    const nutrients = [
      ...(item.vitamins || []),
      ...(item.minerals || [])
    ];

    nutrients.forEach(nutrient => {
      const percent = Number(nutrient.daily_percent || 0);
      if (!percent) return;

      totals[nutrient.name] =
        (totals[nutrient.name] || 0) + percent;
    });

    // КБЖУ: берем из macros
    const macros = item.macros || {};

    const macroPercents = {
      "Белки": macros.protein_daily_percent,
      "Жиры": macros.fat_daily_percent,
      "Углеводы": macros.carbs_daily_percent,
      "Калории": macros.calories_daily_percent
    };

    Object.entries(macroPercents).forEach(([name, value]) => {
      const percent = Number(value || 0);
      if (!percent) return;

      totals[name] = (totals[name] || 0) + percent;
    });
  });

  const entries = Object.entries(totals)
    .sort((a, b) => b[1] - a[1]);

  if (!entries.length) {
    box.innerHTML = `<p class="empty-inline">Пока ничего не добавлено.</p>`;
    return;
  }

  box.innerHTML = entries.map(([name, percent]) => {
    const width = Math.min(percent, 100);

    return `
      <div class="mini-bar-row">
        <div class="mini-bar-label">
          <span>${name}</span>
          <strong>${percent.toFixed(0)}%</strong>
        </div>

        <div class="mini-bar-bg">
          <div
            class="mini-bar-fill"
            style="width: ${width}%">
          </div>
        </div>
      </div>
    `;
  }).join("");
}

function formatValue(value, unit = "") {
  if (value === null || value === undefined || value === "") return "—";
  return `${roundSmart(value)}${unit ? " " + unit : ""}`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getGrams() {
  let grams = Number(gramsInput.value);
  if (!Number.isFinite(grams)) grams = 100;
  grams = Math.max(0, Math.min(3000, grams));
  gramsInput.value = grams;
  return grams;
}

function scaleNumber(value, factor) {
  const n = toNumber(value);
  return n === null ? null : n * factor;
}

function scaleFood(food, grams) {
  const factor = grams / 100;

  return {
    food_id: food.food_id,
    name: food.name,
    title: food.title,
    url: food.url,
    grams,
    macros: Object.fromEntries(
      Object.entries(food.macros || {}).map(([key, value]) => [key, scaleNumber(value, factor)])
    ),
    vitamins: (food.vitamins || []).map(row => ({
      ...row,
      amount: scaleNumber(row.amount, factor),
      daily_percent: scaleNumber(row.daily_percent, factor),
    })),
    minerals: (food.minerals || []).map(row => ({
      ...row,
      amount: scaleNumber(row.amount, factor),
      daily_percent: scaleNumber(row.daily_percent, factor),
    })),
  };
}

function renderSuggestions(items) {
  if (!items.length) {
    suggestions.classList.add("hidden");
    suggestions.innerHTML = "";
    return;
  }

  suggestions.innerHTML = items.map(item => `
    <div class="suggestion" data-id="${escapeHtml(item.id)}">
      <strong>${escapeHtml(item.name || "Без названия")}</strong>
      <span>${escapeHtml(item.title || "")}</span>
    </div>
  `).join("");

  suggestions.classList.remove("hidden");

  document.querySelectorAll(".suggestion").forEach(el => {
    el.addEventListener("click", () => {
      const id = el.dataset.id;
      suggestions.classList.add("hidden");
      loadFood(id);
    });
  });
}

async function searchFoods(query) {
  const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=10`);
  const items = await response.json();
  renderSuggestions(items);
}

async function loadFood(id) {
  const response = await fetch(`/api/food/${id}`);
  const food = await response.json();

  currentFood = food;
  gramsInput.value = 100;

  emptyState.classList.add("hidden");
  foodCard.classList.remove("hidden");

  foodName.textContent = food.name || "Без названия";
  foodTitle.textContent = food.title || "";
  sourceLink.href = food.url || "#";

  renderCurrentFood();
}

function renderCurrentFood() {
  if (!currentFood) return;
  const scaled = scaleFood(currentFood, getGrams());
  renderFoodData(scaled, macros, vitaminsTable, mineralsTable);
}

function renderFoodData(food, macroContainer, vitaminBody, mineralBody) {
  macroContainer.innerHTML = Object.entries(macroLabels).map(([key, [label, unit]]) => `
    <div class="macro">
      <span>${label}</span>
      <strong>${formatValue(food.macros?.[key], unit)}</strong>
    </div>
  `).join("");

  vitaminBody.innerHTML = renderRows(food.vitamins);
  mineralBody.innerHTML = renderRows(food.minerals);
}

function renderRows(rows) {
  if (!rows || !rows.length) {
    return `<tr><td colspan="3">Нет данных</td></tr>`;
  }

  return rows.map(row => `
    <tr>
      <td>${escapeHtml(row.name)}</td>
      <td>${formatValue(row.amount, row.unit)}</td>
      <td>${formatValue(row.daily_percent, "%")}</td>
    </tr>
  `).join("");
}

function loadToday() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveToday(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  renderDailyMiniBars();
  renderToday();
}

function addCurrentFood() {
  if (!currentFood) return;
  const grams = getGrams();
  addFoodToToday(currentFood, grams);
  addFoodBtn.textContent = "✓ Добавлено";
  setTimeout(() => {
    addFoodBtn.textContent = "Добавить";
  }, 1200);
}

function addFoodToToday(food, grams) {
  const item = scaleFood(food, grams);
  item.entry_id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;

  const items = loadToday();
  items.push(item);
  saveToday(items);

  if (currentNutrient) renderDeficit();
}

function removeTodayItem(entryId) {
  const items = loadToday().filter(item => item.entry_id !== entryId);
  saveToday(items);
}

function sumRows(items, groupName) {
  const totals = new Map();

  for (const item of items) {
    for (const row of item[groupName] || []) {
      const key = `${row.name}__${row.unit || ""}`;
      if (!totals.has(key)) {
        totals.set(key, {
          name: row.name,
          unit: row.unit,
          amount: 0,
          daily_percent: 0,
          hasAmount: false,
          hasDaily: false,
        });
      }

      const total = totals.get(key);
      const amount = toNumber(row.amount);
      const daily = toNumber(row.daily_percent);

      if (amount !== null) {
        total.amount += amount;
        total.hasAmount = true;
      }
      if (daily !== null) {
        total.daily_percent += daily;
        total.hasDaily = true;
      }
    }
  }

  return [...totals.values()]
    .map(row => ({
      name: row.name,
      unit: row.unit,
      amount: row.hasAmount ? row.amount : null,
      daily_percent: row.hasDaily ? row.daily_percent : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

function sumMacros(items) {
  const totals = {};
  for (const key of Object.keys(macroLabels)) totals[key] = 0;
  const seen = {};

  for (const item of items) {
    for (const key of Object.keys(macroLabels)) {
      const value = toNumber(item.macros?.[key]);
      if (value !== null) {
        totals[key] += value;
        seen[key] = true;
      }
    }
  }

  for (const key of Object.keys(macroLabels)) {
    if (!seen[key]) totals[key] = null;
  }

  return totals;
}

function renderToday() {
  const items = loadToday();
  todayCount.textContent = items.length;

  todayEmpty.classList.toggle("hidden", items.length > 0);

  todayItems.innerHTML = items.map(item => `
    <div class="today-item">
      <div>
        <strong>${escapeHtml(item.name || "Без названия")}</strong>
        <span>${formatValue(item.grams, "г")}</span>
      </div>
      <button type="button" class="small-danger" data-entry-id="${escapeHtml(item.entry_id)}">Удалить</button>
    </div>
  `).join("");

  document.querySelectorAll(".small-danger").forEach(btn => {
    btn.addEventListener("click", () => removeTodayItem(btn.dataset.entryId));
  });

  const totals = {
    macros: sumMacros(items),
    vitamins: sumRows(items, "vitamins"),
    minerals: sumRows(items, "minerals"),
  };

  renderFoodData(totals, todayMacros, todayVitaminsTable, todayMineralsTable);
}

function showTab(tab) {
  const isSearch = tab === "search";
  const isToday = tab === "today";
  const isDeficit = tab === "deficit";

  searchScreen.classList.toggle("hidden", !isSearch);
  todayScreen.classList.toggle("hidden", !isToday);
  deficitScreen.classList.toggle("hidden", !isDeficit);

  searchTabBtn.classList.toggle("active", isSearch);
  todayTabBtn.classList.toggle("active", isToday);
  deficitTabBtn.classList.toggle("active", isDeficit);

  if (isToday) {
    renderToday();
  }

  if (isDeficit) {
    renderDailyMiniBars();

    if (currentNutrient) {
      renderDeficit();
    }
  }
}


function nutrientGroupLabel(group) {
  if (group === "macro") return "КБЖУ";
  if (group === "vitamin") return "витамин";
  if (group === "mineral") return "минерал";
  return group;
}

function renderNutrientSuggestions(items) {
  if (!items.length) {
    nutrientSuggestions.classList.add("hidden");
    nutrientSuggestions.innerHTML = "";
    return;
  }

  nutrientSuggestions.innerHTML = items.map(item => `
    <div class="nutrient-suggestion suggestion"
      data-id="${escapeHtml(item.id)}"
      data-group="${escapeHtml(item.group)}"
      data-key="${escapeHtml(item.key)}"
      data-name="${escapeHtml(item.name)}"
      data-unit="${escapeHtml(item.unit || "")}">
      <strong>${escapeHtml(item.name)}</strong>
      <span>${escapeHtml(nutrientGroupLabel(item.group))}${item.unit ? " · " + escapeHtml(item.unit) : ""}</span>
    </div>
  `).join("");

  nutrientSuggestions.classList.remove("hidden");

  document.querySelectorAll(".nutrient-suggestion").forEach(el => {
    el.addEventListener("click", () => {
      currentNutrient = {
        id: el.dataset.id,
        group: el.dataset.group,
        key: el.dataset.key,
        name: el.dataset.name,
        unit: el.dataset.unit || null,
      };

      nutrientInput.value = currentNutrient.name;
      nutrientSuggestions.classList.add("hidden");
      loadTopProductsForNutrient();
    });
  });
}

async function searchNutrients(query) {
  const response = await fetch(`/api/nutrients?q=${encodeURIComponent(query)}&limit=20`);
  const items = await response.json();
  renderNutrientSuggestions(items);
}

function findNutrientInItem(item, nutrient) {
  if (!item || !nutrient) return null;

  if (nutrient.group === "macro") {
    const value = toNumber(item.macros?.[nutrient.key]);
    return value === null ? null : {
      amount: value,
      unit: nutrient.unit,
      daily_percent: null,
    };
  }

  const rows = nutrient.group === "vitamin" ? item.vitamins : item.minerals;
  const row = (rows || []).find(r =>
    String(r.name || "").toLowerCase().replaceAll("ё", "е") ===
    String(nutrient.name || "").toLowerCase().replaceAll("ё", "е")
  );

  return row || null;
}

function sumNutrientToday(nutrient) {
  const items = loadToday();
  let amount = 0;
  let daily = 0;
  let hasAmount = false;
  let hasDaily = false;

  for (const item of items) {
    const row = findNutrientInItem(item, nutrient);
    if (!row) continue;

    const rowAmount = toNumber(row.amount);
    const rowDaily = toNumber(row.daily_percent);

    if (rowAmount !== null) {
      amount += rowAmount;
      hasAmount = true;
    }
    if (rowDaily !== null) {
      daily += rowDaily;
      hasDaily = true;
    }
  }

  return {
    amount: hasAmount ? amount : null,
    daily_percent: hasDaily ? daily : null,
  };
}

async function loadTopProductsForNutrient() {
  if (!currentNutrient) return;

  const params = new URLSearchParams({
    group: currentNutrient.group,
    key: currentNutrient.key,
    name: currentNutrient.name,
    limit: "20",
  });

  const response = await fetch(`/api/top-nutrient?${params.toString()}`);
  currentTopProducts = await response.json();

  deficitEmpty.classList.add("hidden");
  deficitCard.classList.remove("hidden");

  renderDeficit();
}

function renderDeficit() {
  if (!currentNutrient) return;

  const totals = sumNutrientToday(currentNutrient);
  const daily = toNumber(totals.daily_percent);
  const amount = toNumber(totals.amount);
  const visibleDaily = daily === null ? 0 : daily;
  const progress = Math.max(0, Math.min(100, visibleDaily));
  const leftPercent = Math.max(0, 100 - visibleDaily);

  deficitTitle.textContent = currentNutrient.name;
  deficitSubtitle.textContent = `${nutrientGroupLabel(currentNutrient.group)}${currentNutrient.unit ? " · " + currentNutrient.unit : ""}`;
  deficitDonut.style.setProperty("--progress", progress);
  deficitPercent.textContent = `${roundSmart(visibleDaily)}%`;
  deficitEaten.textContent = formatValue(amount, currentNutrient.unit || "");
  deficitDaily.textContent = daily === null ? "—" : formatValue(daily, "%");
  deficitLeft.textContent = daily === null ? "Нет % нормы" : formatValue(leftPercent, "%");

  renderTopProducts();
}

function renderTopProducts() {
  topProductsEmpty.classList.toggle("hidden", currentTopProducts.length > 0);

  topProductsBody.innerHTML = currentTopProducts.map(product => {
    const grams = 100;
    const scaledAmount = product.amount_per_100g * grams / 100;
    const scaledDaily = toNumber(product.daily_percent_per_100g);

    return `
      <tr data-food-id="${escapeHtml(product.food_id)}" data-amount100="${escapeHtml(product.amount_per_100g)}" data-daily100="${escapeHtml(product.daily_percent_per_100g ?? "")}" data-unit="${escapeHtml(product.unit || "")}">
        <td>
          <strong>${escapeHtml(product.name || "Без названия")}</strong>
          <span class="muted-line">${escapeHtml(product.title || "")}</span>
        </td>
        <td>${formatValue(product.amount_per_100g, product.unit || "")}</td>
        <td>${formatValue(product.daily_percent_per_100g, "%")}</td>
        <td><input class="top-grams-input" type="number" min="0" max="3000" step="1" value="100"></td>
        <td class="top-scaled-value">${formatValue(scaledAmount, product.unit || "")}${scaledDaily === null ? "" : ` · ${formatValue(scaledDaily, "%")}`}</td>
        <td><button class="top-add-btn" type="button">Добавить</button></td>
      </tr>
    `;
  }).join("");

  document.querySelectorAll(".top-grams-input").forEach(inputEl => {
    inputEl.addEventListener("input", () => updateTopProductRow(inputEl.closest("tr")));
  });

  document.querySelectorAll(".top-add-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const row = btn.closest("tr");
      const foodId = row.dataset.foodId;
      let grams = Number(row.querySelector(".top-grams-input").value);
      if (!Number.isFinite(grams)) grams = 100;
      grams = Math.max(0, Math.min(3000, grams));

      const response = await fetch(`/api/food/${foodId}`);
      const food = await response.json();
      addFoodToToday(food, grams);

      btn.textContent = "✓";
      setTimeout(() => {
        btn.textContent = "Добавить";
      }, 1000);
    });
  });
}

function updateTopProductRow(row) {
  if (!row) return;
  const inputEl = row.querySelector(".top-grams-input");
  const cell = row.querySelector(".top-scaled-value");
  let grams = Number(inputEl.value);
  if (!Number.isFinite(grams)) grams = 100;
  grams = Math.max(0, Math.min(3000, grams));
  inputEl.value = grams;

  const amount100 = Number(row.dataset.amount100);
  const daily100 = row.dataset.daily100 === "" ? null : Number(row.dataset.daily100);
  const unit = row.dataset.unit || "";

  const amount = amount100 * grams / 100;
  const daily = daily100 === null || !Number.isFinite(daily100) ? null : daily100 * grams / 100;
  cell.textContent = `${formatValue(amount, unit)}${daily === null ? "" : ` · ${formatValue(daily, "%")}`}`;
}

input.addEventListener("input", () => {
  const query = input.value.trim();

  clearTimeout(debounceTimer);

  if (query.length < 2) {
    renderSuggestions([]);
    return;
  }

  debounceTimer = setTimeout(() => searchFoods(query), 180);
});

gramsInput.addEventListener("input", renderCurrentFood);
addFoodBtn.addEventListener("click", addCurrentFood);

searchTabBtn.addEventListener("click", () => showTab("search"));
todayTabBtn.addEventListener("click", () => showTab("today"));
deficitTabBtn.addEventListener("click", () => showTab("deficit"));

clearTodayBtn.addEventListener("click", () => {
  if (confirm("Очистить список ‘Съел сегодня’?")) {
    saveToday([]);
  }
});

nutrientInput.addEventListener("input", () => {
  const query = nutrientInput.value.trim();

  clearTimeout(nutrientDebounceTimer);

  if (query.length < 1) {
    renderNutrientSuggestions([]);
    return;
  }

  nutrientDebounceTimer = setTimeout(() => searchNutrients(query), 180);
});

document.addEventListener("click", event => {
  if (!event.target.closest(".search-box")) {
    suggestions.classList.add("hidden");
    nutrientSuggestions.classList.add("hidden");
  }
});

renderToday();
