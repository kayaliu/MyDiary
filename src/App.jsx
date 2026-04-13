import { useState, useEffect, useRef, useCallback } from "react";

// ─── Date helpers ───────────────────────────────────────────────────────────
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
function getDateKey(d = new Date()) { return d.toISOString().split("T")[0]; }
function getDateLabel(d = new Date()) {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 周${WEEKDAYS[d.getDay()]}`;
}
const TODAY = new Date();
const DATE_KEY = getDateKey(TODAY);
const DATE_LABEL = getDateLabel(TODAY);

// ─── Data API helpers (server-side storage) ──────────────────────────────────
const api = {
  getFragments: (date) => fetch(`/api/data/fragments/${date}`).then(r => r.json()),
  addFragment: (date, content, type) => fetch('/api/data/fragments', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, content, type }),
  }).then(r => r.json()),
  deleteFragment: (date, id) => fetch(`/api/data/fragments/${date}/${id}`, { method: 'DELETE' }),
  clearFragments: (date) => fetch(`/api/data/fragments/${date}`, { method: 'DELETE' }),
  getExtra: (date) => fetch(`/api/data/extra/${date}`).then(r => r.json()),
  setExtra: (date, data) => fetch(`/api/data/extra/${date}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(r => r.json()),
  getDiaries: () => fetch('/api/data/diaries').then(r => r.json()),
  saveDiary: (date, entry) => fetch(`/api/data/diaries/${date}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  }).then(r => r.json()),
  patchDiary: (date, patch) => fetch(`/api/data/diaries/${date}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }).then(r => r.json()),
};

// ─── AI API call ─────────────────────────────────────────────────────────────
async function aiChat({ messages, system, max_tokens = 2000 }) {
  const res = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, system, max_tokens }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'AI request failed');
  return data.content;
}

