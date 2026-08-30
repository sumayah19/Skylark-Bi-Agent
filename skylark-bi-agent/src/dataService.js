const { fetchBoardItems, isMockMode } = require('./mondayClient');
const N = require('./dataNormalize');

// Board column titles vary depending on exactly how the CSV was imported
// into monday.com (renamed columns, trimmed labels, etc). Rather than
// hardcode one exact title, we try a list of likely variants per field and
// take the first that has a value. This is the main defense against
// "inconsistent naming conventions" called out in the assignment.
function pick(row, candidates) {
  for (const c of candidates) {
    if (row[c] !== undefined && row[c] !== null && String(row[c]).trim() !== '') return row[c];
  }
  return null;
}

function normalizeDeal(row) {
  const issues = [];
  const ownerCodeRaw = pick(row, ['Owner code', 'Owner Code', 'BD/KAM Personnel code', 'Owner']);
  const statusRaw = pick(row, ['Deal Status', 'Status']);
  const closeDateRaw = pick(row, ['Close Date (A)', 'Close Date', 'Actual Close Date']);
  const dealValueRaw = pick(row, ['Deal value', 'Deal Value', 'Masked Deal value']);
  const sectorRaw = pick(row, ['Sector/service', 'Sector']);

  const deal = {
    id: row.id,
    dealName: N.cleanText(pick(row, ['Deal Name', 'Name'])),
    ownerCode: N.normalizeOwnerCode(ownerCodeRaw),
    clientCode: N.cleanText(pick(row, ['Client Code', 'Customer Name Code'])),
    status: N.normalizeStatus(statusRaw),
    closeDate: N.normalizeDate(closeDateRaw),
    closureProbability: N.cleanText(pick(row, ['Closure Probability'])),
    dealValue: N.normalizeNumber(dealValueRaw),
    tentativeCloseDate: N.normalizeDate(pick(row, ['Tentative Close Date'])),
    stage: N.normalizeStatus(pick(row, ['Deal Stage'])),
    product: N.cleanText(pick(row, ['Product deal', 'Product'])),
    sector: N.normalizeSector(sectorRaw),
    createdDate: N.normalizeDate(pick(row, ['Created Date'])),
  };

  if (!deal.dealName) issues.push('missing deal name');
  if (!deal.ownerCode) issues.push('missing owner code');
  if (!deal.status) issues.push('missing status');
  if (!deal.sector) issues.push('missing sector');
  if (deal.status && deal.status.toLowerCase() === 'won' && !deal.dealValue) issues.push('won deal with no value recorded');
  if (deal.status && deal.status.toLowerCase() === 'won' && !deal.closeDate) issues.push('won deal with no close date');

  deal._issues = issues;
  return deal;
}

