# Jev as a fast brain for squad leaders

Date: 2026-11-24. Status: research and a small live probe. Nothing in the game was changed.

## Short answer

Jev is what the earlier web search suggested: a hosted model from TypeSafe AI that does not write text. It picks one option from a list declared in the request and returns a probability for every option. In the probe a decision with a 370-word situation and 12 options took a median of 246 ms (worst 383 ms), it chose the expected action for 19 of 20 radio orders (9 of 10 English, 10 of 10 Hebrew), and its one miss was a "say again" on a vague order, not a wrong action. A decision costs about 0.006 US cents.

It can replace the Claude call for one job: turning an order into one of a closed list of actions. It cannot write a report, plan, or run the operator.

Two things are open and are the owner's to decide: whose key pays for Jev (the relay today uses one key per player, for one of four providers, and TypeSafe is not one of them), and whether the customer agreement's wording on end users covers the way the game would charge players. Both are described below.

## 1. What the vendor documents

Everything here was read on 2026-11-24 through a page-fetching tool that summarizes pages, so numbers and field names are as that tool reported them; where the probe confirmed a fact against the live API, that is said.

### What it is

Jev is TypeSafe's first "System One" model: the request carries a `state` (text, JSON or images) and typed questions, and the answer is structured values with probabilities, never free text. Four question types: Choice (one option from a set), Noul (probability that a yes/no question is yes), Score (a level on an ordered scale) and Box (a bounding box in an image). Several questions can go in one request and are answered against the same state. Source: https://docs.typesafe.ai and https://docs.typesafe.ai/concepts/system-one.md

The vendor says plainly that it does not write replies, code or explanations. Source: https://docs.typesafe.ai/concepts/system-one.md

### The API

| Item | Value | Source |
|---|---|---|
| Endpoint | `POST https://api.typesafe.ai/v1/systemone` | https://docs.typesafe.ai/api/system-one.md, https://docs.typesafe.ai/introduction/quickstart.md; confirmed by the probe |
| Auth | `Authorization: Bearer <key>`; keys come from console.typesafe.ai/keys | same; confirmed by the probe |
| Request | `model`, `state` (string, object or array), `questions` (a map from a name you choose to a question), optional `assets` (images) | https://docs.typesafe.ai/api/system-one.md |
| Choice question | `{"type": "choice", "instructions": <optional>, "criteria": {<option name>: <description or null>, ...}}`. Option names and descriptions are both shown to the model; question names are not | https://docs.typesafe.ai/primitives/choice.md |
| Choice answer | `{"type": "choice", "choice": <option>, "confidence": 0..1, "probabilities": {<option>: p, ...}}`, probabilities sum to 1 | same; confirmed by the probe |
| Response | `model` (the versioned id that answered), `answers`, `usage` (`input_tokens`, `output_tokens`) | same; confirmed by the probe |
| Number of options | 1 to 255 per Choice question; 1 to 10 levels per Score | https://docs.typesafe.ai/api/system-one.md |
| Length of an option | no limit stated, other than the context limits below | not found |
| Context | 64k tokens per request and 32k per question by default; 262k for both with the header `TypeSafe-Danger-Zone-Long-Context: true`, which the vendor calls slower and less accurate | https://docs.typesafe.ai/models.md |
| Body | at most 32 MiB, UTF-8 JSON, at most 64 levels of nesting; gzip or zstd accepted | https://docs.typesafe.ai/api/errors.md |
| Errors | 400 (rule broken, or `max_tokens_exceeded`), 401, 413, 415, 422 (validation, names the field), 429 (rate limit), 529 (overloaded); retry 429 and 529 with backoff | https://docs.typesafe.ai/api/errors.md |
| Model listing | `GET /v1/models` | https://docs.typesafe.ai/api/list-models.md; confirmed by the probe |

A list of game actions maps onto this directly: one Choice question whose `criteria` is the option list. The vendor's own cookbook does the same for function calling: one Choice question picks the function, more questions in the same request fill closed-set arguments, and the confidence of the whole call is the lowest of the answers. Source: https://docs.typesafe.ai/cookbooks/function_calling.md

### Versions and pinning

`jev-1.14.0` (from 14 October 2026) and `jev-1.13.0`. `jev-latest` and `jev-preview` are aliases that currently point to 1.14.0. To pin, send the versioned id; the vendor advises this for anyone who tuned thresholds against one version. Source: https://docs.typesafe.ai/models.md

