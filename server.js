import express from 'express'
import cors from 'cors'
import { readFileSync, existsSync } from 'fs'
import { createServer } from 'http'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import crypto from 'crypto'
import { fragDB, extraDB, diaryDB } from './db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── Load .env ────────────────────────────────────────────────────────────────
if (existsSync(join(__dirname, '.env'))) {
  for (const line of readFileSync(join(__dirname, '.env'), 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq > 0) {
      const key = t.slice(0, eq).trim()
      const val = t.slice(eq + 1).trim()
      if (!process.env[key]) process.env[key] = val
    }
  }
}

const app      = express()
const PORT     = parseInt(process.env.SERVER_PORT || process.env.PORT || '3001', 10)
const PROVIDER = (process.env.AI_PROVIDER || 'anthropic').toLowerCase()

app.use(cors())
// Raw body needed for webhook signature verification
app.use('/webhook', express.raw({ type: '*/*' }))
app.use(express.json({ limit: '10mb' }))

// ── Helpers ──────────────────────────────────────────────────────────────────
function todayKey() { return new Date().toISOString().split('T')[0] }
function apiError(res, status, msg) { return res.status(status).json({ error: msg }) }
function validKey(k, ph) { const v = process.env[k]; return !!v && v !== ph }

// ════════════════════════════════════════════════════════════════════════════
//  DATA API  /api/data/*
// ════════════════════════════════════════════════════════════════════════════

// ── Fragments ─────────────────────────────────────────────────────────────────
app.get('/api/data/fragments/:date', (req, res) => {
  res.json(fragDB.list(req.params.date))
})

app.post('/api/data/fragments', (req, res) => {
  const { date = todayKey(), content, type = 'text', source = 'web' } = req.body
  if (!content?.trim()) return apiError(res, 400, 'content 不能为空')
  res.json(fragDB.add(date, content, type, source))
})

app.delete('/api/data/fragments/:date/:id', (req, res) => {
  fragDB.remove(req.params.date, req.params.id)
  res.json({ ok: true })
})

app.delete('/api/data/fragments/:date', (req, res) => {
  fragDB.clear(req.params.date)
  res.json({ ok: true })
})

// ── Extra data (health / garmin / stock) ──────────────────────────────────────
app.get('/api/data/extra/:date', (req, res) => {
  res.json(extraDB.get(req.params.date))
})

app.put('/api/data/extra/:date', (req, res) => {
  res.json(extraDB.set(req.params.date, req.body))
})

// ── Diaries ───────────────────────────────────────────────────────────────────
app.get('/api/data/diaries', (_req, res) => {
  res.json(diaryDB.getAll())
})

app.get('/api/data/diaries/:date', (req, res) => {
  const entry = diaryDB.get(req.params.date)
  if (!entry) return apiError(res, 404, '日记不存在')
  res.json(entry)
})

app.put('/api/data/diaries/:date', (req, res) => {
  diaryDB.save(req.params.date, req.body)
  res.json({ ok: true })
})

app.patch('/api/data/diaries/:date', (req, res) => {
  const updated = diaryDB.patch(req.params.date, req.body)
  if (!updated) return apiError(res, 404, '日记不存在')
  res.json({ ok: true })
})

// ════════════════════════════════════════════════════════════════════════════
//  AI PROXY  /api/ai/*
//
//  支持的 AI_PROVIDER:
//    anthropic  — Anthropic Claude（原生格式）
//    openai     — OpenAI GPT（OpenAI 兼容）
//    deepseek   — DeepSeek（OpenAI 兼容）
//    openrouter — OpenRouter 免费/付费模型（OpenAI 兼容）
//    google     — Google Gemini（OpenAI 兼容端点）
//    qianfan    — 百度千帆（OpenAI 兼容）
// ════════════════════════════════════════════════════════════════════════════

