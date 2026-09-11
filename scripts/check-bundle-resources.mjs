// Fail the build if a bridge file on disk isn't covered by tauri.conf.json's
// `bundle.resources`.
//
//   node scripts/check-bundle-resources.mjs
//
// Why this exists: `bundle.resources` lists files by name and by NON-RECURSIVE
// glob, and a file that isn't listed is simply absent from the .app. Nothing
// warns — not the bundler, not the compiler, not a dev run, because in dev the
// bridge is loaded from the real checkout via a walk-up fallback. The first
// symptom is a runtime failure in a shipped build, on someone else's machine.
//
// That has already happened twice:
//   - agntchat_session.py was never listed, so the background-session route was
//     broken in every release build.
//   - agentchat/context/*.py was never listed, because `agentchat/*.py` does not
//     recurse. backends/anthropic.py imports `..context.compactor` unguarded, so
//     an API-key agent raised ImportError on its first tool_use turn.
//
// Runs in CI before the release build (.github/workflows/release.yml).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bridgeDir = join(root, "bridge");
const confPath = join(root, "src-tauri", "tauri.conf.json");

// Not shipped, and not expected to be: the runtime venv, bytecode caches, and
// the SDK's own test suite.
const SKIP_DIRS = new Set(["venv", "__pycache__", ".git", "tests", ".pytest_cache", "dist", "build"]);

/** Every .py under bridge/, as paths relative to bridge/. */
function collect(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) collect(full, out);
    } else if (entry.endsWith(".py")) {
      out.push(relative(bridgeDir, full));
    }
  }
  return out;
}

/** Resource entries are relative to src-tauri/, so "../bridge/x" → "x". */
function toBridgeRelative(resource) {
  const prefix = "../bridge/";
  return resource.startsWith(prefix) ? resource.slice(prefix.length) : null;
}

/** Matches Tauri's glob semantics for the patterns we actually use: a literal
 *  path, or a single-directory `dir/*.py`. `*` deliberately does NOT cross a
 *  path separator — that non-recursion is the bug this script exists to catch,
 *  so modelling it faithfully matters more than being permissive. */
function matches(pattern, file) {
  if (!pattern.includes("*")) return pattern === file;
  const re = new RegExp(
    "^" +
      pattern
        .split("*")
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("[^/]*") +
      "$"
  );
  return re.test(file);
}

const conf = JSON.parse(readFileSync(confPath, "utf8"));
const patterns = (conf.bundle?.resources ?? [])
  .map(toBridgeRelative)
  .filter((p) => p !== null);

const files = collect(bridgeDir).sort();
const missing = files.filter((f) => !patterns.some((p) => matches(p, f)));

if (missing.length > 0) {
  console.error(
    `\n${missing.length} bridge file(s) exist on disk but are NOT in ` +
      `tauri.conf.json bundle.resources.\n` +
      `They will be silently absent from the built app:\n`
  );
  for (const f of missing) console.error(`  bridge/${f}`);
  console.error(
    `\nAdd them to bundle.resources as "../bridge/<path>". Remember the globs\n` +
      `do not recurse: a new subpackage needs its own "dir/*.py" entry.\n`
  );
  process.exit(1);
}

// The reverse drift — a listed file that no longer exists — is worth catching
// too: Tauri errors on it at bundle time, but only after a full compile.
const stale = patterns.filter(
  (p) => !p.includes("*") && !files.includes(p) && !p.endsWith(".txt")
);
if (stale.length > 0) {
  console.error(`\nbundle.resources lists files that do not exist:\n`);
  for (const p of stale) console.error(`  ../bridge/${p}`);
  process.exit(1);
}

console.log(
  `bundle.resources OK: ${files.length} bridge .py files all covered by ` +
    `${patterns.length} patterns`
);
