// What a radio call is made of, for a recogniser that can be told what to expect (the
// game server's, see stt/server.py): the callsigns, this map's points and the words of
// procedure, in the language spoken. All of it comes from rules.json.
//
// Whisper takes its hint as "what was said just before", and follows its spelling and
// punctuation as well as its words. So the hint is written as radio traffic: a few calls
// in the form the page itself writes, then the names that did not fit into them.

const orders = {
  en: ["Move to {p}", "Hold {p}", "Attack {p}"],
  he: ["נועו ל{p}", "תחזיקו את {p}", "תקפו את {p}"],
};

// hintWords lists the words: every callsign, every point of the map, the procedure words.
export function hintWords(rules, lang) {
  const cs = rules.callsigns;
  const radio = rules.radio;
  const names = [cs.player, cs.operator, cs.allStations, cs.contact, ...Object.values(cs.classes)].map((n) => n?.[lang]);
  const points = (rules.map?.points ?? []).map((p) => p.callsign[lang]);
  const procedure = [radio.marker[lang], radio.over[lang], radio.out[lang], ...Object.values(radio.prowords ?? {}).map((w) => w[lang]?.[0])];
  return [...new Set([...names, ...points, ...procedure].filter(Boolean))];
}

// hintCalls is the same vocabulary as traffic: one call to each kind of squad, to the
// operator and to all stations, then the rest of the names as a list.
export function hintCalls(rules, lang) {
  const cs = rules.callsigns;
  const radio = rules.radio;
  const [marker, over, out, me] = [radio.marker[lang], radio.over[lang], radio.out[lang], cs.player[lang]];
  const points = (rules.map?.points ?? []).map((p) => p.callsign[lang]);
  const prowords = Object.values(radio.prowords ?? {}).map((w) => w[lang]?.[0]).filter(Boolean);
  const call = (to, body, end) => (lang === "he" ? `${to}, ${marker} ${me}, ${body}, ${end}.` : `${to}, ${marker} ${me}. ${body[0].toUpperCase()}${body.slice(1)}. ${end}.`);
  const calls = Object.values(cs.classes).map((c, i) => call(`${c[lang]} ${(i % 3) + 1}`, orders[lang][i % 3].replace("{p}", points[i] ?? ""), i % 4 === 3 ? out : over));
  const used = Object.keys(cs.classes).length;
  if (prowords.length > 1) calls.push(call(cs.operator[lang], prowords[0], out), call(cs.allStations[lang], prowords[1], over));
  const rest = [...points.slice(used), cs.contact?.[lang] && `${cs.contact[lang]} 2`, ...prowords.slice(2)].filter(Boolean);
  return `${calls.join(" ")} ${rest.join(", ")}.`;
}
