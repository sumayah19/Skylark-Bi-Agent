# Skylark BI Agent

A conversational business-intelligence agent over two monday.com boards
(**Deals** — sales pipeline, **Work Orders** — project execution & billing).
Built with Node/Express, the Google Gemini API (native function calling), and
a vanilla JS chat UI. No frontend framework, no database — the boards *are*
the database, fetched live on every query (with a 60s in-memory cache).

**Live demo:** https://skylark-bi-agent-s8hy.onrender.com
*(free-tier Render instance — spins down after 15 min idle, first request
after that takes ~30-50s to wake up)*

## Architecture

```
public/              chat UI (static HTML/CSS/JS, no build step)
server.js            Express app: /api/chat, /api/status
src/mondayClient.js  monday.com GraphQL v2 client (+ mock-mode fallback)
src/dataNormalize.js pure functions: dates, numbers, text, statuses, sectors
src/dataService.js   fetch -> normalize into a canonical schema -> filter/aggregate
src/agent.js         Gemini tool-use loop: system prompt + 5 tools + orchestration
src/mockData.js      representative sample data (see caveat below)
```

Request flow: browser → `POST /api/chat` with the running conversation →
`agent.js` calls Gemini with 5 function-call tools → Gemini decides which
tool(s) to call → `dataService` fetches + normalizes + aggregates → result
JSON goes back to Gemini as a `functionResponse` → Gemini writes the final
natural-language answer. The loop repeats (capped at 6 rounds) so the model
can chain tools, e.g. "pipeline by sector" then "now compare to work orders
by sector" in one turn.

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
- **Model fallback for resilience.** `agent.js` tries a short ordered list
  of current Gemini models and automatically moves to the next one if it
  hits a `503` (overloaded) or `404` (retired model) error, instead of
  failing the whole request. See "Challenges faced" below for why this
  exists.

## Setup

```bash
npm install
cp .env.example .env   # fill in GEMINI_API_KEY at minimum (free, no card: aistudio.google.com/app/apikey)
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
setup. **This is what the hosted demo link runs in**, so it's reviewable by
anyone without needing monday.com credentials.

## What the agent can answer
- Pipeline health & sector performance ("How's mining pipeline looking?")
- Stage-by-stage funnel breakdowns
- Win/loss and open-deal aging by owner or sector
- Execution status and delivery load by sector ("what's stuck?")
- Billing vs. collections gaps
- Cross-board: which **Won** deals have no matching **Work Order** yet
  (sold-but-not-executing)
- On-demand leadership snapshot (see Decision Log)

## Key assumptions & trade-offs
See `DECISION_LOG.md` for the full reasoning. Short version:
- Aggregation happens in JS, never in the model's head, to avoid confidently
  wrong numbers.
- No database/ETL — reads go straight to monday.com's GraphQL API per
  request (behind a 60s cache), trading some latency for zero staleness.
- Deal↔Work-Order cross-board matching is done by exact deal-name text
  (no stable foreign key exists in the source data); the tool result
  surfaces this as an explicit caveat rather than presenting the count as
  ground truth.
- monday.com column **titles**, not column IDs, are the integration
  contract, since exact column names aren't guaranteed at import time.

## AI tools used
- **Claude (Anthropic, via a chat session)** did the majority of the initial
  build: architecture, the tool-use loop, data normalization, and the UI —
  written and smoke-tested directly against the mock dataset before wiring
  up monday.com.
- **Google Gemini** (`gemini-3.6-flash` at time of writing, via `@google/genai`)
  powers the agent's actual runtime reasoning/tool-calling, chosen
  specifically for its no-card free tier so the hosted demo stays runnable
  by anyone reviewing it without billing setup.
- Claude was also used throughout deployment to debug the issues below.

## Challenges faced (and this is where most of the real debugging happened)
Building the app was the easier half; **getting it correctly deployed** surfaced
several real-world issues worth documenting honestly:

1. **Stale SDK from an earlier build.** An earlier version of `agent.js` in
   this repo's history still called the Anthropic SDK
   (`@anthropic-ai/sdk`, `claude-sonnet-4-5`) even though the project had
   since moved to Gemini — a half-finished provider swap where the env var
   name (`GEMINI_API_KEY`) had been updated but the actual client code and
   `package.json` dependency hadn't. This caused a confusing
   "missing ANTHROPIC_API_KEY" error in production that had nothing to do
   with the (correct) Gemini key that was actually configured. Fixed by
   fully re-porting `agent.js` to `@google/genai`.
2. **Google's own SDK churn.** The Gemini JS ecosystem moved fast in 2025-26:
   `@google/generative-ai` (the package originally used) is now fully
   deprecated/EOL, and its old message-role format (`role: "function"`) is
   rejected outright by the current API backend (`400: Role 'function' is
   not supported`). This meant a full migration to the current, actively
   maintained SDK, `@google/genai`, including moving from
   `getGenerativeModel()` / `startChat()` to `ai.chats.create()` /
   `chat.sendMessage()`.
3. **Model retirement churn.** `gemini-2.0-flash` and `gemini-2.5-flash`
   were both retired for new users mid-project, each returning a `404`
   pointing at a newer model name. Rather than hardcoding one model name
   again (and risking the same issue), `agent.js` now tries a short
   ordered list of current model names and falls back automatically.
4. **Transient `503` "high demand" errors.** Even on the current stable
   model, Google's free-tier Gemini API intermittently returns
   `503 Service Unavailable` during demand spikes — a known, widely-reported
   issue across 2026 (see Google's own release notes and third-party
   status trackers), unrelated to this app's code or config. The
   model-fallback logic mitigates this somewhat but can't eliminate it,
   since it can affect multiple models simultaneously. This is a real
   limitation of building on a free-tier LLM API and is called out here
   rather than hidden.
5. **Deployment path/monorepo mismatch.** The initial GitHub push nested
   the app one folder deeper than Render expected (`package.json` wasn't
   at the repo root), requiring a flatten + merge-conflict resolution
   before Render's build could find `npm install`/`npm start`.

## Potential improvements (given more time)
- **Real monday.com testing.** `mondayClient.js` is written to the
  documented GraphQL v2 shape but unverified end-to-end against a live
  board — I'd confirm `items_page` cursor pagination and
  `column_values.text` rendering for every column type against the
  actual imported boards.
- **Fuzzy/embedding-based sector & stage matching** instead of exact
  case-insensitive string match, so phrasing like "energy sector" resolves
  correctly without relying on the system prompt alone.
- **A better cross-board key** — a linked-item column (Work Orders → Deals)
  instead of joining on deal-name text, if I owned the monday.com setup.
- **Streaming responses** in the UI (currently single request/response;
  fine for a demo, slower for multi-tool-call answers).
- **A paid/backup LLM provider path** as a last-resort fallback if all
  Gemini models are simultaneously overloaded, so the demo degrades more
  gracefully during a genuine Google-side outage.
- **Automated tests** for `dataNormalize.js` against a larger sample of
  real messy values (currently only smoke-tested manually).
- **Chart/table rendering in the UI** for grouped results instead of prose.

## Tech stack
Node.js + Express (server), vanilla HTML/CSS/JS (UI, no build step),
Google Gemini (via `@google/genai`, native function calling for tool use)
for the agent's reasoning, monday.com GraphQL API v2 for board data.
Deployed on Render (free tier).
