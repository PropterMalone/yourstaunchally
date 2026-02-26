# YSA: Diplomacy on Bluesky

## Project Purpose

Bot that runs games of Diplomacy (7-player strategy board game) on Bluesky. Public negotiation in threads, private order submission via DM. Named "YourStaunchAlly" — ironic given Diplomacy's core mechanic is betrayal.

## Technology Stack

- **Language**: TypeScript 5.7+ (strict mode)
- **Runtime**: Node.js 22+
- **Testing**: Vitest 3
- **Linting/Formatting**: Biome (tabs, single quotes, 100 char width)
- **Package Manager**: npm workspaces
- **ATProto**: @atproto/api for Bluesky interaction
- **Database**: SQLite via better-sqlite3
- **Adjudication**: Python `diplomacy` library (v1.1.2) via subprocess bridge
- **Deploy target**: Malone (Docker, Node + Python dual runtime)

## Architecture

**FCIS (Functional Core, Imperative Shell)** — same as Skeetwolf.

### Packages

```
packages/
├── shared/src/           # Pure types + logic, no I/O
│   ├── types.ts          # Powers, provinces, units, orders, phases, GameState
│   ├── orders.ts         # Order string parsing + validation
│   ├── game-logic.ts     # State machine: lobby → active → finished
│   ├── provinces.ts      # Static province/SC data for standard map
│   └── index.ts
└── engine/src/           # Imperative shell
    ├── bot.ts            # Bluesky API wrapper (from Skeetwolf)
    ├── dm.ts             # DM handling (from Skeetwolf, simplified)
    ├── adjudicator.ts    # Python bridge — subprocess calls
    ├── db.ts             # SQLite persistence
    ├── command-parser.ts # Mention + DM command parsing
    ├── game-manager.ts   # Orchestrator
    └── index.ts          # Polling loop
```

### Python Bridge

`scripts/adjudicate.py` — stateless subprocess, JSON stdin → JSON stdout.
Operations: `new_game`, `set_orders_and_process`, `get_possible`, `get_state`, `render_map`.
Python venv at `.venv/`, diplomacy lib installed there.
Set `PYTHON_PATH` env var in Docker to point to venv python.

## Commands

```bash
npm run validate    # biome check + tsc --noEmit + vitest run
npm run test        # vitest (watch mode)
npm run build       # tsc -b across all packages
```

## Game Flow

1. `@yourstalwartally new game` → creates lobby, creator auto-joins
2. Players `join #id` → auto-starts at 7, or `start #id` with 3-6
3. Powers assigned randomly, unassigned enter civil disorder
4. Orders via DM: `#id A PAR - BUR, A MAR - SPA, F BRE - MAO` (semicolons, commas, or newlines)
5. Phase deadline (48h movement, 24h retreat) or all orders in → adjudicate (20-min grace period)
6. Win: 18 supply centers (solo) or unanimous draw vote

## Key Design Decisions

- **Python diplomacy lib for adjudication** — DATC-compliant, handles all edge cases, renders SVG maps. Subprocess boundary avoids AGPL license contamination.
- **Public press** — All negotiation in Bluesky threads, orders private via DM.
- **Civil disorder** — Unassigned/missing powers hold all units, never build.
- **48h/24h phases** — Async-friendly for cross-timezone play.
- **GameState as JSON blob** — Serialized to SQLite, same pattern as Skeetwolf.
- **Partial order updates** — `submitOrders()` merges by unit location (first two tokens). Players update specific units without resubmitting everything.
- **Coast auto-inference** — `normalizeOrderString()` auto-appends coast for unambiguous fleet moves to SPA/BUL/STP. Ambiguous cases (MAO→SPA, POR→SPA, CON→BUL) left for the player.

## Rate Limiting (Anti-Spam)

- **Posts**: Sliding window — max 5 posts per 60s (bot.ts)
- **DMs**: 2s minimum between sends (dm.ts)
- **Status updates**: 3 checkpoints only — 24h, 6h, 1h before deadline. No @-mentions in status posts.

## Environment Variables

```
BSKY_IDENTIFIER=    # Bot's Bluesky handle
BSKY_PASSWORD=      # Bot's app password
LIVE_DMS=1          # Enable real Bluesky DMs (default: console)
DB_PATH=            # SQLite path (default: /data/yourstaunchally.db)
PYTHON_PATH=        # Python executable (default: python3)
FEED_HOSTNAME=      # Hostname for feed generator
FEED_PUBLISHER_DID= # did:web for feed service
FEED_BOT_DID=       # Bot's did:plc for feed record URIs
LABELER_URL=        # propter-labeler HTTP API (e.g. http://labeler:4100)
LABELER_SECRET=     # Shared secret for labeler API
OLLAMA_URL=         # Ollama endpoint for LLM personas (optional)
```

## FAQ

`packages/feed/src/faq.ts` — static HTML served at `/faq` by the feed generator. Keep this in sync with actual bot behavior when adding/changing commands, order syntax, or game flow. The FAQ is linked from the bot's Bluesky bio.

## Gotchas

- Python diplomacy lib is abandoned (last commit 2020) but works on Python 3.12
- Biome's `noNonNullAssertion` conflicts with TypeScript's `noUncheckedIndexedAccess` — use `as T` casts or helper functions instead of `!`
- `.venv/` and `scripts/` excluded from biome in `biome.json`
- `import.meta.dirname` used in adjudicator.ts to locate Python script
- Python diplomacy lib prints warnings to stdout (e.g. "UNORDERABLE UNIT") — adjudicator.ts strips pre-JSON noise
- Labeler: shared propter-labeler service on propter-net Docker network (see ~/Projects/propter-labeler)