Checked live: `GET /v1/models` for the owner's key lists only the two aliases, but a request with `"model": "jev-1.14.0"` was accepted and answered as `jev-1.14.0`. A deprecation policy for old versions was not found.

### Languages

No page lists supported languages, and Hebrew is named nowhere. The only statement is in the changelog: Jev 1.14 has "better multilingual support". Source: https://docs.typesafe.ai/changelog.md. The page of known weaknesses does not mention languages either (https://docs.typesafe.ai/model-jaggedness.md). Whether Hebrew works therefore rests on the probe in section 2, where it did.

### Probabilities

The vendor says the probability on the chosen option of a Choice is "the probability that the chosen option is correct", and that `confidence` is only a measure of how peaked the distribution is: for a fixed number of options it carries no information beyond the top probability. It makes no measured calibration claim, tells users to tune thresholds on their own data, and gives 0.67 as an example threshold below which a case goes to a person. Source: https://docs.typesafe.ai/confidence.md

Known weaknesses the vendor lists that matter here: a lean toward the option listed first, lower accuracy as the state fills with unrelated content, literal reading of the words, unreliable counting. Source: https://docs.typesafe.ai/model-jaggedness.md

### Price and limits

Price: 0.042 USD per million input tokens for both versions; output tokens are free. Source: https://docs.typesafe.ai/models.md

Rate limits: no numbers are published. They are set per organization, measured in tokens per second and requests per second, shown in the developer console, and higher on custom and enterprise plans. Source: https://docs.typesafe.ai/models.md. Third-party pages quote 1,200 requests per minute and 250,000 tokens per second; that is not from the vendor and is not confirmed. The probe's responses carried no rate-limit headers.

Latency: the vendor publishes no figure. See the probe.

### Through OpenRouter

OpenRouter serves Jev as `typesafe/jev-1.14` (also `typesafe/jev-1.13` and the alias `~typesafe/jev-latest`) at `POST https://openrouter.ai/api/alpha/decisions`, with an OpenRouter key as bearer token and the same `state` and `questions`. The endpoint is marked alpha and its shape may change. An answer can also be of type `refusal`. Sources: https://openrouter.ai/docs/guides/community/jev.md and https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request.md

This matters for the game because OpenRouter is already one of the relay's four providers: a player with an OpenRouter key could have a Jev brain without a second key. Not found: OpenRouter's price for Jev (its model page returned 404 to the fetch tool). Not probed: the owner's key is a TypeSafe key, not an OpenRouter one.

### Data and terms

| Topic | What the documents say | Source |
|---|---|---|
| Training | Input is not used to train or fine-tune models; customer data enters a training set only with the customer's consent | https://typesafe.ai/legal/privacy-policy, https://typesafe.ai/legal/mca §4.1 |
| Retention | No fixed period. TypeSafe has no duty to keep customer data and may delete it at any time (§10.3); some may be kept indefinitely for telemetry, fraud monitoring and legal compliance (§4.1(c)); telemetry (logs, hashes, statistics, classifications) may be processed without restriction (§4.3) | https://typesafe.ai/legal/mca |
| Zero retention | Only for enterprise customers, on request | https://docs.typesafe.ai/legal.md |
| Where | Hosted in the United States | https://typesafe.ai/legal/privacy-policy |
| Using it inside a product | The customer may include the API in applications it develops and operates for end users, and answers for what those end users do (§2.2, §5) | https://typesafe.ai/legal/mca |
| Reselling | The customer may not sell, lease or distribute the services or "offer or make the Services available as a standalone service" (§2.3(a)); the licence is non-sublicensable (§2.1) | https://typesafe.ai/legal/mca |
| Other limits | No use to build a similar or competing product (§2.3(b)); an Acceptable Use Policy applies (§2.3(l)) | https://typesafe.ai/legal/mca |
| Service level | No uptime commitment; liability capped at the greater of 12 months of fees or 50 USD (§9, §12); suspension at once for listed reasons (§6) | https://typesafe.ai/legal/mca |

Reading for the game, not legal advice: a game whose squads use Jev internally, run on the owner's account, with players paying for the game, is the "application for end users" case of §2.2 and is not a standalone resale of Jev. Nothing found blocks that. A scheme that sells Jev calls as such, or hands the owner's quota to players as a metered service of its own, moves toward §2.3(a) and should be put to TypeSafe in writing first.

