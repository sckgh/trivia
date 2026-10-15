# Trivia

A game-show trivia system for live events: a **cinema-scale display**, a **host console** for the
moderator, and **USB buzzers**. Jeopardy / Sale of the Century rules: first to buzz answers. Runs on
Cloudflare Workers' **free plan**.

```
 Display PC (browser, fullscreen)            Cloudflare (free)                    Host phone/laptop
 ┌───────────────────────────┐   WebSocket   ┌───────────────────────────┐  WS   ┌──────────────────┐
 │ /display  SVG 1920×1080    │◄────────────►│ Worker + static assets     │◄────►│ /host  console    │
 │ USB buzzers = keypresses   │              │ Durable Object per room    │      │ (PIN protected)   │
 └───────────────────────────┘              │ = authoritative game state │      └──────────────────┘
                                             └───────────────────────────┘
```

- **Display** (`/display?room=MAIN`): a single SVG scaled to the screen, so it stays sharp from a laptop
  to a 4K cinema projector. Shows the board, questions, media, buzz-ins, timers and scores. Never
  receives an answer until the host reveals it.
- **Host** (`/host?room=MAIN`): phone-friendly console with the answer, notes, Correct / Wrong, buzzer
  control, media playback, score adjustments and **Undo**.
- **Buzzers** plug into the display PC. Because every button is read by the same browser, the first
  keypress wins, however slow the network is.

## Game rules

| Round type | How it plays |
|---|---|
| `board` | Jeopardy grid. Player in control picks a category/value. Host reads, then **opens buzzers**. First buzz answers. Correct = +value and control of the board. Wrong = −value and that player is locked out, buzzers reopen for the rest. Optional **Daily Doubles**: only the player in control answers, for a wager. |
| `fast` | Sale of the Century "Fast Money": rapid sequential questions, fixed points each. |
| `whoami` | "Who Am I?": clues revealed one at a time, points drop with each clue (e.g. 500 → 100). No penalty for wrong guesses. |
| `final` | Category shown → everyone wagers (host enters them) → question → reveal and mark each player. |

