@echo off
rem Autumn — one-click build.
rem Creates (or updates) the "Autumn" folder on your desktop:  Autumn.exe  +  WorkFlow\ (your projects)  +  app\ (runtime)
rem Needs Node.js 18 or newer (https://nodejs.org). The first build downloads Electron once.
setlocal
cd /d "%~dp0"
title Autumn build
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to build Autumn: https://nodejs.org
  pause
  exit /b 1
)
node scripts\build.js %*
if errorlevel 1 (
  echo.
  echo Build failed - see the message above.
  pause
  exit /b 1
)
echo.
echo Autumn is ready: open Autumn.exe in the Autumn folder on your desktop.
pause
