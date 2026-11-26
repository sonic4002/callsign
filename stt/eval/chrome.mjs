// Transcribes the test recordings with the page's own speech worker (client/voice/worker.js)
// in headless Chrome, and measures what a player would wait: the time from letting go of
// the button to the text, on a slowed CPU if asked, and the memory the tab took.
//
//   node stt/eval/chrome.mjs --lang he [--model he-whisper] [--name chrome-he] [--main --throttle 4] [--no-isolation]
//                            [--live] [--paced] [--limit 12] [--about 3] [--mic] [--port 8931]
//
//   --throttle N     slow the CPU N times (Chrome's own throttling). It slows only a page's
//                    main thread, not its workers (measured: a worker runs at full speed
//                    whatever the rate), so it is used together with --main
//   --main           run the worker's code on the page's main thread, where throttling bites
//   --no-isolation   serve without the cross-origin isolation headers: one WebAssembly thread,
//                    as in a browser that gives the page no threads
//   --live           send each recording in pieces as it is made (begin / audio / end)
//   --paced          with --live: at the speed of speech, as when the button is held
//   --about N        only the recordings within 0.4 s of N seconds long
//   --mic            the whole push-to-talk path instead of the worker alone: Chrome plays
//                    each recording as its microphone and client/voice/voice.js holds the
//                    button for as long as it lasts (mic.html). Slow: the speed of speech.
//
// Writes assets/stt-eval/results/<name>.json for score.mjs. Needs `make voice-models`, the
// recordings of `make stt-eval`, and google-chrome. Chrome runs muted with a profile of its
// own that is deleted afterwards; the pages are served from this checkout on a local port.

import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import { hintPhrases } from "../../client/voice/hints.js";

const flag = (name) => process.argv.includes(name);
const arg = (name, or) => (flag(name) ? process.argv[process.argv.indexOf(name) + 1] : or);
const root = fileURLToPath(new URL("../../", import.meta.url));
const lang = arg("--lang", "he");
const model = arg("--model", lang); // a key of client/voice/models.json, when not the language's own
const name = arg("--name", `chrome-${model}`);
const throttle = Number(arg("--throttle", 1));
const isolation = !flag("--no-isolation");
const port = Number(arg("--port", 8931));
const rules = JSON.parse(readFileSync(join(root, "shared/rules.json")));
rules.map = rules.maps.large;
const index = JSON.parse(readFileSync(join(root, "assets/stt-eval/index.json"))).filter((i) => i.lang === lang);
const length = (item) => (statSync(join(root, "assets/stt-eval", item.file)).size - 44) / 32000; // seconds: 16-bit, 16 kHz
const about = Number(arg("--about", 0));
const items = index.filter((i) => !about || Math.abs(length(i) - about) <= 0.4).slice(0, Number(arg("--limit", index.length)));
const mic = flag("--mic");

// ---- the pages, served the way the game server serves them ----
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".wasm": "application/wasm", ".wav": "audio/wav", ".bin": "application/octet-stream" };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
  const file = path === "/eval.html" ? join(root, "stt/eval/chrome.html") : path === "/mic.html" ? join(root, "stt/eval/mic.html") : path.startsWith("/assets/") ? join(root, path) : join(root, "client", path);
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) return res.writeHead(404).end();
  const headers = { "Content-Type": types[extname(file)] ?? "application/octet-stream", "Content-Length": statSync(file).size };
  if (isolation) Object.assign(headers, { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" });
  res.writeHead(200, headers);
  createReadStream(file).pipe(res);
});
await new Promise((done) => server.listen(port, "127.0.0.1", done));

// ---- Chrome, spoken to over its debugging socket ----
const profile = mkdtempSync(join(tmpdir(), "callsign-chrome-"));
process.on("exit", () => rmSync(profile, { recursive: true, force: true }));

