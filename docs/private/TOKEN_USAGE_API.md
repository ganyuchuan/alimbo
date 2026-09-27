# Token Usage API

本文档描述 Alimbo Usage Dashboard 和客户端采集器使用的 Token Usage HTTP API。

## 1. 基础约定

### Base URL

本地开发示例：

```bash
export ALIMBO_CLOUD_URL="http://127.0.0.1:18790"
```

部署后将其替换为实际 Cloud 服务地址：

```bash
export ALIMBO_CLOUD_URL="https://<cloud-origin>"
```

### 用户 Token

所有 Usage API 都要求有效的用户 Bearer Token：

```bash
export ALIMBO_USER_TOKEN="<有效用户 Token>"
```

请求头：

```text
Authorization: Bearer <有效用户 Token>
Accept: application/json
```

Token 决定数据所属用户。服务端不会接受 URL 查询参数中的 Token。

### 支持的 Agent source

| source | Agent |
|---|---|
| `copilot-cli` | GitHub Copilot CLI |
| `claude-code` | Claude Code |
| `codex` | OpenAI Codex CLI |
| `hermes` | Hermes Agent |
| `kimi-code` | Kimi Code CLI |

### Token 统计口径

```text
totalTokens / modelTokens = inputTokens + outputTokens + reasoningOutputTokens
contextTokens = modelTokens + cachedInputTokens
```

`cachedInputTokens` 单独统计，不包含在 `totalTokens` 中。

---

## 2. 健康检查

### `GET /health`

无需鉴权。

```bash
curl --fail --silent --show-error \
  "$ALIMBO_CLOUD_URL/health"
```

响应：

```json
{
  "ok": true
}
```

---

## 3. 查询汇总

### `GET /api/copilot/usage/summary`

Usage Dashboard 使用此接口展示总量、Agent 分布、模型排行和每日趋势。

### 最小请求

```bash
curl --fail --silent --show-error \
  -H "Authorization: Bearer $ALIMBO_USER_TOKEN" \
  -H "Accept: application/json" \
  "$ALIMBO_CLOUD_URL/api/copilot/usage/summary"
```

### 查询参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `from` | ISO 8601 | 否 | 起始时间，包含该时间：`bucketStart >= from` |
| `to` | ISO 8601 | 否 | 结束时间，不包含该时间：`bucketStart < to` |
| `source` | string | 否 | Agent source，只允许四种已支持值 |
| `model` | string | 否 | 精确匹配模型名 |
| `hostname` | string | 否 | 精确匹配采集设备名 |

### 完整筛选示例

```bash
curl --fail --silent --show-error --get \
  -H "Authorization: Bearer $ALIMBO_USER_TOKEN" \
  -H "Accept: application/json" \
  --data-urlencode "from=2026-08-01T00:00:00.000Z" \
  --data-urlencode "to=2026-09-01T00:00:00.000Z" \
  --data-urlencode "source=codex" \
  --data-urlencode "model=gpt-5" \
  --data-urlencode "hostname=MacBook-Pro" \
  "$ALIMBO_CLOUD_URL/api/copilot/usage/summary"
```

### 响应示例

```json
{
  "ok": true,
  "totals": {
    "inputTokens": 100,
    "outputTokens": 20,
    "cachedInputTokens": 300,
    "reasoningOutputTokens": 5,
    "modelTokens": 125,
    "contextTokens": 425
  },
  "bySource": [
    {
      "source": "codex",
      "inputTokens": 100,
      "outputTokens": 20,
      "cachedInputTokens": 300,
      "reasoningOutputTokens": 5,
      "modelTokens": 125,
      "contextTokens": 425
    }
  ],
  "byModel": [
    {
      "model": "gpt-5",
      "inputTokens": 100,
      "outputTokens": 20,
      "cachedInputTokens": 300,
      "reasoningOutputTokens": 5,
      "modelTokens": 125,
      "contextTokens": 425
    }
  ],
  "byDay": [
    {
      "day": "2026-08-25",
      "inputTokens": 100,
      "outputTokens": 20,
      "cachedInputTokens": 300,
      "reasoningOutputTokens": 5,
      "modelTokens": 125,
      "contextTokens": 425
    }
  ],
  "filters": {
    "from": "",
    "to": "",
    "source": "",
    "model": "",
    "hostname": ""
  }
}
```

