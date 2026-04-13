---
name: voice_diary
description: "日记助手：记录每日碎片并用 AI 生成结构化日记。当用户说想记录想法、今天发生的事、帮我记一下、总结日记、看日记、做复盘时触发。调用本地 MyDiary 服务（默认 http://localhost:3001）的 REST API 完成操作。"
metadata: {"clawdbot":{"os":["darwin","linux"],"requires":{"bins":["node","curl"]}}}
---

# 语音日记助手 (MyDiary)

调用运行在本地的 MyDiary 服务记录日记碎片、生成日记和周期复盘。

服务地址从配置读取：`MYDIARY_SERVER_URL`（默认 `http://localhost:3001`）。

---

## 第一步：确认服务状态

每次被触发时先检查：

```bash
curl -s ${MYDIARY_SERVER_URL:-http://localhost:3001}/api/health
```

- 返回 `{"ok":true}` → 继续操作
- 连接失败 → 告知用户启动服务：

```bash
cd ~/Documents/Workspace/MyDiary && npm run preview
```

---

## 操作指令

### 记录一条碎片

用户说了想记录的内容时：

```bash
curl -s -X POST ${MYDIARY_SERVER_URL:-http://localhost:3001}/api/data/fragments \
  -H "Content-Type: application/json" \
  -d "{\"content\": \"用户说的内容\", \"type\": \"text\", \"source\": \"openclaw\"}"
```

成功后只回复：**✓ 已记录**，不展开分析。

---

### 查看今日碎片

```bash
curl -s ${MYDIARY_SERVER_URL:-http://localhost:3001}/api/data/fragments/$(date +%Y-%m-%d)
```

---

### 生成今日日记（用户说"总结日记"时）

```bash
curl -s -X POST ${MYDIARY_SERVER_URL:-http://localhost:3001}/api/ai/generate-diary \
  -H "Content-Type: application/json" \
  -d "{\"date\": \"$(date +%Y-%m-%d)\"}"
```

将返回的 `content` 字段完整展示给用户。

---

### 查看历史日记

```bash
curl -s ${MYDIARY_SERVER_URL:-http://localhost:3001}/api/data/diaries
```

按日期列出，让用户选择查看某天。

---

### 查看某天日记

```bash
curl -s ${MYDIARY_SERVER_URL:-http://localhost:3001}/api/data/diaries/YYYY-MM-DD
```

---

### 生成复盘（本周 / 本月 / 本季度）

1. 获取所有日记：`GET /api/data/diaries`
2. 按用户指定周期筛选
3. 拼接日记内容，调用 AI 生成复盘报告：

```bash
curl -s -X POST ${MYDIARY_SERVER_URL:-http://localhost:3001}/api/ai/chat \
  -H "Content-Type: application/json" \
  -d "{\"messages\":[{\"role\":\"user\",\"content\":\"请对以下日记生成复盘报告：\n\n[日记内容]\"}],\"max_tokens\":2000}"
```

---

## 行为规则

| 用户输入 | 行为 |
|----------|------|
| 任意想法 / 事件 | POST fragment，回复"✓ 已记录" |
| 总结日记 | POST generate-diary，展示全文 |
| 查看今天 / 记了什么 | GET fragments，列出清单 |
| 看日记 / 历史 | GET diaries，列出日期 |
| 复盘 | 询问周期，生成报告 |
| 服务未启动 | 告知启动命令，不做其他尝试 |

---

## API 速查

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/data/fragments/:date` | 获取某日碎片 |
| POST | `/api/data/fragments` | 添加碎片 `{content, type?, date?, source?}` |
| DELETE | `/api/data/fragments/:date/:id` | 删除单条碎片 |
| DELETE | `/api/data/fragments/:date` | 清空某日碎片 |
| GET | `/api/data/diaries` | 所有日记 |
| GET | `/api/data/diaries/:date` | 单篇日记 |
| POST | `/api/ai/generate-diary` | 生成日记 `{date?}` |
| POST | `/api/ai/chat` | AI 对话 `{messages, system?, max_tokens?}` |