// browser starts Chrome (muted, on a profile of its own) and opens one page in it. With a
// recording to play, that file is its microphone, played once, and it is given without asking.
async function browser(recording) {
  const fake = recording ? ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${recording}%noloop`] : [];
  const chrome = spawn("google-chrome", ["--headless=new", "--mute-audio", "--no-first-run", "--disable-gpu", `--user-data-dir=${profile}`, "--remote-debugging-port=0", ...fake, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const wsUrl = await new Promise((resolve, reject) => {
    let err = "";
    chrome.stderr.on("data", (d) => {
      err += d;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(err);
      if (m) resolve(m[1]);
    });
    chrome.on("exit", () => reject(new Error(`Chrome did not start: ${err}`)));
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((done) => ws.addEventListener("open", done));
  let nextId = 1;
  const calls = new Map();
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      calls.set(id, { resolve, reject, method });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  ws.addEventListener("message", ({ data }) => {
    const msg = JSON.parse(data);
    if (!msg.id) return;
    const call = calls.get(msg.id);
    calls.delete(msg.id);
    if (msg.error) call.reject(new Error(`${call.method}: ${msg.error.message}`));
    else call.resolve(msg.result);
  });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId: page } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, page);
  if (throttle > 1) await send("Emulation.setCPUThrottlingRate", { rate: throttle }, page);
  const run = async (expression) => {
    const { result, exceptionDetails } = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, page);
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  };
  const open = async (path, ready) => {
    await send("Page.navigate", { url: `http://127.0.0.1:${port}${path}` }, page);
    for (let i = 0; i < 100 && !(await run(ready).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 100));
  };
  const close = () =>
    new Promise((done) => {
      ws.close();
      if (chrome.exitCode !== null) return done();
      chrome.once("exit", done).kill();
    });
  return { run, open, close };
}

// The most memory any of this Chrome's page processes has held (VmHWM, its resident
// peak) or holds now (VmRSS), in MB.
function memory(field = "VmHWM") {
  let peak = 0;
  for (const pid of readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
    try {
      const cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8");
      if (!cmd.includes(profile) || !cmd.includes("--type=renderer")) continue;
      const kb = Number(new RegExp(`${field}:\\s+(\\d+)`).exec(readFileSync(`/proc/${pid}/status`, "utf8"))?.[1] ?? 0);
      peak = Math.max(peak, kb / 1024);
    } catch {
      // the process ended while it was being read
    }
  }
  return Math.round(peak);
}

const cs = rules.callsigns;
const names = { openers: [...Object.values(cs.classes).map((c) => c[lang]), cs.operator[lang], cs.allStations[lang]], phrases: hintPhrases(rules, lang) };
const out = {};
let chrome;
try {
  if (mic) {
    // One Chrome per recording: its microphone is that recording, from its first sample.
    let live = 0;
    for (const item of items) {
      chrome = await browser(join(root, "assets/stt-eval", item.file));
      await chrome.open("/mic.html", "typeof window.talk === 'function'");
      const got = await chrome.run(`window.talk(${JSON.stringify(lang)}, ${length(item)}, ${JSON.stringify(names)})`);
      await chrome.close();
      live += got.live;
      out[item.file] = { text: got.text, ms: got.ms, seconds: length(item) };
      if (flag("--verbose")) console.log(item.file, JSON.stringify(got));
    }
    console.log(`push-to-talk with the recording as the microphone: ${live} of ${items.length} handed over live`);
  } else {
    chrome = await browser();
    await chrome.open(`/eval.html${flag("--main") ? "?main" : ""}`, "typeof window.say === 'function'");
    const empty = memory();
    const isolated = await chrome.run("window.isolated()");
    const ready = await chrome.run(`window.load(${JSON.stringify(model)})`);
    console.log(`${ready.model}: started in ${ready.ms} ms with ${ready.threads} thread(s); cross-origin isolated: ${isolated}; ${flag("--main") ? "on the main thread" : "in a worker"}; main thread slowed ${throttle}x`);
    const opts = { ...names, live: flag("--live"), paced: flag("--paced") };
    for (const item of items) {
      const got = await chrome.run(`window.say(${JSON.stringify(`/assets/stt-eval/${item.file}`)}, ${JSON.stringify(model)}, ${JSON.stringify(opts)})`);
      out[item.file] = { text: got.text, ms: got.ms, seconds: got.seconds };
    }
    console.log(`memory: the tab peaked at ${memory()} MB and holds ${memory("VmRSS")} MB now (${empty} MB before the model was loaded)`);
  }
  const ms = Object.values(out).map((o) => o.ms).sort((a, b) => a - b);
  const seconds = Object.values(out).reduce((n, o) => n + o.seconds, 0) / ms.length;
  console.log(`${name}: ${ms.length} recordings of ${seconds.toFixed(1)} s on average; wait after the last word: median ${ms[ms.length >> 1]} ms, 9 in 10 within ${ms[Math.floor(ms.length * 0.9)]} ms, longest ${ms.at(-1)} ms`);
  mkdirSync(join(root, "assets/stt-eval/results"), { recursive: true });
  writeFileSync(join(root, `assets/stt-eval/results/${name}.json`), JSON.stringify(out, null, 1));
} finally {
  await chrome?.close();
  server.closeAllConnections();
  server.close();
}
