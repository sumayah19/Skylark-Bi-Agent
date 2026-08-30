# Decision Log

## Key assumptions
- The two source files were shared as **PDF exports of wide spreadsheets**.
  PDF text extraction dumps content column-block by column-block rather
  than row-by-row, so exact row alignment (which deal name goes with which
  status, date, value...) could not be reliably reconstructed from the text.
  I treated this as a data-quality problem in its own right rather than
  guessing at alignment: the shipped `src/mockData.js` is a *representative*
  synthetic dataset (same columns, same value vocabulary — sectors, deal
  stages, statuses, product bundles — same messiness patterns: missing
  owner codes, mixed date formats, blank/`"#VALUE!"` cells) used only when
  monday.com isn't configured. It exists so the agent's tool-calling and
  normalization logic can be demoed and evaluated end-to-end without a live
  board connection; it is never used once `MONDAY_API_TOKEN` + board IDs
  are set. The real, correctly-aligned data lives only in monday.com after
  the CSVs are imported there, which is also what the assignment requires
  the agent to query dynamically.
- monday.com column **titles** (not IDs) are the integration contract,
  since the assignment says "set up appropriate column types and structure
  as you see fit" — i.e. exact column names aren't guaranteed. `dataService.js`
  tries several plausible header spellings per field.
- "This quarter" / "energy sector" style founder phrasing won't map cleanly
  onto the actual schema (sectors are Mining/Renewables/Powerline/Railways/
  Construction/DSP/Others — there's no literal "energy" sector). The system
  prompt tells the agent to resolve what it reasonably can on its own
  (e.g. treat "energy" as Renewables/Powerline) and only ask a clarifying
  question when it truly can't disambiguate (e.g. no year given for "this
  quarter").

## Trade-offs chosen, and why
- **Aggregation in JS, not in the LLM.** Tools return pre-grouped
  counts/sums rather than raw rows. Slightly less flexible (the model can
  only slice along the group-by fields I exposed) but far more trustworthy
  for numeric answers — the failure mode I most wanted to avoid for a
  founder-facing BI tool is a confident, wrong number.
- **No database / no ETL pipeline.** Reads go straight to monday.com's
  GraphQL API on each request (behind a 60s cache). This keeps the "don't
  hardcode CSV data, query dynamically" requirement trivially true and
  removes a whole class of staleness bugs, at the cost of being slower on
  cold cache and dependent on monday.com's API being up.
- **Server-side tool-use loop over a client-side agent framework.** A
  ~150-line hand-rolled loop (`agent.js`) was faster to build, easier to
  reason about, and easier to explain than pulling in LangChain/etc. for
  five tools.
- **Fuzzy header matching over an exact schema contract.** More resilient
  to how someone actually names columns in monday.com, at the cost of some
  silent-mismatch risk if a column is named something wildly different —
  mitigated by `dataQualityNote` surfacing missing-field rates so a bad
  mapping shows up as "80% missing sector" rather than failing silently.
- **Deal↔Work-Order join by exact deal-name text**, not a stable foreign
  key (none exists in the source data). Cheap and transparent, but will
  under-match on cosmetic naming differences between the two boards — the
  tool result says this explicitly (`caveat` field) rather than presenting
  the count as ground truth.

## How I interpreted "help prepare data for leadership updates"
I implemented it as an **on-demand structured snapshot** (`build_leadership_snapshot`
tool), triggered by asking the agent for a leadership/exec update. It returns,
and the agent narrates: deal counts by status, open pipeline by stage, pipeline
and won value by sector, work-order execution-status breakdown, and rolled-up
contracted/billed/collected totals — plus the data-quality caveats for both
boards. I chose "on-demand, chat-native" over a separate export/PDF/slide
generator because (a) it fits the conversational-interface requirement
directly, (b) a founder can immediately follow up ("why is DSP pipeline so
concentrated?") in the same thread instead of receiving a static document,
and (c) it was the highest-value use of remaining time versus building a
document-generation pipeline.

## What I'd do differently with more time
- **Real monday.com testing.** I didn't have a live token/board to test
  against, so `mondayClient.js` is written to the documented GraphQL v2
  shape but unverified end-to-end against a real board; I'd want to
  confirm `items_page` cursor pagination and `column_values.text` rendering
  for every column type (especially status/date columns) against the
  actual imported boards.
- **Fuzzy/embedding-based sector & stage matching** instead of exact
  case-insensitive string match, so "energy" or "renewable energy" resolve
  correctly without relying on the system prompt alone.
- **A better cross-board key.** If I owned the monday.com setup, I'd add a
  linked-item column (Work Orders → Deals) instead of joining on deal-name
  text.
- **Streaming responses** in the UI (currently a single request/response;
  fine for a demo, not ideal for slower multi-tool-call answers).
- **Automated tests** for `dataNormalize.js` against a larger sample of the
  real messy values (I only smoke-tested manually given the time budget).
- **Chart/table rendering in the UI** for grouped results instead of prose,
  which would make sector/stage breakdowns easier to scan.

## Tech stack
Node.js + Express (server), vanilla HTML/CSS/JS (UI, no build step to keep
setup to `npm install && npm start`), Anthropic SDK (`@anthropic-ai/sdk`,
Claude Sonnet with tool use) for the agent's reasoning, monday.com GraphQL
API v2 for board data.
