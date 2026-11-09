@echo off
setlocal DisableDelayedExpansion
set "HALOFLUX_NODE="
for %%I in (node.exe) do set "HALOFLUX_NODE=%%~$PATH:I"
if not defined HALOFLUX_NODE (
  echo Node.js was not found. Install Node.js 22 or newer and reopen this launcher.
  if not "%HALOFLUX_NO_PAUSE%"=="1" pause
  exit /b 1
)
"%HALOFLUX_NODE%" "%~dp0scripts\start-windows.mjs"
set "HALOFLUX_EXIT=%ERRORLEVEL%"
if not "%HALOFLUX_EXIT%"=="0" if not "%HALOFLUX_NO_PAUSE%"=="1" pause
exit /b %HALOFLUX_EXIT%
