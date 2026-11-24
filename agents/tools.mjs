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

// A place is where an order sends the squad. The server reads all of these forms.
const place = (what) => ({
  type: "string",
  description: `${what} One of: a map point by id or any of its names ("F", "Foxtrot", "פסל", "the town"); a landmark or bridge by its id from the map list ("F-house-1", "bridge-south") or by its name ("the grove north of Foxtrot"); or a spot off a point, as "<bearing> of <point> [<metres>]" ("north of Foxtrot", "NE of D 150").`,
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
  tool("move", "Send your squad to a place without stopping to fight on the way. Only a move order takes a squad across a bridge that is about to fall.", {
    place: place("Where to go."),
  }),
  tool("hold", "Send your squad to a place to defend it. The squad fights anything that comes in range and takes the cover the place offers: infantry go inside a building named or standing at the post.", {
    place: place('Where to hold. Use "here" to hold the ground you are on.'),
  }),
  tool("attack", "Advance and engage. Give a place to attack toward it, or a contact id to hunt that enemy squad. Fill one and leave the other empty. Naming a bridge or a building makes the squad shoot at it once in range.", {
    place: { type: "string", description: 'Place to attack toward, in any form a place takes, or "" when attacking a contact.' },
    contact: { type: "integer", description: "Enemy squad id from your status, or 0 when attacking a place." },
  }),
];

// repairTool is for squads whose unit mends bridges.
export const repairTool = tool("repair", "Go to a bridge and mend it. The squad works from the bank while nobody shoots at it; a fallen bridge stands again part-way through.", {
  place: { type: "string", description: 'The bridge, by id or name ("bridge-south", "the south bridge").' },
});

// leaderToolsFor is the tool list of the leader of a squad of that unit.
export const leaderToolsFor = (unit) => (unit?.repairPerSecond > 0 ? [...leaderTools, repairTool] : leaderTools);

export const operatorTools = [
  radio,
  report,
  tool("buy", "Spend gold. Fill `unit` to raise a new squad, or `upgrade` to raise a squad's brain tier. Fill one and leave the other empty.", {
    unit: { type: "string", description: 'Unit id to buy, or "".' },
    upgrade: { type: "string", description: 'Callsign of the squad to upgrade, for example "Viper 2", or "".' },
  }),
];

// normalize drops the empty placeholders strict schemas force the model to send.
export function normalize(name, input) {
  const args = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    if (value === "" || value === 0 || value == null) continue;
    if (name === "hold" && (key === "point" || key === "place") && String(value).trim().toLowerCase() === "here") continue;
    args[key] = value;
  }
  return args;
}
