; MTwin Manager for Windows: a per-user install of the app, no admin rights.
; Build it with scripts\build-installer.ps1, which passes the version from
; src-tauri\tauri.conf.json and where cargo put the release build.

#if Ver < EncodeVer(6,6,0)
  #error Inno Setup 6.6 or newer is needed (WizardStyle dynamic windows11)
#endif
#include "legacy.iss"

#ifndef AppVersion
  #error Pass /DAppVersion=x.y.z, or build with scripts\build-installer.ps1
#endif
; VersionInfoVersion must be numeric; a prerelease such as 0.2.0-beta.1 passes 0.2.0 here.
#ifndef AppNumVersion
  #define AppNumVersion AppVersion
#endif
#ifndef AppExe
  #define AppExe "..\src-tauri\target\release\mtwin-manager.exe"
#endif

[Setup]
AppId={{F65209C5-78F5-4735-AE83-9F83EF9FCD83}
AppName=MTwin Manager
AppVersion={#AppVersion}
AppPublisher=MTwin Manager
AppPublisherURL=https://github.com/leanandhigh/MTwinManager
VersionInfoVersion={#AppNumVersion}
; Per-user: {autopf} is %LOCALAPPDATA%\Programs.
DefaultDirName={autopf}\MTwin Manager
; Installs made before the rename were elsewhere (legacy.iss): this one goes to the new folder and the
; old one is removed ([InstallDelete]); the data folder is the app's own and it moves that itself.
UsePreviousAppDir=no
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; Windows 10 1809, the oldest Windows Tauri 2 supports.
MinVersion=10.0.17763
WizardStyle=modern dynamic windows11
SetupIconFile=..\src-tauri\icons\icon.ico
UninstallDisplayIcon={app}\MTwin Manager.exe
UninstallDisplayName=MTwin Manager
; Restart Manager closes a running MTwin Manager before its exe is replaced.
CloseApplications=force
OutputDir=..\dist-installer
OutputBaseFilename=MTwinManager-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes

[Tasks]
Name: desktopicon; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#AppExe}"; DestDir: "{app}"; DestName: "MTwin Manager.exe"; Flags: ignoreversion

[InstallDelete]
; The program folder and shortcuts under earlier names (legacy.iss, then MTwin Hub).
Type: filesandordirs; Name: "{#LegacyProgramDir}"
Type: files; Name: "{autoprograms}\{#LegacyShortcut}"
Type: files; Name: "{autodesktop}\{#LegacyShortcut}"
Type: files; Name: "{autoprograms}\MTwin Hub.lnk"
Type: files; Name: "{autodesktop}\MTwin Hub.lnk"

[Icons]
Name: "{autoprograms}\MTwin Manager"; Filename: "{app}\MTwin Manager.exe"
Name: "{autodesktop}\MTwin Manager"; Filename: "{app}\MTwin Manager.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\MTwin Manager.exe"; Description: "{cm:LaunchProgram,MTwin Manager}"; Flags: nowait postinstall skipifsilent; Check: WebView2Installed
; MTwin Manager's self-updater runs Setup with /VERYSILENT ... /RELAUNCH and quits: start it again.
Filename: "{app}\MTwin Manager.exe"; Flags: nowait; Check: Relaunch

[Code]
const
  WebView2Key = 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  { Microsoft's Evergreen Bootstrapper: Setup only opens the link, it downloads nothing itself. }
  WebView2Download = 'https://go.microsoft.com/fwlink/p/?LinkId=2124703';
  { tauri-plugin-single-instance holds <identifier>-sim while MTwin Manager runs (the second: a
    version from before the rename). }
  RunningMutex = 'com.mtwin.manager-sim,{#LegacyMutex}';

function HasWebView2(Root: Integer): Boolean;
var
  Version: String;
begin
  Result := RegQueryStringValue(Root, WebView2Key, 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0');
end;

{ The machine-wide runtime (HKLM32 is WOW6432Node) or a per-user one. }
function WebView2Installed: Boolean;
begin
  Result := HasWebView2(HKLM32) or HasWebView2(HKCU);
end;

function InitializeSetup: Boolean;
var
  Code: Integer;
begin
  if not WebView2Installed and (SuppressibleMsgBox(
      'MTwin Manager draws its window with the Microsoft Edge WebView2 Runtime, which is not installed.' #13#10#13#10 +
      'Setup will continue, but MTwin Manager will not open until the runtime is installed.' #13#10#13#10 +
      'Download Microsoft''s WebView2 installer in your browser now?',
      mbConfirmation, MB_YESNO, IDNO) = IDYES) then
    ShellExecAsOriginalUser('open', WebView2Download, '', '', SW_SHOWNORMAL, ewNoWait, Code);
  Result := True;
end;

{ Setup was started by MTwin Manager's self-updater (/RELAUNCH), silently. }
function Relaunch: Boolean;
var
  I: Integer;
begin
  Result := False;
  if WizardSilent and WebView2Installed then
    for I := 1 to ParamCount do
      if CompareText(ParamStr(I), '/RELAUNCH') = 0 then
        Result := True;
end;

{ A running MTwin Manager holds its exe and database open: uninstalling then would leave both behind. }
function InitializeUninstall: Boolean;
begin
  Result := True;
  while Result and CheckForMutexes(RunningMutex) do
    Result := SuppressibleMsgBox('MTwin Manager is running. Close it, then click OK.', mbError, MB_OKCANCEL, IDCANCEL) = IDOK;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Data: String;
begin
  Data := ExpandConstant('{localappdata}\MTwin Manager');
  if (CurUninstallStep <> usPostUninstall) or UninstallSilent or not DirExists(Data) then
    exit;
  { Keep is the first button, so the default: TaskDialogMsgBox has no default-button flag. }
  if TaskDialogMsgBox('Also delete your MTwin Manager accounts and settings?',
      'They are in ' + Data + '. Your Roblox accounts themselves are not affected.',
      mbConfirmation, MB_YESNO, ['&Keep them' #13#10 'They are there again if you reinstall MTwin Manager.',
      '&Delete them' #13#10 'Saved accounts, cookies, groups and settings. This cannot be undone.'], 0) = IDNO then begin
    DelTree(Data, True, True, True);
    { The window position tauri-plugin-window-state keeps. }
    DelTree(ExpandConstant('{userappdata}\com.mtwin.manager'), True, True, True);
    { What a version from before the rename left, if the app never started since to move it. }
    DelTree(ExpandConstant('{#LegacyDataDir}'), True, True, True);
    DelTree(ExpandConstant('{#LegacyWindowState}'), True, True, True);
  end;
end;
