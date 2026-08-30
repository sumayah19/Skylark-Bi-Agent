const mock = require('./mockData');

const MONDAY_API_URL = 'https://api.monday.com/v2';
const CACHE_TTL_MS = 60 * 1000; // 1 min -- boards don't need to be read on every keystroke
const cache = new Map();

function isMockMode() {
  if (String(process.env.FORCE_MOCK_MODE).toLowerCase() === 'true') return true;
  return !process.env.MONDAY_API_TOKEN || (!process.env.MONDAY_DEALS_BOARD_ID && !process.env.MONDAY_WORK_ORDERS_BOARD_ID);
}

async function mondayGraphQL(query, variables) {
  const res = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: process.env.MONDAY_API_TOKEN,
      'API-Version': '2024-10',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`monday.com API HTTP ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  if (json.errors) {
    throw new Error(`monday.com API error: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

/**
 * Fetch every item on a board and flatten each item's column_values into a
 * plain object keyed by the column's display title (what a human sees in
 * monday.com), which is far more useful to an LLM than opaque column ids.
 * Handles pagination via items_page cursors.
 */
async function fetchBoardItemsLive(boardId) {
  const items = [];
  let cursor = null;
  let columns = null;

  do {
    const query = `
      query ($boardId: [ID!], $cursor: String) {
        boards(ids: $boardId) {
          columns { id title }
          items_page(limit: 100, cursor: $cursor) {
            cursor
            items {
              id
              name
              column_values { id text value }
            }
          }
        }
      }
    `;
    const data = await mondayGraphQL(query, { boardId: [boardId], cursor });
    const board = data.boards && data.boards[0];
    if (!board) throw new Error(`Board ${boardId} not found or not accessible with this token.`);
    columns = columns || board.columns;
    const titleById = Object.fromEntries(columns.map((c) => [c.id, c.title]));

    for (const item of board.items_page.items) {
      const row = { id: item.id, Name: item.name };
      for (const cv of item.column_values) {
        row[titleById[cv.id] || cv.id] = cv.text; // .text is the human-readable rendering
      }
      items.push(row);
    }
    cursor = board.items_page.cursor;
  } while (cursor);

  return items;
}

async function fetchBoardItems(kind) {
  // kind: 'deals' | 'work_orders'
  const cacheKey = `items:${kind}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

  let data;
  if (isMockMode()) {
    data = kind === 'deals' ? mock.DEALS : mock.WORK_ORDERS;
  } else {
    const boardId = kind === 'deals' ? process.env.MONDAY_DEALS_BOARD_ID : process.env.MONDAY_WORK_ORDERS_BOARD_ID;
    if (!boardId) throw new Error(`No monday.com board id configured for "${kind}". Set MONDAY_${kind.toUpperCase()}_BOARD_ID.`);
    data = await fetchBoardItemsLive(boardId);
  }
  cache.set(cacheKey, { data, at: Date.now() });
  return data;
}

module.exports = { fetchBoardItems, isMockMode };
