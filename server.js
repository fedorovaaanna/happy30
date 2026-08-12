const path = require('path');
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');

const PORT = process.env.PORT || 3001;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'wishlist.db');

const BANK_DETAILS = `TBC: GE92CD0360000034083541
получатель: Anna Fedorova`;

const SEED_ITEMS = [
  { id: 'korzina',  name: 'Корзина на тему',                          price: null, currency: 'GEL', total_qty: 2,  taken_qty: 0, subtitle: 'можете оплатить мою корзину на тему, но это кот в мешке 😼' },
  { id: 'massage',  name: 'Массаж',                                    price: 130,  currency: 'GEL', total_qty: 1,  taken_qty: 0, details: BANK_DETAILS },
  { id: 'print',    name: 'Большой принт (для дома)',                  price: 100,  currency: 'GEL', total_qty: 8,  taken_qty: 0 },
  { id: 'yoga',     name: 'Йога по субботам в 11:00',                  price: null, currency: 'GEL', total_qty: -1, taken_qty: 0 },
  { id: 'bread',    name: 'Хлеб хоккайдо в Пальпе (буханка в неделю)', price: 8,    currency: 'GEL', total_qty: -1, taken_qty: 0 },
  { id: 'rehab',    name: 'Занятие с реабилитологом-тренером',         price: 150,  currency: 'GEL', total_qty: 1,  taken_qty: 0, details: BANK_DETAILS },
  { id: 'psy',      name: 'Занятие с моей психологиней',               price: 160,  currency: 'GEL', total_qty: 1,  taken_qty: 0, details: BANK_DETAILS },
  { id: 'tattoo',   name: 'Новая татуировка (это мой кот)',            price: 150,  currency: 'GEL', total_qty: 1,  taken_qty: 0, details: BANK_DETAILS },
  { id: 'sneakers', name: 'Копилка на кроссовки',                      price: null, currency: 'GEL', total_qty: -1, taken_qty: 0, details: BANK_DETAILS },
];

// ---- База данных ----
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    subtitle TEXT,
    details TEXT,
    price REAL,
    currency TEXT NOT NULL DEFAULT 'GEL',
    total_qty INTEGER NOT NULL,
    taken_qty INTEGER NOT NULL DEFAULT 0
  );
`);

const countItems = db.prepare('SELECT COUNT(*) AS cnt FROM items').get().cnt;
if (countItems === 0) {
  const insert = db.prepare(
    'INSERT INTO items (id, name, subtitle, details, price, currency, total_qty, taken_qty) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const tx = db.transaction((items) => {
    for (const it of items) insert.run(it.id, it.name, it.subtitle ?? null, it.details ?? null, it.price, it.currency, it.total_qty, it.taken_qty);
  });
  tx(SEED_ITEMS);
  console.log('[db] Засидила 9 позиций вишлиста');
} else {
  console.log(`[db] Таблица items уже существует, записей: ${countItems}`);
}

// ---- Приложение Express ----
const app = express();

app.use(cors({ origin: '*' }));

// Парсим как JSON, так и text/plain (фронт в wishlist.html шлёт text/plain)
app.use(express.json({ limit: '1mb' }));
app.use(express.text({ type: ['text/plain'], limit: '1mb' }));

function parseBodyJson(req, _res, next) {
  if (typeof req.body === 'string' && req.body.length > 0) {
    try {
      req.body = JSON.parse(req.body);
    } catch (_) {
      req.body = req.body || {};
    }
  }
  if (!req.body || typeof req.body !== 'object') {
    req.body = {};
  }
  next();
}

app.get('/api/items', (_req, res) => {
  const rows = db.prepare(
    'SELECT id, name, subtitle, details, price, currency, total_qty, taken_qty FROM items ORDER BY id'
  ).all();
  const items = rows.map((r) => ({
    id: r.id,
    name: r.name,
    subtitle: r.subtitle ?? null,
    details: r.details ?? null,
    price: r.price,
    currency: r.currency,
    total_qty: r.total_qty,
    taken_qty: r.taken_qty,
  }));
  res.json({ items });
});

app.post('/api/items/:id/claim', parseBodyJson, (req, res) => {
  const id = req.params.id;
  const qtyRaw = req.body?.qty;
  const qty = Number(qtyRaw);
  if (!Number.isFinite(qty) || qty <= 0) {
    return res.status(400).json({
      success: false,
      message: 'invalid_qty',
    });
  }

  const item = db.prepare(
    'SELECT id, total_qty, taken_qty FROM items WHERE id = ?'
  ).get(id);

  if (!item) {
    return res.status(404).json({
      success: false,
      message: 'not_found',
    });
  }

  const remaining = item.total_qty === -1 ? Infinity : item.total_qty - item.taken_qty;
  if (remaining <= 0) {
    return res.status(409).json({
      success: false,
      message: 'already_taken',
      taken_qty: item.taken_qty,
      total_qty: item.total_qty,
    });
  }

  const giveQty = Math.min(qty, remaining);

  // Атомарный апдейт: условие в WHERE гарантирует, что не уйдём в минус даже при гонке.
  let stmt;
  let info;
  if (item.total_qty === -1) {
    stmt = db.prepare('UPDATE items SET taken_qty = taken_qty + ? WHERE id = ?');
    info = stmt.run(giveQty, id);
  } else {
    stmt = db.prepare(
      'UPDATE items SET taken_qty = taken_qty + ? WHERE id = ? AND (taken_qty + ?) <= total_qty'
    );
    info = stmt.run(giveQty, id, giveQty);
  }

  if (info.changes === 0) {
    // Кто-то успел занять между SELECT и UPDATE — возвращаем актуальное состояние.
    const fresh = db.prepare(
      'SELECT total_qty, taken_qty FROM items WHERE id = ?'
    ).get(id);
    return res.status(409).json({
      success: false,
      message: 'already_taken',
      taken_qty: fresh?.taken_qty ?? item.taken_qty,
      total_qty: fresh?.total_qty ?? item.total_qty,
    });
  }

  const after = db.prepare(
    'SELECT total_qty, taken_qty FROM items WHERE id = ?'
  ).get(id);

  return res.json({
    success: true,
    id,
    taken_qty: after.taken_qty,
    total_qty: after.total_qty,
    given_qty: giveQty,
  });
});

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(500).json({ success: false, message: 'server_error' });
});

app.listen(PORT, () => {
  console.log(`🎂 Wishlist backend запущен на http://localhost:${PORT}`);
  console.log(`   GET  /api/items`);
  console.log(`   POST /api/items/:id/claim`);
  console.log(`   DB: ${DB_PATH}`);
});
