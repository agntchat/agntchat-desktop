#!/usr/bin/env node
// `npm run tauri:dev` — `tauri dev` on a configurable port.
//
// The dev server port lives in two places that must agree: Vite's
// `server.port` (vite.config.ts) and Tauri's `build.devUrl`
// (src-tauri/tauri.conf.json). Vite already reads TAURI_DEV_PORT; this
// wrapper passes the matching devUrl to Tauri via `--config`, so one
// variable moves both:
//
//   TAURI_DEV_PORT=1500 npm run tauri:dev
//   (PowerShell)  $env:TAURI_DEV_PORT=1500; npm run tauri:dev
//
// Any extra arguments are forwarded to `tauri dev` unchanged. Set
// TAURI_DEV_DRY_RUN=1 to print the command instead of running it.
//
// Why not just kill whatever is on 1420? Usually you should — a stale
// `npm run dev` is the common cause of "Port 1420 is already in use" — but
// when the port is genuinely taken (another project, a corporate agent),
// this is the supported way to sidestep it without editing tracked files.

import { spawn } from "node:child_process";

const raw = process.env.TAURI_DEV_PORT;
const port = raw ? Number(raw) : 1420;

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`tauri-dev: TAURI_DEV_PORT must be a port number, got ${JSON.stringify(raw)}`);
  process.exit(2);
}

const overrides = JSON.stringify({ build: { devUrl: `http://localhost:${port}` } });
const args = ["tauri", "dev", "--config", overrides, ...process.argv.slice(2)];

if (process.env.TAURI_DEV_DRY_RUN) {
  console.log(`TAURI_DEV_PORT=${port} npx ${args.map((a) => JSON.stringify(a)).join(" ")}`);
  process.exit(0);
}

console.log(`tauri-dev: Vite + Tauri on http://localhost:${port}`);

const child = spawn("npx", args, {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, TAURI_DEV_PORT: String(port) },
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
