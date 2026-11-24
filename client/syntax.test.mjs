// Every module of the page must parse. The page has no build step, so a stray brace is
// only found when a browser loads the file; `node --check` on a .js file here does not
// see it either (outside a module package it is not parsed as a module). Each file is
// checked as the module it is.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const modules = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "vendor" || name === "testdata" ? [] : modules(path);
    return name.endsWith(".js") && name !== "sw.js" ? [path] : [];
  });

test("every module of the page parses", () => {
  const scratch = mkdtempSync(join(tmpdir(), "callsign-syntax-"));
  for (const [i, path] of modules(root).entries()) {
    const copy = join(scratch, `m${i}.mjs`);
    writeFileSync(copy, readFileSync(path));
    try {
      execFileSync(process.execPath, ["--check", copy], { stdio: "pipe" });
    } catch (err) {
      assert.fail(`${path.slice(root.length)} does not parse:\n${String(err.stderr).split("\n").slice(1, 5).join("\n")}`);
    }
  }
});