// OpenAI 兼容提供商配置表
const OPENAI_COMPAT_PROVIDERS = {
  openai: {
    envKey: 'OPENAI_API_KEY',
    base:   () => process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    model:  () => process.env.OPENAI_MODEL    || 'gpt-4o',
  },
  deepseek: {
    envKey: 'DEEPSEEK_API_KEY',
    base:   () => 'https://api.deepseek.com/v1',
    model:  () => process.env.DEEPSEEK_MODEL  || 'deepseek-chat',
  },
  openrouter: {
    envKey: 'OPENROUTER_API_KEY',
    base:   () => 'https://openrouter.ai/api/v1',
    model:  () => process.env.OPENROUTER_MODEL || 'openrouter/auto',
    extraHeaders: { 'HTTP-Referer': 'https://github.com/kayaliu/MyDiary', 'X-Title': 'MyDiary' },
  },
  google: {
    envKey: 'GOOGLE_API_KEY',
    base:   () => 'https://generativelanguage.googleapis.com/v1beta/openai',
    model:  () => process.env.GOOGLE_MODEL    || 'gemini-1.5-flash',
  },
  qianfan: {
    envKey: 'QIANFAN_API_KEY',
    base:   () => process.env.QIANFAN_BASE_URL || 'https://qianfan.baidubce.com/v2',
    model:  () => process.env.QIANFAN_MODEL   || 'deepseek-v3.2',
  },
}

async function callAI({ messages, system, max_tokens = 2000 }) {
  // ── Anthropic 原生格式 ────────────────────────────────────────────────────
  if (PROVIDER === 'anthropic') {
    if (!validKey('ANTHROPIC_API_KEY', 'sk-ant-xxx')) throw new Error('请在 .env 中设置有效的 ANTHROPIC_API_KEY')
    const body = { model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5', max_tokens, messages }
    if (system) body.system = system
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
    })
    const data = await r.json()
    if (!r.ok) throw new Error(data?.error?.message || 'Anthropic API error')
    return data.content?.[0]?.text || ''
  }

  // ── OpenAI 兼容格式 ───────────────────────────────────────────────────────
  const cfg = OPENAI_COMPAT_PROVIDERS[PROVIDER]
  if (!cfg) throw new Error(`未知 AI_PROVIDER: ${PROVIDER}。支持: anthropic, openai, deepseek, openrouter, google, qianfan`)

  const apiKey = process.env[cfg.envKey]
  if (!apiKey) throw new Error(`请在 .env 中设置 ${cfg.envKey}`)

  const msgs = system ? [{ role: 'system', content: system }, ...messages] : messages
  const r = await fetch(`${cfg.base()}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, ...(cfg.extraHeaders || {}) },
    body: JSON.stringify({ model: cfg.model(), max_tokens, messages: msgs }),
  })
  const data = await r.json()
  if (!r.ok) throw new Error(data?.error?.message || `${PROVIDER} API error`)
  return data.choices?.[0]?.message?.content || ''
}

app.post('/api/ai/chat', async (req, res) => {
  try {
    res.json({ content: await callAI(req.body) })
  } catch (e) {
    apiError(res, 500, e.message)
  }
})

// ════════════════════════════════════════════════════════════════════════════
//  SIYUAN PROXY  /api/siyuan/*
// ════════════════════════════════════════════════════════════════════════════
app.use('/api/siyuan', async (req, res) => {
  const base  = (process.env.SIYUAN_URL || 'http://127.0.0.1:6806').replace(/\/$/, '')
  const token = process.env.SIYUAN_TOKEN || ''
  try {
    const r = await fetch(`${base}/api${req.path}`, {
      method:  req.method,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Token ${token}` },
      body:    req.method !== 'GET' ? JSON.stringify(req.body) : undefined,
    })
    res.json(await r.json())
  } catch (e) {
    const connErr = e.message.includes('ECONNREFUSED') || e.message.includes('fetch failed')
    res.status(connErr ? 503 : 502).json({ error: connErr ? '无法连接思源笔记，请确认已启动' : e.message })
  }
})

