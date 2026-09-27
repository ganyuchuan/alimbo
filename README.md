# Alimbo

![matrix](./assets/matrix.png)

Alimbo 是一个基于 Node.js 的 AI 中转站：把本地 Copilot、Claude Code 等 Agent 消息转发到移动端（如飞书、Apple Watch），也把移动端指令安全地发回本地 Agent。

## 适合谁

适合想要“随时随地管理本地 Agent”的开发者与团队，尤其是希望在手机或手表上进行审批、下发 prompt、查看执行结果和 Agent 运行状态的场景。

你可以把它理解为：

- 本地网关收口：统一接入 Copilot、Claude Code 等 Agent 消息
- 移动消息桥接：飞书消息与本地 Agent 双向通信
- 可控自动化入口：支持 git、sql、cron、service、skills、mcp 等能力

## 快速开始

### 1) 开始之前

- 本地环境
    - Node.js >= 22
    - npm >= 10
    
- 确保具备 Agent（任选其一，版本建议最新）：
  - [GitHub Copilot CLI 安装和身份验证](https://docs.github.com/zh/copilot/how-tos/set-up/install-copilot-cli)：`copilot --version` 有输出 `GitHub Copilot CLI 1.0.59.`
  - [Claude Code](https://code.claude.com/docs/en/agent-sdk/overview#typescript)：`claude --version` 有输出 `2.1.175 (Claude Code)`

### 2) 安装

#### 场景 A：从源码构建

```bash
npm install
cp .env.example .env
npm run build
```

构建完成后，在需要运行 Agent 的目标项目目录中执行：

```bash
cd /path/to/your/project
node /path/to/alimbo/dist/cli.js claude 1234

# 或启动 GitHub Copilot CLI
node /path/to/alimbo/dist/cli.js copilot 1234
```

也可以在 Alimbo 源码目录执行 `npm link` 注册全局命令，之后直接使用 `alimbo`：

```bash
cd /path/to/alimbo
npm link

cd /path/to/your/project
alimbo claude 1234
```

#### 场景 B：安装 npm 包

```bash
npm install -g alimbo
```

安装后，在需要运行 Agent 的目标项目目录中执行：

```bash
cd /path/to/your/project
alimbo claude 1234

# 或启动 GitHub Copilot CLI
alimbo copilot 1234
```

上述命令会依次完成配对、写入本地配置、安装 hooks、启动网关，并启动对应的 Agent CLI。退出 Agent 后会自动清理 hooks。已经完成配对时，只需记住 Agent 名称：

```bash
alimbo claude
alimbo copilot
```

如果本地尚未配对而直接运行 `alimbo claude` 或 `alimbo copilot`，终端会提示输入 4 位配对码。原有的 `--pairing-code 1234` 写法仍然兼容。

如使用私有云，可在配对时指定服务地址：

```bash
alimbo claude 1234 --base-url https://your-cloud.example.com
```

#### Hermes Agent

安装支持 [Shell hooks](https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks#shell-hooks) 的 Hermes，并先完成它自身的模型配置。在 iOS 配对页选择 **Hermes**，然后在目标项目执行：

```bash
alimbo hermes 1234
# 已配对后
alimbo hermes
```

从源码测试时，将 `alimbo` 替换为 `node /path/to/alimbo/dist/cli.js`。新命令需要包含 Hermes 接入代码的构建或 npm 版本。

| 能力 | 支持情况 |
|------|----------|
| CLI 接入 | 自动配对、启动网关和 Hermes，退出后移除本项目 hooks |
| 工具审批 | `pre_tool_call` 接入现有 iOS / Watch 审批链路，拒绝或通信失败时阻止执行 |
| 执行记录 | 上报工具结果、每轮输入和回答、会话状态；仅成功轮次触发完成标记 |
| 远程 prompt / Token 用量 | 暂不支持 Hermes，不会回退执行 Copilot |

首次启动时，需要在 Hermes 终端确认 Alimbo Shell hooks 的信任提示。安装器不会开启全局自动信任；`HERMES_SAFE_MODE` 或未批准的 hooks 会导致 Hermes 不加载这些 hooks。移动端批准只通过 Alimbo 检查，不绕过 Hermes 自身或其他插件的审批。

配置合并到 `$HERMES_HOME/config.yaml`（默认 `~/.hermes/config.yaml`），保留已有 hooks；脚本放在当前项目的 `.hermes/alimbo/`，只处理此项目及子目录事件。自定义 profile 请先设置 `HERMES_HOME`，安装、运行和卸载时使用同一值。不要同时对嵌套项目安装 hooks，否则同一事件可能匹配多个项目。

默认审批工具为 `terminal,write_file,patch,execute_code,delegate_task`，可用 `HERMES_INTERCEPT_TOOLS` 调整。服务地址和认证优先使用 `HERMES_INTERCEPT_SERVER_URL`、`HERMES_INTERCEPT_AUTH_TOKEN`，留空时回退到对应的 `COPILOT_INTERCEPT_*`。等待时间沿用 `COPILOT_INTERCEPT_MAX_WAIT_MS`，未设置时为 60 秒，最多 240 秒，以留出 Hermes 300 秒 hook 超时的通信余量。

手动安装或异常退出后清理：

```bash
alimbo hook --provider hermes
alimbo unhook --provider hermes
```

单独安装 hooks 不会启动网关；仍需配置当前项目的 `.env` 并运行网关。Hermes Gateway 的 `HOOK.yaml` 事件只在其消息网关触发，本接入使用兼容 CLI 的 Shell hooks。

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

## 创建可登录用户

使用 `create-user.js` 创建用户时，可以通过 `--password` 指定客户端登录密码。密码会以 PBKDF2 哈希形式保存，不会明文写入数据库：

```bash
npm run build
node dist/cloud/create-user.js \
  --username app-user \
  --password 'your-password-at-least-8-chars'
```

创建管理员账户：

```bash
node dist/cloud/create-user.js \
  --admin \
  --username admin \
  --password 'your-admin-password-at-least-8-chars'
```

客户端通过用户名密码登录前，在 cloud-server 使用的 `.env` 中启用密码授权：

```dotenv
CLOUD_AUTH_TOKEN_ALLOW_PASSWORD_GRANT=true
```

然后重启 cloud-server：

```bash
npm run cloud
```

客户端请求 `POST /auth/token`，JSON 请求体如下：

```json
{
  "username": "app-user",
  "password": "your-password-at-least-8-chars"
}
```

服务端会返回该用户已有的 `authToken`，客户端后续使用它访问接口。未指定 `--password` 创建的旧用户仍可使用命令输出的 `authToken`，但不能通过用户名密码登录。创建用户和启动 cloud-server 必须使用同一个 `CLOUD_DB_FILE`。

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
npm run cloud

# 访问内测问卷页面（cloud 服务）
# http://127.0.0.1:18790/survey/watch-alpha

# 通过 PM2 启动网关、飞书桥和云端服务
pm2 start npm --name alimbo-gateway -- run start
pm2 start npm --name alimbo-feishu -- run feishu
pm2 start npm --name alimbo-cloud -- run cloud
```

## APNs 联调（最小 smoke test）

先确保 cloud-server 已启动，并在 `.env` 中配置好 APNs 相关变量（`APNS_ENABLED=true` 等）。

一条命令验证 APNs alert 连通性：

```bash
bash scripts/apns-smoke.sh <ios_device_token>
```

可选参数：

```bash
bash scripts/apns-smoke.sh <ios_device_token> "自定义标题" "自定义正文"
```

## 内测问卷接口（cloud）

- 问卷页面：`GET /survey/watch-alpha`
- 提交接口：`POST /api/surveys/watch-alpha`
- 管理页面（管理员登录态）：`GET /admin/surveys/watch-alpha`
- 管理列表接口（管理员登录态）：`GET /api/admin/surveys/watch-alpha`
- 导出 CSV 接口（管理员登录态）：`GET /api/admin/surveys/watch-alpha.csv`
- 存储位置：`data/cloud.db` 的 `watch_alpha_surveys` 表

问卷页面支持通过 URL Query 预置客户端信息并随提交一并上送：

- `username`
- `email`
- `appVersion`
- `appBuild`
- `appBundleID`
- `iosVersion`
- `device`
- `host`
- `pushNotificationEnabled`
- `tokenPersent`

示例：

```text
http://127.0.0.1:18790/survey/watch-alpha?username=tester&email=a%40b.com&appVersion=1.0.0&appBuild=100
```

最小提交示例：

```bash
curl -X POST http://127.0.0.1:18790/api/surveys/watch-alpha \
  -H "Content-Type: application/json" \
  -d '{
    "terminalUsed": "both",
    "usageFrequency": "daily_once",
    "usageScenarios": ["watch_view_approve_status", "iphone_approve"],
    "nextPriority": "more_agents",
    "username": "tester"
  }'
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

启用远程审批或移动端同步后，Alimbo 会将相关工具参数、执行结果、会话消息和状态发送到配置的云端服务。请只连接可信服务，并避免在 Agent 输入或命令输出中包含敏感信息。飞书桥还会经由飞书服务器转发消息。
