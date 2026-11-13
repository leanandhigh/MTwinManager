@echo off
setlocal
rem Builds MTwin Manager: dist-installer\MTwinManager-Setup-<version>.exe (the installer) and "MTwin Manager.exe" next to
rem this file (the app itself, runs without installing). Run setup.bat once first.
cd /d "%~dp0"

rem Build in a short folder: OpenSSL's build fails when its paths get too long for Windows
rem ("C1083: Cannot open compiler generated file"), e.g. under Downloads\<long zip name>.
if not defined CARGO_TARGET_DIR set "CARGO_TARGET_DIR=%SystemDrive%\mtwin-build"

rem Tools installed by setup.bat in this session may not be on PATH yet.
set "PATH=%ProgramFiles%\nodejs;%USERPROFILE%\.cargo\bin;C:\Strawberry\perl\bin;%PATH%"

where node >nul 2>nul || (echo Node.js is missing. Run setup.bat first. & pause & exit /b 1)
where cargo >nul 2>nul || (echo Rust is missing. Run setup.bat first. & pause & exit /b 1)

if not exist node_modules (
  echo Installing packages...
  call npm.cmd ci || (echo npm ci failed. & pause & exit /b 1)
)

echo Building (the first build takes 5-15 minutes)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-installer.ps1"
if errorlevel 1 (echo. & echo The build failed: see the message above. & pause & exit /b 1)

if exist "%CARGO_TARGET_DIR%\release\mtwin-manager.exe" copy /y "%CARGO_TARGET_DIR%\release\mtwin-manager.exe" "%~dp0MTwin Manager.exe" >nul

echo.
echo Done:
echo   Installer:          %~dp0dist-installer
echo   App (no install):   "%~dp0MTwin Manager.exe"
explorer "%~dp0dist-installer"
pause
