@echo off
rem Starts the Progress Viewer and opens the dashboard. Needs Node.js 18+ (https://nodejs.org).
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org & pause & exit /b 1)
start "" http://localhost:16390
node server.mjs %*
pause
