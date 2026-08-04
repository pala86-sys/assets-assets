# 資產統計

本機試算工具：收入／支出彙總、基金／年金、FCN 試算（`fcn.html`）。資料存在瀏覽器，請定期「匯出 JSON」備份。

## 快速開始（Windows）

1. **雙擊 `啟動.bat`**
2. 瀏覽器會開啟 `http://localhost:8080/index.html`
3. 關閉黑色視窗（或按 Ctrl+C）即停止伺服器

> 需要電腦已安裝 **Python** 或 **Node.js** 其中一項。若 `.bat` 提示找不到，請先安裝再試。

## 其他開啟方式

| 方式 | 說明 |
|------|------|
| 雙擊 `index.html` | 可手動輸入與試算；↻ 抓網功能可能因瀏覽器限制失敗 |
| `python -m http.server 8080` | 在本資料夾執行，再開 `http://localhost:8080/index.html` |
| VS Code Live Server | 對 `index.html` 右鍵 → Open with Live Server |

## 檔案

- `index.html` — 資產統計主頁
- `fcn.html` — FCN 試算
- `common.js` — 兩頁共用的工具函式（數字解析／千分位格式化等），須排在 `app.js`／`fcn-app.js` 之前載入
- `app.js` / `fcn-app.js` / `styles.css` — 程式與樣式

整包資料夾需一併複製，不可只拷貝單一 html。
