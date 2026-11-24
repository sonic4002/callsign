// Renders the install icons from the two SVGs beside this file, with headless Chrome:
//
//   node client/icons/render.mjs
//
// mark.svg has rounded corners; maskable.svg fills the square and keeps the mark inside
// the middle the phone is sure to show. Run again after changing either.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const chrome = process.env.CHROME || "google-chrome";
const icons = [
  ["mark.svg", 192, "icon-192.png"],
  ["mark.svg", 512, "icon-512.png"],
  ["maskable.svg", 512, "maskable-512.png"],
  ["maskable.svg", 180, "apple-touch-icon.png"], // iOS rounds the corners itself
];

const work = mkdtempSync(join(tmpdir(), "callsign-icons-"));
for (const [svg, size, out] of icons) {
  const page = join(work, `${out}.html`);
  const art = readFileSync(join(here, svg), "utf8").replace("<svg ", `<svg width="${size}" height="${size}" `);
  writeFileSync(page, `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>${art}`);
  execFileSync(chrome, ["--headless=new", "--no-sandbox", "--hide-scrollbars", "--default-background-color=00000000", `--window-size=${size},${size}`, `--screenshot=${join(here, out)}`, `file://${page}`], { stdio: "ignore" });
  console.log(out);
}
