// Builds progress-viewer/dist/ProgressViewer.exe: one Windows file with the dashboard and reporter
// inside, no Node.js needed. Needs Bun (https://bun.sh); works from Windows, Linux or macOS.
//
//   node progress-viewer/build-exe.mjs
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, "dist");
const gen = path.join(here, ".build");
fs.rmSync(gen, { recursive: true, force: true });
fs.mkdirSync(gen, { recursive: true });
fs.mkdirSync(dist, { recursive: true });

const assets = { "reporter.luau": fs.readFileSync(path.join(here, "reporter.luau"), "utf8") };
for (const f of fs.readdirSync(path.join(here, "public"))) assets["public/" + f] = fs.readFileSync(path.join(here, "public", f), "utf8");

// Imports run in order, so the assets are in place before server.mjs starts.
fs.writeFileSync(path.join(gen, "assets.mjs"), `globalThis.__PV_ASSETS = ${JSON.stringify(assets)};\n`);
fs.writeFileSync(path.join(gen, "entry.mjs"), `import "./assets.mjs";\nimport "../server.mjs";\n`);

const out = path.join(dist, "ProgressViewer.exe");
const bun = process.env.BUN || "bun";
execFileSync(bun, ["build", path.join(gen, "entry.mjs"), "--compile", "--minify", "--target=bun-windows-x64", "--outfile", out], { stdio: "inherit" });
fs.rmSync(gen, { recursive: true, force: true });
console.log(`\nBuilt ${out}`);