// ════════════════════════════════════════════════════════════════════════════
//  WEBHOOK: FEISHU (飞书)
// ════════════════════════════════════════════════════════════════════════════
app.post('/webhook/feishu', async (req, res) => {
  let payload
  try { payload = JSON.parse(req.body.toString()) } catch { return apiError(res, 400, 'invalid JSON') }

  // URL verification challenge
  if (payload.challenge) return res.json({ challenge: payload.challenge })

  // Token verification
  const verifyToken = process.env.FEISHU_VERIFY_TOKEN
  if (verifyToken && payload.header?.token !== verifyToken) return apiError(res, 401, 'invalid token')

  if (payload.header?.event_type === 'im.message.receive_v1') {
    const msg = payload.event?.message
    if (!msg || msg.message_type !== 'text') return res.json({ ok: true })

    let text = ''
    try { text = JSON.parse(msg.content).text?.trim() } catch {}
    if (!text) return res.json({ ok: true })

    const date = todayKey()

    if (text.includes('总结日记')) {
      res.json({ ok: true })
      await generateAndSendDiary(date, 'feishu', payload.event)
    } else if (text === '查看日记') {
      const diary = diaryDB.get(date)
      await sendFeishuReply(payload.event, diary
        ? '📖 今日日记已生成，请在 MyDiary App 中查看'
        : '📝 今日还未生成日记，继续记录碎片后说"总结日记"')
      res.json({ ok: true })
    } else {
      const frag = fragDB.add(date, text, 'text', 'feishu')
      const count = fragDB.list(date).length
      await sendFeishuReply(payload.event, `👂 收到～（今日第 ${count} 条）`)
      res.json({ ok: true })
    }
  } else {
    res.json({ ok: true })
  }
})

async function getFeishuToken() {
  const r = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: process.env.FEISHU_APP_ID, app_secret: process.env.FEISHU_APP_SECRET }),
  })
  return (await r.json()).tenant_access_token
}

async function sendFeishuReply(event, text) {
  if (!process.env.FEISHU_APP_ID || !process.env.FEISHU_APP_SECRET) return
  try {
    const token  = await getFeishuToken()
    const chatId = event.message?.chat_id
    await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text }) }),
    })
  } catch (e) { console.error('Feishu reply error:', e.message) }
}

// ════════════════════════════════════════════════════════════════════════════
//  WEBHOOK: WECOM (企业微信)
// ════════════════════════════════════════════════════════════════════════════
app.get('/webhook/wecom', (req, res) => {
  const { msg_signature, timestamp, nonce, echostr } = req.query
  const str = [process.env.WECOM_TOKEN || '', timestamp, nonce].sort().join('')
  const sig = crypto.createHash('sha1').update(str).digest('hex')
  if (sig === msg_signature) res.send(echostr)
  else apiError(res, 403, 'signature mismatch')
})

app.post('/webhook/wecom', async (req, res) => {
  const text = req.body.toString().match(/<Content><!\[CDATA\[(.+?)\]\]><\/Content>/)?.[1]?.trim()
  if (!text) return res.send('<xml><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[ok]]></Content></xml>')

  const date = todayKey()
  if (text.includes('总结日记')) {
    res.send('<xml><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[生成中，请稍候...]]></Content></xml>')
    await generateAndSendDiary(date, 'wecom', null)
  } else {
    fragDB.add(date, text, 'text', 'wecom')
    const count = fragDB.list(date).length
    res.send(`<xml><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[👂 收到～（今日第 ${count} 条）]]></Content></xml>`)
  }
})

