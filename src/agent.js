const Anthropic = require('@anthropic-ai/sdk');
const ds = require('./dataService');

const client = new Anthropic({ apiKey: process.env.GEMINI_API_KEY});
const MODEL = 'claude-sonnet-4-5-20250929';

const SYSTEM_PROMPT = `You are Skylark Drones' internal Business Intelligence agent. You answer
founder/exec-level questions by querying two live monday.com boards: "Deals"
(sales pipeline) and "Work Orders" (project execution & billing).

Rules:
- Always use the tools to get real numbers. Never guess or fabricate figures.
- The underlying data is real-world messy (missing owners, blank dates, "#VALUE!"
  cells, inconsistent sector casing, etc). Tool results include a data-quality
  note when relevant -- always surface material caveats to the user in plain
  language (e.g. "12% of matching deals have no recorded value, so this total
  is a floor, not a ceiling").
- If a question is genuinely ambiguous (e.g. "this quarter" with no year, or
  "energy sector" when the actual sector taxonomy is Mining/Renewables/
  Powerline/etc), ask ONE short clarifying question before running numbers --
  don't ask about things you can resolve yourself (e.g. just try the closest
  matching sector name).
- Prefer the summary/aggregate tools over dumping raw rows. Only list raw
  records when the user asks for specific named deals/work orders or a short
  list.
- When asked to "prepare a leadership update" or similar, use
  build_leadership_snapshot and present it as a tight, skimmable brief (not
  raw JSON) -- headline numbers first, then 2-4 notable risks/callouts,
  then data caveats.
- Be concise. Executives want the answer and the "so what", not a data dump.`;

const TOOLS = [
  {
    name: 'summarize_deals',
    description: 'Aggregate the Deals (pipeline) board. Filter and group to answer questions about pipeline health, sector performance, win rate, revenue by stage, owner performance, etc. Returns grouped counts/sums plus a data-quality note.',
    input_schema: {
      type: 'object',
      properties: {
        sector: { type: 'string', description: 'e.g. Mining, Renewables, Powerline, Railways, Construction, DSP, Others' },
        status: { type: 'string', description: 'Deal Status value, e.g. Open, Won, Dead, On Hold' },
        owner: { type: 'string', description: 'Owner code, e.g. OWNER_001' },
        dateField: { type: 'string', enum: ['closeDate', 'tentativeCloseDate', 'createdDate'], description: 'Which date field to filter/report on' },
        dateFrom: { type: 'string', description: 'ISO date, inclusive lower bound' },
        dateTo: { type: 'string', description: 'ISO date, inclusive upper bound' },
        groupBy: { type: 'string', enum: ['sector', 'status', 'stage', 'ownerCode', 'product'], description: 'Field to group results by' },
        valueField: { type: 'string', enum: ['dealValue'], description: 'Numeric field to sum/avg (only dealValue exists)' },
        agg: { type: 'string', enum: ['count', 'sum', 'avg'], description: 'Aggregation to apply within each group' },
      },
    },
  },
  {
    name: 'summarize_work_orders',
    description: 'Aggregate the Work Orders (execution/billing) board. Use for questions about execution status, billing/collections, sector delivery load, and operational metrics.',
    input_schema: {
      type: 'object',
      properties: {
        sector: { type: 'string' },
        status: { type: 'string', description: 'Execution Status, e.g. Ongoing, Completed, Not Started, Pause / struck' },
        owner: { type: 'string' },
        dateField: { type: 'string', enum: ['lastInvoiceDate'], description: 'Only date field available on this board' },
        dateFrom: { type: 'string' },
        dateTo: { type: 'string' },
        groupBy: { type: 'string', enum: ['sector', 'executionStatus', 'natureOfWork', 'ownerCode', 'invoiceStatus'] },
        valueField: { type: 'string', enum: ['amountExGst', 'amountIncGst', 'billedExGst', 'collectedIncGst'] },
        agg: { type: 'string', enum: ['count', 'sum', 'avg'] },
      },
    },
  },
  {
    name: 'list_records',
    description: 'Return a small number of raw, normalized records (not aggregated) for spot-checking or when the user asks about specific named deals/clients. Use sparingly and with a limit.',
    input_schema: {
      type: 'object',
      properties: {
        board: { type: 'string', enum: ['deals', 'work_orders'] },
        sector: { type: 'string' },
        status: { type: 'string' },
        limit: { type: 'integer', default: 10 },
      },
      required: ['board'],
    },
  },
  {
    name: 'pipeline_to_execution_conversion',
    description: 'Cross-board join: for "Won" deals, checks whether a matching Work Order exists (matched by deal name / client code). Answers questions like "are we executing on what we sell?" or "which won deals haven\'t kicked off yet".',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'build_leadership_snapshot',
    description: 'Builds a structured leadership-ready snapshot: pipeline by stage & sector, execution status breakdown, billing/collection health, and top data-quality caveats. Use when asked to prepare a leadership/exec update.',
    input_schema: { type: 'object', properties: {} },
  },
];

