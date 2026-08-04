/**
 * 共用工具（資產統計 index.html／FCN 試算 fcn.html 共用）。
 * 需在 app.js / fcn-app.js 之前以 <script src="common.js"></script> 載入。
 * 掛在 window.AssetCommon 上，避免污染全域變數名稱。
 */
(function () {
  "use strict";

  function uid() {
    return crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  /** 去除千分位逗號、全形空白、一般空白，供數字解析／比對前正規化用 */
  function normalizeNumericInputString(s) {
    return String(s ?? "")
      .replace(/,/g, "")
      .replace(/　/g, "")
      .replace(/\s/g, "")
      .trim();
  }

  function parseNum(v) {
    if (typeof v === "number") return Number.isFinite(v) ? v : 0;
    const s = normalizeNumericInputString(v);
    if (s === "" || s === "-" || s === "." || s === "-.") return 0;
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  function formatThousandsNumber(n) {
    if (!Number.isFinite(n)) return "";
    return new Intl.NumberFormat("zh-TW", {
      useGrouping: true,
      minimumFractionDigits: 0,
      maximumFractionDigits: 20,
    }).format(n);
  }

  /** 將已存字串或小數字字串格式為含千分位之顯示；空或非數字則原樣／空字串 */
  function formatNumericCellDisplay(storedOrRaw) {
    const norm = normalizeNumericInputString(storedOrRaw);
    if (norm === "") return "";
    const n = Number(norm);
    if (!Number.isFinite(n)) return String(storedOrRaw ?? "").trim();
    return formatThousandsNumber(n);
  }

  /**
   * 綁定「.input-use-thousands」輸入框：focus 時還原為純數字方便編輯，
   * blur 時格式化為千分位顯示。
   * @param {Element} rootEl 監聽範圍的容器（事件委派，用 capture）
   * @param {(el: HTMLInputElement, n: number) => (string | undefined)} [formatOverride]
   *   blur 時若提供此函式，會先呼叫；回傳字串則採用該值做為顯示，
   *   回傳 undefined 則退回預設千分位格式。
   *   （例如資產統計頁的支出金額需依幣別決定小數位數，FCN 頁則不需要。）
   */
  function bindThousandsInputs(rootEl, formatOverride) {
    if (!rootEl) return;
    rootEl.addEventListener(
      "focusin",
      (e) => {
        const el = e.target;
        if (!(el instanceof HTMLInputElement) || !el.matches("input.input-use-thousands")) return;
        el.value = normalizeNumericInputString(el.value);
      },
      true
    );
    rootEl.addEventListener(
      "focusout",
      (e) => {
        const el = e.target;
        if (!(el instanceof HTMLInputElement) || !el.matches("input.input-use-thousands")) return;
        const raw = normalizeNumericInputString(el.value);
        if (raw === "") {
          el.value = "";
          return;
        }
        const n = Number(raw);
        if (!Number.isFinite(n)) return;

        if (typeof formatOverride === "function") {
          const overridden = formatOverride(el, n);
          if (overridden !== undefined) {
            el.value = overridden;
            return;
          }
        }

        el.value = formatThousandsNumber(n);
      },
      true
    );
  }

  window.AssetCommon = {
    uid,
    normalizeNumericInputString,
    parseNum,
    formatThousandsNumber,
    formatNumericCellDisplay,
    bindThousandsInputs,
  };
})();
