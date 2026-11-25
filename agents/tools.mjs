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

// The kinds a station may give its own transmission; the server knows the rest itself.
export const kinds = ["contact", "objective", "loss", "status", "ack"];

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
    kind: {
      type: "string",
      enum: kinds,
      description:
        'What the transmission is, so the net can keep quiet what Hammer need not hear: "contact" for the enemy met or a fight begun, "objective" for a place reached or taken or a fight ended, "loss" for a squad that can hardly fight on, "ack" for a bare Roger or Wilco, "status" for everything else (answers, questions, routine).',
    },
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
export const repairTool = tool("repair", "Go to a bridge and mend it. The squad works from the bank while nobody shoots at it; a fallen bridge stands again part-way through. Engineers can also name a damaged structure of their own side: they go in, make it whole, and stay inside for good.", {
  place: { type: "string", description: 'The bridge, by id or name ("bridge-south", "the south bridge"), or for engineers a damaged structure of your own side, by its id from your status ("s5") or by its name ("the refinery", "the barracks near Delta").' },
});
export const captureTool = tool("capture", "Take over an enemy base structure, or a tech building (an assay office, a clinic, a service yard) whoever holds it. Your squad walks to it and, after a few seconds beside it without being shot at, the structure is your side's and the squad stays inside it for good.", {
  place: { type: "string", description: 'The structure: its id from your status, such as "s7", or its name ("the enemy refinery", "the clinic east of Delta").' },
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
  ...(unit?.repairPerSecond > 0 || unit?.captureSeconds > 0 ? [repairTool] : []),
  ...(unit?.class === "infantry" && unit.domain === "land" && !unit.hero ? [fortifyTool] : []),
  ...(unit?.chargeDamage > 0 ? [plantTool] : []),
  ...(unit?.seizeRadius > 0 ? [seizeTool] : []),
];

export const operatorTools = [
  radio,
  report,
  tool("build", "Spend gold to start a structure where Hammer said, or where you choose. It is refused, with the reason, when it cannot stand there.", {
    structure: { type: "string", description: 'Structure id from your list, for example "vehicleWorks".' },
    place: { type: "string", description: 'Where it goes. When Hammer gave an exact spot, pass those words as they were said ("140 metres north and 60 metres east of Alpha"), or write it as "N140 E60 of A". Otherwise a point, a structure of yours by id, or a side of your base such as "base:front" or "base:north". "" lets the game choose a place by your headquarters (a defence or a fence then goes to the front of your base).' },
    place2: { type: "string", description: 'Only for a fence that runs from `place` toward a second place; otherwise "".' },
    run: { type: "string", enum: ["", "north-south", "east-west", "northeast-southwest", "northwest-southeast"], description: 'Only for a fence on an exact spot: which way the run lies, when Hammer said ("running north to south"). The whole run must fit or it is refused. "" lets it face the enemy.' },
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
  tool("cancel", "Take a unit out of its production line before it comes out, and get back the gold not yet spent on it: all of it while it waits, part of it once work on it began.", {
    unit: { type: "string", description: 'Unit id or name; the last one of that kind bought is cancelled. "" cancels the last unit bought, whatever it is.' },
  }),
  tool("rally", "Set where new units gather when they come out of the structure that makes them. They go there and hold it.", {
    place: { type: "string", description: 'A point, a landmark, a tech building by its id or name, or a spot such as "100 metres north of Alpha". "home" puts them back beside their structure.' },
    structure: { type: "string", description: 'One structure of yours, by id or name, to set only its rally point; "" for every structure.' },
  }),
  tool("haul", "Tell your gold haulers which field to work. They keep working it until told otherwise, even under threat, so use it on purpose.", {
    field: { type: "string", description: 'The gold field, by the map point it lies at ("K", "Kilo", "כרמל"), or "auto" to let the haulers choose a safe field themselves.' },
    hauler: { type: "integer", description: "One hauler's id from your status, or 0 for all of them." },
  }),
  tool("sell", "Sell one of your own structures. It is removed at once and part of its cost comes back as gold; what it let you buy and the power it gave go with it. The headquarters cannot be sold.", {
    place: { type: "string", description: 'The structure: its id from your status, such as "s5", or its name ("the dockyard").' },
  }),
  tool("repair", "Pay to mend one of your own damaged structures. It mends over time and takes gold as it goes, until it is whole or your gold runs out.", {
    place: { type: "string", description: 'The structure: its id from your status, such as "s5", or its name ("the refinery").' },
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
