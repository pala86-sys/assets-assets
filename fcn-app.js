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
  /** fcn-app.js 既有程式碼慣用 stripNumericish 這個名稱，維持別名以減少改動範圍 */
  const stripNumericish = normalizeNumericInputString;

  const FCN_STORAGE_KEY = "fcn-sheet-v1";
  const LEGACY_ASSET_KEY = "asset-stats-v1";
  const FCN_MIN_STOCKS = 1;
  /** 比價日欄位最多可存幾格（與「期間（月）」上限一致） */
  const MAX_VALUATION_STORAGE = 36;
  const JINA_PREFIX = "https://r.jina.ai/";
  /** 快取歷史日線區間查詢，避免同一標的／區間重複打 API */
  const historicDailyBarsCache = new Map();

  function normalizeFcnDateStr(v) {
    const s = String(v ?? "").trim();
    if (!s) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (!m) return "";
    const y = m[1];
    const mo = String(Math.min(12, Math.max(1, parseInt(m[2], 10)))).padStart(2, "0");
    const d = String(Math.min(31, Math.max(1, parseInt(m[3], 10)))).padStart(2, "0");
    return `${y}-${mo}-${d}`;
  }

  /** 內部 yyyy-mm-dd → 畫面顯示 yyyy/mm/dd */
  function formatFcnDateSlashDisplay(ymd) {
    const s = normalizeFcnDateStr(ymd);
    if (!s) return "";
    const [y, mo, d] = s.split("-");
    return `${y}/${mo}/${d}`;
  }

  /** 自初次比價日起，每月遞推 n 次比價日（供 KO 歷史比對） */
  function addMonthsToYmd(ymd, months) {
    const s = normalizeFcnDateStr(ymd);
    if (!s) return "";
    const [y, mo, d] = s.split("-").map(Number);
    const dt = new Date(y, mo - 1 + months, d);
    const yy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const dd = String(dt.getDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
  }

  function buildValuationDatesFromFirst(firstYmd, slotCount) {
    const first = normalizeFcnDateStr(firstYmd);
    const arr = [];
    for (let i = 0; i < slotCount; i += 1) {
      if (!first) arr.push("");
      else arr.push(i === 0 ? first : addMonthsToYmd(first, i));
    }
    while (arr.length < MAX_VALUATION_STORAGE) arr.push("");
    return arr.slice(0, MAX_VALUATION_STORAGE);
  }

  function emptyFcnStockItem() {
    return {
      id: uid(),
      symbol: "",
      initialPrice: "",
      currentPrice: "",
      koEverMet: false,
      kiEverMet: false,
      koMetDate: "",
      kiMetDate: "",
    };
  }

  function emptyComboFields() {
    return {
      sheetTitle: "",
      valuationDates: (() => {
        const a = [];
        while (a.length < MAX_VALUATION_STORAGE) a.push("");
        return a.slice(0, MAX_VALUATION_STORAGE);
      })(),
      annualRatePct: "",
      periodMonths: "12",
      investedCapital: "",
      koPct: "100",
      kiPct: "65",
      strikePct: "65",
      stocks: [emptyFcnStockItem()],
    };
  }

  function emptyCombo() {
    return { id: uid(), ...emptyComboFields() };
  }

  function defaultComboFields() {
    return {
      sheetTitle: "GA56",
      valuationDates: (() => {
        const a = ["2026-06-08"];
        while (a.length < MAX_VALUATION_STORAGE) a.push("");
        return a.slice(0, MAX_VALUATION_STORAGE);
      })(),
      annualRatePct: "16.16",
      periodMonths: "12",
      investedCapital: "100000",
      koPct: "100",
      kiPct: "65",
      strikePct: "65",
      stocks: [
        { id: "fcn-stock-1", symbol: "TSM", initialPrice: "393.83", currentPrice: "", koEverMet: false, kiEverMet: false },
        { id: "fcn-stock-2", symbol: "NVDA", initialPrice: "209.25", currentPrice: "", koEverMet: false, kiEverMet: false },
        { id: "fcn-stock-3", symbol: "MU", initialPrice: "518.46", currentPrice: "", koEverMet: false, kiEverMet: false },
      ],
    };
  }

  function defaultCombo() {
    return { id: uid(), ...defaultComboFields() };
  }

  function defaultAppState() {
    const c = defaultCombo();
    return { version: 2, activeComboId: c.id, combos: [c] };
  }

  function normalizeValuationDates(raw) {
    let arr = Array.isArray(raw?.valuationDates)
      ? raw.valuationDates.map((d) => normalizeFcnDateStr(d) || "")
      : [];
    while (arr.length < MAX_VALUATION_STORAGE) arr.push("");
    arr = arr.slice(0, MAX_VALUATION_STORAGE);
    const legacy = raw && !Array.isArray(raw.valuationDates) && raw.valuationDate;
    if (legacy && !arr[0]) arr[0] = normalizeFcnDateStr(raw.valuationDate) || "";
    return arr;
  }

  function normalizeCombo(raw) {
    const d = defaultComboFields();
    if (!raw || typeof raw !== "object") return { id: uid(), ...d };
    let stocks = Array.isArray(raw.stocks)
      ? raw.stocks.map((s, i) => ({
          id: typeof s?.id === "string" && s.id ? s.id : `fcn-stock-${i + 1}`,
          symbol: String(s?.symbol ?? "").slice(0, 24),
          initialPrice: stripNumericish(s?.initialPrice ?? ""),
          currentPrice: stripNumericish(s?.currentPrice ?? ""),
          koEverMet: !!s?.koEverMet,
          kiEverMet: !!s?.kiEverMet,
          koMetDate: normalizeFcnDateStr(s?.koMetDate ?? ""),
          kiMetDate: normalizeFcnDateStr(s?.kiMetDate ?? ""),
        }))
      : [];
    let pad = 0;
    while (stocks.length < FCN_MIN_STOCKS) {
      pad += 1;
      stocks.push({
        id: `fcn-pad-${Date.now()}-${pad}`,
        symbol: "",
        initialPrice: "",
        currentPrice: "",
        koEverMet: false,
        kiEverMet: false,
        koMetDate: "",
        kiMetDate: "",
      });
    }
    const pctOr = (v, fb) => {
      const n = Number(stripNumericish(String(v ?? "")));
      if (!Number.isFinite(n) || n <= 0) return fb;
      return String(n);
    };
    return {
      id: typeof raw.id === "string" && raw.id ? raw.id : uid(),
      sheetTitle: (String(raw.sheetTitle ?? d.sheetTitle).trim().slice(0, 32) || d.sheetTitle),
      valuationDates: normalizeValuationDates(raw),
      annualRatePct: stripNumericish(raw.annualRatePct ?? "") || d.annualRatePct,
      periodMonths: stripNumericish(raw.periodMonths ?? "") || d.periodMonths,
      investedCapital: stripNumericish(raw.investedCapital ?? "") || d.investedCapital,
      koPct: pctOr(raw.koPct, d.koPct),
      kiPct: pctOr(raw.kiPct, d.kiPct),
      strikePct: pctOr(raw.strikePct, d.strikePct),
      stocks,
    };
  }

  function normalizeAppState(parsed) {
    if (!parsed || typeof parsed !== "object") return defaultAppState();
    if (Array.isArray(parsed.combos) && parsed.combos.length) {
      const combos = parsed.combos.map((c) => normalizeCombo(c));
      let activeComboId =
        typeof parsed.activeComboId === "string" && combos.some((c) => c.id === parsed.activeComboId)
          ? parsed.activeComboId
          : combos[0].id;
      return { version: 2, activeComboId, combos };
    }
    /** 舊版：單一試算表物件 */
    if (Array.isArray(parsed.stocks)) {
      const c = normalizeCombo(parsed);
      return { version: 2, activeComboId: c.id, combos: [c] };
    }
    return defaultAppState();
  }

  function migrateFromLegacyIfEmpty() {
    try {
      if (localStorage.getItem(FCN_STORAGE_KEY)) return;
      const raw = localStorage.getItem(LEGACY_ASSET_KEY);
      if (!raw) return;
      const p = JSON.parse(raw);
      if (p?.fcn && typeof p.fcn === "object") {
        localStorage.setItem(FCN_STORAGE_KEY, JSON.stringify(normalizeAppState(p.fcn)));
      }
    } catch {
      /* ignore */
    }
  }

  function loadState() {
    migrateFromLegacyIfEmpty();
    try {
      const raw = localStorage.getItem(FCN_STORAGE_KEY);
      if (!raw) return defaultAppState();
      const parsed = JSON.parse(raw);
      return normalizeAppState(parsed);
    } catch {
      return defaultAppState();
    }
  }

  function saveState() {
    localStorage.setItem(FCN_STORAGE_KEY, JSON.stringify(state));
    mirrorFcnLookupForAssetPage(state);
  }

  /** 同步 FCN 組合摘要至資產統計頁 localStorage，供跨頁／重新整理後帶入投入資金與年利率 */
  function mirrorFcnLookupForAssetPage(fcnState) {
    try {
      const key = LEGACY_ASSET_KEY;
      let asset = {};
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") asset = parsed;
      }
      asset.fcnLookup = (fcnState?.combos || [])
        .map((c) => ({
          sheetTitle: String(c?.sheetTitle ?? "").trim(),
          investedCapital: stripNumericish(String(c?.investedCapital ?? "")),
          annualRatePct: stripNumericish(String(c?.annualRatePct ?? "")),
        }))
        .filter((c) => c.sheetTitle);
      localStorage.setItem(key, JSON.stringify(asset));
    } catch {
      /* ignore */
    }
  }

  let state = loadState();

  const els = {
    panelFcn: document.getElementById("panel-fcn"),
    fcnStockTbody: document.getElementById("fcn-stock-rows"),
    fcnSheetTitle: document.getElementById("fcn-sheet-title"),
    fcnAnnualRate: document.getElementById("fcn-annual-rate"),
    fcnAddStock: document.getElementById("fcn-add-stock"),
    fcnRemoveStock: document.getElementById("fcn-remove-last-stock"),
    fcnPctKo: document.getElementById("fcn-pct-ko"),
    fcnPctKi: document.getElementById("fcn-pct-ki"),
    fcnPctStrike: document.getElementById("fcn-pct-strike"),
    btnExport: document.getElementById("fcn-btn-export"),
    inputImport: document.getElementById("fcn-input-import"),
    btnReset: document.getElementById("fcn-btn-reset"),
    btnFetchAll: document.getElementById("fcn-btn-fetch-all"),
    comboSelect: document.getElementById("fcn-combo-select"),
    btnAddCombo: document.getElementById("fcn-add-combo"),
    btnDelCombo: document.getElementById("fcn-del-combo"),
  };

  function getActiveCombo() {
    if (!state.combos?.length) {
      state = defaultAppState();
      saveState();
    }
    let c = state.combos.find((x) => x.id === state.activeComboId);
    if (!c) {
      state.activeComboId = state.combos[0].id;
      c = state.combos[0];
      saveState();
    }
    return c;
  }

  /** 畫面上比價日格數＝「期間（月）」之數值（四捨五入、1～上限） */
  function getValuationSlotCount(combo) {
    let m = parseNum(String(combo?.periodMonths ?? "").replace(/,/g, ""));
    if (!Number.isFinite(m) || m <= 0) m = 12;
    m = Math.round(m);
    return Math.min(MAX_VALUATION_STORAGE, Math.max(1, m));
  }

  function escapeHtmlAttr(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/'/g, "&#39;");
  }

  function formatFcnPriceFixed(n) {
    if (!Number.isFinite(n)) return "—";
    return new Intl.NumberFormat("zh-TW", {
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    }).format(n);
  }

  function formatFcnMonthlyInterest(n) {
    if (!Number.isFinite(n)) return "—";
    return new Intl.NumberFormat("zh-TW", {
      useGrouping: true,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  }

  function formatQuoteDisplay(n) {
    if (!Number.isFinite(n) || n <= 0) return "—";
    return new Intl.NumberFormat("zh-TW", {
      useGrouping: true,
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(n);
  }

  function normalizeSymbol(sym) {
    return String(sym ?? "")
      .trim()
      .replace(/\s+/g, "")
      .toUpperCase();
  }

  async function fetchYahooPrice(symbol) {
    const sym = normalizeSymbol(symbol);
    if (!sym) return { ok: false, error: "無代號" };
    const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=1d`;
    const readerUrl = JINA_PREFIX + chartUrl;
    const res = await fetch(readerUrl, { headers: { Accept: "text/plain" } });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const text = await res.text();
    const price = parseYahooPriceFromText(text);
    if (price == null || !Number.isFinite(price)) return { ok: false, error: "無法解析報價" };
    return { ok: true, price };
  }

  /** 自 jina 回傳文字擷取 Yahoo chart JSON（失敗則 null） */
  function extractYahooChartJson(text) {
    const start = typeof text === "string" ? text.indexOf('{"chart"') : -1;
    if (start < 0) return null;
    let depth = 0;
    for (let i = start; i < Math.min(text.length, start + 500000); i++) {
      const c = text[i];
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(start, i + 1));
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }

  function parseYahooPriceFromText(text) {
    const tryNum = (s) => {
      const n = Number(s);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const m1 = text.match(/"regularMarketPrice"\s*:\s*([\d.]+)/);
    if (m1) {
      const n = tryNum(m1[1]);
      if (n != null) return n;
    }
    const m2 = text.match(/"regularMarketPreviousClose"\s*:\s*([\d.]+)/);
    if (m2) {
      const n = tryNum(m2[1]);
      if (n != null) return n;
    }
    const j = extractYahooChartJson(text);
    if (j) {
      const r = j?.chart?.result?.[0];
      const meta = r?.meta;
      const p = meta?.regularMarketPrice ?? meta?.chartPreviousClose ?? meta?.previousClose;
      if (tryNum(p) != null) return tryNum(p);
      const closes = r?.indicators?.quote?.[0]?.close;
      if (Array.isArray(closes)) {
        for (let k = closes.length - 1; k >= 0; k--) {
          const v = closes[k];
          if (v != null && tryNum(v) != null) return tryNum(v);
        }
      }
    }
    return null;
  }

  /** K 線 UTC 曆日 yyyy-mm-dd（與比價日字串比較用；跨時區可能有 ±1 日誤差） */
  function ymdFromUtcTs(tsSec) {
    const u = new Date(tsSec * 1000);
    const y = u.getUTCFullYear();
    const mo = String(u.getUTCMonth() + 1).padStart(2, "0");
    const day = String(u.getUTCDate()).padStart(2, "0");
    return `${y}-${mo}-${day}`;
  }

  function extractTimestampCloseBars(j) {
    const r = j?.chart?.result?.[0];
    if (!r?.timestamp || !Array.isArray(r.timestamp)) return [];
    const closes = r?.indicators?.quote?.[0]?.close;
    if (!Array.isArray(closes)) return [];
    const out = [];
    for (let i = 0; i < r.timestamp.length; i++) {
      const c = closes[i];
      if (c == null) continue;
      const n = Number(c);
      if (!Number.isFinite(n) || n <= 0) continue;
      out.push({ ts: r.timestamp[i], close: n });
    }
    return out;
  }

  /** 取「曆日 ≤ targetYmd」之最後一根 K 收盤（處理週末／假日：比價日當日無交易則往前最近交易日） */
  function pickCloseOnOrBeforeYmd(bars, targetYmd) {
    let bestClose = null;
    let bestTs = -Infinity;
    for (const b of bars) {
      const ymd = ymdFromUtcTs(b.ts);
      if (ymd > targetYmd) continue;
      if (b.ts >= bestTs) {
        bestTs = b.ts;
        bestClose = b.close;
      }
    }
    return bestClose;
  }

  /** 查詢區間內每日收盤 K 線（經 jina 讀 Yahoo）；失敗回傳 [] */
  async function fetchYahooDailyBarsInRange(symbol, startYmd, endYmd) {
    const sym = normalizeSymbol(symbol);
    const start = normalizeFcnDateStr(startYmd);
    const end = normalizeFcnDateStr(endYmd);
    if (!sym || !start || !end || start > end) return [];
    const [y1, m1, d1] = start.split("-").map(Number);
    const [y2, m2, d2] = end.split("-").map(Number);
    const p1 = Math.floor(Date.UTC(y1, m1 - 1, d1, 0, 0, 0) / 1000) - 86400 * 5;
    const p2 = Math.floor(Date.UTC(y2, m2 - 1, d2, 23, 59, 59) / 1000) + 86400;
    const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${p1}&period2=${p2}&interval=1d`;
    const readerUrl = JINA_PREFIX + chartUrl;
    try {
      const res = await fetch(readerUrl, { headers: { Accept: "text/plain" } });
      if (!res.ok) return [];
      const text = await res.text();
      const j = extractYahooChartJson(text);
      if (!j) return [];
      return extractTimestampCloseBars(j)
        .map((b) => ({ ymd: ymdFromUtcTs(b.ts), close: b.close, ts: b.ts }))
        .filter((b) => b.ymd >= start && b.ymd <= end)
        .sort((a, b) => a.ts - b.ts);
    } catch {
      return [];
    }
  }

  function firstValuationYmd(combo) {
    return normalizeFcnDateStr((combo.valuationDates || [])[0]);
  }

  /** 最終比價日＝初次比價日 +（期間月數 − 1）月 */
  function finalValuationYmd(combo) {
    const slotCount = getValuationSlotCount(combo);
    const dates = buildValuationDatesFromFirst(firstValuationYmd(combo), slotCount);
    return normalizeFcnDateStr(dates[slotCount - 1] ?? "");
  }

  /** DOM 上的百分比輸入框只反映目前作用中的組合；非作用中組合一律改用該組合自己存的百分比，避免混用到別組合的門檻 */
  function isComboActiveInDom(combo) {
    return combo.id === state.activeComboId;
  }

  function kiFractionFromDom(combo) {
    const pctFrac = (inp, fb) => {
      const v = inp ? parseNum(normalizeNumericInputString(inp.value)) : 0;
      const base = v > 0 ? v : parseNum(fb);
      return base / 100;
    };
    return pctFrac(isComboActiveInDom(combo) ? els.fcnPctKi : null, combo.kiPct);
  }

  function strikeFractionFromDom(combo) {
    const pctFrac = (inp, fb) => {
      const v = inp ? parseNum(normalizeNumericInputString(inp.value)) : 0;
      const base = v > 0 ? v : parseNum(fb);
      return base / 100;
    };
    return pctFrac(isComboActiveInDom(combo) ? els.fcnPctStrike : null, combo.strikePct);
  }

  function closeOnOrBeforeFromBars(bars, targetYmd) {
    let best = null;
    for (const b of bars) {
      if (b.ymd > targetYmd) continue;
      if (!best || b.ts >= best.ts) best = b;
    }
    return best?.close ?? null;
  }

  /** 自初次比價日至最終比價日（或今日），逐日收盤價比對 KI，鎖定曾觸發之標的 */
  async function backfillKiEverMetThroughFinalValuation(combo) {
    if (!combo) return;
    const firstYmd = firstValuationYmd(combo);
    const finalYmd = finalValuationYmd(combo);
    if (!firstYmd || !finalYmd || !isValuationDateDone(firstYmd)) return;
    const today = todayYmdLocal();
    const endYmd = finalYmd <= today ? finalYmd : today;
    const kiFrac = kiFractionFromDom(combo);
    const rows = constituentStocksForKo(combo);
    const closeCutoffYmd = usConfirmedCloseCutoffYmd();
    let changed = false;
    for (const s of rows) {
      if (s.kiEverMet) continue;
      const init = parseNum(s.initialPrice);
      if (init <= 0) continue;
      const sym = String(s.symbol).trim();
      const cacheKey = `${normalizeSymbol(sym)}|${firstYmd}|${endYmd}|daily`;
      let bars = historicDailyBarsCache.get(cacheKey);
      if (bars === undefined) {
        bars = await fetchYahooDailyBarsInRange(sym, firstYmd, endYmd);
        historicDailyBarsCache.set(cacheKey, bars);
        await new Promise((r) => setTimeout(r, 400));
      }
      for (const b of bars) {
        if (b.ymd > finalYmd) continue;
        if (b.ymd > closeCutoffYmd) continue;
        if (b.close <= init * kiFrac) {
          s.kiEverMet = true;
          if (!s.kiMetDate) s.kiMetDate = b.ymd;
          changed = true;
          break;
        }
      }
    }
    if (changed) saveState();
  }

  async function fetchCloseOnFinalValuationDay(symbol, finalYmd, firstYmd) {
    const sym = normalizeSymbol(symbol);
    if (!sym || !finalYmd) return null;
    const start = firstYmd || finalYmd;
    const cacheKey = `${sym}|${start}|${finalYmd}|final`;
    let bars = historicDailyBarsCache.get(cacheKey);
    if (bars === undefined) {
      bars = await fetchYahooDailyBarsInRange(sym, start, finalYmd);
      historicDailyBarsCache.set(cacheKey, bars);
    }
    return closeOnOrBeforeFromBars(bars, finalYmd);
  }

  function formatFcnShares(n) {
    if (!Number.isFinite(n) || n <= 0) return "—";
    return new Intl.NumberFormat("zh-TW", {
      useGrouping: true,
      minimumFractionDigits: 0,
      maximumFractionDigits: 4,
    }).format(n);
  }

  function investedCapitalFromDom(combo) {
    const investedEl = document.getElementById("fcn-invested");
    return investedEl
      ? parseNum(normalizeNumericInputString(investedEl.value))
      : parseNum(combo.investedCapital);
  }

  /**
   * 到期最終比價日之試算結果（跌幅依最終比價日收盤；股數＝投入金額÷執行價）。
   * 一併附上配息（與 KI 無關，按已過期數照樣發放）＋本金或換股市值之總報酬試算。
   * 換股後市值以「目前股價」估算（非到期日收盤），會隨股價變動，僅供參考。
   */
  function buildFinalValuationOutcomeText(combo, finalClosesById) {
    const rows = constituentStocksForKo(combo);
    const invested = investedCapitalFromDom(combo);
    const strikeFrac = strikeFractionFromDom(combo);
    const finalYmd = finalValuationYmd(combo);
    const periods = Math.max(1, periodsElapsedByYmd(combo, finalYmd));
    const interestTotal = comboMonthlyInterestAmountFromDom(combo) * periods;
    const interestText = `已計息 ${periods} 期共 ${formatFcnMoney(interestTotal)}`;

    const triggered = rows.filter((s) => s.kiEverMet);
    if (!triggered.length) {
      if (!(invested > 0)) return "拿回本金";
      const total = invested + interestTotal;
      const returnPct = (total / invested - 1) * 100;
      return `拿回本金 ${formatFcnMoney(invested)}；${interestText}；總計 ${formatFcnMoney(total)}（總報酬率 ${formatPct2(returnPct)}）`;
    }
    let best = null;
    let bestDrop = -Infinity;
    for (const s of triggered) {
      const init = parseNum(s.initialPrice);
      const close = finalClosesById.get(s.id);
      if (init <= 0 || !Number.isFinite(close) || close <= 0) continue;
      const drop = (init - close) / init;
      if (drop > bestDrop) {
        bestDrop = drop;
        best = { stock: s, close };
      }
    }
    if (!best && triggered.length === 1) {
      best = { stock: triggered[0], close: null };
    }
    if (!best) return "KI 觸發（最終比價日收盤價待抓取）";
    const init = parseNum(best.stock.initialPrice);
    const strikePrice = init * strikeFrac;
    if (!(strikePrice > 0)) return "KI 觸發（執行價無法試算）";
    if (!(invested > 0)) {
      return `${String(best.stock.symbol).trim().toUpperCase()}（投入資金未填，無法試算股數）`;
    }
    const shares = invested / strikePrice;
    const sym = String(best.stock.symbol).trim().toUpperCase();
    const sharesText = `${sym} ${formatFcnShares(shares)} 股（${formatThousandsNumber(invested)} ÷ ${formatFcnPriceFixed(strikePrice)}）`;
    const curPrice = parseNum(best.stock.currentPrice);
    if (Number.isFinite(curPrice) && curPrice > 0) {
      const marketValue = shares * curPrice;
      const total = marketValue + interestTotal;
      const returnPct = (total / invested - 1) * 100;
      return `${sharesText}；${interestText}；估計市值 ${formatFcnMoney(marketValue)}（以目前股價 ${formatFcnPriceFixed(
        curPrice
      )} 估算，非保證）＋利息＝總計約 ${formatFcnMoney(total)}（估計總報酬率 ${formatPct2(returnPct)}）`;
    }
    return `${sharesText}；${interestText}（尚無目前股價可估算市值）`;
  }

  function refreshFinalValuationDateDisplay(combo) {
    const dateEl = document.getElementById("fcn-final-val-date");
    const outcomeEl = document.getElementById("fcn-final-val-outcome");
    if (!dateEl) return;
    const finalYmd = finalValuationYmd(combo);
    if (!finalYmd) {
      dateEl.textContent = "—";
      if (outcomeEl) {
        outcomeEl.textContent = "";
        outcomeEl.removeAttribute("title");
      }
      return;
    }
    dateEl.textContent = formatFcnDateSlashDisplay(finalYmd);
    if (!outcomeEl) return;
    if (!isValuationDateDone(finalYmd)) {
      outcomeEl.textContent = "";
      outcomeEl.removeAttribute("title");
      return;
    }
  }

  let finalOutcomeFetchToken = 0;
  let finalOutcomeTimer = null;

  function scheduleFinalValuationOutcomeRefresh(combo) {
    clearTimeout(finalOutcomeTimer);
    finalOutcomeTimer = setTimeout(() => {
      void refreshFinalValuationOutcomeAsync(combo);
    }, 600);
  }

  async function refreshFinalValuationOutcomeAsync(combo) {
    const outcomeEl = document.getElementById("fcn-final-val-outcome");
    if (!outcomeEl) return;
    const finalYmd = finalValuationYmd(combo);
    if (!finalYmd || !isValuationDateDone(finalYmd)) {
      outcomeEl.textContent = "";
      outcomeEl.removeAttribute("title");
      return;
    }
    const token = ++finalOutcomeFetchToken;
    outcomeEl.textContent = "試算中…";
    await backfillKiEverMetThroughFinalValuation(combo);
    const rows = constituentStocksForKo(combo);
    const firstYmd = firstValuationYmd(combo);
    const finalClosesById = new Map();
    for (const s of rows) {
      const close = await fetchCloseOnFinalValuationDay(String(s.symbol).trim(), finalYmd, firstYmd);
      if (close != null) finalClosesById.set(s.id, close);
      await new Promise((r) => setTimeout(r, 350));
    }
    if (token !== finalOutcomeFetchToken) return;
    const text = buildFinalValuationOutcomeText(combo, finalClosesById);
    outcomeEl.textContent = text;
    outcomeEl.setAttribute(
      "title",
      "最終比價日試算：期間內曾觸 KI 者依跌幅最大標的，股數＝投入金額÷執行價；均未觸 KI 則拿回本金。"
    );
  }

  /** 自初次比價日（含）至今日，逐日收盤價比對 KO，鎖定曾達標之標的 */
  async function backfillKoEverMetFromDailyClosesSinceFirstValuation(combo) {
    if (!combo) return;
    const firstYmd = firstValuationYmd(combo);
    if (!firstYmd || !isValuationDateDone(firstYmd)) return;
    const endYmd = todayYmdLocal();
    const koFrac = koFractionFromDom(combo);
    const rows = constituentStocksForKo(combo);
    const closeCutoffYmd = usConfirmedCloseCutoffYmd();
    let changed = false;
    for (const s of rows) {
      if (s.koEverMet) continue;
      const init = parseNum(s.initialPrice);
      if (init <= 0) continue;
      const sym = String(s.symbol).trim();
      const cacheKey = `${normalizeSymbol(sym)}|${firstYmd}|${endYmd}|daily`;
      let bars = historicDailyBarsCache.get(cacheKey);
      if (bars === undefined) {
        bars = await fetchYahooDailyBarsInRange(sym, firstYmd, endYmd);
        historicDailyBarsCache.set(cacheKey, bars);
        await new Promise((r) => setTimeout(r, 400));
      }
      for (const b of bars) {
        if (b.ymd > closeCutoffYmd) continue;
        if (b.close >= init * koFrac) {
          s.koEverMet = true;
          if (!s.koMetDate) s.koMetDate = b.ymd;
          changed = true;
          break;
        }
      }
    }
    if (changed) saveState();
  }

  async function fetchQuotesThenHistoricKo() {
    await fetchAllQuotes();
    historicDailyBarsCache.clear();
    const combo = getActiveCombo();
    await backfillKoEverMetFromDailyClosesSinceFirstValuation(combo);
    await backfillKiEverMetThroughFinalValuation(combo);
    refreshFcnComputedCells();
    await refreshFinalValuationOutcomeAsync(combo);
    saveState();
  }

  function applyPctInputsFromCombo(combo) {
    if (els.fcnPctKo) els.fcnPctKo.value = formatNumericCellDisplay(combo.koPct);
    if (els.fcnPctKi) els.fcnPctKi.value = formatNumericCellDisplay(combo.kiPct);
    if (els.fcnPctStrike) els.fcnPctStrike.value = formatNumericCellDisplay(combo.strikePct);
  }

  function renderComboSelect() {
    const sel = els.comboSelect;
    if (!sel) return;
    sel.innerHTML = state.combos
      .map((c, i) => {
        const label = (c.sheetTitle || "").trim() || "請命名";
        return `<option value="${escapeHtmlAttr(c.id)}">${escapeHtmlAttr(label)}</option>`;
      })
      .join("");
    sel.value = state.activeComboId;
  }

  /** 不依賴 DOM，直接為某組合的所有股票逐一抓取即時報價並寫回 combo.stocks（供總覽頁對所有組合掃描用） */
  async function fetchQuotesForCombo(combo) {
    for (const s of combo.stocks) {
      const sym = String(s.symbol ?? "").trim();
      if (!sym) {
        s.currentPrice = "";
        continue;
      }
      try {
        const r = await fetchYahooPrice(sym);
        s.currentPrice = r.ok ? String(r.price) : "";
      } catch {
        s.currentPrice = "";
      }
      await new Promise((r) => setTimeout(r, 350));
    }
  }

  /** 抓某組合最新報價，並回補 KO／KI 歷史達標紀錄（不依賴 DOM，可用於非目前作用中的組合） */
  async function refreshComboQuotesAndKoKi(combo) {
    await fetchQuotesForCombo(combo);
    await backfillKoEverMetFromDailyClosesSinceFirstValuation(combo);
    await backfillKiEverMetThroughFinalValuation(combo);
  }

  /** 組合目前狀態文字與樣式（供總覽表使用） */
  function comboStatusLabel(combo) {
    const firstYmd = firstValuationYmd(combo);
    if (!firstYmd || !isValuationDateDone(firstYmd)) {
      return { text: "尚未開始", cls: "fcn-status-pending" };
    }
    const koExit = comboKoExitDate(combo);
    if (koExit) {
      return { text: `已提前出場（${formatFcnDateSlashDisplay(koExit)}）`, cls: "fcn-status-ko" };
    }
    const finalYmd = finalValuationYmd(combo);
    const matured = finalYmd && isValuationDateDone(finalYmd);
    if (matured) {
      return comboAnyKiMet(combo)
        ? { text: "已到期（KI 觸發換股）", cls: "fcn-status-ki" }
        : { text: "已到期（拿回本金）", cls: "fcn-status-matured" };
    }
    if (comboAnyKiMet(combo)) return { text: "追蹤中（已觸 KI，留意）", cls: "fcn-status-warning" };
    return { text: "追蹤中", cls: "fcn-status-tracking" };
  }

  /** 下一個排定的配息週期點（用於算利息期數、到期日），非 KO 每日比價日 */
  function comboNextValuationText(combo) {
    const firstYmd = firstValuationYmd(combo);
    if (!firstYmd) return "—";
    const slotCount = getValuationSlotCount(combo);
    const dates = buildValuationDatesFromFirst(firstYmd, slotCount).slice(0, slotCount);
    const today = todayYmdLocal();
    const next = dates.find((d) => d && d > today);
    return next ? formatFcnDateSlashDisplay(next) : "—";
  }

  /** 「下次比價日」欄位文字：尚未開始追蹤時顯示初次比價日；已開始追蹤後 KO 為每日比價，顯示「每日比價中」 */
  function comboNextKoCheckText(combo) {
    const firstYmd = firstValuationYmd(combo);
    if (!firstYmd) return "—";
    if (!isValuationDateDone(firstYmd)) return formatFcnDateSlashDisplay(firstYmd);
    return "每日比價中";
  }

  function comboDaysToMaturityText(combo) {
    const finalYmd = finalValuationYmd(combo);
    if (!finalYmd) return "—";
    const days = daysBetweenYmd(todayYmdLocal(), finalYmd);
    const dateLabel = formatFcnDateSlashDisplay(finalYmd);
    if (days > 0) return `${days} 天後（${dateLabel}）`;
    if (days === 0) return `今日到期（${dateLabel}）`;
    return `已過期（${dateLabel}）`;
  }

  function renderComboOverviewRowHtml(combo) {
    const label = (combo.sheetTitle || "").trim() || "請命名";
    const invested = formatThousandsNumber(parseNum(combo.investedCapital));
    const rate = formatThousandsNumber(parseNum(combo.annualRatePct));
    const status = comboStatusLabel(combo);
    const isActive = combo.id === state.activeComboId;
    /** 已提前出場（KO）：契約已提前終止，後續比價／配息／到期日皆無意義，不再顯示 */
    const alreadyExited = status.cls === "fcn-status-ko";
    const nextKoCheck = alreadyExited ? "—" : comboNextKoCheckText(combo);
    const nextValuation = alreadyExited ? "—" : comboNextValuationText(combo);
    const daysToMaturity = alreadyExited ? "—" : comboDaysToMaturityText(combo);
    return `<tr data-combo-id="${escapeHtmlAttr(combo.id)}" class="fcn-overview-row${isActive ? " is-active" : ""}">
      <td class="fcn-overview-title">${escapeHtmlAttr(label)}</td>
      <td class="mono">${escapeHtmlAttr(invested)}</td>
      <td class="mono">${escapeHtmlAttr(rate)}%</td>
      <td><span class="fcn-status-badge ${status.cls}">${escapeHtmlAttr(status.text)}</span></td>
      <td class="mono">${escapeHtmlAttr(nextKoCheck)}</td>
      <td class="mono">${escapeHtmlAttr(nextValuation)}</td>
      <td class="mono">${escapeHtmlAttr(daysToMaturity)}</td>
    </tr>`;
  }

  /** 重繪「所有組合總覽」表格；不觸發任何網路請求，只讀目前已存的資料 */
  function renderComboOverview() {
    const tbody = document.getElementById("fcn-overview-rows");
    if (!tbody) return;
    tbody.innerHTML = state.combos.map(renderComboOverviewRowHtml).join("");
  }

  let overviewRefreshRunning = false;

  /** 依序（非同時）掃描所有組合並更新報價／KO／KI，逐一完成即重繪總覽，避免同時發太多請求 */
  async function refreshAllCombosOverview() {
    if (overviewRefreshRunning) return;
    overviewRefreshRunning = true;
    const statusEl = document.getElementById("fcn-overview-status");
    const combos = state.combos;
    historicDailyBarsCache.clear();
    try {
      for (let i = 0; i < combos.length; i += 1) {
        if (statusEl) statusEl.textContent = `正在更新第 ${i + 1}／${combos.length} 組合報價…`;
        await refreshComboQuotesAndKoKi(combos[i]);
        renderComboOverview();
        if (combos[i].id === state.activeComboId) {
          renderFcnStockRowsInner(combos[i]);
          refreshFcnComputedCells();
          void refreshFinalValuationOutcomeAsync(combos[i]);
        }
      }
      saveState();
    } finally {
      if (statusEl) statusEl.textContent = "";
      overviewRefreshRunning = false;
    }
  }

  function bindComboOverviewEvents() {
    const tbody = document.getElementById("fcn-overview-rows");
    if (!tbody || tbody.dataset.bound === "1") return;
    tbody.dataset.bound = "1";
    tbody.addEventListener("click", (e) => {
      const tr = e.target.closest("tr[data-combo-id]");
      if (!tr) return;
      const id = tr.dataset.comboId;
      if (!id || id === state.activeComboId) return;
      syncFcnFromDom();
      saveState();
      state.activeComboId = id;
      saveState();
      renderFcnPanel();
      void fetchQuotesThenHistoricKo();
    });
    const refreshBtn = document.getElementById("fcn-overview-refresh");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => {
        void refreshAllCombosOverview();
      });
    }
  }

  /** 本機今日 yyyy-mm-dd（與 date input 一致） */
  function todayYmdLocal() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  /** 已填比價日且該日已過（含當日）：視為已比價 */
  function isValuationDateDone(dateStr) {
    const s = normalizeFcnDateStr(dateStr);
    if (!s) return false;
    return s <= todayYmdLocal();
  }

  /** 美東目前日期（yyyy-mm-dd）與時分，供判斷當日美股是否已收盤 */
  function nowUsEasternParts() {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(new Date());
    const get = (t) => parts.find((p) => p.type === t)?.value || "";
    return {
      ymd: `${get("year")}-${get("month")}-${get("day")}`,
      minutesOfDay: parseInt(get("hour"), 10) * 60 + parseInt(get("minute"), 10),
    };
  }

  /**
   * 美股當日收盤已確定的最後日期（yyyy-mm-dd）：
   * 美東時間 16:30 前（含收盤後資料尚未穩定的緩衝時間），視為當日尚未收盤確定，只採計前一曆日以前的資料。
   */
  function usConfirmedCloseCutoffYmd() {
    const { ymd, minutesOfDay } = nowUsEasternParts();
    const CLOSE_CONFIRMED_AFTER_MINUTES = 16 * 60 + 30;
    if (minutesOfDay >= CLOSE_CONFIRMED_AFTER_MINUTES) return ymd;
    const [y, m, d] = ymd.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() - 1);
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(dt.getUTCDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
  }

  function koFractionFromDom(combo) {
    const pctFrac = (inp, fb) => {
      const v = inp ? parseNum(normalizeNumericInputString(inp.value)) : 0;
      const base = v > 0 ? v : parseNum(fb);
      return base / 100;
    };
    return pctFrac(isComboActiveInDom(combo) ? els.fcnPctKo : null, combo.koPct);
  }

  /** 有代號且期初價 > 0 之標的，列入提前出場是否「全達標」計算 */
  function constituentStocksForKo(combo) {
    return combo.stocks.filter((s) => {
      const sym = String(s.symbol ?? "").trim();
      if (!sym) return false;
      return parseNum(s.initialPrice) > 0;
    });
  }

  function stockMeetsEarlyExitKo(s, koFrac) {
    const init = parseNum(s.initialPrice);
    const cur = parseNum(s.currentPrice);
    if (init <= 0 || !Number.isFinite(cur) || cur <= 0) return false;
    return cur >= init * koFrac;
  }

  /** 兩個 yyyy-mm-dd 字串相差天數（toYmd − fromYmd） */
  function daysBetweenYmd(fromYmd, toYmd) {
    const f = normalizeFcnDateStr(fromYmd);
    const t = normalizeFcnDateStr(toYmd);
    if (!f || !t) return 0;
    const [fy, fm, fd] = f.split("-").map(Number);
    const [ty, tm, td] = t.split("-").map(Number);
    const fUtc = Date.UTC(fy, fm - 1, fd);
    const tUtc = Date.UTC(ty, tm - 1, td);
    return Math.round((tUtc - fUtc) / 86400000);
  }

  /** 全部列入計算之標的是否皆已達 KO（各自獨立判定，非嚴格同一天） */
  function comboAllKoMet(combo) {
    const rows = constituentStocksForKo(combo);
    if (!rows.length) return false;
    return rows.every((s) => !!s.koEverMet);
  }

  /**
   * 提前出場（KO）日：本商品為每日比價（自初次比價日起，逐日收盤與 KO 門檻比較），
   * 出場日＝全部標的各自「首次達標日」中最晚的一天（即最後一檔達標、確認全數達標的當天）。
   * 注意：KO 為各標的獨立追蹤是否「曾經」達標，並未比對是否為「同一天」收盤同時達標，故此日期為估計值。
   */
  function comboKoExitDate(combo) {
    if (!comboAllKoMet(combo)) return "";
    const rows = constituentStocksForKo(combo);
    let latest = "";
    for (const s of rows) {
      const d = normalizeFcnDateStr(s.koMetDate) || todayYmdLocal();
      if (!latest || d > latest) latest = d;
    }
    return latest;
  }

  /** 是否有任一列入計算之標的曾觸碰 KI */
  function comboAnyKiMet(combo) {
    return constituentStocksForKo(combo).some((s) => !!s.kiEverMet);
  }

  /** 比價日序列中，於 uptoYmd（含）之前已「過」的格數（估計已入帳之配息期數） */
  function periodsElapsedByYmd(combo, uptoYmd) {
    const target = normalizeFcnDateStr(uptoYmd);
    if (!target) return 0;
    const slotCount = getValuationSlotCount(combo);
    const dates = buildValuationDatesFromFirst(firstValuationYmd(combo), slotCount);
    let count = 0;
    for (let i = 0; i < slotCount; i += 1) {
      const d = normalizeFcnDateStr(dates[i]);
      if (d && d <= target) count += 1;
    }
    return count;
  }

  function annualRatePctFromDom(combo) {
    const rateEl = els.fcnAnnualRate;
    return rateEl ? parseNum(normalizeNumericInputString(rateEl.value)) : parseNum(combo.annualRatePct);
  }

  /** 每期（月）利息＝投入資金 × 年利率 ÷ 12；優先讀 DOM 上（可能尚未存檔）之投入資金／年利率 */
  function comboMonthlyInterestAmountFromDom(combo) {
    const invested = investedCapitalFromDom(combo);
    const rate = annualRatePctFromDom(combo);
    if (!(invested > 0) || !(rate > 0)) return 0;
    return (invested * (rate / 100)) / 12;
  }

  function formatPct2(n) {
    if (!Number.isFinite(n)) return "—";
    return `${n.toFixed(2)}%`;
  }

  function formatFcnMoney(n) {
    if (!Number.isFinite(n)) return "—";
    return formatFcnMonthlyInterest(n);
  }

  /**
   * 提前出場（KO）總報酬試算文字：已收利息（按已過期數）＋本金 100% 回收。
   * 年化為總報酬率換算持有天數之約當值，僅供參考。
   */
  function comboKoOutcomeText(combo) {
    const koExit = comboKoExitDate(combo);
    if (!koExit) return "";
    const invested = investedCapitalFromDom(combo);
    const periods = Math.max(1, periodsElapsedByYmd(combo, koExit));
    const interestTotal = comboMonthlyInterestAmountFromDom(combo) * periods;
    const firstLine = `已收利息 ${periods} 期共 ${formatFcnMoney(interestTotal)}`;
    const parts = [];
    if (invested > 0) {
      const total = invested + interestTotal;
      const returnPct = (total / invested - 1) * 100;
      parts.push(`加計本金 ${formatFcnMoney(invested)}`, `總計 ${formatFcnMoney(total)}（總報酬率 ${formatPct2(returnPct)}）`);
      const days = daysBetweenYmd(firstValuationYmd(combo), koExit);
      if (days > 0) {
        const annualizedPct = (returnPct / days) * 365;
        parts.push(`約當年化 ${formatPct2(annualizedPct)}`);
      }
    } else {
      parts.push("（投入資金未填，無法試算總報酬）");
    }
    return `${firstLine}\n${parts.join("，")}`;
  }

  /** 依「目前價格距 KI 觸碰價之緩衝空間」分級，供表格上色提示風險 */
  function kiBufferBandClass(initialPrice, currentPrice, kiFrac, kiEverMet) {
    if (kiEverMet) return "fcn-ki-buffer-danger";
    const init = parseNum(initialPrice);
    const cur = parseNum(currentPrice);
    if (!(init > 0) || !Number.isFinite(cur) || cur <= 0 || !(kiFrac > 0)) return "";
    const bufferPct = (cur / init) * 100 - kiFrac * 100;
    if (bufferPct < 5) return "fcn-ki-buffer-danger";
    if (bufferPct < 10) return "fcn-ki-buffer-warning";
    if (bufferPct < 15) return "fcn-ki-buffer-caution";
    return "fcn-ki-buffer-safe";
  }

  /**
   * 在初次比價日已過後，以即時價補充當日 KO 達標判定（歷史逐日比對見 backfillKoEverMetFromDailyClosesSinceFirstValuation）。
   * 僅在美股當日收盤已確定（美東 16:30 後）才會依即時價鎖定達標，避免盤中價格波動就誤判為已出場。
   */
  function updateKoEverMetFromDailyCheck(combo) {
    if (!hasAnyValuationDone()) return false;
    if (nowUsEasternParts().minutesOfDay < 16 * 60 + 30) return false;
    const koFrac = koFractionFromDom(combo);
    let changed = false;
    for (const s of combo.stocks) {
      const sym = String(s.symbol ?? "").trim();
      if (!sym || parseNum(s.initialPrice) <= 0) continue;
      if (s.koEverMet) continue;
      if (stockMeetsEarlyExitKo(s, koFrac)) {
        s.koEverMet = true;
        if (!s.koMetDate) s.koMetDate = todayYmdLocal();
        changed = true;
      }
    }
    return changed;
  }

  /**
   * 依「已收盤確認」之 KO 達標紀錄：列出代號，或全部達標時「已提前出場」。
   * 僅採計 s.koEverMet（美股收盤確認後才會鎖定，見 updateKoEverMetFromDailyCheck），
   * 不採計盤中即時價，避免開盤中價格波動就顯示某標的「已達標」。
   */
  function earlyExitHintText(combo) {
    const rows = constituentStocksForKo(combo);
    if (rows.length === 0) return "";
    const met = rows.filter((s) => !!s.koEverMet);
    if (met.length === 0) return "";
    if (met.length === rows.length) return "已提前出場";
    return met.map((s) => String(s.symbol).trim().toUpperCase()).join("、");
  }

  /** 至少有一格比價日已填且日期已過（含當日） */
  function hasAnyValuationDone() {
    const combo = getActiveCombo();
    const firstInp = document.querySelector("#fcn-valuation-grid .fcn-val-date");
    if (firstInp instanceof HTMLInputElement && firstInp.value.trim()) {
      return isValuationDateDone(firstInp.value);
    }
    return (combo.valuationDates || []).some((d) => isValuationDateDone(d));
  }

  /** 標題「初次比價日」右側：比價開始後，顯示曾達 KO 之代號或「已提前出場」 */
  function refreshValuationKoHints() {
    const el = document.getElementById("fcn-ko-after-valuation");
    if (!el) return;
    const combo = getActiveCombo();
    if (!hasAnyValuationDone()) {
      el.textContent = "";
      el.removeAttribute("title");
      return;
    }
    const hint = earlyExitHintText(combo);
    const koExit = comboKoExitDate(combo);
    if (koExit) {
      const symbols = constituentStocksForKo(combo)
        .map((s) => String(s.symbol).trim().toUpperCase())
        .join("、");
      const outcomeText = comboKoOutcomeText(combo);
      const outcomeHtml = outcomeText.split("\n").map(escapeHtmlAttr).join("<br>");
      el.innerHTML = `已提前出場（${escapeHtmlAttr(symbols || "全數達標")}）於 ${escapeHtmlAttr(
        formatFcnDateSlashDisplay(koExit)
      )}：${outcomeHtml}`;
      el.setAttribute(
        "title",
        "提前出場總報酬試算：已收利息（依已過比價期數 × 每期利息）＋本金 100% 回收；約當年化為總報酬率換算持有天數之估計值。出場日為各標的分別達標日期中最晚一天之估計，並非嚴格比對「全部標的同一天收盤」達標，僅供參考，實際以入帳為準。"
      );
      return;
    }
    el.textContent = hint;
    if (hint) {
      const koPctDisp =
        (els.fcnPctKo && normalizeNumericInputString(els.fcnPctKo.value)) || String(combo.koPct ?? "");
      el.setAttribute(
        "title",
        `提前出場（KO）：自初次比價日起每日比價，若收盤曾達「期初×${koPctDisp}%」即列入摘要；全部達標為提前出場。目前：${hint}`
      );
    } else el.removeAttribute("title");
  }

  function renderValuationGrid(combo) {
    const grid = document.getElementById("fcn-valuation-grid");
    if (!grid) return;
    const first = (combo.valuationDates || [])[0] || "";
    const display = formatFcnDateSlashDisplay(first);
    grid.setAttribute("aria-label", "初次比價日");
    const labelEl = document.querySelector(".fcn-valuation-heading .fcn-valuation-label");
    if (labelEl) labelEl.textContent = "初次比價日";
    grid.innerHTML = `<input type="text" id="fcn-first-val-date" class="fcn-date-input fcn-val-date mono" data-val-idx="0" value="${escapeHtmlAttr(
      display
    )}" placeholder="西元年/月/日，例：2026/06/26" inputmode="numeric" autocomplete="off" aria-label="初次比價日（西元年/月/日）" />`;
  }

  function fcnSummaryCellsHtml(combo, index) {
    if (index === 0) {
      return `<th scope="row" class="fcn-side-label">期間（月）</th><td class="fcn-side-val"><input type="text" id="fcn-period" class="fcn-cell-input mono fcn-period-blue input-use-thousands" inputmode="numeric" autocomplete="off" value="${escapeHtmlAttr(
        formatNumericCellDisplay(combo.periodMonths)
      )}" /></td>`;
    }
    if (index === 1) {
      return `<th scope="row" class="fcn-side-label">投入資金</th><td class="fcn-side-val"><input type="text" id="fcn-invested" class="fcn-cell-input mono input-use-thousands" inputmode="decimal" autocomplete="off" value="${escapeHtmlAttr(
        formatNumericCellDisplay(combo.investedCapital)
      )}" /></td>`;
    }
    if (index === 2) {
      return `<th scope="row" class="fcn-side-label">每月利息</th><td class="fcn-side-val"><span id="fcn-monthly-interest" class="fcn-computed">—</span></td>`;
    }
    return `<td colspan="2" class="fcn-side-spacer"></td>`;
  }

  function renderFcnStockRowHtml(it, combo, index) {
    const summary = fcnSummaryCellsHtml(combo, index);
    const curDisp = formatQuoteDisplay(parseNum(it.currentPrice));
    return `<tr class="fcn-stock-row" data-id="${escapeHtmlAttr(it.id)}">
          <td><input type="text" class="fcn-cell-input fcn-symbol" maxlength="24" autocomplete="off" placeholder="例：TSM、2330.TW" value="${escapeHtmlAttr(
            it.symbol ?? ""
          )}" /></td>
          <td><input type="text" class="fcn-cell-input fcn-initial mono input-use-thousands" inputmode="decimal" autocomplete="off" value="${escapeHtmlAttr(
            formatNumericCellDisplay(it.initialPrice)
          )}" /></td>
          <td><span class="fcn-computed fcn-strike">—</span></td>
          <td><span class="fcn-computed fcn-ko">—</span></td>
          <td><span class="fcn-computed fcn-ki">—</span></td>
          <td class="fcn-quote-cell"><span class="fcn-current-price mono">${escapeHtmlAttr(curDisp)}</span></td>
          <td><span class="fcn-computed fcn-chg">—</span></td>
          ${summary}
        </tr>`;
  }

  function renderFcnSummaryOnlyRowHtml(combo, index) {
    return `<tr class="fcn-summary-only-row" aria-hidden="true">
          <td colspan="7" class="fcn-summary-only-spacer"></td>
          ${fcnSummaryCellsHtml(combo, index)}
        </tr>`;
  }

  function renderFcnStockRowsInner(combo) {
    const tbody = els.fcnStockTbody;
    if (!tbody) return;
    const stockRows = combo.stocks.map((it, i) => renderFcnStockRowHtml(it, combo, i));
    for (let i = combo.stocks.length; i < 3; i += 1) {
      stockRows.push(renderFcnSummaryOnlyRowHtml(combo, i));
    }
    tbody.innerHTML = stockRows.join("");
  }

  function syncFcnFromDom() {
    const combo = getActiveCombo();
    const prevById = new Map(combo.stocks.map((s) => [s.id, s]));
    if (els.fcnSheetTitle) combo.sheetTitle = String(els.fcnSheetTitle.value ?? "").trim().slice(0, 32);
    if (els.fcnAnnualRate) combo.annualRatePct = normalizeNumericInputString(els.fcnAnnualRate.value);
    if (els.fcnPctKo) combo.koPct = normalizeNumericInputString(els.fcnPctKo.value) || combo.koPct;
    if (els.fcnPctKi) combo.kiPct = normalizeNumericInputString(els.fcnPctKi.value) || combo.kiPct;
    if (els.fcnPctStrike) combo.strikePct = normalizeNumericInputString(els.fcnPctStrike.value) || combo.strikePct;
    const periodEl = document.getElementById("fcn-period");
    const investedEl = document.getElementById("fcn-invested");

    const merged = buildValuationDatesFromFirst(
      document.querySelector("#fcn-valuation-grid .fcn-val-date")?.value ?? combo.valuationDates?.[0] ?? "",
      getValuationSlotCount(combo)
    );
    combo.valuationDates = merged;

    if (periodEl) combo.periodMonths = normalizeNumericInputString(periodEl.value);
    if (investedEl) combo.investedCapital = normalizeNumericInputString(investedEl.value);
    const domRows = [...(els.fcnStockTbody?.querySelectorAll("tr.fcn-stock-row") ?? [])];
    combo.stocks = domRows.map((tr, idx) => {
      const id = tr.dataset.id || `fcn-stock-${idx + 1}`;
      const prev = prevById.get(id) ?? combo.stocks[idx];
      const symbol = tr.querySelector(".fcn-symbol")?.value ?? "";
      const initialPrice = normalizeNumericInputString(tr.querySelector(".fcn-initial")?.value ?? "");
      const symEq = prev && String(prev.symbol ?? "").trim() === String(symbol).trim();
      const initEq =
        prev && normalizeNumericInputString(String(prev.initialPrice ?? "")) === initialPrice;
      const koEverMet = prev && symEq && initEq ? !!prev.koEverMet : false;
      const kiEverMet = prev && symEq && initEq ? !!prev.kiEverMet : false;
      const koMetDate = prev && symEq && initEq ? String(prev.koMetDate ?? "") : "";
      const kiMetDate = prev && symEq && initEq ? String(prev.kiMetDate ?? "") : "";
      return {
        id,
        symbol,
        initialPrice,
        currentPrice:
          prev && prev.currentPrice != null && String(prev.currentPrice).trim() !== ""
            ? normalizeNumericInputString(String(prev.currentPrice))
            : "",
        koEverMet,
        kiEverMet,
        koMetDate,
        kiMetDate,
      };
    });
  }

  function getCurrentPriceForRowId(combo, rowId) {
    const it = combo.stocks.find((s) => s.id === rowId);
    return it ? parseNum(it.currentPrice) : NaN;
  }

  function refreshFcnComputedCells() {
    const combo = getActiveCombo();
    if (!els.fcnStockTbody) return;
    if (updateKoEverMetFromDailyCheck(combo)) saveState();
    const pctFrac = (inp, fb) => {
      const v = inp ? parseNum(normalizeNumericInputString(inp.value)) : 0;
      const base = v > 0 ? v : parseNum(fb);
      return base / 100;
    };
    const koM = pctFrac(els.fcnPctKo, combo.koPct);
    const kiM = pctFrac(els.fcnPctKi, combo.kiPct);
    const stM = pctFrac(els.fcnPctStrike, combo.strikePct);
    els.fcnStockTbody.querySelectorAll("tr.fcn-stock-row").forEach((tr) => {
      const rowId = tr.dataset.id;
      const init = parseNum(tr.querySelector(".fcn-initial")?.value);
      const cur = getCurrentPriceForRowId(combo, rowId);
      const strikeEl = tr.querySelector(".fcn-strike");
      const koEl = tr.querySelector(".fcn-ko");
      const kiEl = tr.querySelector(".fcn-ki");
      const chgEl = tr.querySelector(".fcn-chg");
      if (init > 0) {
        if (strikeEl) strikeEl.textContent = formatFcnPriceFixed(init * stM);
        if (koEl) koEl.textContent = formatFcnPriceFixed(init * koM);
        if (kiEl) kiEl.textContent = formatFcnPriceFixed(init * kiM);
      } else {
        if (strikeEl) strikeEl.textContent = "—";
        if (koEl) koEl.textContent = "—";
        if (kiEl) kiEl.textContent = "—";
      }
      if (chgEl) {
        if (init > 0 && Number.isFinite(cur) && cur > 0) {
          const pct = ((cur - init) / init) * 100;
          chgEl.textContent = `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`;
          chgEl.classList.remove("fcn-pct-pos", "fcn-pct-neg");
          if (pct > 0) chgEl.classList.add("fcn-pct-pos");
          else if (pct < 0) chgEl.classList.add("fcn-pct-neg");
        } else {
          chgEl.textContent = "—";
          chgEl.classList.remove("fcn-pct-pos", "fcn-pct-neg");
        }
      }
      const quoteCell = tr.querySelector(".fcn-quote-cell");
      if (quoteCell) {
        quoteCell.classList.remove(
          "fcn-ki-buffer-safe",
          "fcn-ki-buffer-caution",
          "fcn-ki-buffer-warning",
          "fcn-ki-buffer-danger"
        );
        const stockItem = combo.stocks.find((s) => s.id === rowId);
        const bandClass = kiBufferBandClass(init, cur, kiM, !!stockItem?.kiEverMet);
        if (bandClass) {
          quoteCell.classList.add(bandClass);
          const bufferPct = init > 0 && Number.isFinite(cur) && cur > 0 ? (cur / init) * 100 - kiM * 100 : null;
          quoteCell.title =
            stockItem?.kiEverMet
              ? "此標的曾觸碰 KI，本金風險已鎖定（不因股價回升而解除）。"
              : bufferPct != null
                ? `距 KI 觸碰價尚有約 ${bufferPct.toFixed(1)} 個百分點緩衝（以期初價為基準）。`
                : "";
        } else {
          quoteCell.removeAttribute("title");
        }
      }
    });
    const monthlyEl = document.getElementById("fcn-monthly-interest");
    if (monthlyEl) {
      const rateEl = els.fcnAnnualRate;
      const rate = rateEl ? parseNum(normalizeNumericInputString(rateEl.value)) : parseNum(combo.annualRatePct);
      const investedEl = document.getElementById("fcn-invested");
      const inv = investedEl ? parseNum(normalizeNumericInputString(investedEl.value)) : parseNum(combo.investedCapital);
      if (inv <= 0 || rate <= 0) monthlyEl.textContent = "—";
      else monthlyEl.textContent = formatFcnMonthlyInterest((inv * (rate / 100)) / 12);
    }
    refreshDescDynamic();
    refreshValuationKoHints();
    refreshFinalValuationDateDisplay(combo);
    const finalYmd = finalValuationYmd(combo);
    if (finalYmd && isValuationDateDone(finalYmd)) {
      scheduleFinalValuationOutcomeRefresh(combo);
    } else {
      finalOutcomeFetchToken += 1;
      const outcomeEl = document.getElementById("fcn-final-val-outcome");
      if (outcomeEl) {
        outcomeEl.textContent = "";
        outcomeEl.removeAttribute("title");
      }
    }
    renderComboOverview();
  }

  function refreshDescDynamic() {
    const combo = getActiveCombo();
    const periodEl = document.getElementById("fcn-period");
    let months = periodEl ? parseNum(normalizeNumericInputString(periodEl.value)) : parseNum(combo.periodMonths);
    if (!Number.isFinite(months) || months <= 0) months = parseNum(combo.periodMonths);
    if (!Number.isFinite(months) || months <= 0) months = 12;
    months = Math.round(months);
    const elP = document.getElementById("fcn-desc-period");
    if (elP) elP.textContent = String(months);
    const koElInp = els.fcnPctKo;
    let ko = koElInp ? parseNum(normalizeNumericInputString(koElInp.value)) : parseNum(combo.koPct);
    if (!Number.isFinite(ko) || ko <= 0) ko = parseNum(combo.koPct);
    const elK = document.getElementById("fcn-desc-ko-pct");
    if (elK) elK.textContent = String(ko);
  }

  function updateRowPriceDom(tr, price) {
    const priceEl = tr?.querySelector(".fcn-current-price");
    if (priceEl) priceEl.textContent = formatQuoteDisplay(price);
  }

  async function fetchQuoteForRow(tr) {
    if (!tr) return;
    const combo = getActiveCombo();
    const symInp = tr.querySelector(".fcn-symbol");
    const sym = symInp?.value?.trim() ?? "";
    if (!sym) {
      updateRowPriceDom(tr, NaN);
      return;
    }
    try {
      const r = await fetchYahooPrice(sym);
      if (!r.ok) {
        const id = tr.dataset.id;
        const it = combo.stocks.find((s) => s.id === id);
        if (it) it.currentPrice = "";
        updateRowPriceDom(tr, NaN);
        refreshFcnComputedCells();
        return;
      }
      const id = tr.dataset.id;
      const it = combo.stocks.find((s) => s.id === id);
      if (it) it.currentPrice = String(r.price);
      updateRowPriceDom(tr, r.price);
      saveState();
      refreshFcnComputedCells();
    } catch {
      const id = tr.dataset.id;
      const it = combo.stocks.find((s) => s.id === id);
      if (it) it.currentPrice = "";
      updateRowPriceDom(tr, NaN);
      refreshFcnComputedCells();
    }
  }

  async function fetchAllQuotes() {
    const rows = [...(els.fcnStockTbody?.querySelectorAll("tr.fcn-stock-row") ?? [])];
    for (const tr of rows) {
      await fetchQuoteForRow(tr);
      await new Promise((r) => setTimeout(r, 350));
    }
  }

  function renderFcnPanel() {
    const combo = getActiveCombo();
    if (combo.stocks.length < FCN_MIN_STOCKS) {
      const n = normalizeCombo(combo);
      combo.stocks = n.stocks;
      combo.valuationDates = n.valuationDates;
    }
    combo.valuationDates = normalizeValuationDates(combo);
    combo.valuationDates = buildValuationDatesFromFirst(
      combo.valuationDates[0],
      getValuationSlotCount(combo)
    );
    renderComboSelect();
    if (els.fcnSheetTitle) els.fcnSheetTitle.value = combo.sheetTitle ?? "";
    if (els.fcnAnnualRate) els.fcnAnnualRate.value = formatNumericCellDisplay(combo.annualRatePct);
    applyPctInputsFromCombo(combo);
    renderValuationGrid(combo);
    renderFcnStockRowsInner(combo);
    refreshFcnComputedCells();
  }

  let fcnSaveTimer = null;
  function scheduleFcnPersist() {
    clearTimeout(fcnSaveTimer);
    fcnSaveTimer = setTimeout(() => {
      syncFcnFromDom();
      refreshFcnComputedCells();
      saveState();
    }, 140);
  }

  function initEvents() {
    const root = els.panelFcn;
    if (!root || root.dataset.bound === "1") return;
    root.dataset.bound = "1";

    bindComboOverviewEvents();

    if (els.comboSelect) {
      els.comboSelect.addEventListener("change", (e) => {
        syncFcnFromDom();
        saveState();
        state.activeComboId = e.target.value;
        saveState();
        renderFcnPanel();
        void fetchQuotesThenHistoricKo();
      });
    }

    if (els.btnAddCombo) {
      els.btnAddCombo.addEventListener("click", () => {
        syncFcnFromDom();
        const nc = emptyCombo();
        state.combos.push(nc);
        state.activeComboId = nc.id;
        saveState();
        renderFcnPanel();
        void fetchQuotesThenHistoricKo();
      });
    }

    if (els.btnDelCombo) {
      els.btnDelCombo.addEventListener("click", () => {
        if (state.combos.length <= 1) {
          alert("至少保留一組 FCN 組合。");
          return;
        }
        syncFcnFromDom();
        const id = state.activeComboId;
        state.combos = state.combos.filter((c) => c.id !== id);
        state.activeComboId = state.combos[0].id;
        saveState();
        renderFcnPanel();
        void fetchQuotesThenHistoricKo();
      });
    }

    root.addEventListener("input", () => {
      refreshFcnComputedCells();
      scheduleFcnPersist();
    });
    root.addEventListener("change", (e) => {
      const t = e.target;
      if (t?.id === "fcn-pct-ko") {
        getActiveCombo().stocks.forEach((s) => {
          s.koEverMet = false;
        });
      }
      if (t?.id === "fcn-pct-ki") {
        getActiveCombo().stocks.forEach((s) => {
          s.kiEverMet = false;
        });
      }
      if (t?.classList?.contains("fcn-symbol")) {
        const tr = t.closest("tr.fcn-stock-row");
        if (tr) void fetchQuoteForRow(tr);
      }
      if (t?.classList?.contains("fcn-val-date")) {
        const ymd = normalizeFcnDateStr(t.value);
        if (ymd) t.value = formatFcnDateSlashDisplay(ymd);
      }
      syncFcnFromDom();
      refreshFcnComputedCells();
      saveState();
      if (t?.id === "fcn-period") renderValuationGrid(getActiveCombo());
    });

    if (els.fcnAddStock) {
      els.fcnAddStock.addEventListener("click", () => {
        syncFcnFromDom();
        getActiveCombo().stocks.push(emptyFcnStockItem());
        saveState();
        renderFcnPanel();
      });
    }
    if (els.fcnRemoveStock) {
      els.fcnRemoveStock.addEventListener("click", () => {
        const combo = getActiveCombo();
        if (combo.stocks.length <= FCN_MIN_STOCKS) {
          alert(`至少保留 ${FCN_MIN_STOCKS} 檔股票列。`);
          return;
        }
        syncFcnFromDom();
        combo.stocks.pop();
        saveState();
        renderFcnPanel();
      });
    }

    if (els.btnFetchAll) {
      els.btnFetchAll.addEventListener("click", () => {
        syncFcnFromDom();
        renderValuationGrid(getActiveCombo());
        void fetchQuotesThenHistoricKo();
      });
    }

    if (els.btnExport) {
      els.btnExport.addEventListener("click", () => {
        syncFcnFromDom();
        const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `fcn-all-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        saveState();
      });
    }

    if (els.inputImport) {
      els.inputImport.addEventListener("change", (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const parsed = JSON.parse(reader.result);
            state = normalizeAppState(parsed);
            saveState();
            renderFcnPanel();
            void fetchQuotesThenHistoricKo();
          } catch {
            alert("匯入失敗：請確認為本頁匯出的 JSON（可多組合）。");
          }
          e.target.value = "";
        };
        reader.readAsText(file, "UTF-8");
      });
    }

    if (els.btnReset) {
      els.btnReset.addEventListener("click", () => {
        if (!confirm("將清空所有 FCN 組合之本機資料且無法復原（除非已備份）。確定？")) return;
        state = defaultAppState();
        localStorage.removeItem(FCN_STORAGE_KEY);
        saveState();
        renderFcnPanel();
        void fetchQuotesThenHistoricKo();
      });
    }
  }

  bindThousandsInputs(document.querySelector(".fcn-app-root"));
  initEvents();
  renderFcnPanel();
  mirrorFcnLookupForAssetPage(state);
  /** 開啟頁面時依序掃描所有組合的最新報價／KO／KI（含目前作用中的組合），供總覽表使用 */
  void refreshAllCombosOverview();
})();
