# Alimbo

![fire](./assets/fire.png)

Alimbo 是一个基于 Node.js 的 AI 中转站：把本地 Copilot、Claude Code 等 Agent 消息转发到移动端（如飞书、Apple Watch），也把移动端指令安全地发回本地 Agent。

## 适合谁

适合想要“随时随地管理本地 Agent”的开发者与团队，尤其是希望在手机或手表上进行审批、下发 prompt、查看执行结果和 Agent 运行状态的场景。

你可以把它理解为：

- 本地网关收口：统一接入 Copilot、Claude Code 等 Agent 消息
- 移动消息桥接：飞书消息与本地 Agent 双向通信
- 可控自动化入口：支持 git、sql、cron、service、skills、mcp 等能力

## 如果你正在参与 Alimbo Watch 内测

[点击进入 Alimbo Watch 内测说明与产品场景](docs/watch-alpha-tests.md)

## 快速开始

### 1) 开始之前

- 本地环境
    - Node.js >= 22
    - npm >= 10
    
- 确保具备 Agent（任选其一，版本建议最新）：
  - [GitHub Copilot CLI 安装和身份验证](https://docs.github.com/zh/copilot/how-tos/set-up/install-copilot-cli)：`copilot --version` 有输出 `GitHub Copilot CLI 1.0.59.`
  - [Claude Code](https://code.claude.com/docs/en/agent-sdk/overview#typescript)：`claude --version` 有输出 `2.1.175 (Claude Code)`

### 2) 安装与初始化

```bash
npm install
cp .env.example .env
```

### 3) 最小必填配置

打开 `.env`，至少确认是否使用默认端口号：

```dotenv
PORT=18789
```

### 4) 启动网关

```bash
npm start
```

### 5) 健康检查

```bash
curl http://127.0.0.1:18789/health
```

看到 `{"ok":true}` 或等价健康响应，即表示网关启动成功。

## 使用 WebSocket 网关发消息

用 `wscat` 连接网关并完成一次握手 + 查询。

```bash
npx wscat -c ws://127.0.0.1:18789/ws
```

连接后发送握手帧：

```json
{ "type": "req", "id": "1", "method": "connect", "params": { "auth": { "token": "dev-token" }, "client": { "id": "cli", "version": "0.1.0" } } }
```

再发送一个最小请求（例如列出 cron 任务）：

```json
{ "type": "req", "id": "2", "method": "cron.list", "params": {} }
```

或是给本地 Copilot 打招呼：

```json
{ "type": "req", "id": "3", "method": "copilot", "params": { "messages": [ { "role": "user", "content": [ { "type": "text", "text": "Hello!" } ] } ] } }
```

返回成功响应，说明途径1的链路已打通。

## 使用飞书桥发消息

首先开启飞书桥

```dotenv
FEISHU_ENABLED=true
FEISHU_APP_ID=你的飞书应用 ID
FEISHU_APP_SECRET=你的飞书应用 Secret
```

然后启动飞书桥

```bash
npm run feishu
```

最后打开飞书 App 给你的飞书应用（机器人）发消息

## 常用命令速查

```bash
# 启动网关
npm start

# 启动飞书桥（可选）
npm run feishu

# 启动云端服务（可选）
npm run cloud-server

# 通过 PM2 启动网关、飞书桥和云端服务
pm2 start npm --name alimbo-gateway -- run start
pm2 start npm --name alimbo-feishu -- run feishu
pm2 start npm --name alimbo-cloud -- run cloud
```

## 核心功能一览

| 功能 | 说明 |
|------|------|
| 比龙虾更轻的网关 | 将本地 Agent 会话/事件、各类渠道消息和第三方工具收口到一处管理 |
| 支持多开 | 可以同时打开多个网关，从而实现多 Agent |
| Agent 无缝对接 | 安装便已接入你本地的 Copilot、Claude Code 等智能体，无需额外配置 |
| Apple Watch 远程监控 | 可以通过 Apple Watch 实时监控本地 Agent 的状态和事件，随处审批它的任务 |
| 飞书消息渠道 | 你的消息可以通过飞书 App 触达本地 Agent，实现双向通信 |
| Git 工具 | 允许通过网关或飞书执行 git 命令 |
| SQL 工具 | 支持自然语言转 SQL 管理本地 sqlite 数据库 |
| Cron 定时任务 | 支持自然语言调度 Agent 完成周期性任务 |


## FAQ

### 1) 健康检查通过，但连接报 token 错误

先检查本机是否有旧网关进程占用了同端口（常见于旧 token 残留进程）。

### 2) 只启动了网关，为什么 18790 健康检查失败

`18790` 是 cloud-server 默认端口，未启动 `npm run cloud-server` 时失败是正常现象。

### 3) 飞书不回复

确认这三项：

- 网关已启动且可连通
- `FEISHU_ENABLED=true`
- 飞书应用事件订阅配置正确（含你启用的能力）


## 安全

### 权限

Alimbo 的权限控制是应用层策略（Hook + Intercept），不是操作系统级沙箱。若需要强隔离，请结合独立系统用户、容器或更强的运行时隔离方案。

### 隐私

Alimbo 不会上传任何数据到云端，所有消息仅在本地处理和转发。飞书桥的消息转发也仅限于飞书服务器和本地网关之间。
