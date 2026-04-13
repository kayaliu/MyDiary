/**
 * migrate.js — 将 data/ 目录下旧版 JSON 文件一次性迁移到 SQLite
 *
 * 迁移内容：
 *   fragments-YYYY-MM-DD.json  →  fragments 表
 *   extra-YYYY-MM-DD.json      →  extra_data 表
 *   diary-*.json / diaries.json →  diaries 表
 *
 * 用法：
 *   node migrate.js
 *
 * 说明：
 *   - 迁移是幂等的：重复运行不会创建重复记录（INSERT OR IGNORE）
 *   - 迁移完成后，原 JSON 文件不会被删除，可手动备份后清理
 *   - 如果 data/ 目录不存在或没有 JSON 文件，脚本会安全退出
 */

import { readdirSync, readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import Database from 'better-sqlite3'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR  = join(__dirname, 'data')
const DB_PATH   = join(DATA_DIR, 'diary.db')

// ── Helpers ───────────────────────────────────────────────────────────────────
function readJSON(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return fallback }
}

function log(msg) { console.log(`  ${msg}`) }

// ── Main ──────────────────────────────────────────────────────────────────────
if (!existsSync(DATA_DIR)) {
  console.log('⚠️  data/ 目录不存在，无需迁移。')
  process.exit(0)
}

// Open DB (db.js already ran schema init via import, but we open directly here
// so migrate.js can run standalone before the server is started)
const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS fragments (
    id INTEGER PRIMARY KEY, date TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'text',
    content TEXT NOT NULL, ts INTEGER NOT NULL, source TEXT NOT NULL DEFAULT 'web'
  );
  CREATE INDEX IF NOT EXISTS idx_fragments_date ON fragments(date);
  CREATE TABLE IF NOT EXISTS extra_data (date TEXT PRIMARY KEY, health TEXT, garmin TEXT, stock TEXT);
  CREATE TABLE IF NOT EXISTS diaries (
    date TEXT PRIMARY KEY, date_label TEXT, content TEXT,
    fragments TEXT DEFAULT '[]', generated_at INTEGER,
    siyuan_synced INTEGER DEFAULT 0, siyuan_doc_id TEXT
  );
`)

const insertFrag  = db.prepare('INSERT OR IGNORE INTO fragments (id,date,type,content,ts,source) VALUES (?,?,?,?,?,?)')
const insertExtra = db.prepare(`
  INSERT INTO extra_data (date,health,garmin,stock) VALUES (?,?,?,?)
  ON CONFLICT(date) DO UPDATE SET
    health = COALESCE(excluded.health, health),
    garmin = COALESCE(excluded.garmin, garmin),
    stock  = COALESCE(excluded.stock,  stock)
`)
const insertDiary = db.prepare(`
  INSERT OR IGNORE INTO diaries (date,date_label,content,fragments,generated_at,siyuan_synced,siyuan_doc_id)
  VALUES (?,?,?,?,?,?,?)
`)

const toJSON = (v) => (v != null) ? JSON.stringify(v) : null

const files = readdirSync(DATA_DIR)
let fragCount = 0, extraCount = 0, diaryCount = 0

// ── Migrate fragments ─────────────────────────────────────────────────────────
const fragFiles = files.filter(f => f.startsWith('fragments-') && f.endsWith('.json'))
log(`发现 ${fragFiles.length} 个碎片文件`)

const migrateFrags = db.transaction(() => {
  for (const file of fragFiles) {
    const date  = file.replace('fragments-', '').replace('.json', '')
    const frags = readJSON(join(DATA_DIR, file), [])
    for (const f of frags) {
      insertFrag.run(f.id, date, f.type || 'text', f.content, f.ts || f.id, f.source || 'web')
      fragCount++
    }
  }
})
migrateFrags()
log(`✓ 碎片：迁移 ${fragCount} 条`)

// ── Migrate extra data ────────────────────────────────────────────────────────
const extraFiles = files.filter(f => f.startsWith('extra-') && f.endsWith('.json'))
log(`发现 ${extraFiles.length} 个健康/投资数据文件`)

const migrateExtra = db.transaction(() => {
  for (const file of extraFiles) {
    const date = file.replace('extra-', '').replace('.json', '')
    const data = readJSON(join(DATA_DIR, file), {})
    insertExtra.run(date, toJSON(data.health || null), toJSON(data.garmin || null), toJSON(data.stock || null))
    extraCount++
  }
})
migrateExtra()
log(`✓ 健康/投资：迁移 ${extraCount} 条`)

// ── Migrate diaries ───────────────────────────────────────────────────────────
// Support both: individual diary-YYYY-MM-DD.json files + legacy diaries.json
const diaryFiles = files.filter(f => f.startsWith('diary-') && f.endsWith('.json'))

// Also check for legacy single diaries.json
let legacyDiaries = {}
if (files.includes('diaries.json')) {
  legacyDiaries = readJSON(join(DATA_DIR, 'diaries.json'), {})
}

log(`发现 ${diaryFiles.length} 个日记文件 + ${Object.keys(legacyDiaries).length} 条 diaries.json 记录`)

const migrateDiaries = db.transaction(() => {
  // Individual files
  for (const file of diaryFiles) {
    const date  = file.replace('diary-', '').replace('.json', '')
    const entry = readJSON(join(DATA_DIR, file), null)
    if (!entry) continue
    insertDiary.run(
      entry.date || date,
      entry.dateLabel || entry.date_label || '',
      entry.content   || '',
      toJSON(entry.fragments || []),
      entry.generatedAt || entry.generated_at || null,
      entry.siyuanSynced || entry.siyuan_synced ? 1 : 0,
      entry.siyuanDocId  || entry.siyuan_doc_id || null,
    )
    diaryCount++
  }

  // Legacy diaries.json
  for (const [date, entry] of Object.entries(legacyDiaries)) {
    insertDiary.run(
      date,
      entry.dateLabel || entry.date_label || '',
      entry.content   || '',
      toJSON(entry.fragments || []),
      entry.generatedAt || entry.generated_at || null,
      entry.siyuanSynced || entry.siyuan_synced ? 1 : 0,
      entry.siyuanDocId  || entry.siyuan_doc_id || null,
    )
    diaryCount++
  }
})
migrateDiaries()
log(`✓ 日记：迁移 ${diaryCount} 篇`)

db.close()

console.log(`
✅ 迁移完成！
   碎片：${fragCount} 条
   健康/投资：${extraCount} 条
   日记：${diaryCount} 篇
   数据库：${DB_PATH}

💡 原 JSON 文件已保留，确认无误后可手动删除：
   rm data/fragments-*.json data/extra-*.json data/diary-*.json data/diary-index.json data/diaries.json 2>/dev/null
`)
