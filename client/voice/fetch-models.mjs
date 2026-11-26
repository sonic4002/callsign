// make voice-models: downloads the speech runtime and the recognisers named in
// models.json, each from a pinned version, and checks every file against its SHA-256.
// Files already in place and correct are left alone. Run from the repository root.
// A model marked "optional" (the older Hebrew one, used only where the first is not on
// the server) is fetched only with --all.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const manifest = JSON.parse(readFileSync(new URL("models.json", import.meta.url)));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function get(url, file, want) {
  if (existsSync(file) && sha(readFileSync(file)) === want.sha256) return console.log(`ok       ${file}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (sha(bytes) !== want.sha256) throw new Error(`${url}: checksum does not match models.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.part`, bytes);
  renameSync(`${file}.part`, file);
  console.log(`fetched  ${file} (${(bytes.length / 1e6).toFixed(1)} MB)`);
}

const rt = manifest.runtime;
for (const f of rt.files) await get(rt.source + f.path, join(rt.dir, f.path), f);
const all = process.argv.includes("--all");
for (const m of Object.values(manifest.models)) {
  if (m.optional && !all) continue;
  for (const f of Object.values(m.files)) {
    await get(`https://huggingface.co/${m.name}/resolve/${m.revision}/${f.path}`, join("assets/models", m.dir, f.path), f);
  }
}
