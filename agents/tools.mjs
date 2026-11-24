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
  tool("attack", "Advance and engage. Give a place to attack toward it, or a contact id to hunt that enemy squad. Fill one and leave the other empty. Naming a bridge, a building or an enemy structure makes the squad shoot at it once in range.", {
    place: { type: "string", description: 'Place to attack toward, in any form a place takes, or an enemy structure by its id from your status ("s7") or its name ("the enemy works"), or "" when attacking a contact.' },
    contact: { type: "integer", description: "Enemy squad id from your status, or 0 when attacking a place." },
  }),
];

// Squads that mend bridges get repair; engineer squads also take over enemy structures.
export const repairTool = tool("repair", "Go to a bridge and mend it. The squad works from the bank while nobody shoots at it; a fallen bridge stands again part-way through.", {
  place: { type: "string", description: 'The bridge, by id or name ("bridge-south", "the south bridge").' },
});
export const captureTool = tool("capture", "Take over an enemy base structure. Your squad walks to it and, after a few seconds beside it without being shot at, the structure is your side's and the squad stays inside it for good.", {
  place: { type: "string", description: 'The enemy structure: its id from your status, such as "s7", or its name ("the enemy refinery").' },
});

// Infantry dig in; each hero has the one tool that makes it a hero.
export const fortifyTool = tool("fortify", "Dig in: build a sandbag position where your squad stands. It takes a few seconds in which the squad does not move and is not shot at, faces the nearest enemy in sight (or the nearest point your side does not hold), and covers your men from that front only. Your squad then holds it.", {});
export const plantTool = tool("plant", "Set a demolition charge. You walk to the target, work beside it for a few seconds, and the charge goes off a few seconds later. You carry only a few.", {
  place: { type: "string", description: 'What to set the charge on: an enemy structure by its id from your status ("s7") or its name ("the enemy works"), a bridge by id or name ("bridge-south", "the south bridge"), or the enemy headquarters by its point ("Z").' },
});
export const seizeTool = tool("seize", "Take over an enemy vehicle squad in sight. You close with it and, after a few seconds near it, it fights for your side with a leader of its own, for as long as you live and stay near it. One at a time.", {
  contact: { type: "integer", description: "The enemy vehicle squad's contact id from your status." },
});

// leaderToolsFor is the tool list of the leader of a squad of that unit.
export const leaderToolsFor = (unit) => [
  ...leaderTools,
  ...(unit?.captureSeconds > 0 ? [captureTool] : []),
  ...(unit?.repairPerSecond > 0 ? [repairTool] : []),
  ...(unit?.class === "infantry" && unit.domain === "land" && !unit.hero ? [fortifyTool] : []),
  ...(unit?.chargeDamage > 0 ? [plantTool] : []),
  ...(unit?.seizeRadius > 0 ? [seizeTool] : []),
];

export const operatorTools = [
  radio,
  report,
  tool("build", "Spend gold to start a structure. Base structures take their own place by your headquarters; a defence or a fence takes a place.", {
    structure: { type: "string", description: 'Structure id from your list, for example "vehicleWorks".' },
    place: { type: "string", description: 'For a defence or a fence: a point you hold, a structure of yours by id, or a side of your base such as "base:front" or "base:north". "" for a base structure, or to use the front of your base.' },
    place2: { type: "string", description: 'Only for a fence that runs from `place` toward a second place; otherwise "".' },
  }),
  tool("buy", "Spend gold. Fill `unit` to raise a new squad, or `upgrade` to raise a squad's brain tier. Fill one and leave the other empty.", {
    unit: { type: "string", description: 'Unit id to buy, or "".' },
    upgrade: { type: "string", description: 'Callsign of the squad to upgrade, for example "Viper 2", or "".' },
  }),
  tool(
    "command",
    'Set who decides, after Hammer gave or took back the fight or the purse in words of their own, or gave you a standing task that needs them ("buy troops and push forward"). The fixed phrases ("run the fight", "I have command", "you may buy", "do not buy") switch them without you; your status always shows both.',
    {
      mode: { type: "string", enum: ["orders", "fight"], description: 'Who tasks the squads from now on: "fight" when Hammer handed you the fight, "orders" when Hammer commands. Give the current one to change only `buy`.' },
      buy: { type: "boolean", description: "Whether you may buy and upgrade on your own from now on: true when Hammer let you (or handed you the fight without holding the purse back), false when Hammer told you not to spend or took command back." },
    },
  ),
  tool("haul", "Tell your gold haulers which field to work. They keep working it until told otherwise, even under threat, so use it on purpose.", {
    field: { type: "string", description: 'The gold field, by the map point it lies at ("K", "Kilo", "כרמל"), or "auto" to let the haulers choose a safe field themselves.' },
    hauler: { type: "integer", description: "One hauler's id from your status, or 0 for all of them." },
  }),
];

// normalize drops the empty placeholders strict schemas force the model to send.
export function normalize(name, input) {
  const args = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    if (name === "command" && key === "buy") {
      args[key] = value; // false is the whole point of this one
      continue;
    }
    if (value === "" || value === 0 || value == null) continue;
    if (name === "hold" && (key === "point" || key === "place") && String(value).trim().toLowerCase() === "here") continue;
    args[key] = value;
  }
  return args;
}
