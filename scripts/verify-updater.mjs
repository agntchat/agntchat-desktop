// Prove the self-update path end to end, locally, without publishing anything.
//
//   node scripts/verify-updater.mjs 0.1.2 0.11.0
//
// Builds TWO release bundles — an "old" one and a "new" one — with the updater
// endpoint pointed at a local file server instead of GitHub, then serves a
// signed latest.json advertising the new version. Launch the staged old app and
// you should see the real update toast, a real signature check, a real install,
// and a relaunch into the new version.
//
// Worth running whenever anything in the update chain moves: the endpoint, the
// keypair, plugins.updater config, tauri-plugin-updater's major version, or
// src/lib/updater.ts. A broken updater is invisible until the release after the
// one that broke it, by which point every installed app is stranded.
//
// Restores tauri.conf.json, package.json and Cargo.toml on exit, including on
// Ctrl-C — but it does edit them while running, so don't run it on a dirty tree
// you care about.

import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const confPath = join(root, "src-tauri", "tauri.conf.json");
const pkgPath = join(root, "package.json");
const cargoPath = join(root, "src-tauri", "Cargo.toml");

const PORT = 8787;
const STAGE = join(root, "target-updater-test");
const KEY = join(process.env.HOME, ".agntchat-release", "agntchat-updater.key");

const oldVersion = process.argv[2];
const newVersion = process.argv[3];

if (!oldVersion || !newVersion) {
  console.error("Usage: node scripts/verify-updater.mjs <old-version> <new-version>");
  console.error("   e.g. node scripts/verify-updater.mjs 0.1.2 0.11.0");
  process.exit(1);
}

if (!existsSync(KEY)) {
  console.error(`Updater private key not found at ${KEY}`);
  console.error("See docs/reference/releasing-clients.md § The two kinds of signing.");
  process.exit(1);
}

// The target triple decides which entry of latest.json the running app reads.
const arch = process.arch === "x64" ? "x86_64" : "aarch64";
const target = `${arch}-apple-darwin`;
const platformKey = `darwin-${process.arch === "x64" ? "x86_64" : "aarch64"}`;

// --- save originals so an interrupted run doesn't leave the repo rewritten ---
const originals = new Map(
  [confPath, pkgPath, cargoPath].map((p) => [p, readFileSync(p, "utf8")])
);

function restore() {
  for (const [p, text] of originals) writeFileSync(p, text);
}
process.on("SIGINT", () => {
  restore();
  console.log("\nRestored tauri.conf.json / package.json / Cargo.toml.");
  process.exit(130);
});

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { cwd: root, stdio: "inherit", ...opts });
}

/** Build a release bundle at `version` with the endpoint pointed at localhost. */
function buildAt(version) {
  console.log(`\n=== building ${version} ===`);
  run("node", [join(root, "scripts", "bump-version.mjs"), version]);

  const conf = JSON.parse(readFileSync(confPath, "utf8"));
  conf.plugins.updater.endpoints = [`http://localhost:${PORT}/latest.json`];
  writeFileSync(confPath, JSON.stringify(conf, null, 2) + "\n");

  run("npx", ["tauri", "build", "--target", target], {
    env: {
      ...process.env,
      // Literally "true" — the CLI parses CI as its own --ci flag and rejects
      // any other value. Without it, bundle_dmg.sh drives Finder over
      // AppleScript to style the .dmg window and hangs forever in a
      // non-interactive shell. GitHub's runners set this themselves.
      CI: "true",
      // Contents, not a path: the bundler ignores TAURI_SIGNING_PRIVATE_KEY_PATH
      // and fails after the compile with "no private key".
      TAURI_SIGNING_PRIVATE_KEY: readFileSync(KEY, "utf8"),
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "",
    },
  });

  return join(root, "src-tauri", "target", target, "release", "bundle", "macos");
}

function findOne(dir, ext) {
  const hit = readdirSync(dir).find((f) => f.endsWith(ext));
  if (!hit) throw new Error(`No ${ext} in ${dir}`);
  return join(dir, hit);
}

rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });

try {
  // The old build is what you launch; stage the .app before the next build
  // overwrites it.
  const oldDir = buildAt(oldVersion);
  const oldApp = findOne(oldDir, ".app");
  const stagedApp = join(STAGE, `agntchat-${oldVersion}.app`);
  cpSync(oldApp, stagedApp, { recursive: true });

  // The new build supplies the updater artifacts the old one will download.
  const newDir = buildAt(newVersion);
  const tarball = findOne(newDir, ".app.tar.gz");
  const sig = findOne(newDir, ".app.tar.gz.sig");

  const assetName = tarball.split("/").pop();
  copyFileSync(tarball, join(STAGE, assetName));

  writeFileSync(
    join(STAGE, "latest.json"),
    JSON.stringify(
      {
        version: newVersion,
        notes: "Local updater verification build.",
        pub_date: new Date().toISOString(),
        platforms: {
          [platformKey]: {
            signature: readFileSync(sig, "utf8").trim(),
            url: `http://localhost:${PORT}/${assetName}`,
          },
        },
      },
      null,
      2
    ) + "\n"
  );
} finally {
  restore();
  console.log("\nRestored tauri.conf.json / package.json / Cargo.toml.");
}

// --- serve the staging dir ---
const TYPES = { ".json": "application/json", ".gz": "application/gzip" };

createServer((req, res) => {
  const name = decodeURIComponent((req.url || "/").split("?")[0].replace(/^\//, ""));
  const file = join(STAGE, name);
  // Only ever serve out of the staging dir.
  if (!file.startsWith(STAGE) || !existsSync(file)) {
    res.writeHead(404).end("not found");
    return;
  }
  console.log(`  served ${name}`);
  res.writeHead(200, {
    "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
  });
  res.end(readFileSync(file));
}).listen(PORT, () => {
  console.log(`
Serving ${STAGE} on http://localhost:${PORT}

Now launch the old build and watch for the toast:

  open "${join(STAGE, `agntchat-${oldVersion}.app`)}"

Expect: "Version ${newVersion} is available" → Install → progress → restart.
After restarting, Profile should report ${newVersion}.

Ctrl-C to stop the server. Delete ${STAGE} when done.
`);
});
