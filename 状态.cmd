@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "NODE=node"
where node >nul 2>nul || (echo Node.js not found in PATH. Install it from https://nodejs.org/ then re-run this file. & pause & exit /b 1)
"%NODE%" "bin\gemini-zh.js" status
echo.
"%NODE%" "bin\gemini-zh.js" verify
echo.
pause
