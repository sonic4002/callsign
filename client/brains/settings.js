// The "AI" dialog: where the player's squads think, the player's key on the relay, and
// what the match has cost so far. The key is typed here once, sent to this game's relay,
// and then forgotten by the page: afterwards only its provider and last characters show.

import { BrowserAgents } from "./host.js";

const $ = (id) => document.getElementById(id);

// mountAgents wires the dialog and starts the page's agent host. t(key, vars) translates;
// system(key, vars, tone) writes a line in the radio log. seat() gives the seat the page
// holds in the lobby's match right now, or null. It returns { agents, render }.
export function mountAgents({ t, system, server, side, seat, canAct }) {
  const provider = (id) => (id ? t(`provider.${id}`) : "");
  const agents = new BrowserAgents({
    server,
    side,
    seat,
    canAct,
    say: (what, vars = {}, tone = "") => system(`agents.${what}`, { provider: provider(vars.provider), reason: vars.code ? t(`trouble.${vars.code}`) : "" }, tone),
    onChange: () => render(),
  });
  let note = ""; // what went wrong with the last save, as a trouble code

  function render() {
    const { key, usage } = agents;
    $("brains-status").textContent = t(`brains.${agents.status}`, { provider: provider(key.provider), hint: key.hint, count: agents.workers });
    $("brains-keyline").textContent = agents.relayUp === false ? t("brains.norelay") : key.set ? t("brains.keyset", { provider: provider(key.provider), hint: key.hint }) : t("brains.nokey");
    for (const id of ["brains-provider", "brains-input", "brains-save"]) $(id).disabled = agents.relayUp === false;
    $("brains-remove").hidden = !key.set;
    $("brains-note").hidden = !note;
    $("brains-note").textContent = note ? t(`trouble.${note}`) : "";
    $("brains-demo").checked = agents.demo;
    $("brains-usage").textContent = t("brains.count", { calls: usage.calls, input: usage.input.toLocaleString("en"), output: usage.output.toLocaleString("en") });
    $("brains-open").classList.toggle("live", agents.status === "relay" || agents.status === "demo");
  }

  $("brains-open").addEventListener("click", () => {
    note = "";
    render();
    $("brains").showModal();
    agents.refresh();
  });
  $("brains-save").addEventListener("click", async () => {
    const input = $("brains-input");
    const key = input.value.trim();
    if (!key) return input.focus();
    $("brains-save").disabled = true;
    try {
      await agents.saveKey($("brains-provider").value, key);
      note = "";
    } catch (err) {
      note = err.code ?? "failed";
    }
    input.value = ""; // the page keeps no copy, whether or not the relay took it
    render();
  });
  $("brains-remove").addEventListener("click", async () => {
    try {
      await agents.removeKey();
      note = "";
    } catch (err) {
      note = err.code ?? "failed";
    }
    render();
  });
  $("brains-demo").addEventListener("change", (ev) => agents.setDemo(ev.target.checked));

  agents.refresh();
  return { agents, render };
}
