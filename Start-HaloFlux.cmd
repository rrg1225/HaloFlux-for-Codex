@echo off
setlocal
where.exe node.exe >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 22 or newer and reopen this launcher.
  pause
  exit /b 1
)
node.exe "%~dp0scripts\start-windows.mjs"
set "HALOFLUX_EXIT=%ERRORLEVEL%"
if not "%HALOFLUX_EXIT%"=="0" pause
exit /b %HALOFLUX_EXIT%
