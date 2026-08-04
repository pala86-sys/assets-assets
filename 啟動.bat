@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo  資產統計 — 本機伺服器
echo  =====================
echo.

where python >nul 2>nul
if %errorlevel%==0 (
  echo 使用 Python 啟動 http://localhost:8080
  echo 按 Ctrl+C 可停止伺服器
  echo.
  start "" "http://localhost:8080/index.html"
  python -m http.server 8080
  goto :eof
)

where node >nul 2>nul
if %errorlevel%==0 (
  echo 使用 Node.js 啟動 http://localhost:8080
  echo 按 Ctrl+C 可停止伺服器
  echo.
  start "" "http://localhost:8080"
  npx --yes serve -l 8080 .
  goto :eof
)

echo [無法啟動] 找不到 Python 或 Node.js。
echo.
echo 請擇一安裝後再雙擊本檔：
echo   - Python  https://www.python.org/downloads/
echo   - Node.js https://nodejs.org/
echo.
echo 或改用 VS Code / Cursor 的 Live Server 擴充功能開啟 index.html。
echo.
pause
