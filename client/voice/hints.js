// The words a radio call is made of, for a recogniser that can be told what to expect
// (the game server's, see stt/server.py): the callsigns, this map's points and the words
// of procedure, in the language spoken. All of it comes from rules.json.

export function hintWords(rules, lang) {
  const cs = rules.callsigns;
  const radio = rules.radio;
  const names = [cs.player, cs.operator, cs.allStations, cs.contact, ...Object.values(cs.classes)].map((n) => n?.[lang]);
  const points = (rules.map?.points ?? []).map((p) => p.callsign[lang]);
  const procedure = [radio.marker[lang], radio.over[lang], radio.out[lang], ...Object.values(radio.prowords ?? {}).map((w) => w[lang]?.[0])];
  return [...new Set([...names, ...points, ...procedure].filter(Boolean))];
}
