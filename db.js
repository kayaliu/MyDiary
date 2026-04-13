/**
 * db.js — SQLite storage layer (replaces JSON file storage)
 *
 * Tables:
 *   fragments  — daily input fragments (voice / text / image / feishu / wecom)
 *   extra_data — daily health / garmin / stock data
 *   diaries    — generated diary entries
 */

import Database from 'better-sqlite3'
import { mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR  = join(__dirname, 'data')
const DB_PATH   = join(DATA_DIR, 'diary.db')

mkdirSync(DATA_DIR, { recursive: true })

const db = new Database(DB_PATH)

// WAL mode: concurrent reads, safer writes
db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')

// ── Schema ────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS fragments (
    id      INTEGER PRIMARY KEY,
    date    TEXT    NOT NULL,
    type    TEXT    NOT NULL DEFAULT 'text',
    content TEXT    NOT NULL,
    ts      INTEGER NOT NULL,
    source  TEXT    NOT NULL DEFAULT 'web'
  );
  CREATE INDEX IF NOT EXISTS idx_fragments_date ON fragments(date);

  CREATE TABLE IF NOT EXISTS extra_data (
    date   TEXT PRIMARY KEY,
    health TEXT,
    garmin TEXT,
    stock  TEXT
  );

  CREATE TABLE IF NOT EXISTS diaries (
    date          TEXT    PRIMARY KEY,
    date_label    TEXT,
    content       TEXT,
    fragments     TEXT    DEFAULT '[]',
    generated_at  INTEGER,
    siyuan_synced INTEGER DEFAULT 0,
    siyuan_doc_id TEXT
  );
`)

// ── Helpers ───────────────────────────────────────────────────────────────────
const toJSON   = (v) => (v != null) ? JSON.stringify(v) : null
const fromJSON = (v) => { try { return v ? JSON.parse(v) : null } catch { return null } }

// ── Fragments API ─────────────────────────────────────────────────────────────
export const fragDB = {
  /** Return all fragments for a date, ordered chronologically */
  list (date) {
    return db.prepare('SELECT * FROM fragments WHERE date = ? ORDER BY ts ASC').all(date)
  },

  /** Insert a new fragment; id is epoch ms (matches legacy behaviour) */
  add (date, content, type = 'text', source = 'web') {
    const id = Date.now()
    const ts = Date.now()
    db.prepare(
      'INSERT INTO fragments (id, date, type, content, ts, source) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, date, type, content.trim(), ts, source)
    return { id, date, type, content: content.trim(), ts, source }
  },

  /** Delete one fragment by date + id */
  remove (date, id) {
    db.prepare('DELETE FROM fragments WHERE date = ? AND id = ?').run(date, parseInt(id, 10))
  },

  /** Delete all fragments for a date */
  clear (date) {
    db.prepare('DELETE FROM fragments WHERE date = ?').run(date)
  },
}

// ── Extra Data API ────────────────────────────────────────────────────────────
export const extraDB = {
  /** Return { health, garmin, stock } for a date (nulls for absent keys) */
  get (date) {
    const row = db.prepare('SELECT * FROM extra_data WHERE date = ?').get(date)
    if (!row) return {}
    const result = {}
    if (row.health !== null) result.health = fromJSON(row.health)
    if (row.garmin !== null) result.garmin = fromJSON(row.garmin)
    if (row.stock  !== null) result.stock  = fromJSON(row.stock)
    return result
  },

  /** Merge patch into existing row; null values remove that key */
  set (date, patch) {
    const current = extraDB.get(date)
    const merged  = { ...current, ...patch }
    db.prepare(`
      INSERT INTO extra_data (date, health, garmin, stock) VALUES (?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        health = excluded.health,
        garmin = excluded.garmin,
        stock  = excluded.stock
    `).run(date, toJSON(merged.health ?? null), toJSON(merged.garmin ?? null), toJSON(merged.stock ?? null))
    return merged
  },
}

// ── Diaries API ───────────────────────────────────────────────────────────────
function rowToDiary (row) {
  if (!row) return null
  return {
    date:         row.date,
    dateLabel:    row.date_label,
    content:      row.content,
    fragments:    fromJSON(row.fragments) || [],
    generatedAt:  row.generated_at,
    siyuanSynced: !!row.siyuan_synced,
    siyuanDocId:  row.siyuan_doc_id || null,
  }
}

export const diaryDB = {
  /** Return all diaries as { [date]: entry } map, newest first */
  getAll () {
    const rows   = db.prepare('SELECT * FROM diaries ORDER BY date DESC').all()
    const result = {}
    for (const row of rows) result[row.date] = rowToDiary(row)
    return result
  },

  /** Return single diary or null */
  get (date) {
    return rowToDiary(db.prepare('SELECT * FROM diaries WHERE date = ?').get(date))
  },

  /** Upsert a full diary entry */
  save (date, entry) {
    db.prepare(`
      INSERT INTO diaries (date, date_label, content, fragments, generated_at, siyuan_synced, siyuan_doc_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        date_label    = excluded.date_label,
        content       = excluded.content,
        fragments     = excluded.fragments,
        generated_at  = excluded.generated_at,
        siyuan_synced = excluded.siyuan_synced,
        siyuan_doc_id = excluded.siyuan_doc_id
    `).run(
      date,
      entry.dateLabel    || entry.date_label || '',
      entry.content      || '',
      toJSON(entry.fragments || []),
      entry.generatedAt  || entry.generated_at || Date.now(),
      entry.siyuanSynced || entry.siyuan_synced ? 1 : 0,
      entry.siyuanDocId  || entry.siyuan_doc_id || null,
    )
  },

  /** Partial update — merges patch onto existing row */
  patch (date, patch) {
    const current = diaryDB.get(date)
    if (!current) return null
    const updated = { ...current, ...patch }
    diaryDB.save(date, updated)
    return rowToDiary(db.prepare('SELECT * FROM diaries WHERE date = ?').get(date))
  },
}

export default db
