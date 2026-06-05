# YourStalwartAlly

Diplomacy board game bot for [Bluesky](https://bsky.app). Full 7-player games of classic Diplomacy, starting Spring 1901 — negotiate in public threads, submit orders privately via DM.

**Bot profile**: [@yourstalwartally.bsky.social](https://bsky.app/profile/yourstalwartally.bsky.social)
**FAQ**: [malone.taildf301e.ts.net/ysa/faq](https://malone.taildf301e.ts.net/ysa/faq)

## Features

- **Full 7-player Diplomacy** — standard map, all unit types, convoys, retreats, builds
- **Public press negotiation** — all diplomacy happens in Bluesky threads
- **Private orders via DM** — submit and update orders in direct messages
- **Map images** — SVG maps rendered to PNG (via sharp) and attached to adjudication posts
- **Python adjudication engine** — DATC-compliant [diplomacy](https://github.com/diplomacy/diplomacy) library behind a subprocess boundary
- **Grace period** — 20-minute window when all orders are in before adjudication
- **LLM secretary personas** — each power has an in-character secretary (Ollama + phi3:mini) for conversational DM responses
- **Per-game Bluesky feeds** — follow a single game's posts in your timeline
- **Queue and invite system** — lobby fills to 7 players, then auto-starts
- **Civil disorder** — unassigned powers hold all units automatically

## Architecture

Monorepo with two packages:

- **packages/shared** — pure game logic, types, order parsing (no I/O)
- **packages/engine** — Bluesky bot, SQLite persistence, game orchestrator

Adjudication runs through `scripts/adjudicate.py`, a stateless subprocess that communicates via JSON over stdin/stdout. This keeps the AGPL-licensed Python diplomacy library at a subprocess boundary.

Built on [propter-bsky-kit](https://github.com/PropterMalone/propter-bsky-kit).

## Running

```bash
npm install
npm run validate  # biome + typecheck + tests
npm run build     # production build
```

The bot requires a Python 3.12+ venv with the `diplomacy` library installed, plus a Bluesky account. See `.env.example` for required environment variables.

## License

MIT — see [LICENSE](LICENSE).
