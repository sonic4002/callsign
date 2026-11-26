// The agent runtime also runs in the player's browser, and the game server serves only
// the modules it lists (server/cmd/callsign/main.go: browserModules). A module one of
// those imports and the list forgets is a page that never starts.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("every module the browser's agent modules import is one the server serves", () => {
  const main = read("../../server/cmd/callsign/main.go");
  const list = main.slice(main.indexOf("var browserModules"), main.indexOf("func agentModules"));
  const served = new Set([...list.matchAll(/"([\w-]+\.mjs)": true/g)].map((m) => m[1]));
  assert.ok(served.has("agent.mjs") && served.size > 10, "the list was not read");
  for (const name of served) {
    // Static imports only: a module fetched on demand in Node alone (a Node-only brain) is not the browser's.
    for (const m of read(`../${name}`).matchAll(/^(?:import|export)\s[^;]*?from\s+"\.\/([\w-]+\.mjs)"/gm)) {
      assert.ok(served.has(m[1]), `${name} imports ${m[1]}, which the server does not serve to browsers`);
    }
  }
});
