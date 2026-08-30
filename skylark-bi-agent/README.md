# Skylark BI Agent

A conversational business-intelligence agent over two monday.com boards
(**Deals** — sales pipeline, **Work Orders** — project execution & billing).
Built with Node/Express, the Anthropic API (tool use), and a vanilla JS
chat UI. No frontend framework, no database — the boards *are* the
database, fetched live on every query (with a 60s in-memory cache).

## Architecture

```
public/            chat UI (static HTML/CSS/JS, no build step)
server.js          Express app: /api/chat, /api/status
src/mondayClient.js  monday.com GraphQL v2 client (+ mock-mode fallback)
src/dataNormalize.js pure functions: dates, numbers, text, statuses, sectors
src/dataService.js   fetch -> normalize into a canonical schema -> filter/aggregate
src/agent.js         Claude tool-use loop: system prompt + 5 tools + orchestration
src/mockData.js       representative sample data (see caveat below)
```

Request flow: browser → `POST /api/chat` with the running conversation →
`agent.js` calls Claude with 5 tools → Claude decides which tool(s) to call →
`dataService` fetches + normalizes + aggregates → result JSON goes back to
Claude as a `tool_result` → Claude writes the final natural-language answer.
The loop repeats (capped at 6 rounds) so the model can chain tools, e.g.
"pipeline by sector" then "now compare to work orders by sector" in one turn.

### Why this shape
- **Aggregation happens in code, not in the model's head.** The tools return
  pre-computed sums/counts/groups rather than raw rows, because LLMs are
  unreliable at arithmetic over dozens of rows. The model's job is picking
  the right filter/group-by and narrating the result, not counting.
- **Column-title mapping, not hardcoded column IDs.** `dataService.js`
  tries several likely header spellings per field (`pick()`), because
  monday.com column titles depend on how each user names them at import
  time, and the assignment explicitly calls out inconsistent naming.
- **A single normalization layer.** All date/number/text/status cleaning
  lives in `dataNormalize.js` and is exercised on the way in, once, so every
  tool works against clean, typed data and every tool result can carry a
  `dataQualityNote` for free.

## Setup

```bash
npm install
cp .env.example .env   # fill in ANTHROPIC_API_KEY at minimum
npm start              # http://localhost:3000
```

### Running against real monday.com boards
1. Create two boards in monday.com and import the provided CSVs
   (Work Orders, Deals) as separate boards.
2. Generate a personal API token: monday.com → Avatar → Admin →
   API → *Generate token* (or Developer → My Access Tokens).
3. Get each board's numeric ID from its URL (`.../boards/1234567890`).
4. Set in `.env`:
   ```
   MONDAY_API_TOKEN=<token>
   MONDAY_DEALS_BOARD_ID=<id>
   MONDAY_WORK_ORDERS_BOARD_ID=<id>
   ```
5. Restart the server. `/api/status` will report `mockMode: false` and the
   UI banner switches to "connected · monday.com live".

### Running without monday.com (sample-data / demo mode)
Leave the `MONDAY_*` variables blank (or set `FORCE_MOCK_MODE=true`). The
app falls back to `src/mockData.js` automatically — same code path, same
tools, so the agent's reasoning is fully testable without any monday.com
setup. This is what the hosted demo link runs in unless a token is present.

## What the agent can answer
- Pipeline health & sector performance ("How's mining pipeline looking?")
- Stage-by-stage funnel breakdowns
- Win/loss and open-deal aging by owner or sector
- Execution status and delivery load by sector ("what's stuck?")
- Billing vs. collections gaps
- Cross-board: which **Won** deals have no matching **Work Order** yet
  (sold-but-not-executing)
- On-demand leadership snapshot (see Decision Log)

## Known limitations / next steps
See `DECISION_LOG.md`.

## AI tools used
Built in a Claude chat session (Claude Sonnet) with the assistant writing
and smoke-testing the code directly (Node scripts run against the mock
dataset to verify normalization/aggregation before wiring up the UI).
