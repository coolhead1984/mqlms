@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Launch-Quote-Studio.ps1"
if errorlevel 1 (
  echo.
  echo Quote Studio could not start. Please read the message above.
  pause
)