Not found: the text of the Acceptable Use Policy (the agreement refers to it; a search did not turn it up); the Data Processing Agreement was not read; no clause on games; no statement on whether an individual player can get a key by self-service, which decides whether "the player's own key" is practical for Jev at all. The agreement was read through a summarizing tool: before any commercial decision, someone should read §2 in full.

## 2. The probe

59 decision calls and one model listing, all to `api.typesafe.ai` with the owner's key, on 2026-11-24. The requests held only game text: a made-up situation and radio calls. Total cost was under one US cent.

### Setup

The state was a JSON object with two fields: `situation`, 373 words of plain English describing the squad (Viper 1), four map points with their English and Hebrew callsigns and plain names (Delta / דוד "the quarry", Foxtrot / פסל "the town", Golf / גמל "the bridge", Kilo / כרמל "the gold field"), the headquarters, two landmarks, one enemy in sight (Target 3 / מטרה 3, a technical) and what the orders mean; and `radio_call`, the order. The situation was the same in every call and was written in English also for the Hebrew orders, as the game's status is.

One Choice question, "Which single action does the radio call order Viper 1 to take?", with options named `move_D`, `hold_D`, `attack_D` and so on for the four points (12), plus `attack_target_3`, `fall_back`, `take_cover` and `say_again` (16 in all). Each option had a one-line English description. The model was `jev-latest`, answered by `jev-1.14.0`.

### Latency

Ten calls with the 12 point options only and the single question, 1,312 input tokens each, one after another on one kept-open connection, measured from this machine around the whole HTTP exchange:

| | ms |
|---|---|
| each call | 333, 251, 223, 227, 226, 202, 240, 383, 285, 284 |
| median | 246 |
| worst | 383 |

The other 48 calls (16 options, two questions, about 1,450 tokens) were the same: medians 222 to 237 ms per set, worst 396 ms. A call on a fresh connection, TLS included, took 248 ms. Hebrew and English orders took the same time. In the game the browser reaches Jev through the relay, which first asks the game server for the squad's tier, so the player would see this figure plus those two hops.

A request with a one-line state and three options was billed 297 input tokens, so there is a fixed overhead of roughly 250 tokens per request.

### Correctness

"p" is the probability Jev gave the option it chose. "Clear" is a second question in the same request, a Noul: "Is the radio call a clear order that exactly one of the listed actions carries out?".

| # | Order | Expected | Chosen | p | Clear |
|---|---|---|---|---|---|
| 1 | Viper 1, this is Hammer, move to Foxtrot and hold, over | hold_F | hold_F | 1.00 | 0.94 |
| 2 | ... push up to the town, over | move_F | move_F | 0.62 | 0.85 |
| 3 | ... hold the bridge, over | hold_G | hold_G | 1.00 | 0.90 |
| 4 | ... get out of there, over | fall_back | **say_again** | 0.56 | 0.29 |
| 5 | ... take out that technical, over | attack_target_3 | attack_target_3 | 1.00 | 0.61 |
| 6 | ... hit the quarry and clear them out, over | attack_D | attack_D | 1.00 | 0.92 |
| 7 | ... get your heads down, find some cover, over | take_cover | take_cover | 1.00 | 0.92 |
| 8 | ... head over to the gold field, don't stop to fight, over | move_K | move_K | 1.00 | 0.96 |
| 9 | ... I want Kilo defended, over | hold_K | hold_K | 1.00 | 0.93 |
| 10 | ... do the thing we talked about at the place, over | say_again | say_again | 1.00 | 0.03 |
| 11 | צפע 1, כאן פטיש, נוע לפסל, עבור | move_F | move_F | 0.92 | 0.86 |
| 12 | ... תחזיקו את הגשר, עבור | hold_G | hold_G | 1.00 | 0.93 |
| 13 | ... תקוף את גמל, עבור | attack_G | attack_G | 0.99 | 0.74 |
| 14 | ... צאו משם מיד, חזרה הביתה, עבור | fall_back | fall_back | 1.00 | 0.95 |
| 15 | ... תורידו את הטנדר הזה, עבור | attack_target_3 | attack_target_3 | 1.00 | 0.66 |
| 16 | ... תפסו מחסה, עבור | take_cover | take_cover | 1.00 | 0.97 |
| 17 | ... עלו לעיירה והתבצרו שם, עבור | hold_F | hold_F | 1.00 | 0.93 |
| 18 | ... סעו לשדה הזהב, בלי להתעכב על קרבות בדרך, עבור | move_K | move_K | 1.00 | 0.96 |
| 19 | ... אני רוצה שתכבשו את המחצבה, עבור | attack_D | attack_D | 0.98 | 0.93 |
| 20 | ... תעשה את מה שדיברנו עליו שם, עבור | say_again | say_again | 0.98 | 0.04 |

