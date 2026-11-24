// The game tools as the model sees them. The server owns what each one does and checks
// every call; these definitions only describe them.

const tool = (name, description, properties) => ({
  name,
  description,
  strict: true,
  input_schema: {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  },
});

const point = (what) => ({
  type: "string",
  description: `${what} A map point by id or any of its names, for example "F", "Foxtrot", "פסל" or "the town".`,
});

const radio = tool(
  "radio",
  'Transmit on the command net. The net writes the call ("<to>, this is <you>") and the closing word itself, so the body is only the message.',
  {
    to: {
      type: "array",
      items: { type: "string" },
      description: 'Callsigns to address, for example ["Hammer"], ["Viper 1", "Rhino 1"] or ["All stations"].',
    },
    body: { type: "string", description: 'The message alone, one short sentence, for example "Wilco" or "Contact, two vehicles north of Golf".' },
    end: { type: "string", enum: ["over", "out"], description: '"over" when you expect a reply, "out" when you do not.' },
  },
);

const report = tool("report", "Read the current situation: positions, orders, strength, contacts in sight and who holds each point.", {});

export const leaderTools = [
  radio,
  report,
  tool("move", "Send your squad to a point without stopping to fight on the way.", { point: point("Where to go.") }),
  tool("hold", "Send your squad to a point to defend it. The squad fights anything that comes in range.", {
    point: point('Where to hold. Use "here" to hold the ground you are on.'),
  }),
  tool("attack", "Advance and engage. Give a point to attack toward it, or a contact id to hunt that enemy squad. Fill one and leave the other empty.", {
    point: { type: "string", description: 'Point to attack toward, or "" when attacking a contact.' },
    contact: { type: "integer", description: "Enemy squad id from your status, or 0 when attacking a point." },
  }),
];

export const operatorTools = [
  radio,
  report,
  tool("buy", "Spend gold. Fill `unit` to raise a new squad, or `upgrade` to raise a squad's brain tier. Fill one and leave the other empty.", {
    unit: { type: "string", description: 'Unit id to buy, or "".' },
    upgrade: { type: "string", description: 'Callsign of the squad to upgrade, for example "Viper 2", or "".' },
  }),
  tool("haul", "Tell your gold haulers which field to work. They keep working it until told otherwise, even under threat, so use it on purpose.", {
    field: { type: "string", description: 'The gold field, by the map point it lies at ("K", "Kilo", "כרמל"), or "auto" to let the haulers choose a safe field themselves.' },
    hauler: { type: "integer", description: "One hauler's id from your status, or 0 for all of them." },
  }),
];

// normalize drops the empty placeholders strict schemas force the model to send.
export function normalize(name, input) {
  const args = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    if (value === "" || value === 0 || value == null) continue;
    if (name === "hold" && key === "point" && String(value).trim().toLowerCase() === "here") continue;
    args[key] = value;
  }
  return args;
}
