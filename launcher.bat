@echo off
setlocal
title DeepSeek Harness Launcher

rem ============================================================
rem  DeepSeek Harness - One-Click Launcher
rem  Starts "dsh web" (http://127.0.0.1:3080) and opens browser.
rem ============================================================

set "URL=http://127.0.0.1:3080"

rem ---------- 1. Check that node and dsh are available ----------
where node >nul 2>nul
if errorlevel 1 goto :no_node

where dsh >nul 2>nul
if errorlevel 1 goto :no_dsh

rem ---------- 2. Already running? Just open the browser ----------
netstat -ano | findstr /c:":3080 " | findstr /c:"LISTENING" >nul 2>nul
if not errorlevel 1 goto :already_running

rem ---------- 3. Start the server in its own window ----------
echo [INFO] Starting DeepSeek Harness server...
start "DeepSeek Harness Server" cmd /k "dsh web"

rem ---------- 4. Poll port 3080 until ready (max 20 seconds) ----------
echo [INFO] Waiting for the server on port 3080 (max 20s)...
set /a tries=0

:wait_loop
timeout /t 1 /nobreak >nul
netstat -ano | findstr /c:":3080 " | findstr /c:"LISTENING" >nul 2>nul
if not errorlevel 1 goto :ready
set /a tries+=1
if %tries% lss 20 goto :wait_loop

echo [ERROR] Server did not become ready within 20 seconds.
echo [ERROR] Look at the "DeepSeek Harness Server" window for logs.
pause
exit /b 1

:ready
echo [INFO] Server is ready. Opening browser...
start "" "%URL%"
echo [INFO] Done. The server keeps running in its own window.
echo [INFO] Close the "DeepSeek Harness Server" window to stop it.
exit /b 0

:already_running
echo [INFO] DeepSeek Harness is already running on port 3080.
echo [INFO] Opening browser...
start "" "%URL%"
exit /b 0

:no_node
echo [ERROR] Node.js was not found in PATH.
echo         Install it from https://nodejs.org/
echo         Then run:  npm install -g @deepseek-ai/dsh
echo         After installing, re-run this script.
pause
exit /b 1

:no_dsh
echo [ERROR] dsh (DeepSeek Harness CLI) was not found in PATH.
echo         Install it with:  npm install -g @deepseek-ai/dsh
echo         After installing, re-run this script.
pause
exit /b 1