English 9 of 10, Hebrew 10 of 10.

The miss, order 4: "get out of there" got `say_again` at 0.56 with `fall_back` second at 0.42. The Hebrew order 14 was easier because it also says "back home". In order 2 the rest of the probability (0.36) was on `attack_F`, which is the honest second reading of "push up to the town".

The same 20 orders were sent again with the option list in reverse order, because the vendor warns of a lean toward the first option. Every choice was the same, including the miss; probabilities moved by at most 0.08 (order 2: 0.54, order 4: 0.63).

### Are the probabilities usable for "not sure, say again"?

Eight more calls that have no right action among the options:

| Call | Chosen | p | Next options | Clear |
|---|---|---|---|---|
| Viper 1, this is Hammer, move to ... [static] ..., over | say_again | 1.00 | | 0.04 |
| ... radio check, over | say_again | 1.00 | | 0.06 |
| ... attack, over | say_again | 0.91 | attack_target_3 0.08 | 0.18 |
| ... go to Foxtrot or Golf, whichever, over | say_again | 0.72 | move_F 0.14, move_G 0.13 | 0.30 |
| ... buy a tank, over | say_again | 0.72 | attack_target_3 0.24 | 0.18 |
| צפע 1, כאן פטיש, זוז ל... [רעש], עבור | say_again | 1.00 | | 0.06 |
| ... מה המצב אצלך, עבור | say_again | 1.00 | | 0.09 |
| Rhino 1, this is Hammer, how much gold do we have, over | say_again | 1.00 | | 0.04 |

On this sample, yes. Of 28 distinct calls, 26 had the chosen option at 0.72 or higher and all 26 were right. The two below that were order 2 (right, 0.62) and order 4 (wrong, 0.56). With the vendor's example threshold of 0.67, the squad would have acted 17 times, each time correctly, and asked to say again 11 times: the 8 calls above, orders 10 and 20, and, needlessly, order 2. Order 4 was already a "say again". No wrong action at any threshold.

The Noul question separated the two groups as well (0.61 and above for every real order, 0.36 and below for everything else) but added nothing the Choice probabilities did not already show, and its lowest values among real orders (0.61, 0.66) were for "take out that technical", which the Choice got right at 1.00. An explicit `say_again` option with a description did the work; a second question is not needed.

### What the probe does not show

- It is 28 calls written by one author who also wrote the situation and the option descriptions. It shows that the approach works, not an error rate. A threshold has to be tuned on a few hundred orders recorded from real matches.
- No order came from speech recognition. Misheard Hebrew is the likeliest real input and was not tested.
- One map, four points, one contact. Longer lists (every landmark, several contacts) were not tested; the limit is 255 options.
- Orders with two steps ("move to Foxtrot, then attack Delta") have no option and were not tested.
- "Radio check" fell to `say_again` because the list had no option for it. The game answers radio checks by code today and should keep doing so.
- Latency was measured from one place at one time of day, on an account with unknown rate limits.

## 3. Cost per decision

A decision in the probe's shape is about 1,450 input tokens: 1,450 x 0.042 USD / 1,000,000 = 0.000061 USD, or about 16,000 decisions for one dollar. A squad that takes 100 orders in a match costs 0.6 cents. The real state would be the game's compact status rather than 373 words of prose, so the figure should stay in this range; even five times larger it is a third of a cent per hundred decisions.

## 4. How the game would call it (design only)

### What exists

An agent thinks through a brain object with one function, `think({ agent, system, tools, messages, wake, rules })`, which returns content blocks in the shape of Anthropic's Messages API (`agents/agent.mjs`, the loop in `#wake`). The agent then runs each `tool_use` block through the game link. `agents/brain-claude.mjs` and `agents/brain-relay.mjs` send the whole conversation to a model. `agents/brain-scripted.mjs` uses no model: it reads `wake.call` and `wake.status`, matches verbs by pattern, and returns the same blocks: a `move`, `hold` or `attack`, then a `radio` call with a fixed phrase ("Wilco" / "רות, יבוצע", "Say again" / "אמור שנית", "Negative, <reason>"). A brain marked `slow` makes the agent say "Stand by" when an answer takes long.

