# 📖 MyDiary · 语音日记助手

用碎片时间积累记录，用 AI 整理成一篇温暖的日记。

支持**语音 / 文字 / 图片**输入，接入 **Apple 健康 / Garmin / 同花顺**数据，  
并可通过**飞书、企业微信**发送记录，日记生成后一键同步到**思源笔记**。

---

## 功能特性

| 功能 | 说明 |
|------|------|
| 🎤 语音输入 | 按住麦克风说话，说"总结日记"直接触发生成 |
| ✍️ 文字 / 图片 | 打字或上传图片随时记录碎片 |
| 🍎 Apple 健康 | JSON 导入或手动填入步数、睡眠、心率等 |
| ⌚ Garmin | 手动填入运动类型、距离、配速等 |
| 📈 投资数据 | 手动填入今日盈亏、总收益率等 |
| 🤖 AI 日记生成 | Anthropic Claude / OpenAI GPT / DeepSeek，模型可切换 |
| 📓 思源笔记同步 | 日记一键推送到本地思源笔记 |
| 📱 移动端优先 | 手机浏览器直接使用，支持 PWA 添加到主屏幕 |
| 🔁 周期复盘 | 按本周 / 本月 / 本季度生成 AI 深度复盘报告 |
| 🐦 飞书接入 | 通过飞书机器人发送记录 / 触发日记生成 |
| 💬 企业微信接入 | 通过企业微信应用发送记录 / 触发日记生成 |

---

## 技术栈

- **前端**：React 18 + Vite 8（内置 OXC JSX 转换，零插件依赖）
- **后端**：Express.js，REST API + webhook 接收
- **存储**：服务端 JSON 文件（`data/` 目录），多端共享
- **AI**：支持 Anthropic / OpenAI / DeepSeek，`.env` 切换

---

## 快速开始

### 1. 克隆并安装依赖

```bash
git clone https://github.com/kayaliu/MyDiary.git
cd MyDiary
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`，最少只需填写 AI 相关配置：

```env
# 选择 AI 提供商
AI_PROVIDER=anthropic          # 或 openai / deepseek

# 对应提供商的 API Key（只填所选的那个）
ANTHROPIC_API_KEY=sk-ant-xxx
# OPENAI_API_KEY=sk-xxx
# DEEPSEEK_API_KEY=sk-xxx

SERVER_PORT=3001
```

### 3. 启动

```bash
npm run dev
```

