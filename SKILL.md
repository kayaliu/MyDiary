---
name: voice-diary
description: 语音日记技能。当用户提到"语音日记"、"记录日记"、"语音记录"、"总结日记"、"日记助手"、"帮我记一下"、"今天发生了"、或希望用碎片时间积累片段并生成结构化日记时，必须触发此技能。支持全天断续输入（语音/文字/图片），说"总结日记"时自动汇总为规范日记格式，并支持按周/月/季复盘。
---

# 语音日记助手 (MyDiary) — 操作指南

MyDiary 是一个运行在本地的日记服务（默认 `http://localhost:3001`）。  
作为 AI agent，你通过 REST API 直接操作数据，无需用户手动打开浏览器。

---

## 第一步：确认服务状态

每次被触发时，先检查服务是否在运行：

```bash
curl -s http://localhost:3001/api/health
```

- 若返回 `{"ok":true,...}`：服务正常，继续操作
- 若连接失败：提示用户先启动服务：
  ```bash
  cd /Users/kayaliu/Documents/Workspace/MyDiary
  npm run dev   # 开发模式
  # 或
  npm run preview   # 生产模式
  ```

---

## 核心操作

### 记录一条碎片

用户说了什么想记下来的内容，调用：

```bash
curl -s -X POST http://localhost:3001/api/data/fragments \
  -H "Content-Type: application/json" \
  -d '{"content": "用户说的内容", "type": "text"}'
```

`type` 可以是 `text`（文字）、`voice`（语音转写）、`image`（图片描述）。

成功后回复用户：**"✓ 已记录"**，简短确认，不展开分析。

---

### 查看今日已记录的碎片

```bash
DATE=$(date +%Y-%m-%d)
curl -s http://localhost:3001/api/data/fragments/$DATE
```

以友好格式展示给用户，例如：
> 今日已记录 3 条：
> 1. [文字] 今天终于把报告改完了
> 2. [文字] 午饭吃了烤鸭
> 3. [文字] 突然想到一个好主意

---

### 生成今日日记（用户说"总结日记"时触发）

```bash
curl -s -X POST http://localhost:3001/api/ai/generate-diary \
  -H "Content-Type: application/json" \
  -d '{"date": "'$(date +%Y-%m-%d)'"}'
```

将生成的日记内容完整展示给用户。

---

### 查看历史日记列表

```bash
curl -s http://localhost:3001/api/data/diaries
```

按日期倒序列出，让用户选择查看某一天。

---

### 查看某天的日记

```bash
curl -s http://localhost:3001/api/data/diaries/2026-04-13
```

---

### 删除一条碎片

```bash
curl -s -X DELETE http://localhost:3001/api/data/fragments/2026-04-13/1744517823000
```

---

### 清空今日碎片

```bash
curl -s -X DELETE http://localhost:3001/api/data/fragments/$(date +%Y-%m-%d)
```

---

### 生成周期复盘

获取所有日记后，根据用户指定的周期（本周/本月/本季度）筛选内容，  
调用 AI 进行复盘分析：

```bash
curl -s http://localhost:3001/api/data/diaries
```

筛选日记后，通过 `/api/ai/chat` 发送复盘 prompt：

```bash
curl -s -X POST http://localhost:3001/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role":"user","content":"请对以下日记生成本周复盘报告：\n\n[日记内容]"}],
    "max_tokens": 2000
  }'
```

---

## 行为准则

| 场景 | 行为 |
|------|------|
| 用户发来一段话/想法 | 静默调用 API 记录，回复"✓ 已记录"，不展开分析 |
| 用户说"总结日记" | 调用生成接口，完整展示日记 |
| 用户说"看看今天记了什么" | 调用 fragments API，列出当日记录 |
| 用户说"查看日记" / "看日记" | 调用 diaries API，列出日记列表 |
| 用户说"做个复盘" | 询问周期（本周/本月/本季度），然后生成复盘 |
| 服务未启动 | 提示启动命令，不尝试其他方案 |

---

## 服务地址配置

默认地址：`http://localhost:3001`

如果用户修改了 `SERVER_PORT`，服务地址相应变化。  
可通过 `.env` 中的 `SERVER_PORT` 确认。

---

## 完整 API 参考

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 服务状态检查 |
| GET | `/api/data/fragments/:date` | 获取某日碎片 |
| POST | `/api/data/fragments` | 添加碎片 `{date?,content,type?,source?}` |
| DELETE | `/api/data/fragments/:date/:id` | 删除单条 |
| DELETE | `/api/data/fragments/:date` | 清空某日 |
| GET | `/api/data/extra/:date` | 健康/运动/投资数据 |
| PUT | `/api/data/extra/:date` | 保存额外数据 |
| GET | `/api/data/diaries` | 所有日记 |
| GET | `/api/data/diaries/:date` | 单篇日记 |
| PUT | `/api/data/diaries/:date` | 保存日记 |
| PATCH | `/api/data/diaries/:date` | 部分更新 |
| POST | `/api/ai/chat` | AI 对话代理 |
| POST | `/api/ai/generate-diary` | 生成今日日记 `{date?}` |