// ─── SiYuan API calls ─────────────────────────────────────────────────────────
const siyuan = {
  async call(path, body = {}) {
    const res = await fetch(`/api/siyuan${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  },
  listNotebooks: () => siyuan.call('/notebook/lsNotebooks'),
  createDoc: (notebook, path, md) => siyuan.call('/filetree/createDocWithMd', { notebook, path, markdown: md }),
  updateBlock: (id, md) => siyuan.call('/block/updateBlock', { id, data: md, dataType: 'markdown' }),
  searchBlock: (query) => siyuan.call('/search/fullTextSearchBlock', { query, method: 0, groupBy: 0, orderBy: 0, types: {} }),
};

// ─── Diary prompt template ───────────────────────────────────────────────────
function buildDiaryPrompt(fragments, extraData, dateLabel) {
  const fragText = fragments.length > 0
    ? fragments.map((f, i) => `${i + 1}. [${f.type === 'voice' ? '语音' : f.type === 'image' ? '图片' : '文字'}] ${f.content}`).join('\n')
    : '（今日暂无碎片记录）';

  const healthSection = extraData.health
    ? `\n【Apple健康数据】步数:${extraData.health.steps} 睡眠:${extraData.health.sleep} 心率:${extraData.health.heartRate}bpm 活动:${extraData.health.activeMin}分钟 热量:${extraData.health.calories}kcal`
    : '';
  const garminSection = extraData.garmin
    ? `\n【Garmin运动】${extraData.garmin.activity} 时长:${extraData.garmin.duration} 距离:${extraData.garmin.distance} 配速:${extraData.garmin.pace} VO2max:${extraData.garmin.vo2max}`
    : '';
  const stockSection = extraData.stock
    ? `\n【投资数据】今日盈亏:${extraData.stock.todayPnl}元 总收益:${extraData.stock.totalReturn} 持仓:${extraData.stock.positions} 备注:${extraData.stock.note}`
    : '';

  return `今天的记录碎片：
${fragText}
${healthSection}${garminSection}${stockSection}

请严格按以下模板生成日记（保留所有标题，暂无内容时写"暂无记录"，语气温暖支持，侧重积极面同时诚实面对不足，建议具体可行）：

日期：${dateLabel}

#### 今日亮点
[提炼最值得记住的时刻、积极情绪、有意义的互动]

#### 今日成长
- 完成了什么
- 学到了什么
- 克服了什么挑战

#### 今日想法
[记录今天有什么新的点子或创意]

#### 今日健康
[记录今天饮食、运动、睡眠等情况]

#### 今日花销
[记录今天的花费]

#### 今日投资
[总结今天的投资情况]

#### 今日 TODO 完成情况
[总结今天的 TODO 安排完成情况]

### 明日改进
[1-2 条具体可执行建议]

### 今日关键词
[2字以内，1-3个词，用 # 标签形式]

### 明日 TODO
[记录明天的 TODO 安排]

## 一句话总结
[温暖概括今天]`;
}

function buildReviewPrompt(period, entries) {
  return `请根据以下${period}的日记内容，生成一份深度复盘报告。

${entries}

复盘结构：
1. ${period}关键词（3个以内）
2. 最值得记住的3个时刻
3. 成长轨迹（串联每天的成长点，看出趋势）
4. 反复出现的挑战（识别模式）
5. 情绪地图（高点与低点及规律）
6. 下${period === "本周" ? "周" : period === "本月" ? "月" : "季度"}一个重点主题
7. 写给未来自己的一句话

语气：温暖、诚实、有洞察力。`;
}

// ─── Markdown renderer ────────────────────────────────────────────────────────
function MarkdownText({ text }) {
  const lines = text.split("\n");
  return (
    <div style={{ fontSize: 14, lineHeight: 1.9, color: "#333" }}>
      {lines.map((line, i) => {
        if (line.startsWith("## ")) return <h2 key={i} style={{ fontSize: 16, fontWeight: 700, margin: "18px 0 6px", color: "#1a1a1a", borderBottom: "2px solid #F0E8D8", paddingBottom: 4 }}>{line.slice(3)}</h2>;
        if (line.startsWith("### ")) return <h3 key={i} style={{ fontSize: 15, fontWeight: 600, margin: "14px 0 4px", color: "#2a2a2a" }}>{line.slice(4)}</h3>;
        if (line.startsWith("#### ")) return <h4 key={i} style={{ fontSize: 14, fontWeight: 600, margin: "10px 0 4px", color: "#333", borderLeft: "3px solid #E8A94D", paddingLeft: 8 }}>{line.slice(5)}</h4>;
        if (line.startsWith("- ") || line.startsWith("• ")) return <div key={i} style={{ paddingLeft: 16, color: "#555", margin: "2px 0" }}>• {line.slice(2)}</div>;
        if (line.match(/^#[^\s#]/)) return <span key={i} style={{ display: "inline-block", background: "#FFF3DC", color: "#B8751A", padding: "2px 8px", borderRadius: 20, fontSize: 12, margin: "2px 3px 2px 0" }}>{line}</span>;
        if (line.startsWith("**") && line.endsWith("**")) return <strong key={i} style={{ display: "block", margin: "6px 0 2px", color: "#1a1a1a" }}>{line.slice(2, -2)}</strong>;
        if (line.trim() === "") return <div key={i} style={{ height: 6 }} />;
        return <p key={i} style={{ margin: "2px 0", color: "#444" }}>{line}</p>;
      })}
    </div>
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ msg }) {
  if (!msg) return null;
  return (
    <div style={{ position: "fixed", top: 56, left: "50%", transform: "translateX(-50%)", background: "rgba(0,0,0,0.78)", color: "#fff", padding: "9px 22px", borderRadius: 22, fontSize: 13, zIndex: 9999, whiteSpace: "nowrap", pointerEvents: "none" }}>
      {msg}
    </div>
  );
}

// ─── Health Import Modal ──────────────────────────────────────────────────────
function HealthImportModal({ onClose, onImport }) {
  const [raw, setRaw] = useState('');
  const [tab, setTab] = useState('manual');

  const manualDefaults = {
    steps: '', sleep: '', heartRate: '', calories: '', activeMin: '',
    activity: '', duration: '', distance: '', pace: '', vo2max: ''
  };
  const [manual, setManual] = useState(manualDefaults);

  function handleJsonImport() {
    try {
      const data = JSON.parse(raw);
      // Health Auto Export format
      const metrics = data.data?.metrics || data.metrics || [];
      const find = (name) => metrics.find(m => m.name === name)?.data?.[0]?.qty;
      onImport({
        health: {
          steps: find('step_count') || find('stepCount') || 0,
          sleep: find('sleep_analysis') || find('sleepAnalysis') || '未记录',
          heartRate: find('heart_rate') || find('heartRate') || 0,
          calories: find('active_energy') || find('activeEnergy') || 0,
          activeMin: find('exercise_time') || find('exerciseTime') || 0,
        }
      });
      onClose();
    } catch (e) {
      alert('JSON 格式解析失败，请检查格式');
    }
  }

  function handleManualImport() {
    const h = {
      steps: manual.steps || '未记录',
      sleep: manual.sleep || '未记录',
      heartRate: manual.heartRate || '未记录',
      calories: manual.calories || '未记录',
      activeMin: manual.activeMin || '未记录',
    };
    const g = (manual.activity || manual.duration || manual.distance) ? {
      activity: manual.activity || '运动',
      duration: manual.duration || '未记录',
      distance: manual.distance || '未记录',
      pace: manual.pace || '未记录',
      vo2max: manual.vo2max || '未记录',
    } : null;
    onImport({ health: h, garmin: g });
    onClose();
  }

  const inp = { width: '100%', border: '1px solid #E8E8E8', borderRadius: 8, padding: '8px 10px', fontSize: 14, background: '#F9F9F7', outline: 'none', boxSizing: 'border-box' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: '#fff', width: '100%', maxWidth: 480, borderRadius: '20px 20px 0 0', padding: '20px 20px 40px', maxHeight: '85vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>导入健康数据</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#999' }}>×</button>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {['manual', 'json'].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: '8px', border: 'none', borderRadius: 10, background: tab === t ? '#E8A94D' : '#F5F5F5', color: tab === t ? '#fff' : '#555', fontWeight: tab === t ? 600 : 400, cursor: 'pointer', fontSize: 13 }}>
              {t === 'manual' ? '手动输入' : 'JSON导入'}
            </button>
          ))}
        </div>

        {tab === 'manual' && (
          <>
            <div style={{ fontSize: 12, color: '#999', marginBottom: 12, lineHeight: 1.6 }}>
              从苹果健康/Garmin App 查看数据后手动填入
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
              {[['steps','步数 (步)'],['sleep','睡眠'],['heartRate','心率 (bpm)'],['calories','热量 (kcal)'],['activeMin','活动 (分钟)']].map(([key, label]) => (
                <div key={key}>
                  <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>{label}</div>
                  <input style={inp} placeholder={label} value={manual[key]} onChange={e => setManual(p => ({ ...p, [key]: e.target.value }))} />
                </div>
              ))}
            </div>
            <div style={{ fontSize: 12, color: '#B8751A', fontWeight: 600, marginBottom: 8 }}>Garmin 运动（选填）</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
              {[['activity','运动类型'],['duration','时长'],['distance','距离'],['pace','配速'],['vo2max','VO2max']].map(([key, label]) => (
                <div key={key}>
                  <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>{label}</div>
                  <input style={inp} placeholder={label} value={manual[key]} onChange={e => setManual(p => ({ ...p, [key]: e.target.value }))} />
                </div>
              ))}
            </div>
            <button onClick={handleManualImport} style={{ width: '100%', background: '#E8A94D', color: '#fff', border: 'none', borderRadius: 12, padding: '12px', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
              导入
            </button>
          </>
        )}

        {tab === 'json' && (
          <>
            <div style={{ fontSize: 12, color: '#999', marginBottom: 8, lineHeight: 1.6 }}>
              使用 <b>Health Auto Export</b> App（免费）→ 导出 JSON → 粘贴到下方
            </div>
            <textarea
              style={{ ...inp, resize: 'vertical', height: 160, fontFamily: 'monospace', fontSize: 12 }}
              placeholder={'{\n  "data": {\n    "metrics": [...]\n  }\n}'}
              value={raw}
              onChange={e => setRaw(e.target.value)}
            />
            <button onClick={handleJsonImport} style={{ width: '100%', background: '#E8A94D', color: '#fff', border: 'none', borderRadius: 12, padding: '12px', fontSize: 15, fontWeight: 600, cursor: 'pointer', marginTop: 12 }}>
              解析并导入
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Stock Import Modal ───────────────────────────────────────────────────────
function StockImportModal({ onClose, onImport }) {
  const [data, setData] = useState({ todayPnl: '', totalReturn: '', positions: '', note: '' });
  const inp = { width: '100%', border: '1px solid #E8E8E8', borderRadius: 8, padding: '8px 10px', fontSize: 14, background: '#F9F9F7', outline: 'none', boxSizing: 'border-box', marginBottom: 10 };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: '#fff', width: '100%', maxWidth: 480, borderRadius: '20px 20px 0 0', padding: '20px 20px 40px' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>导入投资数据</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#999' }}>×</button>
        </div>
        <div style={{ fontSize: 12, color: '#999', marginBottom: 12 }}>从同花顺/其他App查看后手动填入</div>
        {[['todayPnl','今日盈亏（元）','如：+2340 或 -800'],['totalReturn','总收益率','如：+8.6%'],['positions','持仓摘要','如：沪深300 ETF +1.2%'],['note','备注','今日操作或市场看法']].map(([key, label, ph]) => (
          <div key={key}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>{label}</div>
            <input style={inp} placeholder={ph} value={data[key]} onChange={e => setData(p => ({ ...p, [key]: e.target.value }))} />
          </div>
        ))}
        <button onClick={() => { onImport({ stock: data }); onClose(); }} style={{ width: '100%', background: '#52C41A', color: '#fff', border: 'none', borderRadius: 12, padding: '12px', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
          导入
        </button>
      </div>
    </div>
  );
}

// ─── SiYuan Settings Modal ────────────────────────────────────────────────────
function SiYuanModal({ onClose, onSave, currentNotebook }) {
  const [notebooks, setNotebooks] = useState([]);
  const [selected, setSelected] = useState(currentNotebook || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function loadNotebooks() {
    setLoading(true); setError('');
    try {
      const res = await siyuan.listNotebooks();
      if (res.code === 0) setNotebooks(res.data?.notebooks || []);
      else setError(res.msg || '获取笔记本失败');
    } catch (e) {
      setError('无法连接思源笔记，请确认已启动并在设置中允许 API 访问');
    }
    setLoading(false);
  }

  useEffect(() => { loadNotebooks(); }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: '#fff', width: '100%', maxWidth: 480, borderRadius: '20px 20px 0 0', padding: '20px 20px 40px' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>思源笔记设置</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#999' }}>×</button>
        </div>
        {loading && <div style={{ textAlign: 'center', color: '#999', padding: 20 }}>连接中…</div>}
        {error && (
          <div style={{ background: '#FFF2F0', border: '1px solid #FFD6D6', borderRadius: 10, padding: 12, marginBottom: 12, fontSize: 13, color: '#CF1322', lineHeight: 1.6 }}>
            {error}
            <br /><br />
            请确认：<br />
            1. 思源笔记已启动<br />
            2. 设置 → 关于 → 已开启"在浏览器中打开"或 API 服务<br />
            3. .env 中 SIYUAN_TOKEN 已正确配置
          </div>
        )}
        {!loading && !error && (
          <>
            <div style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>选择保存日记的笔记本：</div>
            {notebooks.map(nb => (
              <div key={nb.id} onClick={() => setSelected(nb.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: `1.5px solid ${selected === nb.id ? '#E8A94D' : '#E8E8E8'}`, marginBottom: 8, cursor: 'pointer', background: selected === nb.id ? '#FFF8EC' : '#fff' }}>
                <span style={{ fontSize: 18 }}>📓</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: selected === nb.id ? 600 : 400 }}>{nb.name}</div>
                </div>
                {selected === nb.id && <span style={{ color: '#E8A94D', fontWeight: 700 }}>✓</span>}
              </div>
            ))}
            <button onClick={() => { onSave(selected); onClose(); }} disabled={!selected} style={{ width: '100%', background: selected ? '#E8A94D' : '#F5F5F5', color: selected ? '#fff' : '#999', border: 'none', borderRadius: 12, padding: '12px', fontSize: 15, fontWeight: 600, cursor: selected ? 'pointer' : 'not-allowed', marginTop: 8 }}>
              保存设置
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Helper: time ago ─────────────────────────────────────────────────────────
function timeAgo(ts) {
  const d = Date.now() - ts;
  if (d < 60000) return "刚刚";
  if (d < 3600000) return `${Math.floor(d / 60000)}分钟前`;
  return `${Math.floor(d / 3600000)}小时前`;
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ════════════════════════════════════════════════════════════════════════════════
export default function VoiceDiaryApp() {
  const [tab, setTab] = useState("record");
  const [fragments, setFragments] = useState([]);
  const [diaries, setDiaries] = useState({});
  const [inputText, setInputText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [viewingDiary, setViewingDiary] = useState(null);
  const [extraData, setExtraData] = useState({ health: null, garmin: null, stock: null });
  const [reviewPeriod, setReviewPeriod] = useState("本周");
  const [reviewResult, setReviewResult] = useState("");
  const [reviewLoading, setReviewLoading] = useState(false);
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState(null); // 'health' | 'stock' | 'siyuan'
  const [siyuanNotebook, setSiyuanNotebook] = useState(() => {
    try { return JSON.parse(localStorage.getItem('siyuan_notebook')) || ''; } catch { return ''; }
  });
  const [syncingId, setSyncingId] = useState(null);
  const recogRef = useRef(null);
  const textareaRef = useRef(null);

  // Load persisted data from server
  useEffect(() => {
    api.getFragments(DATE_KEY).then(data => { if (Array.isArray(data)) setFragments(data); }).catch(() => {});
    api.getDiaries().then(data => { if (data && typeof data === 'object') setDiaries(data); }).catch(() => {});
    api.getExtra(DATE_KEY).then(data => { if (data && typeof data === 'object') setExtraData(prev => ({ ...prev, ...data })); }).catch(() => {});
  }, []);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  }, []);

  async function addFragment(content, type = "text") {
    if (!content.trim()) return;
    try {
      const f = await api.addFragment(DATE_KEY, content.trim(), type);
      setFragments(prev => [...prev, f]);
      setInputText("");
      showToast("✓ 已记录");
    } catch (e) {
      showToast("记录失败：" + e.message);
    }
  }

  async function removeFragment(id) {
    try {
      await api.deleteFragment(DATE_KEY, id);
      setFragments(prev => prev.filter(f => f.id !== id));
    } catch (e) {
      showToast("删除失败");
    }
  }

  async function clearFragments() {
    try {
      await api.clearFragments(DATE_KEY);
      setFragments([]);
      showToast("已清空");
    } catch (e) {
      showToast("清空失败");
    }
  }

  // ── Voice recording ────────────────────────────────────────────────────────
  const startVoice = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { showToast("当前浏览器不支持语音识别，请使用 Chrome"); return; }
    const r = new SR();
    r.lang = "zh-CN"; r.continuous = false; r.interimResults = false;
    r.onstart = () => setIsRecording(true);
    r.onend = () => setIsRecording(false);
    r.onresult = (e) => {
      const text = e.results[0][0].transcript;
      if (text.includes("总结日记")) {
        generateDiary();
      } else {
        addFragment(text, "voice").catch(() => {});
      }
    };
    r.onerror = () => { setIsRecording(false); showToast("语音识别失败，请重试"); };
    recogRef.current = r;
    r.start();
  }, [fragments, extraData]);

  const stopVoice = useCallback(() => {
    recogRef.current?.stop();
    setIsRecording(false);
  }, []);

  // ── Image input ────────────────────────────────────────────────────────────
  function handleImageUpload(file) {
    if (!file) return;
    addFragment(`[图片: ${file.name}]`, "image").catch(() => {});
  }

  // ── Extra data import ──────────────────────────────────────────────────────
  async function handleDataImport(data) {
    const next = { ...extraData, ...data };
    setExtraData(next);
    try {
      await api.setExtra(DATE_KEY, next);
      showToast("数据已导入 ✓");
    } catch (e) {
      showToast("导入失败：" + e.message);
    }
  }

  async function removeExtraData(key) {
    const next = { ...extraData, [key]: null };
    setExtraData(next);
    try {
      await api.setExtra(DATE_KEY, next);
    } catch (e) {
      showToast("删除失败");
    }
  }

  // ── Generate diary ─────────────────────────────────────────────────────────
  async function generateDiary() {
    if (fragments.length === 0 && !extraData.health && !extraData.garmin && !extraData.stock) {
      showToast("请先添加今日记录"); return;
    }
    setGenerating(true); setTab("diary"); setViewingDiary(null);
    try {
      const prompt = buildDiaryPrompt(fragments, extraData, DATE_LABEL);
      const content = await aiChat({
        system: "你是一个温暖的日记助手。仅整理通顺保留原话，语气温暖支持，侧重积极面同时诚实面对不足，建议具体可行。",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 2000,
      });
      const entry = { date: DATE_KEY, dateLabel: DATE_LABEL, content, fragments: [...fragments], generatedAt: Date.now() };
      await api.saveDiary(DATE_KEY, entry);
      setDiaries(prev => ({ ...prev, [DATE_KEY]: entry }));
      setViewingDiary(DATE_KEY);
      showToast("日记已生成 ✓");
    } catch (e) {
      showToast("生成失败：" + e.message);
      setTab("record");
    }
    setGenerating(false);
  }

  // ── SiYuan sync ────────────────────────────────────────────────────────────
  async function syncToSiYuan(dateKey) {
    const entry = diaries[dateKey];
    if (!entry) return;
    if (!siyuanNotebook) { setModal('siyuan'); return; }
    setSyncingId(dateKey);
    try {
      const path = `/日记/${entry.date}`;
      const md = `# ${entry.dateLabel}\n\n${entry.content}`;
      const res = await siyuan.createDoc(siyuanNotebook, path, md);
      if (res.code === 0) {
        showToast("已同步到思源笔记 ✓");
        const patch = { siyuanSynced: true, siyuanDocId: res.data };
        await api.patchDiary(dateKey, patch);
        setDiaries(p => ({ ...p, [dateKey]: { ...p[dateKey], ...patch } }));
      } else {
        showToast("同步失败：" + res.msg);
      }
    } catch (e) {
      showToast("同步失败：" + e.message);
    }
    setSyncingId(null);
  }

  // ── Review generation ──────────────────────────────────────────────────────
  async function generateReview() {
    const entries = Object.entries(diaries);
    if (entries.length === 0) { showToast("暂无日记可复盘"); return; }
    setReviewLoading(true); setReviewResult("");

    const now = new Date();
    let filtered = entries;
    if (reviewPeriod === "本周") {
      const weekAgo = Date.now() - 7 * 86400000;
      filtered = entries.filter(([k]) => new Date(k).getTime() >= weekAgo);
    } else if (reviewPeriod === "本月") {
      filtered = entries.filter(([k]) => k.startsWith(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`));
    } else {
      const quarter = Math.floor(now.getMonth() / 3);
      filtered = entries.filter(([k]) => {
        const m = new Date(k).getMonth();
        return Math.floor(m / 3) === quarter && new Date(k).getFullYear() === now.getFullYear();
      });
    }
    if (filtered.length === 0) { showToast(`${reviewPeriod}暂无日记`); setReviewLoading(false); return; }

    const text = filtered.map(([k, v]) => `=== ${v.dateLabel} ===\n${v.content}`).join('\n\n');
    try {
      const content = await aiChat({
        messages: [{ role: "user", content: buildReviewPrompt(reviewPeriod, text) }],
        max_tokens: 2000,
      });
      setReviewResult(content);
    } catch (e) {
      setReviewResult("生成失败：" + e.message);
    }
    setReviewLoading(false);
  }

  // ── Styles ─────────────────────────────────────────────────────────────────
  const S = {
    app: { maxWidth: 480, margin: "0 auto", background: "#F7F4EF", height: "100vh", overflow: "hidden", display: "flex", flexDirection: "column", fontFamily: "-apple-system, 'PingFang SC', 'Helvetica Neue', sans-serif", position: "relative" },
    header: { background: "#fff", padding: "14px 16px 10px", borderBottom: "1px solid #EEE", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 },
    content: { flex: 1, overflowY: "auto", padding: "12px 16px", paddingBottom: 16 },
    card: { background: "#fff", borderRadius: 16, padding: "14px 16px", marginBottom: 12, boxShadow: "0 1px 6px rgba(0,0,0,0.05)" },
    sectionTitle: { fontSize: 12, fontWeight: 600, color: "#AAA", letterSpacing: 1, marginBottom: 10, textTransform: "uppercase" },
    btn: (active, color = "#E8A94D") => ({ background: active ? color : "#F5F5F5", color: active ? "#fff" : "#666", border: "none", borderRadius: 20, padding: "7px 16px", fontSize: 13, fontWeight: 500, cursor: "pointer" }),
    primaryBtn: (disabled) => ({ background: disabled ? "#E0D8CE" : "#E8A94D", color: "#fff", border: "none", borderRadius: 12, padding: "12px", fontSize: 15, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer", width: "100%" }),
    tabBar: { background: "#fff", borderTop: "1px solid #EEE", display: "flex", padding: "8px 0 22px", flexShrink: 0 },
    tabItem: (active) => ({ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, cursor: "pointer", color: active ? "#E8A94D" : "#BBB", fontSize: 10, fontWeight: active ? 600 : 400, border: "none", background: "none" }),
    voiceBtn: { width: 72, height: 72, borderRadius: "50%", background: isRecording ? "#FF4757" : "#E8A94D", color: "#fff", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontSize: 26, boxShadow: isRecording ? "0 0 0 10px rgba(255,71,87,0.15)" : "0 4px 16px rgba(232,169,77,0.45)", transition: "all .2s", touchAction: "none" },
    textarea: { width: "100%", background: "#F9F9F7", border: "1px solid #E8E8E8", borderRadius: 12, padding: "10px 12px", fontSize: 15, resize: "none", outline: "none", color: "#333", boxSizing: "border-box", fontFamily: "inherit", lineHeight: 1.6 },
    chipOn: { display: "flex", alignItems: "center", gap: 6, background: "#FFF3DC", color: "#B8751A", border: "1.5px solid #E8A94D", borderRadius: 20, padding: "6px 12px", fontSize: 13, cursor: "pointer" },
    chipOff: { display: "flex", alignItems: "center", gap: 6, background: "#F5F5F5", color: "#888", border: "1.5px solid #E8E8E8", borderRadius: 20, padding: "6px 12px", fontSize: 13, cursor: "pointer" },
  };

  const currentDiary = viewingDiary ? diaries[viewingDiary] : null;

  return (
    <div style={S.app}>
      <Toast msg={toast} />

      {modal === 'health' && <HealthImportModal onClose={() => setModal(null)} onImport={handleDataImport} />}
      {modal === 'stock' && <StockImportModal onClose={() => setModal(null)} onImport={handleDataImport} />}
      {modal === 'siyuan' && <SiYuanModal onClose={() => setModal(null)} onSave={(id) => { setSiyuanNotebook(id); try { localStorage.setItem('siyuan_notebook', JSON.stringify(id)); } catch {} showToast("思源笔记已配置 ✓"); }} currentNotebook={siyuanNotebook} />}

      {/* Header */}
      <div style={S.header}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, color: "#1A1A1A" }}>
            {tab === "record" && "今日记录"}
            {tab === "diary" && (currentDiary ? currentDiary.dateLabel : "我的日记")}
            {tab === "review" && "周期复盘"}
          </div>
          <div style={{ fontSize: 11, color: "#BBB", marginTop: 1 }}>{DATE_LABEL}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {tab === "record" && fragments.length > 0 && (
            <button onClick={generateDiary} disabled={generating} style={{ ...S.btn(true), opacity: generating ? 0.6 : 1, fontSize: 13 }}>
              {generating ? "生成中…" : "总结日记 ✦"}
            </button>
          )}
          {tab === "diary" && currentDiary && (
            <button onClick={() => setViewingDiary(null)} style={{ ...S.btn(false), fontSize: 13 }}>← 返回</button>
          )}
          <button onClick={() => setModal('siyuan')} title="思源笔记设置" style={{ background: siyuanNotebook ? '#FFF3DC' : '#F5F5F5', border: 'none', borderRadius: 20, padding: '7px 10px', cursor: 'pointer', fontSize: 16 }}>
            📓
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={S.content}>

        {/* ── RECORD TAB ──────────────────────────────────────────────────── */}
        {tab === "record" && (
          <>
            {/* Voice button */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "20px 0 14px" }}>
              <button
                style={S.voiceBtn}
                onMouseDown={startVoice} onMouseUp={stopVoice}
                onTouchStart={e => { e.preventDefault(); startVoice(); }} onTouchEnd={stopVoice}
              >
                🎤
              </button>
              <div style={{ fontSize: 12, color: isRecording ? "#FF4757" : "#CCC", marginTop: 10, fontWeight: isRecording ? 600 : 400 }}>
                {isRecording ? "录音中，松开停止…" : '按住说话 · 说"总结日记"可直接生成'}
              </div>
            </div>

            {/* Text input */}
            <div style={S.card}>
              <textarea
                ref={textareaRef}
                style={S.textarea} rows={3}
                placeholder="也可以打字记录想法、待办、情绪…（⌘+Enter 快速提交）"
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) addFragment(inputText); }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button onClick={() => addFragment(inputText)} disabled={!inputText.trim()} style={{ ...S.btn(!inputText.trim() ? false : true), flex: 1 }}>记录</button>
                <label style={{ ...S.btn(false), cursor: "pointer", display: 'flex', alignItems: 'center', gap: 4 }}>
                  📷 图片
                  <input type="file" accept="image/*" style={{ display: "none" }} onChange={e => handleImageUpload(e.target.files[0])} />
                </label>
              </div>
            </div>

            {/* Data imports */}
            <div style={S.card}>
              <div style={S.sectionTitle}>导入外部数据</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <div onClick={() => setModal('health')} style={extraData.health ? S.chipOn : S.chipOff}>
                  <span>🍎</span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>Apple健康</div>
                    {extraData.health && <div style={{ fontSize: 11 }}>步数 {extraData.health.steps}</div>}
                  </div>
                  {extraData.health
                    ? <span style={{ fontSize: 11, cursor: 'pointer' }} onClick={e => { e.stopPropagation(); removeExtraData('health'); }}>×</span>
                    : <span style={{ fontSize: 12 }}>+</span>}
                </div>

                <div onClick={() => setModal('health')} style={extraData.garmin ? { ...S.chipOn, background: '#E8F4FF', color: '#1890FF', borderColor: '#91D5FF' } : S.chipOff}>
                  <span>⌚</span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>Garmin</div>
                    {extraData.garmin && <div style={{ fontSize: 11 }}>{extraData.garmin.activity}</div>}
                  </div>
                  {extraData.garmin
                    ? <span style={{ fontSize: 11, cursor: 'pointer' }} onClick={e => { e.stopPropagation(); removeExtraData('garmin'); }}>×</span>
                    : <span style={{ fontSize: 12 }}>+</span>}
                </div>

                <div onClick={() => setModal('stock')} style={extraData.stock ? { ...S.chipOn, background: '#F6FFED', color: '#389E0D', borderColor: '#B7EB8F' } : S.chipOff}>
                  <span>📈</span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>投资</div>
                    {extraData.stock && <div style={{ fontSize: 11 }}>{extraData.stock.todayPnl}元</div>}
                  </div>
                  {extraData.stock
                    ? <span style={{ fontSize: 11, cursor: 'pointer' }} onClick={e => { e.stopPropagation(); removeExtraData('stock'); }}>×</span>
                    : <span style={{ fontSize: 12 }}>+</span>}
                </div>
              </div>

              {/* Expanded health preview */}
              {extraData.health && (
                <div style={{ marginTop: 10, background: "#FFF8F0", borderRadius: 10, padding: 10 }}>
                  <div style={{ fontSize: 11, color: "#B8751A", fontWeight: 600, marginBottom: 6 }}>Apple健康数据</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 6 }}>
                    {[["步数", extraData.health.steps], ["睡眠", extraData.health.sleep], ["心率", `${extraData.health.heartRate}bpm`], ["热量", `${extraData.health.calories}kcal`], ["活动", `${extraData.health.activeMin}min`]].map(([k, v]) => (
                      <div key={k} style={{ background: "#fff", borderRadius: 8, padding: "6px 4px", textAlign: "center" }}>
                        <div style={{ fontSize: 10, color: "#AAA" }}>{k}</div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#E8A94D" }}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {extraData.garmin && (
                <div style={{ marginTop: 8, background: "#E8F4FF", borderRadius: 10, padding: 10 }}>
                  <div style={{ fontSize: 11, color: "#1890FF", fontWeight: 600, marginBottom: 4 }}>Garmin · {extraData.garmin.activity}</div>
                  <div style={{ display: "flex", gap: 14, fontSize: 12, color: "#555" }}>
                    <span>⏱ {extraData.garmin.duration}</span>
                    <span>📍 {extraData.garmin.distance}</span>
                    <span>⚡ {extraData.garmin.pace}</span>
                  </div>
                </div>
              )}
              {extraData.stock && (
                <div style={{ marginTop: 8, background: "#F6FFED", borderRadius: 10, padding: 10 }}>
                  <div style={{ fontSize: 11, color: "#389E0D", fontWeight: 600, marginBottom: 4 }}>今日投资</div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#555" }}>
                    <span>今日 <b style={{ color: extraData.stock.todayPnl?.startsWith('+') ? '#389E0D' : '#CF1322' }}>{extraData.stock.todayPnl}元</b></span>
                    <span>总收益 {extraData.stock.totalReturn}</span>
                  </div>
                  {extraData.stock.note && <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>{extraData.stock.note}</div>}
                </div>
              )}
            </div>

            {/* Fragment list */}
            {fragments.length > 0 ? (
              <div style={S.card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={S.sectionTitle}>今日碎片 ({fragments.length})</div>
                  <button onClick={clearFragments} style={{ fontSize: 11, color: "#CCC", background: "none", border: "none", cursor: "pointer" }}>清空</button>
                </div>
                {fragments.map(f => (
                  <div key={f.id} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: "1px solid #F5F5F5" }}>
                    <span style={{ background: f.type === 'voice' ? '#E8F4FF' : f.type === 'image' ? '#F0FFF4' : '#F5F5F5', color: f.type === 'voice' ? '#1890FF' : f.type === 'image' ? '#52C41A' : '#888', fontSize: 11, padding: "2px 8px", borderRadius: 20, height: 20, whiteSpace: 'nowrap' }}>
                      {f.type === 'voice' ? '🎤' : f.type === 'image' ? '📷' : '✍️'}
                    </span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, color: "#333", lineHeight: 1.6 }}>{f.content}</div>
                      <div style={{ fontSize: 11, color: "#CCC", marginTop: 2 }}>{timeAgo(f.ts)}</div>
                    </div>
                    <button onClick={() => removeFragment(f.id)} style={{ background: "none", border: "none", color: "#DDD", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: '0 2px' }}>×</button>
                  </div>
                ))}
                <button onClick={generateDiary} disabled={generating} style={{ ...S.primaryBtn(generating), marginTop: 14 }}>
                  {generating ? "AI 正在生成日记…" : "✦ 总结日记"}
                </button>
              </div>
            ) : (
              <div style={{ textAlign: "center", padding: "32px 0", color: "#CCC" }}>
                <div style={{ fontSize: 44, marginBottom: 10 }}>🌅</div>
                <div style={{ fontSize: 14 }}>按住麦克风或打字</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>随时记录今天的想法与经历</div>
              </div>
            )}
          </>
        )}

        {/* ── DIARY TAB ──────────────────────────────────────────────────── */}
        {tab === "diary" && (
          <>
            {generating && !currentDiary && (
              <div style={{ ...S.card, textAlign: "center", padding: "40px 16px" }}>
                <div style={{ fontSize: 36, marginBottom: 12, animation: 'spin 2s linear infinite' }}>✦</div>
                <div style={{ fontSize: 15, color: "#888" }}>AI 正在整理今日日记…</div>
              </div>
            )}
            {currentDiary ? (
              <>
                <div style={S.card}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "#1A1A1A" }}>{currentDiary.dateLabel}</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => { navigator.clipboard?.writeText(currentDiary.content); showToast("已复制 ✓"); }} style={{ ...S.btn(false), fontSize: 12, padding: "5px 10px" }}>📋</button>
                      <button
                        onClick={() => syncToSiYuan(viewingDiary)}
                        disabled={syncingId === viewingDiary}
                        style={{ ...S.btn(currentDiary.siyuanSynced, '#B8751A'), fontSize: 12, padding: "5px 10px", opacity: syncingId === viewingDiary ? 0.6 : 1 }}
                      >
                        {syncingId === viewingDiary ? '同步中…' : currentDiary.siyuanSynced ? '✓ 已同步' : '📓 同步'}
                      </button>
                    </div>
                  </div>
                  <MarkdownText text={currentDiary.content} />
                </div>
                {!siyuanNotebook && (
                  <div style={{ ...S.card, background: '#FFF9F0', border: '1px solid #FFE0A0' }}>
                    <div style={{ fontSize: 13, color: '#B8751A', fontWeight: 600, marginBottom: 4 }}>💡 配置思源笔记</div>
                    <div style={{ fontSize: 13, color: '#888', lineHeight: 1.6, marginBottom: 10 }}>点击右上角 📓 图标，选择笔记本，即可一键同步日记到思源笔记。</div>
                    <button onClick={() => setModal('siyuan')} style={{ ...S.btn(true, '#B8751A'), fontSize: 13 }}>立即配置</button>
                  </div>
                )}
              </>
            ) : !generating && (
              <>
                {Object.keys(diaries).length === 0 ? (
                  <div style={{ textAlign: "center", padding: "48px 0", color: "#CCC" }}>
                    <div style={{ fontSize: 44, marginBottom: 10 }}>📖</div>
                    <div style={{ fontSize: 14 }}>还没有日记</div>
                    <div style={{ fontSize: 12, marginTop: 4 }}>去「记录」添加今日碎片并生成日记</div>
                  </div>
                ) : (
                  <div style={S.card}>
                    <div style={S.sectionTitle}>我的日记 ({Object.keys(diaries).length})</div>
                    {Object.entries(diaries).sort((a, b) => b[0].localeCompare(a[0])).map(([key, entry]) => (
                      <div key={key} onClick={() => setViewingDiary(key)} style={{ padding: "12px 0", borderBottom: "1px solid #F5F5F5", cursor: "pointer" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: "#1A1A1A" }}>{entry.dateLabel}</div>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            {entry.siyuanSynced && <span style={{ fontSize: 11, color: '#B8751A' }}>📓</span>}
                            <span style={{ fontSize: 12, color: "#E8A94D" }}>查看 →</span>
                          </div>
                        </div>
                        <div style={{ fontSize: 12, color: "#AAA", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {entry.content.split("\n").find(l => l.trim() && !l.startsWith("#"))?.slice(0, 60) || ""}…
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ── REVIEW TAB ──────────────────────────────────────────────────── */}
        {tab === "review" && (
          <>
            <div style={S.card}>
              <div style={S.sectionTitle}>选择复盘周期</div>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                {["本周", "本月", "本季度"].map(p => (
                  <button key={p} onClick={() => setReviewPeriod(p)} style={{ ...S.btn(reviewPeriod === p), flex: 1 }}>{p}</button>
                ))}
              </div>
              <div style={{ fontSize: 12, color: "#BBB", marginBottom: 12, textAlign: "center" }}>
                共 {Object.keys(diaries).length} 篇日记可供复盘
              </div>
              <button onClick={generateReview} disabled={reviewLoading || Object.keys(diaries).length === 0} style={S.primaryBtn(reviewLoading || Object.keys(diaries).length === 0)}>
                {reviewLoading ? "AI 正在复盘分析…" : `✦ 生成${reviewPeriod}复盘`}
              </button>
            </div>

            {reviewResult ? (
              <div style={S.card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{reviewPeriod}复盘</div>
                  <button onClick={() => { navigator.clipboard?.writeText(reviewResult); showToast("已复制 ✓"); }} style={{ ...S.btn(false), fontSize: 12, padding: "5px 10px" }}>📋 复制</button>
                </div>
                <MarkdownText text={reviewResult} />
              </div>
            ) : !reviewLoading && (
              <div style={{ textAlign: "center", padding: "32px 0", color: "#CCC" }}>
                <div style={{ fontSize: 44, marginBottom: 10 }}>🔁</div>
                <div style={{ fontSize: 14 }}>积累日记，定期复盘</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>发现成长轨迹与思维模式</div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Tab bar */}
      <div style={S.tabBar}>
        {[
          { id: "record", icon: "✍️", label: "记录" },
          { id: "diary", icon: "📖", label: "日记" },
          { id: "review", icon: "🔁", label: "复盘" },
        ].map(t => (
          <button key={t.id} style={S.tabItem(tab === t.id)} onClick={() => { setTab(t.id); if (t.id === "diary") setViewingDiary(null); }}>
            <span style={{ fontSize: 22 }}>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