没有数据时，`totals` 各字段为 `0`，三个分组数组为空。

---

## 4. 查询 Bucket 明细

### `GET /api/copilot/usage/buckets`

Usage Dashboard 使用此接口展示最近的 30 分钟 bucket 明细。

### 最小请求

```bash
curl --fail --silent --show-error \
  -H "Authorization: Bearer $ALIMBO_USER_TOKEN" \
  -H "Accept: application/json" \
  "$ALIMBO_CLOUD_URL/api/copilot/usage/buckets"
```

### 查询参数

除汇总接口的 `from`、`to`、`source`、`model`、`hostname` 外，还支持：

| 参数 | 类型 | 默认值 | 范围 | 说明 |
|---|---|---:|---:|---|
| `limit` | integer | `200` | `1..1000` | 最大返回条数 |

结果按 `bucketStart` 降序排列。

### Dashboard 等价请求

```bash
curl --fail --silent --show-error --get \
  -H "Authorization: Bearer $ALIMBO_USER_TOKEN" \
  -H "Accept: application/json" \
  --data-urlencode "limit=100" \
  "$ALIMBO_CLOUD_URL/api/copilot/usage/buckets"
```

### 指定 Agent 与日期范围

```bash
curl --fail --silent --show-error --get \
  -H "Authorization: Bearer $ALIMBO_USER_TOKEN" \
  -H "Accept: application/json" \
  --data-urlencode "from=2026-08-25T00:00:00.000Z" \
  --data-urlencode "to=2026-08-26T00:00:00.000Z" \
  --data-urlencode "source=kimi-code" \
  --data-urlencode "limit=100" \
  "$ALIMBO_CLOUD_URL/api/copilot/usage/buckets"
```

### 响应示例

```json
{
  "ok": true,
  "items": [
    {
      "hostname": "MacBook-Pro",
      "source": "codex",
      "model": "gpt-5",
      "project": "unknown",
      "bucketStart": "2026-08-25T10:30:00.000Z",
      "inputTokens": 100,
      "outputTokens": 20,
      "cachedInputTokens": 300,
      "reasoningOutputTokens": 5,
      "totalTokens": 125,
      "updatedAtMs": 1787630000000
    }
  ],
  "limit": 100,
  "filters": {
    "from": "",
    "to": "",
    "source": "",
    "model": "",
    "hostname": ""
  }
}
```

---

## 5. 上传 Usage

### `POST /api/copilot/usage/ingest`

供客户端采集器上传 30 分钟 bucket，以及可选的 session 聚合数据。

### 只上传 Bucket

```bash
curl --fail --silent --show-error \
  -X POST \
  -H "Authorization: Bearer $ALIMBO_USER_TOKEN" \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  "$ALIMBO_CLOUD_URL/api/copilot/usage/ingest" \
  --data-binary @- <<'JSON'
{
  "schemaVersion": 1,
  "hostname": "MacBook-Pro",
  "syncId": "client-sync-20260825-001",
  "buckets": [
    {
      "source": "codex",
      "model": "gpt-5",
      "project": "unknown",
      "bucketStart": "2026-08-25T10:30:00.000Z",
      "inputTokens": 100,
      "outputTokens": 20,
      "cachedInputTokens": 300,
      "reasoningOutputTokens": 5,
      "totalTokens": 125
    }
  ],
  "sessions": []
}
JSON
```

### 同时上传 Session

```bash
curl --fail --silent --show-error \
  -X POST \
  -H "Authorization: Bearer $ALIMBO_USER_TOKEN" \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  "$ALIMBO_CLOUD_URL/api/copilot/usage/ingest" \
  --data-binary @- <<'JSON'
{
  "schemaVersion": 1,
  "hostname": "MacBook-Pro",
  "syncId": "client-sync-20260825-002",
  "buckets": [],
  "sessions": [
    {
      "source": "codex",
      "project": "unknown",
      "sessionHash": "0123456789abcdef",
      "firstMessageAt": "2026-08-25T10:31:00.000Z",
      "lastMessageAt": "2026-08-25T10:36:00.000Z",
      "durationSeconds": 300,
      "activeSeconds": 180,
      "messageCount": 8,
      "userMessageCount": 3,
      "userPromptHours": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    }
  ]
}
JSON
```

