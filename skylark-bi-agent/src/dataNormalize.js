/**
 * Normalization helpers for the messy monday.com export data.
 *
 * The source boards (see /mnt/user-data samples we were given) have real
 * problems: dates in 3+ formats, blank required fields, stray "OWNER_00X"
 * codes with typos, sector names cased inconsistently, numbers stored as
 * text with currency junk, "N/A" / "-" / "" all meaning "missing", and
 * duplicate rows. Every function here is defensive: it never throws on
 * bad input, it returns `null` (not "" or "undefined") for anything it
 * can't confidently parse, and it never silently invents a value.
 */

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const MISSING_TOKENS = new Set(['', 'n/a', 'na', '-', '--', 'null', 'undefined', '#value!', 'tbd', 'pending']);

function cleanText(raw) {
  if (raw === null || raw === undefined) return null;
  const t = String(raw).replace(/\s+/g, ' ').trim();
  if (t === '' || MISSING_TOKENS.has(t.toLowerCase())) return null;
  return t;
}

/** Normalize a wide range of date strings to ISO YYYY-MM-DD, or null. */
function normalizeDate(raw) {
  const t = cleanText(raw);
  if (!t) return null;

  // Already ISO: 2025-06-23
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return toISO(+m[1], +m[2] - 1, +m[3]);

  // Slash formats: 23/06/2025 or 06/23/2025 or 6/23/25
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let [, a, b, y] = m.map(Number);
    if (y < 100) y += 2000;
    // Heuristic: if first part > 12 it must be a day -> DD/MM/YYYY
    if (a > 12) return toISO(y, b - 1, a);
    // Otherwise assume MM/DD/YYYY (common in the source exports)
    return toISO(y, a - 1, b);
  }

  // "23 Jun 2025" / "Jun 23, 2025" / "23-Jun-2025"
  m = t.match(/^(\d{1,2})[\s-]([A-Za-z]{3,})[\s,-]+(\d{4})$/);
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mo !== undefined) return toISO(+m[3], mo, +m[1]);
  }
  m = t.match(/^([A-Za-z]{3,})[\s,-]+(\d{1,2})[\s,-]+(\d{4})$/);
  if (m) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mo !== undefined) return toISO(+m[3], mo, +m[2]);
  }

  // Bare month name only (e.g. "June", "Dec") with no year/day -- seen in
  // the "Last executed month" column. Can't produce a date; caller should
  // treat this as a separate categorical field, not a date.
  return null;
}

function toISO(y, mZeroBased, d) {
  const dt = new Date(Date.UTC(y, mZeroBased, d));
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

/** Strip currency symbols/commas/whitespace and parse a number, or null. */
function normalizeNumber(raw) {
  const t = cleanText(raw);
  if (!t) return null;
  const cleaned = t.replace(/[₹$,\s]/g, '').replace(/^\((.*)\)$/, '-$1'); // (123) -> -123
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Canonicalize deal/work-order status strings that vary in casing/spacing. */
function normalizeStatus(raw) {
  const t = cleanText(raw);
  if (!t) return null;
  // Collapse "A. Lead Generated" style prefixes into a clean label but keep
  // the stage letter for ordering elsewhere if needed.
  return t.replace(/\s+/g, ' ').trim();
}

/** Canonicalize sector names (casing / known synonyms only -- no guessing). */
const SECTOR_SYNONYMS = {
  'dsp': 'DSP',
  'others': 'Others',
};
function normalizeSector(raw) {
  const t = cleanText(raw);
  if (!t) return null;
  const key = t.toLowerCase();
  if (SECTOR_SYNONYMS[key]) return SECTOR_SYNONYMS[key];
  return t
    .split(' ')
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** Owner/personnel codes: trim, uppercase, validate the OWNER_### shape. */
function normalizeOwnerCode(raw) {
  const t = cleanText(raw);
  if (!t) return null;
  const m = t.toUpperCase().match(/OWNER[_\s-]?0*(\d+)/);
  if (m) return `OWNER_${m[1].padStart(3, '0')}`;
  return t; // leave non-conforming codes as-is but flagged by caller
}

module.exports = {
  cleanText,
  normalizeDate,
  normalizeNumber,
  normalizeStatus,
  normalizeSector,
  normalizeOwnerCode,
};