The relay (`relay/relay.go`, `think`) checks the seat with the game server, gets the squad's tier, reads the player's stored key and its provider, takes the model for that provider and tier from `shared/models.json`, and calls `provider.Provider.Think` (`relay/provider/provider.go`). Each provider can reach exactly one address, written in that package, and redirects are never followed. The request shape is a chat: system prompt, tools, messages.

### The decision brain

A decision brain is the scripted brain with its pattern matching replaced by one Jev call. It keeps everything else the scripted brain does in code.

1. No model call when none is needed. An event wake (arrived, contact, pinned, losses) gets the fixed report line the scripted brain already has. A radio check, and any other fixed proword, is answered by code. Calls from another squad are ignored. This keeps the rule that routing is done by code.
2. The option list is built by code from what the agent already holds, `wake.status` and `rules.map`, and only from things this squad can do, so that no option is one the server would refuse for a known reason:
   - move, hold and attack for each map point the squad's unit can reach;
   - attack for each contact in sight, by its contact id;
   - hold at each landmark near the squad ("take cover"), and at the landmarks the call names (`call.landmarks`, which the net already extracts);
   - move to the squad's own headquarters ("fall back");
   - repair for each bridge and capture for each enemy structure, for the units that have those tools;
   - `say_again`, described as: the call is unclear, incomplete, or asks for none of the above.
   Option names are stable codes (`hold:F`, `attack:contact:3`); descriptions carry the English and Hebrew callsign and the plain name, as the map table in `agents/prompts.mjs` does. Each option maps in code to one tool call with fixed arguments. With every point and nearby landmark this is some tens of options, well under the limit of 255.
3. The state is the compact status the agent already renders for a wake, plus the call's body. Past conversation is not sent: Jev has no memory, and the vendor warns that unrelated content lowers accuracy.
4. The answer becomes tool calls by a fixed table:
   - top option is an action with probability at or above the threshold: the tool call for that option, then `radio` to the caller with "Wilco" / "רות, יבוצע", end "out". If the server refuses the tool, "Negative, <the reason it gave>", end "over", exactly as the scripted brain's `orElse` does today.
   - top option is `say_again`, or the probability is below the threshold: `radio` with "Say again" / "אמור שנית", end "over". When two actions hold most of the probability (as in "Foxtrot or Golf": 0.14 and 0.13), the phrase can name the two places, as the scripted brain does for two landmarks.
   The radio body is always one of the fixed phrases in the net language. Jev writes nothing.
5. The brain is not `slow`: at a quarter of a second there is no "Stand by".
6. The threshold starts at the vendor's example of 0.67 and is tuned on recorded orders. The model id is pinned (`jev-1.14.0`), because a threshold belongs to a version.

An alternative to one flat list is two questions in one request, one for the verb and one for the place, which grows as verbs plus places instead of verbs times places. The vendor's function-calling cookbook works this way and takes the lower of the two probabilities. It was not probed, and the two answers are given independently, so a mismatched pair is possible. The flat list is the one with evidence.

What this brain cannot do: write a contact report in its own words, weigh a risky order, carry out an order in two steps, or be the operator. A natural extension, which the vendor describes as confidence routing, is to hand a low-probability call to the squad's LLM brain instead of asking the player to say again; that costs the four seconds only on the hard calls.

### Where it goes in the relay

- A new provider in `relay/provider` with its one address, `https://api.typesafe.ai/v1/systemone`, bearer auth, and the same error mapping as the others (401 as a bad key, 429 as rate limited, 529 as overloaded). If OpenRouter players are to be served, a second address, `https://openrouter.ai/api/alpha/decisions`, on the existing OpenRouter provider.
- It should not be squeezed into `Think`. A decision request is a state and an option list, not a system prompt, tools and messages, and tool arguments such as a free-text place have no closed set. A second, small interface beside `Provider` (a decision: state and questions in; answers, token counts and the model out) keeps the four chat providers untouched.
- A second relay route beside `/think` with the same checks in the same order: player token, seat header, the tier question to the game server, the stored key. The relay, never the caller, sets the model, from a new entry in `shared/models.json`. It forwards `state` and `questions` under a size cap, as `/think` forwards prompts.
- Which squads get it is the open design point. Today the tier picks a model within the player's provider. A decision brain is a different kind of brain, not a model in that table, so the tier has to pick the brain kind as well: for example tier 1 is a decision brain and tiers 2 and 3 stay LLMs. The agent already learns its tier from the status on every wake, so a brain that dispatches by tier fits the existing `think` contract.