### 顶层字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `schemaVersion` | integer | 是 | 当前必须为 `1` |
| `hostname` | string | 是 | 默认设备名，最大 200 字符 |
| `syncId` | string | 建议 | 仅用于日志追踪，最大 100 字符，不参与去重 |
| `buckets` | array | 否 | 默认空数组；每批最多 100 条 |
| `sessions` | array | 否 | 默认空数组；每批最多 500 条 |

### Bucket 字段

| 字段 | 类型 | 规则 |
|---|---|---|
| `source` | string | 必须是已支持 source |
| `model` | string | 最大 100 字符 |
| `project` | string | 最大 200 字符；隐私模式建议传 `unknown` |
| `hostname` | string | 可选；未提供时使用顶层 hostname |
| `bucketStart` | ISO 8601 | 30 分钟 bucket 起点；不可晚于服务器当前时间 24 小时以上 |
| `inputTokens` | integer | 非负安全整数 |
| `outputTokens` | integer | 非负安全整数 |
| `cachedInputTokens` | integer | 非负安全整数 |
| `reasoningOutputTokens` | integer | 非负安全整数 |
| `totalTokens` | integer | 必须等于 input + output + reasoning |

### 幂等与更新语义

Bucket 唯一键：

```text
userId + hostname + source + model + project + bucketStart
```

服务端采用绝对值 upsert：

- 同一 bucket 重复上传相同数值，不会重复累计。
- 同一 bucket 后续上传更完整数值，会覆盖旧数值。
- 客户端必须上传该 bucket 的当前完整快照，不能只上传增量。
- `syncId` 不参与唯一键，也不用于 token 去重。

Session 唯一键：

```text
userId + hostname + source + sessionHash
```

`sessionHash` 应由客户端对原始 session ID 做不可逆哈希，不应上传原始 session ID。

### 响应示例

```json
{
  "ok": true,
  "accepted": 1,
  "sessions": 0,
  "dropped": 0
}
```

当前 `accepted` 表示成功 upsert 的 bucket 数量，不区分新增与覆盖。

---

## 6. 最小客户端读取流程

```bash
# 1. 验证服务可用
curl --fail --silent --show-error "$ALIMBO_CLOUD_URL/health"

# 2. 读取总量和分组统计
curl --fail --silent --show-error \
  -H "Authorization: Bearer $ALIMBO_USER_TOKEN" \
  "$ALIMBO_CLOUD_URL/api/copilot/usage/summary"

# 3. 读取最近 100 个 bucket
curl --fail --silent --show-error --get \
  -H "Authorization: Bearer $ALIMBO_USER_TOKEN" \
  --data-urlencode "limit=100" \
  "$ALIMBO_CLOUD_URL/api/copilot/usage/buckets"
```

若客户端只做展示，不需要调用 ingest 接口。

---

## 7. 错误响应

### Token 缺失或无效

HTTP `401`：

```json
{
  "error": "unauthorized"
}
```

### source 非法

HTTP `400`：

```json
{
  "error": "invalid source"
}
```

### schemaVersion 不支持

HTTP `400`：

```json
{
  "error": "unsupported schemaVersion"
}
```

### Bucket 或 Session 字段非法

HTTP `400`：

```json
{
  "error": "invalid usage payload"
}
```

### 批次过大

HTTP `413`：

```json
{
  "error": "usage batch too large"
}
```

---

## 8. Dashboard 对应关系

| 页面区域 | API / 字段 |
|---|---|
| 顶部指标卡 | `summary.totals` |
| Agent 分布 | `summary.bySource`；页面会为缺失 Agent 补零 |
| 每日趋势 | `summary.byDay` |
| 模型排行 | `summary.byModel` |
| 最近 Usage Buckets | `buckets.items` |
| 开始/结束日期 | `from` / `to` |
| Agent 下拉筛选 | `source` |

Dashboard 会并发调用：

```bash
curl -H "Authorization: Bearer $ALIMBO_USER_TOKEN" \
  "$ALIMBO_CLOUD_URL/api/copilot/usage/summary"

curl -H "Authorization: Bearer $ALIMBO_USER_TOKEN" \
  "$ALIMBO_CLOUD_URL/api/copilot/usage/buckets?limit=100"
```