访问 [http://localhost:5173](http://localhost:5173) 即可使用。

---

## 完整配置说明

```env
# ── AI 提供商 ──────────────────────────────────────────────────────────────────
AI_PROVIDER=anthropic          # anthropic | openai | deepseek

ANTHROPIC_API_KEY=sk-ant-xxx   # Claude

OPENAI_API_KEY=sk-xxx          # OpenAI GPT
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o

DEEPSEEK_API_KEY=sk-xxx        # DeepSeek
DEEPSEEK_MODEL=deepseek-chat

# ── 思源笔记 ──────────────────────────────────────────────────────────────────
SIYUAN_TOKEN=your-token        # 设置 → 关于 → API Token
SIYUAN_URL=http://127.0.0.1:6806
SIYUAN_NOTEBOOK_ID=            # 笔记本 ID（可在 Web App 内选择，无需手填）

# ── 飞书 webhook ──────────────────────────────────────────────────────────────
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_VERIFY_TOKEN=xxx

# ── 企业微信 webhook ──────────────────────────────────────────────────────────
WECOM_TOKEN=xxx
WECOM_ENCODING_AES_KEY=xxx
WECOM_CORP_ID=xxx

# ── 服务端口 ──────────────────────────────────────────────────────────────────
SERVER_PORT=3001
```

---

## 渠道集成

### 飞书机器人接入

1. 前往 [飞书开放平台](https://open.feishu.cn) → 创建自建应用
2. 权限管理 → 添加 `im:message`、`im:message.receive_v1` 权限
3. 事件订阅 → 填入回调地址（需要公网可访问的地址）
4. 将 App ID / App Secret / Verification Token 填入 `.env`

**本地开发用 ngrok 暴露端口：**

```bash
# 安装 ngrok: https://ngrok.com/download
ngrok http 3001
# 得到类似 https://abc123.ngrok.io 的地址
```

飞书控制台填入：`https://abc123.ngrok.io/webhook/feishu`

**使用效果：**
- 在飞书给机器人发消息 → 自动保存为当日碎片，回复"✓ 已记录"
- 发送"总结日记" → 自动生成当日日记并回复全文

---

### 企业微信接入

1. 前往 [企业微信管理后台](https://work.weixin.qq.com) → 应用管理 → 创建应用
2. 进入应用 → 接收消息 → 设置 API 接收
3. 填入回调地址：`https://abc123.ngrok.io/webhook/wecom`
4. 将 Token / EncodingAESKey / CorpID 填入 `.env`

---

### 思源笔记同步

1. 启动思源笔记，进入「设置 → 关于」，开启 API 服务并复制 Token
2. 将 Token 填入 `.env` 的 `SIYUAN_TOKEN`
3. 重启服务后，在 Web App 右上角点击 📓 图标，选择目标笔记本
4. 日记生成后点击「📓 同步」按钮，自动在思源笔记创建 `/日记/YYYY-MM-DD` 文档

---

## 生产部署

```bash
# 构建前端
npm run build

# 启动（生产模式，Express 同时托管静态文件）
npm run preview
```

或使用 PM2：

```bash
npm install -g pm2
pm2 start "npm run preview" --name mydiary
pm2 save && pm2 startup
```

部署到服务器后，将飞书 / 企业微信的 webhook 地址改为服务器公网 IP/域名。

---

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/data/fragments/:date` | 获取某日碎片（date 格式：`YYYY-MM-DD`）|
| POST | `/api/data/fragments` | 添加碎片 `{ date, content, type }` |
| DELETE | `/api/data/fragments/:date/:id` | 删除单条碎片 |
| DELETE | `/api/data/fragments/:date` | 清空某日全部碎片 |
| GET | `/api/data/extra/:date` | 获取健康 / 投资等额外数据 |
| PUT | `/api/data/extra/:date` | 保存额外数据 |
| GET | `/api/data/diaries` | 获取所有日记 |
| PUT | `/api/data/diaries/:date` | 保存 / 覆盖日记 |
| PATCH | `/api/data/diaries/:date` | 部分更新日记 |
| POST | `/api/ai/chat` | AI 对话代理（前端使用）|
| POST | `/api/ai/generate-diary` | 服务端生成日记（webhook 使用）|
| ALL | `/api/siyuan/*` | 思源笔记 API 代理 |
| POST | `/webhook/feishu` | 飞书 webhook 入口 |
| GET/POST | `/webhook/wecom` | 企业微信 webhook 入口 |

---

## 项目结构

```
MyDiary/
├── src/
│   ├── main.jsx          # React 入口
│   └── App.jsx           # 主应用（所有组件）
├── server.js             # Express 后端
├── index.html            # HTML 模板
├── vite.config.js        # Vite 配置（Vite 8 + 内置 OXC）
├── package.json
├── .env.example          # 环境变量模板
├── .gitignore
├── data/                 # 运行时数据（已 gitignore）
│   ├── fragments-YYYY-MM-DD.json
│   ├── extra-YYYY-MM-DD.json
│   └── diaries.json
└── dist/                 # 构建产物（已 gitignore）
```

---

## 常见问题

**Q: 语音识别不可用？**  
A: 需要使用 Chrome 或 Safari（iOS 需授权麦克风权限），Firefox 不支持 Web Speech API。

**Q: AI 生成失败，报 401？**  
A: 检查 `.env` 中对应 `AI_PROVIDER` 的 API Key 是否正确填写。

**Q: 飞书 webhook 验证失败？**  
A: 确认 `FEISHU_VERIFY_TOKEN` 与飞书控制台「事件订阅」页面的 Verification Token 一致。

**Q: 思源笔记连接失败？**  
A: 确认思源笔记已启动且 API 服务已开启（设置 → 关于 → 在浏览器中打开），同时检查 `SIYUAN_TOKEN`。

**Q: 多设备如何共享数据？**  
A: 将服务部署到公网服务器，所有设备访问同一地址即可。`data/` 目录的 JSON 文件是唯一数据源。

---

## License

MIT
