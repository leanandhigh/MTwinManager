# MTwin Manager

A fast, local-only Roblox account manager and multi-client launcher for Windows.
Your cookies stay encrypted on your PC, and nothing is sent anywhere except Roblox.

## What it does

- **Accounts**: add each account once through Roblox's own sign-in page, group them, and see at a
  glance which are signed in, online or need attention.
- **Play**: paste a game link, a private server link, a Place ID or a username, pick one account or
  many, and launch them, into the same server if you want.
- **Home**: every running client as a live card. Clients that crash or get disconnected can be
  brought back automatically.
- **Servers**: browse a game's public and private servers and join with any account.
- **Progress**: live stats from your accounts, reported by a script you run in game.
- **Monitor and Performance**: CPU, memory and network per client, with limits and presets for
  running many clients on one PC.
- **Roblox updates, Browse, Discord notifications** and an in-app log for when something goes wrong.

English and Thai are built in.

## Safety and privacy

- Accounts live in an encrypted database on this PC, unlocked by Windows or by a master password.
- The app talks to Roblox and to GitHub (its own updates). Discord is contacted only once
  you set a webhook, and the optional item values and version lists come from their public sources.
- It sends no usage statistics.

## Build from source

Windows 10 1809 or later, x64.

1. Run `setup.bat` once. It installs Node.js, Rust and the other build tools with winget, then builds.
2. After that, `build-exe.bat` builds the installer into `dist-installer` and the app itself next to
   the script.

For UI work, `npm install` and `npm run dev` open the interface in a browser against a fake backend,
with no Rust build needed.

| Command | What it does |
|---|---|
| `npm run dev` | The interface in a browser, with a fake backend |
| `npm run build` | Type-check, check the translations, build the interface |
| `npm run tauri dev` | The real app, with live reload |
| `cargo test --locked` (in `src-tauri`) | The backend's tests |

## Project layout

| Path | What is there |
|---|---|
| `src/` | The interface: React 19, TypeScript, Tailwind 4 |
| `src/features/` | One folder per page |
| `src/i18n/locales/` | The interface's text, English and Thai |
| `src-tauri/src/` | The backend: Rust, Tauri 2 |
| `src-tauri/locales/` | The backend's Thai text |
| `installer/` | The Inno Setup script |

## License

MIT. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).