// ════════════════════════════════════════════════════════════════════════════
//  DIARY GENERATION
// ════════════════════════════════════════════════════════════════════════════
const WEEKDAYS = ['日','一','二','三','四','五','六']
function getDateLabel(dateStr) {
  const d = new Date(dateStr + 'T12:00:00')
  return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日 周${WEEKDAYS[d.getDay()]}`
}

async function generateAndSendDiary(date, channel = 'web', eventCtx = null) {
  const frags     = fragDB.list(date)
  const extra     = extraDB.get(date)
  const dateLabel = getDateLabel(date)

  const fragText = frags.length > 0
    ? frags.map((f, i) => `${i+1}. [${f.source || f.type}] ${f.content}`).join('\n')
    : '（今日暂无碎片记录）'

  const healthSection = extra.health ? `\n【Apple健康】步数:${extra.health.steps} 睡眠:${extra.health.sleep} 心率:${extra.health.heartRate}bpm` : ''
  const garminSection = extra.garmin ? `\n【Garmin】${extra.garmin.activity} ${extra.garmin.duration} ${extra.garmin.distance}` : ''
  const stockSection  = extra.stock  ? `\n【投资】盈亏:${extra.stock.todayPnl}元 ${extra.stock.positions}` : ''

  const prompt = `今天的记录碎片：\n${fragText}${healthSection}${garminSection}${stockSection}

请严格按以下模板生成日记：

日期：${dateLabel}

#### 今日亮点
[提炼最值得记住的时刻]

#### 今日成长
- 完成了什么
- 学到了什么
- 克服了什么挑战

#### 今日想法
[新的点子或创意]

#### 今日健康
[饮食、运动、睡眠]

#### 今日花销
[今天的花费]

#### 今日投资
[投资情况]

#### 今日 TODO 完成情况
[TODO完成情况]

### 明日改进
[1-2条具体建议]

### 今日关键词
[2字以内，1-3个词，#标签]

### 明日 TODO
[明天的安排]

## 一句话总结
[温暖概括]`

  try {
    const content = await callAI({
      system: '你是一个温暖的日记助手。仅整理通顺保留原话，语气温暖支持，侧重积极面同时诚实面对不足。',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2000,
    })

    const entry = { date, dateLabel, content, fragments: frags, generatedAt: Date.now() }
    diaryDB.save(date, entry)

    if (channel === 'feishu' && eventCtx) {
      const summary = content.includes('一句话总结')
        ? content.slice(content.indexOf('一句话总结'))
        : content.slice(0, 300) + '...'
      await sendFeishuReply(eventCtx, `📖 今日日记已生成 ✦\n\n${summary}\n\n完整日记请在 MyDiary App 中查看`)
    }
    return entry
  } catch (e) {
    console.error('Diary generation error:', e.message)
    if (channel === 'feishu' && eventCtx) await sendFeishuReply(eventCtx, `生成失败：${e.message}`)
    return null
  }
}

app.post('/api/ai/generate-diary', async (req, res) => {
  const entry = await generateAndSendDiary(req.body.date || todayKey(), 'web')
  if (entry) res.json(entry)
  else apiError(res, 500, 'Diary generation failed — check server logs')
})

// ════════════════════════════════════════════════════════════════════════════
//  HEALTH CHECK
// ════════════════════════════════════════════════════════════════════════════
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    provider: PROVIDER,
    storage: 'sqlite',
    configured: {
      anthropic:   validKey('ANTHROPIC_API_KEY',  'sk-ant-xxx'),
      openai:      validKey('OPENAI_API_KEY',      'sk-xxx'),
      deepseek:    validKey('DEEPSEEK_API_KEY',    'sk-xxx'),
      openrouter:  validKey('OPENROUTER_API_KEY',  'sk-or-xxx'),
      google:      validKey('GOOGLE_API_KEY',      'AIza-xxx'),
      qianfan:     validKey('QIANFAN_API_KEY',     'your-qianfan-key'),
      siyuan:      validKey('SIYUAN_TOKEN',        'your-siyuan-token'),
      feishu:      validKey('FEISHU_APP_ID',       'your-feishu-app-id'),
      wecom:       validKey('WECOM_TOKEN',         'your-wecom-token'),
    },
    channels: {
      feishu: `http://your-domain:${PORT}/webhook/feishu`,
      wecom:  `http://your-domain:${PORT}/webhook/wecom`,
    }
  })
})

// ── Production: serve built frontend ────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const distPath = join(__dirname, 'dist')
  app.use(express.static(distPath))
  app.get('*', (_req, res) => res.sendFile(join(distPath, 'index.html')))
}

// ── Start ────────────────────────────────────────────────────────────────────
createServer(app).listen(PORT, () => {
  console.log(`\n🚀 MyDiary server  →  http://localhost:${PORT}`)
  console.log(`   AI provider : ${PROVIDER}  ${validKey('ANTHROPIC_API_KEY','sk-ant-xxx') || validKey('OPENAI_API_KEY','sk-xxx') || validKey('DEEPSEEK_API_KEY','sk-xxx') ? '✅' : '⚠️  需配置 API Key'}`)
  console.log(`   Storage     : SQLite  (data/diary.db)`)
  console.log(`   SiYuan      : ${process.env.SIYUAN_URL || 'http://127.0.0.1:6806'}`)
  console.log(`   飞书 Webhook: http://your-domain:${PORT}/webhook/feishu`)
  console.log(`   企业微信    : http://your-domain:${PORT}/webhook/wecom\n`)
})