Other rules (in each game's `settings`):

- `buzzSeconds` (10): time to buzz once open; on expiry the answer is revealed. `0` = no limit.
- `answerSeconds` (5): countdown shown for the answering player (visual; the host decides).
- `wrongPenalty` (true): wrong answers lose the value (never in Who Am I).
- `earlyBuzzLockoutMs` (250): pressing before buzzers open locks that player out briefly, like the TV show.

## Quick start (local)

```bash
npm install
cp .dev.vars.example .dev.vars    # sets HOST_PIN=1234 for local use
npm run dev                        # http://localhost:8787
```

Open `http://localhost:8787/display` in one window and `http://localhost:8787/host` in another (PIN `1234`).
In the display window press **1–4** to buzz.

## Deploy to Cloudflare (free)

```bash
npx wrangler login
npx wrangler secret put HOST_PIN   # choose the host PIN
npm run deploy                      # validates content, builds and deploys
```

Your app is at `https://trivia.<your-subdomain>.workers.dev`. Everything used is in the Workers Free plan:
static assets (unlimited requests), one Worker, and SQLite-backed Durable Objects with WebSocket
hibernation (no charge while idle). A night of trivia uses a tiny fraction of the daily free limits.

## Running a show

1. On the **display PC** (connected to the projector and the buzzers) open `/display?room=MAIN` and click
   **Start display** (full screen + sound). Double-click the screen at any time to get back to settings.
2. Click **Set up buzzers** and press each player's button in turn — or use the default keys from the game file.
   Outside a question, pressing a buzzer flashes that player's panel, so you can test the buttons.
3. On your phone open `/host?room=MAIN`, enter the PIN, choose a game.
4. Use different room codes to run separate games at the same time.

Host keyboard shortcuts (laptop): `Space` open buzzers · `C` correct · `X` wrong · `R` reveal · `N` next ·
`P` play media · `Ctrl+Z` undo.

### Buzzers

Any USB device that types a key works: USB "buzzer" buttons, arcade-button kits with a keyboard encoder,
foot pedals, or a programmable macro pad. Give each player a distinct key (`1`–`4` by default). Tips:

- Avoid cheap keyboard matrices for simultaneous presses (key ghosting); dedicated encoders are fine.
- Keys are matched against `KeyboardEvent.key` ("1", "a") or `KeyboardEvent.code` ("Digit1", "KeyA").
- Key-repeat is ignored, so a held button can't buzz twice.

## Writing questions

Everything lives in `content/`. Edit the JSON, then `npm run validate` (or just `npm run deploy`,
which validates first).

```
content/
  games/demo.json            # a game: players, settings, which rounds in which order
  rounds/round1-board.json   # one file per round — reuse rounds across games
  rounds/fast-money.json
  rounds/who-am-i.json
  rounds/final.json
public/media/                # images, audio and video referenced by questions
```

**A game** (`content/games/<id>.json`):

```json
{
  "title": "Trivia Night",
  "players": [
    { "name": "Red Team", "color": "#ff4d5e", "key": "1" },
    { "name": "Blue Team", "color": "#3fa9ff", "key": "2" }
  ],
  "settings": { "buzzSeconds": 10, "answerSeconds": 5, "wrongPenalty": true },
  "rounds": ["round1-board", "fast-money", "final"]
}
```

**A board round**:

```json
{
  "type": "board",
  "title": "Round 1",
  "categories": [
    {
      "name": "Name That Tune",
      "questions": [
        { "value": 100, "prompt": "Name this piece", "answer": "Ode to Joy",
          "accept": ["Beethoven's 9th"], "notes": "Symphony No. 9, 1824",
          "media": { "type": "audio", "src": "music/ode-to-joy.mp3", "start": 0, "end": 10 } },
        { "value": 500, "prompt": "Hardest natural substance?", "answer": "Diamond", "dailyDouble": true }
      ]
    }
  ]
}
```

**Fast** — `{ "type": "fast", "title": "Fast Money", "value": 100, "questions": [{ "prompt": "…", "answer": "…" }] }`
**Who Am I** — `{ "type": "whoami", "title": "Who Am I?", "values": [500,400,300,200,100], "questions": [{ "answer": "…", "clues": ["…", "…"] }] }`
**Final** — `{ "type": "final", "category": "…", "question": { "prompt": "…", "answer": "…" } }`

Question fields: `prompt`, `answer` (required); `accept` (other acceptable answers, host only); `notes`
(host only); `media`.

### Media

| `media.type` | Notes |
|---|---|
| `image` | SVG/PNG/WebP/JPG. Add `"reveal": "blur"` or `"zoom"` (+ `"steps": 4`) to reveal it gradually — the host taps **Reveal more**. |
| `audio` | MP3/OGG/WAV. Host taps **Play**; `start`/`end` (seconds) pick a clip. Pauses automatically when someone buzzes. |
| `video` | MP4/WebM. Same controls as audio. |

`src` is a path under `public/media/`, or a full `https://` URL. Static asset files are limited to
25 MiB each — for longer video, put it in a free R2 bucket (or anywhere public) and use its URL.
Media files are public URLs, so don't put the answer in the file name.

### Suggested categories

General Knowledge · Science & Nature · History · Geography (flags, outlines) · Screen Time (film/TV
clips and stills) · Name That Tune (5–10 s intros) · Sport · Food & Drink · Picture This (blur/zoom
reveal) · Space · Wordplay (anagrams, rhyming slang, before & after) · Local Legends (your in-jokes).

## Development

```bash
npm test           # rules engine + view redaction + content validation (Vitest)
npm run typecheck
npm run e2e        # with `npm run dev` running: drives display + host in headless Chromium, saves screenshots
```

Code map:

- `src/shared/game.ts` — the rules, as a pure reducer (`reduce(content, state, action, now)`).
- `src/shared/view.ts` — what each role may see (answers stripped for the display).
- `src/shared/schema.ts` — content schema (zod).
- `src/worker/room.ts` — `GameRoom` Durable Object: state, undo history, buzz timer alarm, WebSocket fan-out.
- `src/client/display/` — the SVG display. `src/client/host/` — the host console.
- `scripts/build-content.ts` — validates `content/` and bundles it into the Worker, so answers are never
  served as public files.