function normalizeWorkOrder(row) {
  const issues = [];
  const amountExGstRaw = pick(row, ['Amount in Rupees (Excl of GST) (Masked)', 'Amount (Excl GST)', 'Amount in Rupees (Excl of GST)']);
  const amountIncGstRaw = pick(row, ['Amount in Rupees (Incl of GST) (Masked)', 'Amount (Incl GST)']);
  const billedExGstRaw = pick(row, ['Billed Value in Rupees (Excl of GST.) (Masked)', 'Billed Value (Excl GST)']);
  const collectedIncRaw = pick(row, ['Collected Amount in Rupees (Incl of GST.) (Masked)', 'Collected Amount (Incl GST)']);
  const sectorRaw = pick(row, ['Sector', 'Sector/service']);
  const ownerRaw = pick(row, ['BD/KAM Personnel code', 'Owner code']);

  const wo = {
    id: row.id,
    dealName: N.cleanText(pick(row, ['Deal name masked', 'Deal Name', 'Name'])),
    clientCode: N.cleanText(pick(row, ['Customer Name Code', 'Client Code'])),
    serial: N.cleanText(pick(row, ['Serial #', 'Serial'])),
    natureOfWork: N.cleanText(pick(row, ['Nature of Work'])),
    ownerCode: N.normalizeOwnerCode(ownerRaw),
    sector: N.normalizeSector(sectorRaw),
    typeOfWork: N.cleanText(pick(row, ['Type of Work'])),
    platform: N.cleanText(pick(row, ['Is any Skylark software platform part of the client deliverables in this deal?', 'Skylark platform in deliverables?'])),
    executionStatus: N.normalizeStatus(pick(row, ['Execution Status'])),
    amountExGst: N.normalizeNumber(amountExGstRaw),
    amountIncGst: N.normalizeNumber(amountIncGstRaw),
    billedExGst: N.normalizeNumber(billedExGstRaw),
    collectedIncGst: N.normalizeNumber(collectedIncRaw),
    invoiceStatus: N.normalizeStatus(pick(row, ['Invoice Status'])),
    lastInvoiceDate: N.normalizeDate(pick(row, ['Last invoice date'])),
    collectionStatus: N.cleanText(pick(row, ['Collection status'])),
  };

  if (!wo.dealName) issues.push('missing deal name');
  if (!wo.sector) issues.push('missing sector');
  if (!wo.executionStatus) issues.push('missing execution status');
  if (wo.amountExGst === null) issues.push('missing contract amount');
  if (wo.amountExGst !== null && wo.billedExGst !== null && wo.billedExGst > wo.amountExGst * 1.05) {
    issues.push('billed value exceeds contract amount by >5%');
  }

  wo._issues = issues;
  return wo;
}

async function getDeals() {
  const raw = await fetchBoardItems('deals');
  return raw.map(normalizeDeal);
}

async function getWorkOrders() {
  const raw = await fetchBoardItems('work_orders');
  return raw.map(normalizeWorkOrder);
}

function inDateRange(dateStr, from, to) {
  if (!dateStr) return !from && !to; // records with no date only pass if no range requested
  if (from && dateStr < from) return false;
  if (to && dateStr > to) return false;
  return true;
}

/** Generic filter usable for both deals and work orders (field names differ, handled by caller). */
function applyFilters(records, filters = {}) {
  const { sector, status, owner, dateField, dateFrom, dateTo } = filters;
  return records.filter((r) => {
    if (sector && (r.sector || '').toLowerCase() !== sector.toLowerCase()) return false;
    if (status && (r.status || r.executionStatus || '').toLowerCase() !== status.toLowerCase()) return false;
    if (owner && r.ownerCode !== owner) return false;
    if ((dateFrom || dateTo) && dateField) {
      if (!inDateRange(r[dateField], dateFrom || null, dateTo || null)) return false;
    }
    return true;
  });
}

function groupAndAggregate(records, { groupBy, valueField, agg = 'count' }) {
  const groups = new Map();
  for (const r of records) {
    const key = (groupBy ? r[groupBy] : 'All') || 'Unspecified';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const result = [];
  for (const [key, rows] of groups.entries()) {
    let value;
    if (agg === 'count') value = rows.length;
    else if (agg === 'sum') value = rows.reduce((s, r) => s + (r[valueField] || 0), 0);
    else if (agg === 'avg') {
      const nums = rows.map((r) => r[valueField]).filter((v) => v !== null && v !== undefined);
      value = nums.length ? nums.reduce((s, v) => s + v, 0) / nums.length : null;
    }
    result.push({ group: key, count: rows.length, value });
  }
  result.sort((a, b) => (b.value || 0) - (a.value || 0));
  return result;
}

function dataQualityNote(records) {
  const withIssues = records.filter((r) => r._issues && r._issues.length);
  if (!records.length) return 'No records matched this query.';
  const pct = Math.round((withIssues.length / records.length) * 100);
  if (!withIssues.length) return null;
  const counts = {};
  for (const r of withIssues) for (const issue of r._issues) counts[issue] = (counts[issue] || 0) + 1;
  const topIssues = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([issue, n]) => `${issue} (${n})`).join(', ');
  return `${withIssues.length}/${records.length} records (${pct}%) had data-quality issues: ${topIssues}.`;
}

module.exports = {
  getDeals, getWorkOrders, applyFilters, groupAndAggregate, dataQualityNote, isMockMode,
};
