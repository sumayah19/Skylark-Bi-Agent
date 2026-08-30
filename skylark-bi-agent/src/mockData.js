/**
 * Representative sample data used only when MONDAY_API_TOKEN /
 * MONDAY_*_BOARD_ID are not configured, or FORCE_MOCK_MODE=true.
 *
 * IMPORTANT (see DECISION_LOG.md): this is NOT a row-accurate transcription
 * of the provided "Deal funnel Data" / "Work Order Tracker" PDFs. Those
 * files were shared as PDF exports of wide spreadsheets; the text
 * extraction interleaves columns in reading order rather than preserving
 * row alignment, so individual rows can't be reliably reconstructed from
 * the PDF text. This sample set instead mirrors the real columns, value
 * vocabulary (deal stages, statuses, sectors, product bundles), and the
 * *kinds* of messiness we observed (missing owner codes, mixed date
 * formats, blank close dates, duplicate-looking rows, "#VALUE!" cells) so
 * the agent's normalization and reasoning logic can be exercised
 * end-to-end. In production this file is never read -- fetchBoardItems()
 * in mondayClient.js pulls live data instead.
 */

const SECTORS = ['Mining', 'Renewables', 'Powerline', 'Railways', 'Construction', 'DSP', 'Others'];
const OWNERS = ['OWNER_001', 'OWNER_002', 'OWNER_003', 'OWNER_004', null]; // null = missing on purpose
const STAGES = [
  'A. Lead Generated', 'B. Sales Qualified Leads', 'C. Demo Done', 'D. Feasibility',
  'E. Proposal/Commercials Sent', 'F. Negotiations', 'G. Project Won', 'L. Project Lost',
  'M. Projects On Hold', 'N. Not relevant at the moment',
];
const PRODUCTS = ['Pure Service', 'Service + Spectra', 'Dock + DMO + Spectra + Service', null];
const DEAL_STATUS = ['Open', 'Won', 'Dead', 'On Hold', null]; // null = missing (seen in real data)

function seededRand(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}
const rand = seededRand(42);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const DEALS = Array.from({ length: 60 }, (_, i) => {
  const status = pick(DEAL_STATUS);
  const closeDate = status && rand() > 0.3
    ? `2025-${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rand() * 27)).padStart(2, '0')}`
    : (rand() > 0.5 ? '31/12/2025' : ''); // mixed formats + blanks, like the source
  return {
    id: `deal_${i + 1}`,
    'Deal Name': `Deal-${100 + i}`,
    'Owner code': pick(OWNERS),
    'Client Code': `COMPANY${String(1 + Math.floor(rand() * 200)).padStart(3, '0')}`,
    'Deal Status': status,
    'Close Date (A)': closeDate,
    'Closure Probability': status === 'Won' ? null : pick(['High', 'Medium', 'Low', null]),
    'Deal value': rand() > 0.15 ? Math.round(rand() * 8000000) : null,
    'Tentative Close Date': `2026-${String(1 + Math.floor(rand() * 3)).padStart(2, '0')}-${String(1 + Math.floor(rand() * 27)).padStart(2, '0')}`,
    'Deal Stage': pick(STAGES),
    'Product deal': pick(PRODUCTS),
    'Sector/service': pick(SECTORS),
    'Created Date': `2025-${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}-15`,
  };
});

const WO_STATUS = ['Ongoing', 'Completed', 'Not Started', 'Pause / struck', null];
const NATURE = ['One time Project', 'Monthly Contract', 'Annual Rate Contract', 'Proof of Concept', null];

const WORK_ORDERS = Array.from({ length: 45 }, (_, i) => {
  const wonDeal = DEALS.filter((d) => d['Deal Status'] === 'Won')[i % DEALS.filter((d) => d['Deal Status'] === 'Won').length];
  const amountExGst = rand() > 0.1 ? Math.round(rand() * 3000000 * 100) / 100 : null;
  return {
    id: `wo_${i + 1}`,
    'Deal name masked': wonDeal ? wonDeal['Deal Name'] : `Deal-${900 + i}`,
    'Customer Name Code': wonDeal ? wonDeal['Client Code'] : `WOCOMPANY_${String(1 + i).padStart(3, '0')}`,
    'Serial #': `SDPLDEAL-${String(i + 1).padStart(3, '0')}`,
    'Nature of Work': pick(NATURE),
    'BD/KAM Personnel code': pick(OWNERS),
    'Sector': pick(SECTORS),
    'Type of Work': pick(['Topography Survey: RGB', 'LiDAR Survey: LiDAR', 'Powerline Inspection', 'Volumetric survey', 'Hydrology', 'Others']),
    'Skylark platform in deliverables?': pick(['NONE', 'SPECTRA', 'DMO', 'SPECTRA + DMO']),
    'Execution Status': pick(WO_STATUS),
    'Amount (Excl GST)': amountExGst,
    'Amount (Incl GST)': amountExGst ? Math.round(amountExGst * 1.18 * 100) / 100 : null,
    'Billed Value (Excl GST)': amountExGst && rand() > 0.3 ? Math.round(amountExGst * rand() * 100) / 100 : 0,
    'Collected Amount (Incl GST)': amountExGst && rand() > 0.5 ? Math.round(amountExGst * 1.18 * rand() * 100) / 100 : 0,
    'Invoice Status': pick(['Fully Billed', 'Partially Billed', 'Not billed yet', 'Stuck']),
    'Last invoice date': rand() > 0.4 ? `2025-${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}-10` : null,
    'Collection status': pick(['Billed', 'Not Billable', 'Update Required', 'Stuck', null]),
  };
});

module.exports = { DEALS, WORK_ORDERS };