async function runTool(name, input) {
  if (name === 'summarize_deals') {
    const deals = await ds.getDeals();
    const filtered = ds.applyFilters(deals, input);
    const grouped = ds.groupAndAggregate(filtered, {
      groupBy: input.groupBy, valueField: input.valueField, agg: input.agg || 'count',
    });
    return { matchedRecords: filtered.length, grouped, dataQualityNote: ds.dataQualityNote(filtered) };
  }

  if (name === 'summarize_work_orders') {
    const wos = await ds.getWorkOrders();
    const filtered = ds.applyFilters(wos, { ...input, status: input.status }).filter((r) => {
      if (input.status && (r.executionStatus || '').toLowerCase() !== input.status.toLowerCase()) return false;
      return true;
    });
    const grouped = ds.groupAndAggregate(filtered, {
      groupBy: input.groupBy, valueField: input.valueField, agg: input.agg || 'count',
    });
    return { matchedRecords: filtered.length, grouped, dataQualityNote: ds.dataQualityNote(filtered) };
  }

  if (name === 'list_records') {
    const records = input.board === 'deals' ? await ds.getDeals() : await ds.getWorkOrders();
    const filtered = ds.applyFilters(records, input);
    const limit = input.limit || 10;
    return { total: filtered.length, showing: Math.min(limit, filtered.length), records: filtered.slice(0, limit) };
  }

  if (name === 'pipeline_to_execution_conversion') {
    const [deals, wos] = await Promise.all([ds.getDeals(), ds.getWorkOrders()]);
    const won = deals.filter((d) => (d.status || '').toLowerCase() === 'won');
    const woKeys = new Set(wos.map((w) => (w.dealName || '').toLowerCase()).filter(Boolean));
    const matched = won.filter((d) => d.dealName && woKeys.has(d.dealName.toLowerCase()));
    const unmatched = won.filter((d) => !d.dealName || !woKeys.has(d.dealName.toLowerCase()));
    return {
      wonDeals: won.length,
      matchedToWorkOrder: matched.length,
      noWorkOrderFound: unmatched.length,
      sampleUnmatched: unmatched.slice(0, 8).map((d) => ({ dealName: d.dealName, clientCode: d.clientCode, closeDate: d.closeDate })),
      caveat: 'Matching is done by exact deal-name text, so cosmetic naming differences between the two boards will show up as false "no work order found" results.',
    };
  }

  if (name === 'build_leadership_snapshot') {
    const [deals, wos] = await Promise.all([ds.getDeals(), ds.getWorkOrders()]);
    const pipelineByStage = ds.groupAndAggregate(deals.filter((d) => (d.status || '').toLowerCase() === 'open'), { groupBy: 'stage', agg: 'count' });
    const pipelineBySector = ds.groupAndAggregate(deals, { groupBy: 'sector', valueField: 'dealValue', agg: 'sum' });
    const wonBySector = ds.groupAndAggregate(deals.filter((d) => (d.status || '').toLowerCase() === 'won'), { groupBy: 'sector', valueField: 'dealValue', agg: 'sum' });
    const executionByStatus = ds.groupAndAggregate(wos, { groupBy: 'executionStatus', agg: 'count' });
    const billing = {
      contractedExGst: wos.reduce((s, w) => s + (w.amountExGst || 0), 0),
      billedExGst: wos.reduce((s, w) => s + (w.billedExGst || 0), 0),
      collectedIncGst: wos.reduce((s, w) => s + (w.collectedIncGst || 0), 0),
    };
    return {
      dealCounts: { total: deals.length, open: deals.filter((d) => (d.status || '').toLowerCase() === 'open').length, won: deals.filter((d) => (d.status || '').toLowerCase() === 'won').length, dead: deals.filter((d) => (d.status || '').toLowerCase() === 'dead').length },
      pipelineByStage,
      pipelineValueBySector: pipelineBySector,
      wonValueBySector: wonBySector,
      workOrderCounts: { total: wos.length },
      executionByStatus,
      billing,
      dataQualityNote_deals: ds.dataQualityNote(deals),
      dataQualityNote_workOrders: ds.dataQualityNote(wos),
    };
  }

  throw new Error(`Unknown tool: ${name}`);
}

async function chat(history) {
  // history: [{role: 'user'|'assistant', content: string}, ...]
  const messages = history.map((m) => ({ role: m.role, content: m.content }));

  // Agentic tool-use loop, capped so a confused model can't spin forever.
  for (let turn = 0; turn < 6; turn += 1) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });

    const toolUses = response.content.filter((b) => b.type === 'tool_use');
    if (toolUses.length === 0) {
      const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      return { reply: text, mockMode: ds.isMockMode() };
    }

    messages.push({ role: 'assistant', content: response.content });
    const toolResults = [];
    for (const use of toolUses) {
      let result;
      try {
        result = await runTool(use.name, use.input || {});
      } catch (err) {
        result = { error: err.message };
      }
      toolResults.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(result) });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  return { reply: "I wasn't able to settle on an answer within my tool-call budget -- try narrowing the question.", mockMode: ds.isMockMode() };
}

module.exports = { chat };
