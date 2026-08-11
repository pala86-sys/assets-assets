(function () {
  "use strict";

  const {
    uid,
    normalizeNumericInputString,
    parseNum,
    formatThousandsNumber,
    formatNumericCellDisplay,
    bindThousandsInputs,
  } = window.AssetCommon;

  const STORAGE_KEY = "asset-stats-v1";
  const FCN_STORAGE_KEY = "fcn-sheet-v1";

  const defaultState = () => ({
    incomeCategories: [],
    expenseCategories: [],
    usdToTwdRate: "",
    usdToTwdRateUpdatedAt: "",
    fcnLookup: [],
  });

  let state = loadState();

  const els = {
    summaryGrid: document.getElementById("summary-grid"),
    incomeCategories: document.getElementById("income-categories"),
    expenseCategories: document.getElementById("expense-categories"),
    btnAddIncomeCategory: document.getElementById("btn-add-income-category"),
    btnAddExpenseCategory: document.getElementById("btn-add-expense-category"),
    btnExport: document.getElementById("btn-export"),
    inputImport: document.getElementById("input-import"),
    btnReset: document.getElementById("btn-reset"),
    fxUsdTwd: document.getElementById("fx-usd-twd"),
    btnFetchHsbcFx: document.getElementById("btn-fetch-hsbc-fx"),
    fxFetchStatus: document.getElementById("fx-fetch-status"),
    tplIncomeCategory: document.getElementById("tpl-income-category"),
    tplIncomeRow: document.getElementById("tpl-income-row"),
    tplExpenseCategory: document.getElementById("tpl-expense-category"),
    tplExpenseRow: document.getElementById("tpl-expense-row"),
  };

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return defaultState();
      return {
        incomeCategories: Array.isArray(parsed.incomeCategories) ? parsed.incomeCategories : [],
        expenseCategories: Array.isArray(parsed.expenseCategories) ? parsed.expenseCategories : [],
        usdToTwdRate:
          parsed.usdToTwdRate != null && String(parsed.usdToTwdRate).trim() !== ""
            ? normalizeNumericInputString(String(parsed.usdToTwdRate))
            : "",
        usdToTwdRateUpdatedAt:
          typeof parsed.usdToTwdRateUpdatedAt === "string" ? parsed.usdToTwdRateUpdatedAt : "",
        fcnLookup: Array.isArray(parsed.fcnLookup) ? parsed.fcnLookup : [],
      };
    } catch {
      return defaultState();
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    renderSummary();
  }

  function emptyIncomeItem() {
    return {
      id: uid(),
      name: "",
      incomeKind: "other",
      currency: "TWD",
      investedCapital: "",
      annualReturnRate: "",
      netValue: "",
      investedUnits: "",
      distributionPerUnit: "",
      notes: "",
      moneydjUrl: "",
      moneydjDivUrl: "",
    };
  }

  function emptyExpenseItem() {
    return {
      id: uid(),
      name: "",
      currency: "TWD",
      monthlyAmount: "",
      annualAmount: "",
      notes: "",
    };
  }

  /** 類別名含「保險」或「稅」時，細項填「年支出（試算）」（其餘填「月支出（試算）」）。 */
  function categoryNameUsesAnnualExpense(name) {
    const s = String(name ?? "");
    return s.includes("保險") || s.includes("稅");
  }

  /** 支出換算為「每月」（保險／稅：年額÷12；其餘：月額）。相容舊欄位 amount＝每月。 */
  function expenseMonthlyEquivalent(categoryName, it) {
    if (categoryNameUsesAnnualExpense(categoryName)) {
      return parseNum(it.annualAmount) / 12;
    }
    const m = it.monthlyAmount;
    if (m !== undefined && m !== "") return parseNum(m);
    return parseNum(it.amount);
  }

  function emptyIncomeCategory() {
    return { id: uid(), name: "", items: [emptyIncomeItem()] };
  }

  function emptyExpenseCategory() {
    return { id: uid(), name: "", items: [emptyExpenseItem()] };
  }

  /** 支出月／年試算：台幣取整並顯示整數位；美金顯示至小數第二位（皆含千分位） */
  function formatExpenseAmountDisplay(n, currency) {
    if (!Number.isFinite(n)) return "";
    const usd = currency === "USD";
    const v = usd ? n : Math.round(n);
    return new Intl.NumberFormat("zh-TW", {
      useGrouping: true,
      minimumFractionDigits: usd ? 2 : 0,
      maximumFractionDigits: usd ? 2 : 0,
    }).format(v);
  }

  function refreshExpenseAmountFormatting(tr) {
    const cur = tr.querySelector(".field-currency")?.value ?? "TWD";
    for (const cls of ["field-monthly", "field-annual"]) {
      const inp = tr.querySelector(`.${cls}`);
      if (!(inp instanceof HTMLInputElement)) continue;
      const raw = normalizeNumericInputString(inp.value);
      if (raw === "") {
        inp.value = "";
        continue;
      }
      const n = Number(raw);
      if (!Number.isFinite(n)) continue;
      inp.value = formatExpenseAmountDisplay(n, cur);
    }
  }

  /**
   * .main 內數字輸入框（含換匯欄）blur 時的千分位格式化例外：
   * 支出列的月／年金額要依幣別決定小數位數，其餘欄位沿用共用預設千分位格式。
   * 傳給 window.AssetCommon.bindThousandsInputs 當作 formatOverride。
   */
  function expenseThousandsFormatOverride(el, n) {
    const trExp = el.closest("tr.expense-row");
    if (trExp && (el.classList.contains("field-monthly") || el.classList.contains("field-annual"))) {
      const cur = trExp.querySelector(".field-currency")?.value ?? "TWD";
      return formatExpenseAmountDisplay(n, cur);
    }
    return undefined;
  }

  function refreshFxUsdTwdInputFromState() {
    if (!els.fxUsdTwd) return;
    const raw = normalizeNumericInputString(state.usdToTwdRate ?? "");
    if (raw === "") {
      els.fxUsdTwd.value = "";
      return;
    }
    const n = Number(raw);
    els.fxUsdTwd.value = Number.isFinite(n) ? formatThousandsNumber(n) : "";
  }

  /** 頁面載入時，若有快取匯率則顯示上次更新時間，讓使用者知道目前數值是否夠新 */
  function renderCachedFxUpdatedAt() {
    if (!els.fxFetchStatus) return;
    const raw = normalizeNumericInputString(state.usdToTwdRate ?? "");
    if (raw === "" || !state.usdToTwdRateUpdatedAt) return;
    const d = new Date(state.usdToTwdRateUpdatedAt);
    if (Number.isNaN(d.getTime())) return;
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    els.fxFetchStatus.textContent = `使用快取匯率，更新於 ${y}/${mo}/${day} ${hh}:${mm}`;
  }

  function normalizedIncomeKind(it) {
    return it.incomeKind === "fund" ? "fund" : "other";
  }

  /** 收入類別名稱含「投資」時，細項名稱可連動 FCN 試算表 */
  function incomeCategoryLooksLikeInvestment(catName) {
    return String(catName ?? "").trim().includes("投資");
  }

  function normalizeFcnLookupKey(s) {
    return String(s ?? "")
      .trim()
      .replace(/\s+/g, "")
      .toUpperCase();
  }

  /** 讀取 FCN 頁本機資料，供名稱比對帶入投入資金／年報酬率 */
  function fcnCombosFromStoragePayload(parsed) {
    const combos = Array.isArray(parsed?.combos)
      ? parsed.combos
      : Array.isArray(parsed?.stocks)
        ? [parsed]
        : Array.isArray(parsed)
          ? parsed
          : [];
    return combos
      .map((c) => {
        const title = String(c?.sheetTitle ?? "").trim();
        const titleKey = normalizeFcnLookupKey(title);
        if (!titleKey) return null;
        const investedCapital = normalizeNumericInputString(String(c?.investedCapital ?? ""));
        const annualRatePct = normalizeNumericInputString(String(c?.annualRatePct ?? ""));
        return { title, titleKey, investedCapital, annualRatePct };
      })
      .filter(Boolean);
  }

  function refreshFcnLookupFromStorage() {
    try {
      const raw = localStorage.getItem(FCN_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const combos = fcnCombosFromStoragePayload(parsed);
        if (combos.length) {
          state.fcnLookup = combos.map(({ title, investedCapital, annualRatePct }) => ({
            sheetTitle: title,
            investedCapital,
            annualRatePct,
          }));
          return;
        }
      }
    } catch {
      /* ignore */
    }
  }

  function loadFcnCombosForLookup() {
    try {
      const raw = localStorage.getItem(FCN_STORAGE_KEY);
      if (raw) {
        const combos = fcnCombosFromStoragePayload(JSON.parse(raw));
        if (combos.length) return combos;
      }
    } catch {
      /* ignore */
    }
    return fcnCombosFromStoragePayload(state.fcnLookup);
  }

  /** 細項名稱含 FCN 組合名稱（如 GG53 連股權 含 GG53）時回傳該組合；多筆則取最長名稱 */
  function findMatchingFcnCombo(itemName) {
    const nameKey = normalizeFcnLookupKey(itemName);
    if (!nameKey) return null;
    let best = null;
    let bestLen = 0;
    for (const c of loadFcnCombosForLookup()) {
      if (nameKey === c.titleKey || nameKey.includes(c.titleKey)) {
        if (c.titleKey.length > bestLen) {
          best = c;
          bestLen = c.titleKey.length;
        }
      }
    }
    return best;
  }

  /** 「投資」類別且細項名稱對應 FCN 組合時，年報酬率由 FCN 帶入、不可手動編輯 */
  function incomeRowRateLockedByFcn(tr, categoryName) {
    if (!incomeCategoryLooksLikeInvestment(categoryName)) return false;
    const name = tr.querySelector(".field-name")?.value ?? "";
    return !!findMatchingFcnCombo(name);
  }

  function incomeCategoryNameFromRow(tr) {
    return tr.closest(".category-card")?.querySelector(".category-name")?.value ?? "";
  }

  function incomeNumericFieldIsEmpty(raw) {
    const s = normalizeNumericInputString(raw);
    return s === "" || s === "0";
  }

  /**
   * 若細項名稱對應 FCN 組合，帶入投入資金與年報酬率。
   * @returns {boolean} 是否有寫入欄位
   */
  function applyFcnAutofillToIncomeRow(tr, categoryName, { onlyIfEmpty = false } = {}) {
    if (!incomeCategoryLooksLikeInvestment(categoryName)) return false;
    const nameInp = tr.querySelector(".field-name");
    const investedInp = tr.querySelector(".field-invested");
    const rateInp = tr.querySelector(".field-rate");
    if (!nameInp || !investedInp || !rateInp) return false;

    const combo = findMatchingFcnCombo(nameInp.value);
    if (!combo) return false;

    let changed = false;

    if (combo.investedCapital !== "" && (!onlyIfEmpty || incomeNumericFieldIsEmpty(investedInp.value))) {
      investedInp.value = formatNumericCellDisplay(combo.investedCapital);
      changed = true;
    }
    if (combo.annualRatePct !== "" && (!onlyIfEmpty || incomeNumericFieldIsEmpty(rateInp.value))) {
      rateInp.value = formatNumericCellDisplay(combo.annualRatePct);
      changed = true;
    }
    return changed;
  }

  /** 掃描「投資」類別所有列，依 FCN 組合名稱帶入投入資金／年報酬率 */
  function applyFcnAutofillToAllInvestmentRows({ onlyIfEmpty = true } = {}) {
    refreshFcnLookupFromStorage();
    let any = false;
    document.querySelectorAll(".category-card[data-kind='income']").forEach((article) => {
      const catName = article.querySelector(".category-name")?.value ?? "";
      if (!incomeCategoryLooksLikeInvestment(catName)) return;
      const catId = article.dataset.categoryId;
      article.querySelectorAll(".income-row").forEach((tr) => {
        if (applyFcnAutofillToIncomeRow(tr, catName, { onlyIfEmpty })) {
          any = true;
          const prev = incomeItemFromState(catId, tr.dataset.id);
          refreshIncomeRowVisual(tr, prev);
        }
      });
      if (catId) syncIncomeCategoryFromDom(article, catId);
    });
    if (any) saveState();
    return any;
  }

  /** 由名稱推測是否為年金細項（試算同基金；↻ 自國泰撥回頁更新每單位分配） */
  function nameImpliesAnnuity(name) {
    return String(name ?? "").trim().includes("年金");
  }

  /** 由名稱推測是否為基金細項（含「年金」：同基金試算欄位與公式） */
  function nameImpliesFund(name) {
    const s = String(name ?? "").trim();
    if (!s) return false;
    if (s.includes("基金")) return true;
    if (nameImpliesAnnuity(s)) return true;
    return /\bfunds?\b/i.test(s);
  }

  /** 名稱含基金／年金關鍵字優先；否則沿用已存入之 incomeKind（舊資料可保留「基金」試算邏輯） */
  function effectiveIncomeKindFromItem(item) {
    if (nameImpliesFund(item.name)) return "fund";
    return normalizedIncomeKind(item);
  }

  /** 基金／年金：月收入 = 每單位分配 × 持有單位（假設為每月配息），年收入 = 月收入 × 12。其他：年收入 = 投入資金 × 年報酬率%，月收入 = 年收入 ÷ 12 */
  function computedAnnualMonthly(it) {
    if (effectiveIncomeKindFromItem(it) === "fund") {
      const monthly = parseNum(it.distributionPerUnit) * parseNum(it.investedUnits);
      return { annual: monthly * 12, monthly };
    }
    const annual = parseNum(it.investedCapital) * (parseNum(it.annualReturnRate) / 100);
    return { annual, monthly: annual / 12 };
  }

  /** 基金／年金試算之年報酬率(%) = 年收入 ÷ 投入資金 × 100；投入資金為 0 時回傳空字串 */
  function impliedFundAnnualReturnRatePct(it) {
    const capital = parseNum(it.investedCapital);
    if (!(capital > 0)) return "";
    const monthly = parseNum(it.distributionPerUnit) * parseNum(it.investedUnits);
    const annual = monthly * 12;
    if (!Number.isFinite(annual)) return "";
    const pct = (annual / capital) * 100;
    if (!Number.isFinite(pct)) return "";
    return normalizeNumericInputString(pct.toFixed(2));
  }

  function formatComputedPlain(n) {
    if (!Number.isFinite(n)) return "—";
    return new Intl.NumberFormat("zh-TW", {
      useGrouping: true,
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
    }).format(n);
  }

  /** 台幣月收入顯示整數；美元顯示小數二位 */
  function formatComputedMonthly(n, currency) {
    if (!Number.isFinite(n)) return "—";
    const usd = currency === "USD";
    return new Intl.NumberFormat("zh-TW", {
      useGrouping: true,
      minimumFractionDigits: usd ? 2 : 0,
      maximumFractionDigits: usd ? 2 : 0,
    }).format(n);
  }

  function incomeItemFromState(categoryId, rowId) {
    if (!categoryId || !rowId) return null;
    const cat = state.incomeCategories.find((c) => c.id === categoryId);
    return cat?.items?.find((it) => it.id === rowId) ?? null;
  }

  function collectIncomeRow(tr, prevItem) {
    const name = tr.querySelector(".field-name")?.value ?? "";
    let incomeKind =
      prevItem && normalizedIncomeKind(prevItem) === "fund" ? "fund" : "other";
    if (nameImpliesFund(name)) incomeKind = "fund";
    const item = {
      id: tr.dataset.id || uid(),
      name,
      incomeKind,
      currency: tr.querySelector(".field-currency")?.value ?? "TWD",
      investedCapital: normalizeNumericInputString(tr.querySelector(".field-invested")?.value ?? ""),
      annualReturnRate: normalizeNumericInputString(tr.querySelector(".field-rate")?.value ?? ""),
      netValue: normalizeNumericInputString(tr.querySelector(".field-net")?.value ?? ""),
      investedUnits: normalizeNumericInputString(tr.querySelector(".field-units")?.value ?? ""),
      distributionPerUnit: normalizeNumericInputString(tr.querySelector(".field-dist")?.value ?? ""),
      notes: tr.querySelector(".field-notes")?.value ?? "",
      moneydjUrl: tr.querySelector(".field-moneydj-url")?.value ?? "",
      moneydjDivUrl: tr.querySelector(".field-moneydj-div-url")?.value ?? "",
    };
    if (effectiveIncomeKindFromItem(item) === "fund") {
      item.annualReturnRate = impliedFundAnnualReturnRatePct(item);
    }
    return item;
  }

  function refreshIncomeRowVisual(tr, prevItem) {
    const invested = tr.querySelector(".field-invested");
    const rate = tr.querySelector(".field-rate");
    const net = tr.querySelector(".field-net");
    const units = tr.querySelector(".field-units");
    const dist = tr.querySelector(".field-dist");
    const moneydjBtn = tr.querySelector(".btn-fetch-moneydj");
    const annualEl = tr.querySelector(".field-computed-annual");
    const monthlyEl = tr.querySelector(".field-computed-monthly");
    if (!invested || !annualEl || !monthlyEl) return;

    const item = collectIncomeRow(tr, prevItem);
    const kind = effectiveIncomeKindFromItem(item);
    if (kind === "fund") {
      invested.disabled = false;
      rate.disabled = true;
      net.disabled = false;
      units.disabled = false;
      dist.disabled = false;
      if (rate) {
        const pct = item.annualReturnRate;
        rate.value =
          pct === ""
            ? ""
            : new Intl.NumberFormat("zh-TW", {
                useGrouping: true,
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              }).format(parseNum(pct));
      }
    } else {
      invested.disabled = false;
      const catName = incomeCategoryNameFromRow(tr);
      rate.disabled = incomeRowRateLockedByFcn(tr, catName);
      net.disabled = true;
      units.disabled = true;
      dist.disabled = true;
    }
    if (moneydjBtn) {
      const allow = kind === "fund";
      moneydjBtn.hidden = !allow;
      moneydjBtn.disabled = !allow;
      if (allow) {
        moneydjBtn.title = nameImpliesAnnuity(item.name)
          ? "自國泰淨值頁與撥回頁更新淨值、每單位分配。Shift+點擊可變更連結（僅供參考）"
          : "自 MoneyDJ 更新淨值與每單位分配。Shift+點擊可變更淨值／配息連結";
      }
    }

    const { annual, monthly } = computedAnnualMonthly(item);
    const cur = tr.querySelector(".field-currency")?.value ?? "TWD";
    annualEl.textContent = formatComputedPlain(annual);
    monthlyEl.textContent = formatComputedMonthly(monthly, cur);
  }

  function refreshAllIncomeRowsInCard(article) {
    const catId = article.dataset.categoryId;
    const cat = state.incomeCategories.find((c) => c.id === catId);
    const prevMap = new Map((cat?.items || []).map((it) => [it.id, it]));
    article.querySelectorAll(".income-row").forEach((tr) => {
      refreshIncomeRowVisual(tr, prevMap.get(tr.dataset.id));
    });
  }

  function collectExpenseRow(tr) {
    return {
      id: tr.dataset.id || uid(),
      name: tr.querySelector(".field-name")?.value ?? "",
      currency: tr.querySelector(".field-currency")?.value ?? "TWD",
      monthlyAmount: normalizeNumericInputString(tr.querySelector(".field-monthly")?.value ?? ""),
      annualAmount: normalizeNumericInputString(tr.querySelector(".field-annual")?.value ?? ""),
      notes: tr.querySelector(".field-notes")?.value ?? "",
    };
  }

  function syncIncomeCategoryFromDom(card, catId) {
    const cat = state.incomeCategories.find((c) => c.id === catId);
    if (!cat) return;
    cat.name = card.querySelector(".category-name")?.value ?? "";
    const tbody = card.querySelector("tbody");
    const prevById = new Map((cat.items || []).map((it) => [it.id, it]));
    cat.items = [...tbody.querySelectorAll(".income-row")].map((tr) =>
      collectIncomeRow(tr, prevById.get(tr.dataset.id))
    );
  }

  function syncExpenseCategoryFromDom(card, catId) {
    const cat = state.expenseCategories.find((c) => c.id === catId);
    if (!cat) return;
    cat.name = card.querySelector(".category-name")?.value ?? "";
    const tbody = card.querySelector("tbody");
    cat.items = [...tbody.querySelectorAll(".expense-row")].map(collectExpenseRow);
  }

  function bindDebouncedSave(card, syncFn) {
    card.addEventListener("input", () => {
      clearTimeout(card._saveT);
      card._saveT = setTimeout(syncFn, 120);
    });
    card.addEventListener("change", syncFn);
  }

  function fillIncomeRow(tr, item, categoryName) {
    tr.dataset.id = item.id;
    tr.querySelector(".field-name").value = item.name ?? "";
    tr.querySelector(".field-currency").value = item.currency === "USD" ? "USD" : "TWD";
    tr.querySelector(".field-invested").value = formatNumericCellDisplay(item.investedCapital);
    tr.querySelector(".field-rate").value = formatNumericCellDisplay(item.annualReturnRate);
    tr.querySelector(".field-net").value = formatNumericCellDisplay(item.netValue);
    tr.querySelector(".field-units").value = formatNumericCellDisplay(item.investedUnits);
    tr.querySelector(".field-dist").value = formatNumericCellDisplay(item.distributionPerUnit);
    const mj = tr.querySelector(".field-moneydj-url");
    if (mj) mj.value = item.moneydjUrl ?? "";
    const mjDiv = tr.querySelector(".field-moneydj-div-url");
    if (mjDiv) mjDiv.value = item.moneydjDivUrl ?? "";
    tr.querySelector(".field-notes").value = item.notes ?? "";
    refreshIncomeRowVisual(tr, item);
    if (applyFcnAutofillToIncomeRow(tr, categoryName ?? "", { onlyIfEmpty: true })) {
      refreshIncomeRowVisual(tr, item);
    }
  }

  function fillExpenseRow(tr, item) {
    tr.dataset.id = item.id;
    tr.querySelector(".field-name").value = item.name ?? "";
    const cur = item.currency === "USD" ? "USD" : "TWD";
    tr.querySelector(".field-currency").value = cur;
    let monthly = item.monthlyAmount;
    let annual = item.annualAmount;
    if ((monthly === undefined || monthly === "") && item.amount != null && item.amount !== "") {
      monthly = item.amount;
    }
    const fmt = (v) => {
      const norm = normalizeNumericInputString(v == null ? "" : String(v));
      return norm === "" ? "" : formatExpenseAmountDisplay(parseNum(norm), cur);
    };
    tr.querySelector(".field-monthly").value = fmt(monthly);
    tr.querySelector(".field-annual").value = fmt(annual);
    tr.querySelector(".field-notes").value = item.notes ?? "";
  }

  function refreshExpenseRowVisual(tr, categoryName) {
    const useAnnual = categoryNameUsesAnnualExpense(categoryName);
    const monthly = tr.querySelector(".field-monthly");
    const annual = tr.querySelector(".field-annual");
    if (!monthly || !annual) return;
    monthly.disabled = useAnnual;
    annual.disabled = !useAnnual;
    refreshExpenseAmountFormatting(tr);
  }

  function refreshExpenseCategoryRows(article) {
    const catName = article.querySelector(".category-name")?.value ?? "";
    article.querySelectorAll(".expense-row").forEach((tr) => refreshExpenseRowVisual(tr, catName));
  }

  /**
   * 同類別 tbody 內排序。表格列的 HTML5 DnD 在多數瀏覽器不可靠，改以滑鼠按下／放開實際搬移列。
   * 僅能從 .cell-drag-handle 啟動。
   */
  function bindReorderableRows(tbody, options) {
    const { rowSelector, article, categoryId, kind } = options;

    function rowFrom(el) {
      return el instanceof Element ? el.closest(rowSelector) : null;
    }

    function applyReorderAtClientY(dragRow, clientY) {
      const others = [...tbody.querySelectorAll(rowSelector)].filter((r) => r !== dragRow);
      if (!others.length) return;
      for (const r of others) {
        const rect = r.getBoundingClientRect();
        if (clientY < rect.top + rect.height / 2) {
          tbody.insertBefore(dragRow, r);
          return;
        }
      }
      tbody.appendChild(dragRow);
    }

    function finishReorder(dragRow) {
      if (kind === "income") {
        syncIncomeCategoryFromDom(article, categoryId);
        refreshAllIncomeRowsInCard(article);
      } else {
        refreshExpenseCategoryRows(article);
        syncExpenseCategoryFromDom(article, categoryId);
      }
      saveState();
    }

    tbody.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      const handle = e.target.closest(".cell-drag-handle");
      if (!handle) return;
      const dragRow = rowFrom(handle);
      if (!dragRow || dragRow.parentNode !== tbody) return;
      e.preventDefault();

      dragRow.classList.add("is-dragging");
      document.body.classList.add("is-reordering-rows");

      const onMouseMove = (ev) => {
        applyReorderAtClientY(dragRow, ev.clientY);
      };

      const onMouseUp = (ev) => {
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        dragRow.classList.remove("is-dragging");
        document.body.classList.remove("is-reordering-rows");
        applyReorderAtClientY(dragRow, ev.clientY);
        finishReorder(dragRow);
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    });
  }

  function renderIncomeCategory(cat) {
    const node = els.tplIncomeCategory.content.cloneNode(true);
    const article = node.querySelector(".category-card");
    article.dataset.categoryId = cat.id;
    article.querySelector(".category-name").value = cat.name ?? "";

    const tbody = article.querySelector("tbody");
    const items = cat.items?.length ? cat.items : [emptyIncomeItem()];
    const catName = cat.name ?? "";
    items.forEach((item) => {
      const tr = els.tplIncomeRow.content.cloneNode(true).querySelector("tr");
      fillIncomeRow(tr, item, catName);
      tbody.appendChild(tr);
    });
    refreshAllIncomeRowsInCard(article);

    article.querySelector(".btn-add-income-item").addEventListener("click", () => {
      syncIncomeCategoryFromDom(article, cat.id);
      const tr = els.tplIncomeRow.content.cloneNode(true).querySelector("tr");
      fillIncomeRow(tr, emptyIncomeItem(), article.querySelector(".category-name")?.value ?? "");
      tbody.appendChild(tr);
      refreshAllIncomeRowsInCard(article);
      saveState();
    });

    article.querySelector(".btn-remove-category").addEventListener("click", () => {
      if (!confirm("再次確認：將刪除此收入類別及其下所有細項，且無法復原。確定刪除？")) return;
      state.incomeCategories = state.incomeCategories.filter((c) => c.id !== cat.id);
      article.remove();
      saveState();
    });

    function tryAutofillFromFcnNameField(tr) {
      const catName = article.querySelector(".category-name")?.value ?? "";
      if (applyFcnAutofillToIncomeRow(tr, catName)) {
        syncIncomeCategoryFromDom(article, cat.id);
        saveState();
      }
    }

    tbody.addEventListener("input", (e) => {
      if (!e.target.classList.contains("field-name")) return;
      const tr = e.target.closest("tr.income-row");
      if (!tr) return;
      const prev = incomeItemFromState(cat.id, tr.dataset.id);
      tryAutofillFromFcnNameField(tr);
      refreshIncomeRowVisual(tr, prev);
    });

    tbody.addEventListener("change", (e) => {
      if (e.target.classList.contains("field-name")) {
        const tr = e.target.closest("tr.income-row");
        if (tr) {
          const prev = incomeItemFromState(cat.id, tr.dataset.id);
          tryAutofillFromFcnNameField(tr);
          refreshIncomeRowVisual(tr, prev);
        }
        return;
      }
      if (!e.target.closest(".field-currency")) return;
      const tr = e.target.closest("tr.income-row");
      if (!tr) return;
      const prev = incomeItemFromState(cat.id, tr.dataset.id);
      refreshIncomeRowVisual(tr, prev);
      syncIncomeCategoryFromDom(article, cat.id);
      saveState();
    });

    tbody.addEventListener("click", (e) => {
      const fetchBtn = e.target.closest(".btn-fetch-moneydj");
      if (fetchBtn) {
        e.preventDefault();
        const trFund = fetchBtn.closest("tr.income-row");
        if (trFund) void fetchMoneyDjForIncomeRow(trFund, article, cat.id, e.shiftKey === true);
        return;
      }
      const btn = e.target.closest(".btn-remove-row");
      if (!btn) return;
      const tr = btn.closest("tr");
      if (!tr) return;
      const rows = tbody.querySelectorAll(".income-row");
      if (rows.length <= 1) {
        if (!confirm("再次確認：每一類別須至少保留一列。確定清空本列內容（重置為空白）？")) return;
        fillIncomeRow(tr, emptyIncomeItem(), article.querySelector(".category-name")?.value ?? "");
      } else {
        if (!confirm("再次確認：確定刪除此細項？")) return;
        tr.remove();
      }
      syncIncomeCategoryFromDom(article, cat.id);
      refreshAllIncomeRowsInCard(article);
      saveState();
    });

    bindDebouncedSave(article, () => {
      syncIncomeCategoryFromDom(article, cat.id);
      refreshAllIncomeRowsInCard(article);
      saveState();
    });

    bindReorderableRows(tbody, {
      rowSelector: "tr.income-row",
      article,
      categoryId: cat.id,
      kind: "income",
    });

    return article;
  }

  function renderExpenseCategory(cat) {
    const node = els.tplExpenseCategory.content.cloneNode(true);
    const article = node.querySelector(".category-card");
    article.dataset.categoryId = cat.id;
    article.querySelector(".category-name").value = cat.name ?? "";

    const tbody = article.querySelector("tbody");
    const items = cat.items?.length ? cat.items : [emptyExpenseItem()];
    items.forEach((item) => {
      const tr = els.tplExpenseRow.content.cloneNode(true).querySelector("tr");
      fillExpenseRow(tr, item);
      tbody.appendChild(tr);
    });
    refreshExpenseCategoryRows(article);

    article.querySelector(".category-name").addEventListener("input", () => {
      refreshExpenseCategoryRows(article);
    });

    article.querySelector(".btn-add-expense-item").addEventListener("click", () => {
      syncExpenseCategoryFromDom(article, cat.id);
      const tr = els.tplExpenseRow.content.cloneNode(true).querySelector("tr");
      fillExpenseRow(tr, emptyExpenseItem());
      tbody.appendChild(tr);
      refreshExpenseCategoryRows(article);
      saveState();
    });

    article.querySelector(".btn-remove-category").addEventListener("click", () => {
      if (!confirm("再次確認：將刪除此支出類別及其下所有細項，且無法復原。確定刪除？")) return;
      state.expenseCategories = state.expenseCategories.filter((c) => c.id !== cat.id);
      article.remove();
      saveState();
    });

    tbody.addEventListener("click", (e) => {
      const btn = e.target.closest(".btn-remove-row");
      if (!btn) return;
      const tr = btn.closest("tr");
      if (!tr) return;
      const rows = tbody.querySelectorAll(".expense-row");
      if (rows.length <= 1) {
        if (!confirm("再次確認：每一類別須至少保留一列。確定清空本列內容（重置為空白）？")) return;
        fillExpenseRow(tr, emptyExpenseItem());
      } else {
        if (!confirm("再次確認：確定刪除此細項？")) return;
        tr.remove();
      }
      syncExpenseCategoryFromDom(article, cat.id);
      refreshExpenseCategoryRows(article);
      saveState();
    });

    tbody.addEventListener("change", (e) => {
      const t = e.target;
      if (!(t instanceof HTMLSelectElement) || !t.classList.contains("field-currency")) return;
      const tr = t.closest("tr.expense-row");
      if (!tr) return;
      refreshExpenseAmountFormatting(tr);
    });

    bindDebouncedSave(article, () => {
      refreshExpenseCategoryRows(article);
      syncExpenseCategoryFromDom(article, cat.id);
      saveState();
    });

    bindReorderableRows(tbody, {
      rowSelector: "tr.expense-row",
      article,
      categoryId: cat.id,
      kind: "expense",
    });

    return article;
  }

  function computeTotals() {
    const twd = { incomeMonthly: 0, incomeAnnual: 0, expense: 0 };
    const usd = { incomeMonthly: 0, incomeAnnual: 0, expense: 0 };

    state.incomeCategories.forEach((cat) => {
      (cat.items || []).forEach((it) => {
        const { monthly, annual } = computedAnnualMonthly(it);
        if (it.currency === "USD") {
          usd.incomeMonthly += monthly;
          usd.incomeAnnual += annual;
        } else {
          twd.incomeMonthly += monthly;
          twd.incomeAnnual += annual;
        }
      });
    });

    state.expenseCategories.forEach((cat) => {
      const catName = cat.name ?? "";
      (cat.items || []).forEach((it) => {
        const v = expenseMonthlyEquivalent(catName, it);
        if (it.currency === "USD") usd.expense += v;
        else twd.expense += v;
      });
    });

    return { twd, usd };
  }

  const MONEYDJ_ORIGIN = "https://www.moneydj.com";

  function normalizeMoneyDjAbsoluteUrl(input) {
    const s = String(input ?? "").trim();
    if (!s) return "";
    if (/^https?:\/\//i.test(s)) return s;
    if (s.startsWith("//")) return `https:${s}`;
    if (s.startsWith("/")) return `${MONEYDJ_ORIGIN}${s}`;
    if (/^funddj\//i.test(s)) return `${MONEYDJ_ORIGIN}/${s.replace(/^\/+/, "")}`;
    if (/moneydj\.com/i.test(s)) return s.includes("://") ? s : `https://${s.replace(/^\/+/, "")}`;
    return s;
  }

  function extractMoneyDjFundCode(url) {
    const m = String(url ?? "").match(/[?&]a=([^&]+)/i);
    if (!m) return "";
    try {
      return decodeURIComponent(m[1]).trim();
    } catch {
      return m[1].trim();
    }
  }

  /** 將境外／境內淨值表中幣別文字對應至本程式幣別；無法對應時不回寫下拉選單。 */
  function moneyDjCurrencyLabelToAppCode(label) {
    const s = String(label ?? "").replace(/\s+/g, "");
    if (!s) return "";
    if (s.includes("美元")) return "USD";
    if (s.includes("台幣") || s.includes("新台幣")) return "TWD";
    return "";
  }

  function parseMoneyDjMarkdownNavRows(text) {
    if (typeof text !== "string" || !text) return [];
    const rows = [];
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("|")) continue;
      const m = trimmed.match(/\[([^\]]+)\]\([^)]*[?&]a=([^&)\s]+)[^)]*\)/i);
      if (!m) continue;
      const parts = trimmed.split("|").map((p) => p.trim());
      if (parts.length < 5) continue;
      const name = m[1].replace(/\s+/g, " ").trim();
      const code = String(m[2]).trim();
      const dateStr = parts[2] ?? "";
      const currencyLabel = (parts[3] ?? "").replace(/\s+/g, "");
      const navRaw = (parts[4] ?? "").replace(/,/g, "").trim();
      if (!/^[\d.+-]+$/.test(navRaw)) continue;
      const nav = Number(navRaw);
      if (!Number.isFinite(nav)) continue;
      rows.push({ name, code, dateStr, currencyLabel, navRaw, nav });
    }
    return rows;
  }

  /** 從頁面文字推測幣別（標題／摘要區） */
  function inferMoneyDjCurrencyLabel(text) {
    const head = String(text ?? "").slice(0, 4000);
    if (/級別美元|美元計價|\(USD\)|USD/i.test(head)) return "美元";
    if (/級別台幣|級別新台幣|台幣計價|\(TWD\)/i.test(head)) return "台幣";
    if (/美元/.test(head)) return "美元";
    if (/台幣|新台幣/.test(head)) return "台幣";
    return "";
  }

  /** 解析單檔淨值頁（yp010001／yp010000 等），非整表 markdown 連結格式 */
  function parseMoneyDjSingleFundNav(text, fundCode, rowNameHint) {
    if (typeof text !== "string" || !text) return null;
    let name = "";
    const h1 = text.match(/^#\s*(.+)$/m);
    if (h1) {
      name = h1[1]
        .replace(/-AB SICAV.*$/i, "")
        .replace(/-MoneyDJ.*$/i, "")
        .replace(/\(基金之配息.*$/i, "")
        .trim();
    }
    const near30 = text.match(/(.{2,80}?)-近30日淨值/);
    if (near30) name = near30[1].replace(/^#+\s*/, "").trim() || name;

    let code = String(fundCode ?? "").trim();
    if (!code) {
      const mCode = text.match(/GoTrade(?:Down)?\s*\(\s*['"]([A-Za-z0-9]+)['"]/i);
      if (mCode) code = mCode[1].trim();
    }

    const hint = String(rowNameHint ?? "").trim().replace(/\s+/g, "");
    if (hint && name) {
      const n = name.replace(/\s+/g, "");
      if (!n.includes(hint) && !hint.includes(n.slice(0, Math.min(hint.length, n.length)))) {
        /* 有代碼仍以 URL 為準；僅無代碼且名稱完全不符時略過 */
        if (!code) return null;
      }
    }

    const currencyLabel = inferMoneyDjCurrencyLabel(text);
    const lines = text.split(/\r?\n/);
    let headerIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i].trim();
      if (ln.includes("淨值日期") && ln.includes("最新淨值")) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx >= 0) {
      for (let i = headerIdx + 1; i < Math.min(lines.length, headerIdx + 6); i++) {
        const ln = lines[i].trim();
        const m = ln.match(/^(\d{4}\/\d{1,2}\/\d{1,2})\s+([\d.]+)([-+][\d.]+)?\s+([\d.]+)\s+([\d.]+)/);
        if (m) {
          const nav = Number(m[2]);
          if (!Number.isFinite(nav)) continue;
          return {
            name,
            code,
            dateStr: m[1],
            currencyLabel,
            navRaw: m[2],
            nav,
          };
        }
      }
    }

    const inline = text.match(/日期\s+淨值\s+(\d{1,2}\/\d{1,2})\s+([\d.]+)/);
    if (inline) {
      const nav = Number(inline[2]);
      if (Number.isFinite(nav)) {
        const y = new Date().getFullYear();
        const [mo, d] = inline[1].split("/");
        return {
          name,
          code,
          dateStr: `${y}/${mo.padStart(2, "0")}/${d.padStart(2, "0")}`,
          currencyLabel,
          navRaw: inline[2],
          nav,
        };
      }
    }
    return null;
  }

  function parseMoneyDjNavFromText(text, fundCode, rowNameHint) {
    const rows = parseMoneyDjMarkdownNavRows(text);
    const fromTable = pickMoneyDjNavRow(rows, fundCode, rowNameHint);
    if (fromTable) return fromTable;
    return parseMoneyDjSingleFundNav(text, fundCode, rowNameHint);
  }

  function pickMoneyDjNavRow(rows, fundCode, lineNameHint) {
    if (!rows?.length) return null;
    const codeU = fundCode ? String(fundCode).trim().toUpperCase() : "";
    if (codeU) {
      const exact = rows.filter((r) => r.code.toUpperCase() === codeU);
      if (exact.length >= 1) return exact[0];
    }
    const hint = String(lineNameHint ?? "").trim().replace(/\s+/g, "");
    if (hint) {
      let best = null;
      let bestLen = -1;
      for (const r of rows) {
        const n = r.name.replace(/\s+/g, "");
        if (n && n.includes(hint) && n.length > bestLen) {
          best = r;
          bestLen = n.length;
        }
      }
      if (best) return best;
    }
    if (rows.length === 1) return rows[0];
    return null;
  }

  function moneyDjDividendUrlFromCode(code) {
    const c = String(code ?? "").trim();
    if (!c) return "";
    return `${MONEYDJ_ORIGIN}/funddj/yp/funddividend.djhtm?a=${encodeURIComponent(c)}`;
  }

  /** 境外基金配息頁（發放日常為 N/A） */
  function moneyDjOverseasDividendUrlFromCode(code) {
    const c = String(code ?? "").trim();
    if (!c) return "";
    return `${MONEYDJ_ORIGIN}/funddj/yp/wb05.djhtm?a=${encodeURIComponent(c)}`;
  }

  /** 依代碼嘗試境內 funddividend 與境外 wb05 配息頁 */
  function moneyDjDividendTryUrlsFromCode(code) {
    const a = moneyDjDividendUrlFromCode(code);
    const b = moneyDjOverseasDividendUrlFromCode(code);
    return [a, b].filter((u, i, arr) => u && arr.indexOf(u) === i);
  }

  function parseMoneyDjMarkdownDistributionTable(text) {
    if (typeof text !== "string") return null;
    const lines = text.split(/\r?\n/);
    let headerCells = [];
    let headerLineIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i].trim();
      if (!ln.startsWith("|") || !ln.includes("每單位分配")) continue;
      headerCells = ln.split("|").map((c) => c.trim());
      if (headerCells.some((c) => c.includes("每單位分配"))) {
        headerLineIndex = i;
        break;
      }
    }
    if (headerLineIndex === -1) return null;
    const idxDist = headerCells.findIndex((c) => c.includes("每單位分配"));
    if (idxDist < 0) return null;
    const idxCurrency = headerCells.findIndex((c) => c.replace(/\s+/g, "") === "幣別");
    for (let j = headerLineIndex + 1; j < lines.length; j++) {
      const ln = lines[j].trim();
      if (!ln.startsWith("|")) break;
      const cells = ln.split("|").map((c) => c.trim());
      if (cells.length <= idxDist) continue;
      const distCell = cells[idxDist];
      if (!distCell || distCell.includes("---")) continue;
      const recordDate = (cells[1] ?? cells[0] ?? "").trim();
      if (!/^\d{4}\/\d{1,2}\/\d{1,2}/.test(recordDate)) continue;
      const perUnit = Number(String(distCell).replace(/,/g, ""));
      if (!Number.isFinite(perUnit)) continue;
      const cur =
        idxCurrency >= 0 && cells[idxCurrency] ? cells[idxCurrency].replace(/\s+/g, "") : "";
      return { perUnitRaw: String(distCell).replace(/,/g, ""), perUnit, currencyLabel: cur, recordDate };
    }
    return null;
  }

  /** 境內／境外配息頁常見之純文字表格（非 markdown | 格式；境外發放日可為 N/A） */
  function parseMoneyDjPlainTextDistributionTable(text) {
    if (typeof text !== "string") return null;
    const lines = text.split(/\r?\n/);
    let headerIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i].trim();
      if (ln.includes("每單位分配") && (ln.includes("配息基準") || ln.includes("除息"))) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx < 0) return null;
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const ln = lines[i].trim();
      if (!ln) continue;
      if (
        ln.startsWith("附註") ||
        ln.startsWith("*") ||
        ln.includes("年化配息率計算") ||
        ln.includes("無此基金配息")
      ) {
        break;
      }
      // 基準日 除息日 發放日(可 N/A) 狀態 每單位分配 年化配息率 幣別
      const m = ln.match(
        /^(\d{4}\/\d{1,2}\/\d{1,2})\s+(\d{4}\/\d{1,2}\/\d{1,2})\s+\S+\s+\S+\s+([\d.]+)\s+([\d.]+)(?:\s+(\S+))?/
      );
      if (!m) continue;
      const perUnit = Number(m[3]);
      if (!Number.isFinite(perUnit)) continue;
      return {
        perUnitRaw: m[3],
        perUnit,
        currencyLabel: (m[5] ?? "").replace(/\s+/g, ""),
        recordDate: m[1],
      };
    }
    return null;
  }

  function parseMoneyDjLatestPerUnitDistribution(text) {
    return parseMoneyDjMarkdownDistributionTable(text) || parseMoneyDjPlainTextDistributionTable(text);
  }

  async function fetchLatestDistributionFromUrl(url) {
    const text = await fetchMoneyDjPlainText(url);
    const div = parseMoneyDjLatestPerUnitDistribution(text);
    if (!div) {
      throw new Error("配息頁找不到「每單位分配金額」表格或尚無配息資料。");
    }
    return div;
  }

  async function fetchLatestDistributionFromCode(code) {
    const urls = moneyDjDividendTryUrlsFromCode(code);
    if (!urls.length) throw new Error("無基金代碼");
    let lastErr = null;
    for (const u of urls) {
      try {
        return await fetchLatestDistributionFromUrl(u);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("配息頁找不到「每單位分配金額」表格或尚無配息資料。");
  }

  function suggestMoneyDjDivUrl(navUrl, fundCode) {
    const c = String(fundCode ?? extractMoneyDjFundCode(navUrl) ?? "").trim();
    if (!c) return "";
    if (/yp010001|yp010000|wb05/i.test(String(navUrl ?? ""))) {
      return moneyDjOverseasDividendUrlFromCode(c);
    }
    return moneyDjDividendUrlFromCode(c);
  }

  async function fetchMoneyDjPlainText(url) {
    const normalized = normalizeMoneyDjAbsoluteUrl(url);
    if (!normalized) throw new Error("無網址");
    const readerUrl = `https://r.jina.ai/${normalized}`;
    const res = await fetch(readerUrl, { headers: { Accept: "text/plain" } });
    if (!res.ok) throw new Error(`讀取失敗 (${res.status})`);
    return await res.text();
  }

  async function resolveMoneyDjNavRow(userMoneyDjUrl, rowName) {
    const normalized = normalizeMoneyDjAbsoluteUrl(userMoneyDjUrl);
    if (!normalized) return null;
    const urlCode = extractMoneyDjFundCode(normalized);
    const tryUrls = [];
    const dividendPage = /\/funddj\/yp\/funddividend\.djhtm/i.test(normalized);
    if (!dividendPage) tryUrls.push(normalized);
    const pushFundCodeUrls = (code) => {
      if (!code) return;
      const q = encodeURIComponent(code.trim());
      const candidates = [
        `${MONEYDJ_ORIGIN}/funddj/ya/yp010001.djhtm?a=${q}`,
        `${MONEYDJ_ORIGIN}/funddj/ya/yp010000.djhtm?a=${q}`,
      ];
      for (const c of candidates) {
        if (!tryUrls.includes(c)) tryUrls.push(c);
      }
    };
    pushFundCodeUrls(urlCode);

    let lastRows = [];
    let lastText = "";
    for (const u of tryUrls) {
      let text = "";
      try {
        text = await fetchMoneyDjPlainText(u);
      } catch {
        continue;
      }
      lastText = text;
      lastRows = parseMoneyDjMarkdownNavRows(text);
      const picked = parseMoneyDjNavFromText(text, urlCode, rowName);
      if (picked) return { picked, usedUrl: u };
    }
    const pickedByName = pickMoneyDjNavRow(lastRows, "", rowName) || parseMoneyDjSingleFundNav(lastText, urlCode, rowName);
    if (pickedByName) return { picked: pickedByName, usedUrl: tryUrls[tryUrls.length - 1] ?? normalized };
    return null;
  }

  /** Shift+點擊 ↻ 時：依序輸入淨值頁與配息頁連結（配息可留空改自動查） */
  function promptMoneyDjUrlPair(tr) {
    const urlInput = tr.querySelector(".field-moneydj-url");
    const divUrlInput = tr.querySelector(".field-moneydj-div-url");
    if (!urlInput) return null;

    const navDefault = tr.dataset.moneydjNeedUrl === "1" ? "" : String(urlInput.value ?? "").trim();
    const navEntered = prompt(
      "MoneyDJ 淨值頁連結（例：yp010001.djhtm?a=… 或境外淨值表）：",
      navDefault
    );
    if (navEntered === null) return null;
    const navUrl = navEntered.trim();
    if (!navUrl) return null;
    urlInput.value = navUrl;
    delete tr.dataset.moneydjNeedUrl;

    const navCode = extractMoneyDjFundCode(navUrl);
    const divDefault =
      tr.dataset.moneydjNeedDivUrl === "1"
        ? ""
        : String(divUrlInput?.value ?? "").trim() || suggestMoneyDjDivUrl(navUrl, navCode);
    const divEntered = prompt(
      "MoneyDJ 配息頁連結（境內 funddividend／境外 wb05；留空則依基金代碼自動查）：",
      divDefault
    );
    if (divEntered === null) return null;
    if (divUrlInput) {
      divUrlInput.value = divEntered.trim();
      delete tr.dataset.moneydjNeedDivUrl;
    }
    return navUrl;
  }

  /** 國泰全委預設連結（月月泰利／ACT048）；各列可 Shift+點擊 ↻ 改存自訂網址 */
  const CATHAY_DEFAULT_NAV_URL =
    "https://fund.cathaylife.com.tw/w/wfv/wfv02.djhtm?a=ACT048";
  const CATHAY_DEFAULT_DIST_URL =
    "https://fund.cathaylife.com.tw/w/wfv/wfv04.djhtm?a=ACT048";

  function normalizeCathayAbsoluteUrl(input) {
    const s = String(input ?? "").trim();
    if (!s) return "";
    if (/^https?:\/\//i.test(s)) return s;
    if (s.startsWith("//")) return `https:${s}`;
    if (s.startsWith("/")) return `https://fund.cathaylife.com.tw${s}`;
    if (/fund\.cathaylife\.com\.tw/i.test(s)) return s.includes("://") ? s : `https://${s.replace(/^\/+/, "")}`;
    return s;
  }

  /** 由淨值頁（wfv02）推測撥回頁（wfv04），保留 ?a= 代碼 */
  function suggestCathayDistUrlFromNav(navUrl) {
    const s = normalizeCathayAbsoluteUrl(navUrl);
    if (!s) return CATHAY_DEFAULT_DIST_URL;
    if (/wfv02\.djhtm/i.test(s)) return s.replace(/wfv02\.djhtm/i, "wfv04.djhtm");
    if (/wfv04\.djhtm/i.test(s)) return s;
    const code = extractMoneyDjFundCode(s);
    if (code) {
      return `https://fund.cathaylife.com.tw/w/wfv/wfv04.djhtm?a=${encodeURIComponent(code)}`;
    }
    return CATHAY_DEFAULT_DIST_URL;
  }

  function resolveCathayNavUrl(tr) {
    const raw = tr.querySelector(".field-moneydj-url")?.value ?? "";
    return normalizeCathayAbsoluteUrl(raw) || CATHAY_DEFAULT_NAV_URL;
  }

  function resolveCathayDistUrl(tr) {
    const raw = tr.querySelector(".field-moneydj-div-url")?.value ?? "";
    const saved = normalizeCathayAbsoluteUrl(raw);
    if (saved) return saved;
    return suggestCathayDistUrlFromNav(resolveCathayNavUrl(tr));
  }

  /** Shift+點擊 ↻（年金）：設定國泰淨值頁與撥回頁連結 */
  function promptCathayUrlPair(tr) {
    const urlInput = tr.querySelector(".field-moneydj-url");
    const divUrlInput = tr.querySelector(".field-moneydj-div-url");
    if (!urlInput) return null;

    const navDefault =
      tr.dataset.cathayNeedUrl === "1"
        ? ""
        : String(urlInput.value ?? "").trim() || CATHAY_DEFAULT_NAV_URL;
    const navEntered = prompt(
      "國泰淨值頁連結（例：wfv02.djhtm?a=ACT048）：",
      navDefault
    );
    if (navEntered === null) return null;
    const navUrl = normalizeCathayAbsoluteUrl(navEntered.trim());
    if (!navUrl) return null;
    urlInput.value = navUrl;
    delete tr.dataset.cathayNeedUrl;

    const divDefault =
      tr.dataset.cathayNeedDivUrl === "1"
        ? ""
        : String(divUrlInput?.value ?? "").trim() || suggestCathayDistUrlFromNav(navUrl);
    const divEntered = prompt(
      "國泰撥回資產頁連結（例：wfv04.djhtm?a=ACT048；留空則依淨值頁代碼自動推估）：",
      divDefault
    );
    if (divEntered === null) return null;
    if (divUrlInput) {
      const distUrl = normalizeCathayAbsoluteUrl(divEntered.trim()) || suggestCathayDistUrlFromNav(navUrl);
      divUrlInput.value = distUrl;
      delete tr.dataset.cathayNeedDivUrl;
    }
    return navUrl;
  }

  async function fetchCathayPlainText(url) {
    const normalized = normalizeCathayAbsoluteUrl(url);
    if (!normalized) throw new Error("無網址");
    const readerUrl = `https://r.jina.ai/${normalized}`;
    const res = await fetch(readerUrl, { headers: { Accept: "text/plain" } });
    if (!res.ok) throw new Error(`讀取國泰頁面失敗 (${res.status})`);
    return await res.text();
  }

  /** 自國泰近30日淨值表解析最新淨值 */
  function parseCathayNavFromText(text) {
    if (typeof text !== "string" || !text) return null;
    const lines = text.split(/\r?\n/);
    let headerIdx = -1;
    let dateCol = -1;
    let navCol = -1;
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i].trim();
      if (!ln.startsWith("|")) continue;
      const parts = ln.split("|").map((p) => p.trim());
      const mid = parts.filter((_, idx) => idx > 0 && idx < parts.length - 1);
      const d = mid.findIndex((c) => c === "日期" || c.includes("日期"));
      const n = mid.findIndex((c) => c === "淨值" || (c.includes("淨值") && !c.includes("單位")));
      if (d >= 0 && n >= 0) {
        headerIdx = i;
        dateCol = d;
        navCol = n;
        break;
      }
    }
    if (headerIdx < 0 || navCol < 0) return null;

    for (let i = headerIdx + 1; i < lines.length; i++) {
      const ln = lines[i].trim();
      if (!ln.startsWith("|")) continue;
      if (/^\|[\s-:|]+\|$/.test(ln) || /^[\s|:/-]+$/.test(ln.replace(/\|/g, ""))) continue;
      const parts = ln.split("|").map((p) => p.trim());
      const mid = parts.filter((_, idx) => idx > 0 && idx < parts.length - 1);
      if (mid.length <= navCol) continue;
      const navRaw = String(mid[navCol] ?? "").replace(/,/g, "").trim();
      if (!/^[\d.+-]+$/.test(navRaw)) continue;
      const nav = Number(navRaw);
      if (!Number.isFinite(nav)) continue;
      const dateStr = dateCol >= 0 ? String(mid[dateCol] ?? "").trim() : "";
      return { navRaw, nav, dateStr };
    }
    return null;
  }

  /** 自國泰撥回資產狀況頁解析最新「撥回資產金額」 */
  function parseCathayDistributionFromText(text) {
    if (typeof text !== "string" || !text) return null;
    const lines = text.split(/\r?\n/);
    let headerIdx = -1;
    let amountCol = -1;
    let dateCol = -1;
    let currencyCol = -1;
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i].trim();
      if (!ln.startsWith("|") || !ln.includes("撥回資產金額")) continue;
      const parts = ln.split("|").map((p) => p.trim());
      const mid = parts.filter((_, idx) => idx > 0 && idx < parts.length - 1);
      amountCol = mid.findIndex((c) => c.includes("撥回資產金額"));
      dateCol = mid.findIndex((c) => c.includes("除息日"));
      currencyCol = mid.findIndex((c) => c.includes("幣別"));
      if (amountCol >= 0) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx < 0 || amountCol < 0) return null;

    for (let i = headerIdx + 1; i < lines.length; i++) {
      const ln = lines[i].trim();
      if (!ln.startsWith("|")) continue;
      if (/^\|[\s-:|]+\|$/.test(ln) || /^[\s|:/-]+$/.test(ln.replace(/\|/g, ""))) continue;
      const parts = ln.split("|").map((p) => p.trim());
      const mid = parts.filter((_, idx) => idx > 0 && idx < parts.length - 1);
      if (mid.length <= amountCol) continue;
      const amountRaw = String(mid[amountCol] ?? "").replace(/,/g, "").trim();
      if (!/^[\d.+-]+$/.test(amountRaw)) continue;
      const amount = Number(amountRaw);
      if (!Number.isFinite(amount)) continue;
      const dateStr = dateCol >= 0 ? String(mid[dateCol] ?? "").trim() : "";
      const currencyLabel =
        currencyCol >= 0 ? String(mid[currencyCol] ?? "").replace(/\s+/g, "") : "新台幣";
      return { perUnitRaw: amountRaw, perUnit: amount, dateStr, currencyLabel };
    }
    return null;
  }

  async function fetchCathayLatestNav(url) {
    const text = await fetchCathayPlainText(url);
    const parsed = parseCathayNavFromText(text);
    if (!parsed) throw new Error("無法解析國泰淨值頁之最新淨值。");
    return parsed;
  }

  async function fetchCathayLatestDistribution(url) {
    const text = await fetchCathayPlainText(url);
    const parsed = parseCathayDistributionFromText(text);
    if (!parsed) throw new Error("無法解析國泰撥回頁之「撥回資產金額」。");
    return parsed;
  }

  async function fetchCathayAnnuityForIncomeRow(tr, article, catId, forceUrlPrompt) {
    const urlInput = tr.querySelector(".field-moneydj-url");
    const divUrlInput = tr.querySelector(".field-moneydj-div-url");
    const btn = tr.querySelector(".btn-fetch-moneydj");
    if (!btn) return;

    const needUrlRetry = tr.dataset.cathayNeedUrl === "1";
    const needDivRetry = tr.dataset.cathayNeedDivUrl === "1";
    if (forceUrlPrompt || needUrlRetry || needDivRetry) {
      const paired = promptCathayUrlPair(tr);
      if (paired === null) return;
    }

    const navUrl = resolveCathayNavUrl(tr);
    const distUrl = resolveCathayDistUrl(tr);
    if (urlInput && !String(urlInput.value ?? "").trim()) urlInput.value = navUrl;
    if (divUrlInput && !String(divUrlInput.value ?? "").trim()) divUrlInput.value = distUrl;

    const prevLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = "…";
    try {
      const [navResult, distResult] = await Promise.allSettled([
        fetchCathayLatestNav(navUrl),
        fetchCathayLatestDistribution(distUrl),
      ]);
      if (navResult.status === "rejected" && distResult.status === "rejected") {
        throw new Error(
          `${navResult.reason?.message || navResult.reason}\n${distResult.reason?.message || distResult.reason}`
        );
      }
      const nav = navResult.status === "fulfilled" ? navResult.value : null;
      const dist = distResult.status === "fulfilled" ? distResult.value : null;
      const netInput = tr.querySelector(".field-net");
      const distInput = tr.querySelector(".field-dist");
      const curSel = tr.querySelector(".field-currency");
      const lines = [];
      if (nav) {
        if (netInput) netInput.value = formatNumericCellDisplay(nav.navRaw);
        const dateNote = nav.dateStr ? `（${nav.dateStr}）` : "";
        lines.push(`淨值已更新為 ${nav.navRaw}${dateNote}`);
      } else {
        lines.push(`淨值未更新：${navResult.reason?.message || navResult.reason}`);
        tr.dataset.cathayNeedUrl = "1";
      }
      if (dist) {
        if (distInput) distInput.value = formatNumericCellDisplay(dist.perUnitRaw);
        const appCur = moneyDjCurrencyLabelToAppCode(dist.currencyLabel);
        if (appCur && curSel) curSel.value = appCur;
        const dateNote = dist.dateStr ? `（除息日 ${dist.dateStr}）` : "";
        lines.push(`每單位分配已更新為 ${dist.perUnitRaw}${dateNote}`);
      } else {
        lines.push(`每單位分配未更新：${distResult.reason?.message || distResult.reason}`);
        tr.dataset.cathayNeedDivUrl = "1";
      }
      if (nav) delete tr.dataset.cathayNeedUrl;
      if (dist) delete tr.dataset.cathayNeedDivUrl;
      syncIncomeCategoryFromDom(article, catId);
      refreshIncomeRowVisual(tr, incomeItemFromState(catId, tr.dataset.id));
      saveState();
      alert(lines.join("\n"));
    } catch (e) {
      tr.dataset.cathayNeedUrl = "1";
      const msg = e?.message || String(e);
      if (confirm(`${msg}\n\n是否立即重新設定國泰淨值／撥回連結（Shift+點擊 ↻）？`)) {
        btn.textContent = prevLabel;
        btn.disabled = false;
        return fetchCathayAnnuityForIncomeRow(tr, article, catId, true);
      }
      alert(msg);
    } finally {
      btn.textContent = prevLabel;
      btn.disabled = false;
    }
  }

  async function fetchMoneyDjForIncomeRow(tr, article, catId, forceUrlPrompt) {
    const prev = incomeItemFromState(catId, tr.dataset.id);
    const item = collectIncomeRow(tr, prev);
    if (effectiveIncomeKindFromItem(item) !== "fund") {
      alert("僅適用細項為「基金」或「年金」（名稱含對應關鍵字／或資料已標為基金）。");
      return;
    }
    if (nameImpliesAnnuity(item.name)) {
      return fetchCathayAnnuityForIncomeRow(tr, article, catId, forceUrlPrompt);
    }
    const urlInput = tr.querySelector(".field-moneydj-url");
    const btn = tr.querySelector(".btn-fetch-moneydj");
    if (!urlInput || !btn) return;
    let rawUrl = String(urlInput.value ?? "").trim();
    const rowName = tr.querySelector(".field-name")?.value?.trim() ?? "";
    const needUrlRetry = tr.dataset.moneydjNeedUrl === "1";
    const needDivRetry = tr.dataset.moneydjNeedDivUrl === "1";

    if (forceUrlPrompt) {
      const paired = promptMoneyDjUrlPair(tr);
      if (paired === null) return;
      rawUrl = paired;
    } else if (!rawUrl || needUrlRetry || needDivRetry) {
      if (needDivRetry && rawUrl) {
        const divUrlInput = tr.querySelector(".field-moneydj-div-url");
        const navCode = extractMoneyDjFundCode(rawUrl);
        const divDefault = suggestMoneyDjDivUrl(rawUrl, navCode);
        const divEntered = prompt(
          "MoneyDJ 配息頁連結（留空則依基金代碼自動查）：",
          divDefault
        );
        if (divEntered === null) return;
        if (divUrlInput) {
          divUrlInput.value = divEntered.trim();
          delete tr.dataset.moneydjNeedDivUrl;
        }
      } else {
        const entered = prompt(
          "請貼上 MoneyDJ 淨值頁連結（Shift+點擊 ↻ 可同時設定配息連結）：",
          needUrlRetry ? "" : rawUrl
        );
        if (entered === null) return;
        rawUrl = String(entered).trim();
        if (!rawUrl) return;
        urlInput.value = rawUrl;
        delete tr.dataset.moneydjNeedUrl;
      }
    }
    if (!extractMoneyDjFundCode(rawUrl) && !rowName) {
      alert("若連結不含 ?a= 代碼（例如整頁淨值表），請填寫細項名稱以利比對基金列。");
      return;
    }

    const prevLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = "…";

    const finish = () => {
      btn.textContent = prevLabel;
      btn.disabled = false;
    };

    try {
      const urlCode = extractMoneyDjFundCode(rawUrl);
      const navResolved = await resolveMoneyDjNavRow(rawUrl, rowName);
      if (!navResolved?.picked) {
        throw new Error("找不到對應淨值列（請確認連結、?a= 代碼或細項名稱與表中基金名稱相符）。");
      }
      const { picked } = navResolved;
      const netInput = tr.querySelector(".field-net");
      const distInput = tr.querySelector(".field-dist");
      const curSel = tr.querySelector(".field-currency");
      if (netInput) netInput.value = formatNumericCellDisplay(picked.navRaw);
      const appCur = moneyDjCurrencyLabelToAppCode(picked.currencyLabel);
      if (appCur && curSel) curSel.value = appCur;

      const lines = [`淨值已更新（${picked.dateStr || "—"}）`];
      const effCode = picked.code || urlCode;
      const divUrlInput = tr.querySelector(".field-moneydj-div-url");
      const savedDivUrl = divUrlInput?.value?.trim() ?? "";
      let divFetched = false;
      if (savedDivUrl) {
        try {
          const div = await fetchLatestDistributionFromUrl(savedDivUrl);
          if (distInput) distInput.value = formatNumericCellDisplay(div.perUnitRaw);
          const divCur = moneyDjCurrencyLabelToAppCode(div.currencyLabel);
          if (divCur && curSel) curSel.value = divCur;
          const dateNote = div.recordDate ? `，基準日 ${div.recordDate}` : "";
          lines.push(`已自配息頁填入每單位分配 ${div.perUnitRaw}${dateNote}。`);
          divFetched = true;
        } catch {
          lines.push("已存配息頁讀取失敗，改依基金代碼自動查配息。");
        }
      }
      if (!divFetched && effCode) {
        try {
          const div = await fetchLatestDistributionFromCode(effCode);
          if (distInput) distInput.value = formatNumericCellDisplay(div.perUnitRaw);
          const divCur = moneyDjCurrencyLabelToAppCode(div.currencyLabel);
          if (divCur && curSel) curSel.value = divCur;
          const dateNote = div.recordDate ? `，基準日 ${div.recordDate}` : "";
          lines.push(`已填入最新每單位分配 ${div.perUnitRaw}${dateNote}。`);
        } catch {
          lines.push("配息頁無可解析之配息列（Shift+點擊 ↻ 可設定 wb05／funddividend 配息連結）。");
        }
      }
      delete tr.dataset.moneydjNeedUrl;
      delete tr.dataset.moneydjNeedDivUrl;
      syncIncomeCategoryFromDom(article, catId);
      refreshIncomeRowVisual(tr, incomeItemFromState(catId, tr.dataset.id));
      saveState();
      alert(lines.join("\n"));
    } catch (e) {
      tr.dataset.moneydjNeedUrl = "1";
      urlInput.value = "";
      syncIncomeCategoryFromDom(article, catId);
      saveState();
      const msg = e?.message || String(e);
      if (confirm(`${msg}\n\n是否立即重新輸入連結（Shift+點擊 ↻ 可同時設定淨值與配息）？`)) {
        finish();
        return fetchMoneyDjForIncomeRow(tr, article, catId, true);
      }
      alert(msg);
    } finally {
      finish();
    }
  }

  const HSBC_TW_FOREX_PAGE = "https://www.hsbc.com.tw/currency-rates/";

  /** 讀取公開轉載之頁面內容並解析美金電匯即期買／賣，回傳中價。格式變動時可能失敗。 */
  function parseHsbcUsdSpotMidFromFetchedText(text) {
    const row =
      typeof text === "string" &&
      text.match(/\|\s*US Dollar\s*\(USD\)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|/im);
    if (!row) return null;
    const buy = parseFloat(row[1]);
    const sell = parseFloat(row[2]);
    if (!Number.isFinite(buy) || !Number.isFinite(sell)) return null;
    return { buy, sell, mid: (buy + sell) / 2 };
  }

  function extractHsbcTwUpdateSnippet(text) {
    if (typeof text !== "string") return "";
    const m =
      text.match(/^Latest update:\s*(.+)$/im) ||
      text.match(/^匯率更新日期為[：:]\s*(.+)$/im);
    return m ? m[1].trim().replace(/\s+/g, " ") : "";
  }

  /** 將牌價頁標示時間改為 yyyy/mm/dd（保留時間為 HH:mm）。斜線數字視為「日／月／年」（台版頁常見）。 */
  function formatHsbcTwUpdateForDisplay(raw) {
    if (!raw || typeof raw !== "string") return "";
    const s = raw.trim().replace(/\s+/g, " ");
    const zh = s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日(?:\s*(\d{1,2}):(\d{2}))?/);
    if (zh) {
      const pad = (n) => String(n).padStart(2, "0");
      let y = parseInt(zh[1], 10);
      const mo = parseInt(zh[2], 10);
      const d = parseInt(zh[3], 10);
      const datePart = `${y}/${pad(mo)}/${pad(d)}`;
      if (zh[4] != null && zh[5] != null)
        return `${datePart} ${pad(parseInt(zh[4], 10))}:${zh[5]}`;
      return datePart;
    }
    const slash = s.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:,?[ \u00A0]+(\d{1,2}):(\d{2}))?$/
    );
    if (!slash) return s;
    let day = parseInt(slash[1], 10);
    let month = parseInt(slash[2], 10);
    let year = parseInt(slash[3], 10);
    if (year < 100) year += year >= 69 ? 1900 : 2000;
    if (month > 12 && day <= 12) {
      const t = month;
      month = day;
      day = t;
    } else if (day > 12 && month <= 12) {
      /* already day/month */
    }
    const pad2 = (n) => String(n).padStart(2, "0");
    const datePart = `${year}/${pad2(month)}/${pad2(day)}`;
    if (slash[4] != null && slash[5] != null) {
      return `${datePart} ${pad2(parseInt(slash[4], 10))}:${slash[5]}`;
    }
    return datePart;
  }

  async function fetchAndApplyHsbcTwSpotMid() {
    const btn = els.btnFetchHsbcFx;
    const status = els.fxFetchStatus;
    if (!btn || !status) return;
    btn.disabled = true;
    status.textContent = "讀取滙豐台灣牌價中…";
    try {
      const readerUrl =
        `https://r.jina.ai/${HSBC_TW_FOREX_PAGE}`;
      const res = await fetch(readerUrl, { headers: { Accept: "text/plain" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const parsed = parseHsbcUsdSpotMidFromFetchedText(text);
      if (!parsed) throw new Error("parse");
      const rateStr = parsed.mid.toFixed(4);
      state.usdToTwdRate = rateStr;
      state.usdToTwdRateUpdatedAt = new Date().toISOString();
      if (els.fxUsdTwd) els.fxUsdTwd.value = formatThousandsNumber(Number(rateStr));
      saveState();
      const updRaw = extractHsbcTwUpdateSnippet(text);
      const upd = updRaw ? formatHsbcTwUpdateForDisplay(updRaw) : "";
      const ratePretty = formatThousandsNumber(Number(rateStr));
      status.textContent = upd
        ? `已套用即期中價 ${ratePretty}（來源標示時間：${upd}）`
        : `已套用即期中價 ${ratePretty}`;
    } catch {
      status.textContent =
        "自動載入失敗（網路或跨網域限制）。請手動輸入，或以本機伺服器經 http:// 開啟後再試。";
    } finally {
      btn.disabled = false;
    }
  }

  function syncAllCategoriesFromDom() {
    document.querySelectorAll(".category-card").forEach((card) => {
      const kind = card.dataset.kind;
      const id = card.dataset.categoryId;
      if (kind === "income") syncIncomeCategoryFromDom(card, id);
      else syncExpenseCategoryFromDom(card, id);
    });
  }

  function formatMoney(currency, n, fractionDigits) {
    let min;
    let max;
    if (fractionDigits != null) {
      min = max = fractionDigits;
    } else if (currency === "USD") {
      min = 0;
      max = 2;
    } else {
      min = 0;
      max = 0;
    }
    const opts =
      currency === "USD"
        ? {
            style: "currency",
            currency: "USD",
            useGrouping: true,
            minimumFractionDigits: min,
            maximumFractionDigits: max,
          }
        : {
            style: "currency",
            currency: "TWD",
            useGrouping: true,
            minimumFractionDigits: min,
            maximumFractionDigits: max,
          };
    try {
      return new Intl.NumberFormat("zh-TW", opts).format(n);
    } catch {
      return `${currency} ${n}`;
    }
  }

  function renderSummary() {
    const { twd, usd } = computeTotals();
    els.summaryGrid.innerHTML = "";

    const blocks = [
      { code: "TWD", label: "台幣", data: twd },
      { code: "USD", label: "美元", data: usd },
    ];

    const fxRate = parseNum(state.usdToTwdRate);

    blocks.forEach(({ code, label, data }) => {
      const netMonthly = data.incomeMonthly - data.expense;
      const primary = formatMoney(code, netMonthly, code === "USD" ? 2 : undefined);
      let fxBlock = "";
      if (code === "USD") {
        if (fxRate > 0) {
          const twdEq = netMonthly * fxRate;
          fxBlock = `<span class="available-fx">約 ${formatMoney("TWD", twdEq)}</span>`;
        } else {
          fxBlock = `<span class="available-fx muted">填寫上方匯率後顯示約當台幣</span>`;
        }
      }
      const card = document.createElement("div");
      card.className = "summary-card";
      card.innerHTML = `
        <h3>${label}</h3>
        <div class="summary-rows">
          <div class="row"><span class="label">收入（月收入合計）</span><span class="mono">${formatMoney(code, data.incomeMonthly, code === "USD" ? 2 : undefined)}</span></div>
          <div class="row"><span class="label">收入（年收入合計）</span><span class="mono">${formatMoney(code, data.incomeAnnual)}</span></div>
          <div class="row"><span class="label">支出（折算每月合計）</span><span class="mono">${formatMoney(code, data.expense, code === "USD" ? 2 : undefined)}</span></div>
          <div class="row row-available"><span class="label">每月可用資金（月收入 − 支出）</span><div class="value-col"><span class="mono net ${netMonthly >= 0 ? "positive" : "negative"}">${primary}</span>${fxBlock}</div></div>
        </div>
      `;
      els.summaryGrid.appendChild(card);
    });

    const availTwd = twd.incomeMonthly - twd.expense;
    const availUsd = usd.incomeMonthly - usd.expense;
    let totalCombinedHtml = "";
    if (fxRate > 0) {
      const sumTwd = availTwd + availUsd * fxRate;
      totalCombinedHtml = `<span class="mono net ${sumTwd >= 0 ? "positive" : "negative"}">${formatMoney("TWD", sumTwd)}</span>`;
    } else {
      totalCombinedHtml = `<span class="muted">請於上方填寫美元兌台幣匯率後顯示</span>`;
    }

    const comboCard = document.createElement("div");
    comboCard.className = "summary-card summary-card-combined";
    comboCard.innerHTML = `
      <h3 class="combined-title">每月可用資金</h3>
      <div class="summary-rows summary-rows-stack">
        <div class="row-combined"><span class="label">台幣：</span><span class="mono net ${availTwd >= 0 ? "positive" : "negative"}">${formatMoney("TWD", availTwd)}</span></div>
        <div class="row-combined"><span class="label">美元：</span><span class="mono net ${availUsd >= 0 ? "positive" : "negative"}">${formatMoney("USD", availUsd, 2)}</span></div>
        <div class="row-combined row-combined-total"><span class="label">共計：</span>${totalCombinedHtml}</div>
      </div>
    `;
    els.summaryGrid.appendChild(comboCard);
  }

  function renderAll() {
    els.incomeCategories.innerHTML = "";
    els.expenseCategories.innerHTML = "";

    if (!state.incomeCategories.length) {
      els.incomeCategories.innerHTML = '<p class="empty-hint">尚無收入類別，請按「新增收入類別」。</p>';
    } else {
      state.incomeCategories.forEach((cat) => {
        els.incomeCategories.appendChild(renderIncomeCategory(cat));
      });
    }

    if (!state.expenseCategories.length) {
      els.expenseCategories.innerHTML = '<p class="empty-hint">尚無支出類別，請按「新增支出類別」。</p>';
    } else {
      state.expenseCategories.forEach((cat) => {
        els.expenseCategories.appendChild(renderExpenseCategory(cat));
      });
    }

    renderSummary();
    applyFcnAutofillToAllInvestmentRows({ onlyIfEmpty: true });
  }

  els.btnAddIncomeCategory.addEventListener("click", () => {
    document.querySelectorAll(".category-card[data-kind='income']").forEach((card) => {
      const id = card.dataset.categoryId;
      syncIncomeCategoryFromDom(card, id);
    });
    const cat = emptyIncomeCategory();
    state.incomeCategories.push(cat);
    saveState();
    renderAll();
  });

  els.btnAddExpenseCategory.addEventListener("click", () => {
    document.querySelectorAll(".category-card[data-kind='expense']").forEach((card) => {
      const id = card.dataset.categoryId;
      syncExpenseCategoryFromDom(card, id);
    });
    const cat = emptyExpenseCategory();
    state.expenseCategories.push(cat);
    saveState();
    renderAll();
  });

  els.btnExport.addEventListener("click", () => {
    syncAllCategoriesFromDom();
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `asset-stats-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    saveState();
  });

  els.inputImport.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || typeof parsed !== "object") throw new Error("格式錯誤");
        const prevLookup = state.fcnLookup;
        state = {
          incomeCategories: Array.isArray(parsed.incomeCategories) ? parsed.incomeCategories : [],
          expenseCategories: Array.isArray(parsed.expenseCategories) ? parsed.expenseCategories : [],
          usdToTwdRate:
            parsed.usdToTwdRate != null && String(parsed.usdToTwdRate).trim() !== ""
              ? normalizeNumericInputString(String(parsed.usdToTwdRate))
              : "",
          usdToTwdRateUpdatedAt:
            typeof parsed.usdToTwdRateUpdatedAt === "string" ? parsed.usdToTwdRateUpdatedAt : "",
          fcnLookup: Array.isArray(parsed.fcnLookup) ? parsed.fcnLookup : prevLookup,
        };
        refreshFxUsdTwdInputFromState();
        renderCachedFxUpdatedAt();
        saveState();
        renderAll();
      } catch {
        alert("匯入失敗：請確認為本程式匯出的 JSON。");
      }
      e.target.value = "";
    };
    reader.readAsText(file, "UTF-8");
  });

  els.btnReset.addEventListener("click", () => {
    if (!confirm("將清空所有本機資料且無法復原（除非已備份）。確定？")) return;
    state = defaultState();
    localStorage.removeItem(STORAGE_KEY);
    if (els.fxUsdTwd) els.fxUsdTwd.value = "";
    if (els.fxFetchStatus) els.fxFetchStatus.textContent = "";
    renderAll();
  });

  bindThousandsInputs(document.querySelector(".main"), expenseThousandsFormatOverride);

  if (els.fxUsdTwd) {
    refreshFxUsdTwdInputFromState();
    renderCachedFxUpdatedAt();
    els.fxUsdTwd.addEventListener("input", () => {
      state.usdToTwdRate = normalizeNumericInputString(els.fxUsdTwd.value);
      state.usdToTwdRateUpdatedAt = "";
      if (els.fxFetchStatus) els.fxFetchStatus.textContent = "";
      saveState();
    });
  }

  if (els.btnFetchHsbcFx) {
    els.btnFetchHsbcFx.addEventListener("click", () => {
      fetchAndApplyHsbcTwSpotMid();
    });
  }

  window.addEventListener("pageshow", () => {
    refreshFcnLookupFromStorage();
    applyFcnAutofillToAllInvestmentRows({ onlyIfEmpty: true });
  });

  window.addEventListener("storage", (e) => {
    if (e.key !== FCN_STORAGE_KEY && e.key !== STORAGE_KEY) return;
    refreshFcnLookupFromStorage();
    applyFcnAutofillToAllInvestmentRows({ onlyIfEmpty: true });
  });

  refreshFcnLookupFromStorage();
  renderAll();
})();
