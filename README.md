# Birthday Wishlist Backend

Публичный бэкенд для лендинга-вишлиста на день рождения.
Стек: **Node.js 18+ · Express · better-sqlite3**.
База данных — один файл `wishlist.db` в корне проекта.

## 1. Быстрый старт (локально)

```bash
npm install
npm start
```

По умолчанию сервер слушает **http://localhost:3001**.
При первом запуске автоматически создаётся таблица `items` и засиживаются 9 подарков из ТЗ.

Переменные окружения (опционально):

| переменная | умолчание | описание |
|---|---|---|
| `PORT` | `3001` | Порт для HTTP-сервера |
| `DB_PATH` | `./wishlist.db` | Путь к SQLite-файлу |

## 2. API (контракт)

### `GET /api/items`
Текущее состояние всех подарков.
```json
{ "items": [ { "id": "massage", "name": "Массаж", "price": 130, "currency": "GEL", "total_qty": 1, "taken_qty": 0 }, ... ] }
```

### `POST /api/items/:id/claim`
Занять одну или несколько штук подарка.
Тело запроса (поддерживаются как `application/json`, так и `text/plain` — как шлёт `wishlist.html`):
```json
{ "qty": 1 }
```

Ответы:
- `200 { "success": true, "id", "taken_qty", "total_qty", "given_qty" }` — ок
- `400 { "success": false, "message": "invalid_qty" }` — неверное количество
- `404 { "success": false, "message": "not_found" }` — нет такого подарка
- `409 { "success": false, "message": "already_taken", "taken_qty", "total_qty" }` — всё разобрали

### `GET /healthz`
Проверка лайвнесса. Возвращает `{ "ok": true, "ts": ... }`.

CORS открыт для всех источников (`Access-Control-Allow-Origin: *`).

## 3. Подключение к `wishlist.html`

Открой [wishlist.html](./wishlist.html) и в самом начале `<script>`-блока (строка ~121) пропиши:

```js
const API_BASE_URL = "https://<твой-домен>/api";
// или локально: "http://localhost:3001/api"
```

После этого вместо демо-режима (localStorage) кнопки будут ходить в бэкенд, и статус «занято» станет общим для всех гостей.

## 4. Конкурентность

Инкремент `taken_qty` атомарный: SQL-запрос имеет вид
```sql
UPDATE items SET taken_qty = taken_qty + ?
WHERE id = ? AND (taken_qty + ?) <= total_qty
```
Если `changes = 0` — значит между `SELECT` и `UPDATE` кто-то успел занять слот, возвращаем `409`.
Для бесконечных подарков (`total_qty = -1`) проверка по количеству не производится.

## 5. Деплой на Render (рекомендация)

Render бесплатного тарифа хватает для задачи.

1. Запушь этот репозиторий на GitHub/GitLab.
2. Render → **New +** → **Web Service** → подключи репо.
3. Настройки сборки и запуска:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. **Advanced → Add Environment Variable:** `PORT` = `10000` (Render сам проставит, но можно явно).
5. Дождись деплоя — получишь URL вида `https://my-wishlist-xyz.onrender.com`.
6. Подставь его в `API_BASE_URL` в `wishlist.html`:
   ```js
   const API_BASE_URL = "https://my-wishlist-xyz.onrender.com/api";
   ```

**Про SQLite на Render:** БД-файл лежит на диске инстанса и **не удаляется** между рестартами (в отличие от Ephemeral Filesystem у Railway). Но при миграции на новый инстанс файл теряется — если важна персистентность на годы, есть два пути:
- переключиться на Postgres (`pg` вместо `better-sqlite3`), или
- настроить периодический бэкап `.db` файла.

Для вишлиста на неделю-две до дня рождения варианта с SQLite вполне хватает.

## 6. Полезные команды

```bash
npm run dev    # запуск с авторестартом по изменению файлов (Node 18+)
npm run seed   # отдельный seed-скрипт (TODO: если нужен отдельно от автосида)
```

Чтобы сбросить состояние «занято» на начальное — просто удали `wishlist.db` и перезапусти сервер (база пересоздастся с чистым сидом).