### Decisions this needs from the owner

`CLAUDE.md` locks the relay to "the player's own key (OpenRouter or Claude/Gemini/OpenAI)". Jev does not fit that sentence as it stands, in one of three ways:

1. TypeSafe becomes a fifth provider and a player brings a TypeSafe key. The key store holds one key per player today, so a player with an Anthropic key for the operator and a TypeSafe key for tier-1 squads needs a second slot. Whether a player can get a TypeSafe key by self-service was not found.
2. Jev is reached through the player's OpenRouter key. No second key and no new provider, but it works only for OpenRouter players and rests on an alpha endpoint.
3. The game pays: the relay holds one TypeSafe key of the owner's and tier-1 thinking is part of the game. At 0.006 cents a decision this is affordable, it is the "application for end users" case of the agreement, and it removes the key from the tier-1 experience altogether. It changes the locked rule that the player's key pays, and all players then share one organization's rate limit, whose size is not published.

## 5. Recommendation

Use it for tier-1 squads, for taking orders, after two things: a larger test on recorded orders in both languages, speech-recognition errors included, to set the threshold; and the owner's decision on whose key pays.

Do not use it for the operator or as the whole brain of the higher tiers: it cannot write or plan. It is worth trying as the first step of every tier (Jev decides the plain orders in a quarter of a second, the LLM gets only the calls Jev is unsure of), but that is a second step and was not tested.

Reasons: the measured speed is about a sixteenth of the current thought; Hebrew worked as well as English on this sample; the failure seen was a request to say again, not a wrong move; the cost is negligible; the scripted brain already has the exact shape needed, so the change in the agent is small. Reasons for caution: the sample is small and home-made, the vendor publishes no language list, no latency figure, no rate limits and no uptime commitment, zero retention is enterprise-only, and the service is hosted in the United States.

## 6. Built and measured (2026-11-24, after the owner's decision)

The owner chose option 3 of section 4: the game pays, with one TypeSafe key held by the relay (`CALLSIGN_JEV_KEY`). What was built is in `agents/brain-jev.mjs` (the brain), `relay/decide.go` and `relay/provider/typesafe.go` (the route and the provider), and it follows section 4 with one change: the grammar of the rule brain (`agents/rule-grammar.mjs`) reads every call first, and only a call it cannot place goes to Jev.

Measured on 150 orders to one squad (`agents/test/fixtures/orders.json`: 45 taught sentences, 60 loose paraphrases, 45 damaged the way a speech recogniser damages them; 85 English, 65 Hebrew), with 148 live decisions through the game server and the relay, model `jev-1.14.0`, threshold 0.67:

| | right | asked "Say again" | acted wrongly |
|---|---|---|---|
| grammar alone | 138 (92%) | 12 | 0 |
| Jev alone | 117 (78%) | 28 | 5 |
| grammar, then Jev | 142 (95%) | 8 | 0 |

By kind, grammar then Jev: taught 45 of 45, paraphrases 59 of 60, damaged 38 of 45. Jev alone at other thresholds: 0.5 gives 126 right and 16 wrong, 0.85 gives 103 right and 3 wrong; no threshold removes its wrong actions on this set. Grammar then Jev has no wrong action from 0.67 up, and 2 at 0.6.

Latency of a decision as the browser sees it (page to game server to relay to TypeSafe and back, the seat check included): median 222 ms, nine in ten under 268 ms, worst 777 ms. Inside the relay the figures are one millisecond lower. A request held 34 options and about 1,680 input tokens, 0.007 US cents.

What the numbers do and do not say:

- The set was written by the author of the grammar, and four faults it showed in the grammar were then fixed, so the grammar's 92% is measured on sentences it was tuned on. Before those fixes it was 126 right and 9 wrong. Jev's figures are not tuned on anything.
- Jev alone loses most of its misses to options that overlap: "Hold Foxtrot" came back 0.63 for holding Foxtrot and 0.30 for "stay where you are", under the threshold. The grammar takes those calls first, so the brain as shipped does not pay for it; a second question for the place (section 4, the alternative) would be the fix for the model alone.
- The damaged orders are imitations of recogniser errors, not recordings. Recorded orders from real matches are still the right way to set the threshold.
