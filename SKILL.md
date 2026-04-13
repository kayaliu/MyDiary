# MyDiary — 语音日记 AI Mini App

一个运行在本地的语音日记 Web 应用。利用碎片时间积累语音/文字/图片片段，AI 汇总生成结构化日记，并一键同步到思源笔记，支持周/月/季复盘。

---

## 项目结构

```
MyDiary/
├── server.js          # Express 后端（AI 代理 + 思源笔记代理）
├── src/
│   ├── main.jsx       # React 入口
│   └── App.jsx        # 主应用（全部 UI 逻辑）
├── index.html
├── vite.config.js
├── package.json
├── .env               # 你的配置（从 .env.example 复制）
└── .env.example       # 配置模板
```

---

## 快速开始

### 1. 安装依赖

```bash
cd MyDiary
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`，至少填入一个 AI Key：

```env
AI_PROVIDER=anthropic           # 或 openai / deepseek
ANTHROPIC_API_KEY=sk-ant-xxx

SIYUAN_TOKEN=your-token         # 从思源「设置-关于」复制
SIYUAN_NOTEBOOK_ID=             # 可选，也可在 App 内选择
```

### 3. 启动

```bash
npm run dev
```

打开 http://localhost:5173 即可使用。

---

## 功能说明

### 记录 Tab
- **语音输入**：按住麦克风说话；说"总结日记"直接触发生成
- **文字输入**：打字记录，⌘+Enter 快速提交
- **图片上传**：截图/照片记录到当日碎片
- **Apple健康**：手动输入 或 JSON 导入（配合 Health Auto Export App）
- **Garmin**：手动输入运动数据（待官方 API 授权后可自动化）
- **投资数据**：手动输入同花顺等平台数据

### 日记 Tab
- 查看历史所有日记（按日期倒序）
- 一键复制 Markdown
- 一键同步到思源笔记（需配置 Token）

### 复盘 Tab
- 按本周/本月/本季度筛选日记
- AI 生成深度复盘报告

---

## 支持的 AI 提供商

| 提供商 | .env 设置 | 说明 |
|--------|-----------|------|
| Anthropic Claude | `AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` | 默认，推荐 |
| OpenAI / 兼容API | `AI_PROVIDER=openai` + `OPENAI_API_KEY` | 支持自定义 base URL |
| DeepSeek | `AI_PROVIDER=deepseek` + `DEEPSEEK_API_KEY` | 低成本选项 |

---

## 思源笔记配置

1. 打开思源笔记 → 设置 → 关于 → 复制 API Token
2. 填入 `.env` 的 `SIYUAN_TOKEN`
3. App 右上角 📓 图标 → 选择笔记本
4. 日记将保存到 `笔记本/日记/YYYY-MM-DD`

---

## 第三方数据集成说明

| 来源 | 状态 | 方案 |
|------|------|------|
| Apple健康 | ✅ 支持 | 手动输入 或 Health Auto Export JSON |
| Garmin | ✅ 手动支持 | 手动输入；官方 API 需开发者账号 |
| 同花顺/股票 | ✅ 手动支持 | 手动输入；无公开 API |
| 思源笔记 | ✅ 全自动 | 本地 REST API 直接集成 |

---

## 生产部署

```bash
npm run build        # 构建前端
NODE_ENV=production node server.js   # 启动生产服务
```

访问 http://localhost:3001
