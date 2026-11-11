@echo off
setlocal
rem One-time setup for building RoALT on Windows: installs what the build needs with winget
rem (Node.js, Rust, the Visual Studio C++ Build Tools, Strawberry Perl, Inno Setup), skipping
rem anything already installed, then builds the installer with build-exe.bat.
cd /d "%~dp0"

where winget >nul 2>nul || (
  echo winget was not found. Install "App Installer" from the Microsoft Store, then run this again.
  pause & exit /b 1
)

set "WG=winget install -e --accept-package-agreements --accept-source-agreements --silent"

echo.
echo [1/5] Node.js
where node >nul 2>nul && (echo     already installed) || %WG% --id OpenJS.NodeJS.LTS

echo.
echo [2/5] Rust
where cargo >nul 2>nul && (echo     already installed) || (
  if exist "%USERPROFILE%\.cargo\bin\cargo.exe" (echo     already installed) else %WG% --id Rustlang.Rustup
)

echo.
echo [3/5] Visual Studio C++ Build Tools (large download, can take a while)
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
set "HAVEVC="
if exist "%VSWHERE%" for /f "usebackq delims=" %%i in (`"%VSWHERE%" -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "HAVEVC=1"
if defined HAVEVC (echo     already installed) else %WG% --id Microsoft.VisualStudio.2022.BuildTools --override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"

echo.
echo [4/5] Strawberry Perl (OpenSSL needs it to build)
if exist "C:\Strawberry\perl\bin\perl.exe" (echo     already installed) else %WG% --id StrawberryPerl.StrawberryPerl

echo.
echo [5/5] Inno Setup (makes the installer)
set "HAVEISCC="
if exist "%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe" set "HAVEISCC=1"
if exist "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" set "HAVEISCC=1"
if exist "%ProgramFiles%\Inno Setup 6\ISCC.exe" set "HAVEISCC=1"
if defined HAVEISCC (echo     already installed) else %WG% --id JRSoftware.InnoSetup

rem What was just installed isn't on this window's PATH yet.
set "PATH=%ProgramFiles%\nodejs;%USERPROFILE%\.cargo\bin;C:\Strawberry\perl\bin;C:\Strawberry\c\bin;%PATH%"
where rustup >nul 2>nul && rustup default stable

echo.
echo Setup done. Building RoALT now...
call "%~dp0build-exe.bat"
