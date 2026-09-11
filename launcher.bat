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

rem ---------- 2. Update check (throttled; never blocks the launcher) ----------
rem Compares this plugin and the Harness against their upstreams, then asks
rem before installing anything. Missing script or no network is skipped.
if exist "%~dp0update.js" node "%~dp0update.js" ask --timeout 20

rem ---------- 3. Already running? Just open the browser ----------
netstat -ano | findstr /c:":3080 " | findstr /c:"LISTENING" >nul 2>nul
if not errorlevel 1 goto :already_running

rem ---------- 4. Start the server in its own window ----------
echo [INFO] Starting DeepSeek Harness server...
start "DeepSeek Harness Server" cmd /k "dsh web"

rem ---------- 5. Poll port 3080 until ready (max 20 seconds) ----------
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
echo [INFO] Server is ready. dsh web opens the browser automatically.
rem Surface the previous boot's self-check when it flagged a Harness change, so a
rem compatibility break is visible here instead of only inside the report file.
if not exist "%~dp0dsh-desktop-selfcheck.txt" goto :ready_done
findstr /c:"STATUS: OK" "%~dp0dsh-desktop-selfcheck.txt" >nul 2>nul
if not errorlevel 1 goto :ready_done
echo [WARN] dsh-desktop self-check flagged this install:
findstr /c:"STATUS:" "%~dp0dsh-desktop-selfcheck.txt"
findstr /c:"CHECKED:" "%~dp0dsh-desktop-selfcheck.txt"
echo [WARN] Details: "%~dp0dsh-desktop-selfcheck.txt"
:ready_done
echo [INFO] Done. The server keeps running in its own window.
echo [INFO] Close the "DeepSeek Harness Server" window to stop it.
exit /b 0

:already_running
echo [INFO] DeepSeek Harness is already running on port 3080.
rem The harness authenticates the UI with a per-process launch token, so a bare
rem origin answers HTTP 401 until the browser holds a session cookie. The
rem dsh-desktop plugin publishes the tokenized URL beside this script; prefer
rem it, and fall back to the bare origin when the file is absent.
set "OPENURL="
if exist "%~dp0web-url.txt" set /p OPENURL=<"%~dp0web-url.txt"
if not defined OPENURL set "OPENURL=%URL%"
echo [INFO] Opening browser...
start "" "%OPENURL%"
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
