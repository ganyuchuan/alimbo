# Alimbo Desktop Onboarding Skill (AI-Optimized)

## 目标

本 Skill 用于指导 AI 助手完成 Alimbo 桌面端首次引导，覆盖：
- 安装 Alimbo CLI
- 启动本地网关
- 与 Apple Watch 配对
- 在用户项目初始化 hooks
- 按需启用飞书桥接
- 提供关闭、卸载与排障流程

适用于 GitHub Copilot 与 Claude Code。

## 信息来源与优先级

- 本 Skill 以 README 中的用户流程为唯一主流程。
- 若与旧文档冲突，以 README 为准。

## 版本与兼容性约束（先确认）

- Alimbo Desktop: 0.2.9（release tag: v0.2.9）
- Alimbo Watch: 1.0 Build 4
- 桌面系统: macOS 或 Windows
- Node.js: 要求 >=22
- npm: 可用
- PM2: 可选（推荐）
- 设备系统: watchOS 26.0+，iOS 26.0+

## 前置检查命令

按用户实际使用的 AI CLI 检查：

```bash
copilot --version
```

或

```bash
claude --version
```

建议同时检查：

```bash
node -v
npm -v
```

## 标准引导流程（默认执行）

1. 安装 CLI

```bash
npm install -g alimbo
alimbo --version
```

2. 启动本地网关

```bash
alimbo
```

如需自定义端口：

```bash
alimbo --port 18789
```

3. Apple Watch 配对

```bash
alimbo watch --pairing-code 1234
```

说明：
- 4 位配对码来自 Alimbo Watch 首次输入用户名后的界面。
- 非首次可在手表设置点击 new pairing code 获取新码。
- 默认云端地址是 `https://go.aigc4me.cloud`，如需私有云可加 `--cloud-url`。

示例：

```bash
alimbo watch --pairing-code 1234 --cloud-url https://your-cloud.example.com
```

4. 在目标项目初始化 hooks

```bash
cd /path/to/your/project
alimbo hook
```

如需覆盖已有 hooks：

```bash
alimbo hook --force
```

5. 按需启用飞书桥接（可选）

```bash
alimbo feishu --app-id YOUR_FEISHU_APP_ID --app-secret YOUR_FEISHU_APP_SECRET
```

6. 一体化 Agent 启动（推荐）

当用户希望在当前项目直接进入 Claude/Copilot 并自动接管 hooks + gateway 生命周期时，优先使用：

```bash
alimbo claude
```

或

```bash
alimbo copilot
```

说明：
- 命令会自动写入必要 env 覆盖、执行 `alimbo hook --force`、启动网关并拉起对应 CLI。
- 退出 Claude/Copilot 后会自动执行 `alimbo unhook` 清理。
- 默认会设置 `ALIMBO_AUTO_STOP_GATEWAY_ON_SESSION_END=true`，会话结束后可自动停网关。

## 成功判据（必须明确告知用户）

- Apple Watch 收到消息: Setup intercept decision connectivity check
- 终端出现: [alimbo-watch] Success

## 命令变更提醒（避免走旧流程）

- `alimbo setup` 已废弃，不再作为引导入口。
- 应使用：
	- `alimbo watch --pairing-code <XXXX>` 完成配对与 token 下发
	- `alimbo feishu --app-id ... --app-secret ...` 按需启用飞书桥
	- `alimbo claude` / `alimbo copilot` 一体化启动（推荐）
	- `alimbo hook` / `alimbo hook --force` 手动初始化 hooks（按需）

## 管理员附加能力（cloud）

当需要为指定用户名创建 users 表记录并发放高熵 token 时，可执行：

```bash
npm run cloud:create-user -- --username <name>
```

输出包含：`userId`、`username`、`authToken`、`dbFile`。

## 交互式提问规范（给 AI）

AI 应按以下顺序提问，减少往返：

1. 是否已安装并登录 Copilot/Claude CLI
2. 是否已拿到 Apple Watch 的 4 位 pairing code
3. 是否希望直接使用 `alimbo claude` / `alimbo copilot` 一体化模式
4. 是否需要飞书审批链路

当问到飞书时，先解释影响再给默认建议：
- 需要远程审批 Agent 指令: 建议开启
- 仅本地使用: 建议暂不启用

## 安全与敏感信息处理

- 不要求用户在聊天中粘贴 App Secret 或其他敏感值。
- 凭据只在本机终端输入。
- 若用户贴出敏感值，提醒其立即轮换。

## 关闭与卸载

关闭服务：

```bash
pm2 list
pm2 stop <gateway_process_name_or_id>
pm2 stop <feishu_process_name_or_id>
```

卸载 CLI：

```bash
npm uninstall -g alimbo
```

可选清理：

```bash
pm2 delete <gateway_process_name_or_id>
pm2 delete <feishu_process_name_or_id>
```

## 故障排查 SOP

1. 先收集日志

```bash
alimbo logs gateway --lines 200
alimbo logs feishu --lines 200
```

2. 向开发者反馈时至少包含
- 失败步骤
- 终端报错原文或截图
- 上述日志

3. 常见优先排查项
- watch 在 health 成功后仍 token 异常: 先检查旧网关进程残留与当前配置一致性
- 进程混淆: 使用 pm2 list，仅操作 alimbo 相关进程
- 误用废弃命令: 若执行了 `alimbo setup`，改用 `alimbo watch --pairing-code <XXXX>`

## AI 输出风格约束

- 优先给可直接复制的最短命令。
- 每一步只给当前必要信息，避免长篇解释。
- 先给默认路径，再给可选分支命令。
- 用户未明确要求时，不展开源码安装流程。

## 可复用回复模板（给 AI）

### 模板 A：首次安装最短路径

```text
先执行下面 3 步：
1) npm install -g alimbo && alimbo --version
2) alimbo
3) alimbo watch --pairing-code 你的4位配对码

成功标志：手表收到“Setup intercept decision connectivity check”，终端出现“[alimbo-watch] Success”。
```

### 模板 B：需要飞书审批

```text
如果你要在飞书里审批 Agent 指令，再执行：
alimbo feishu --app-id YOUR_FEISHU_APP_ID --app-secret YOUR_FEISHU_APP_SECRET

注意：App Secret 只在本机终端输入，不要发到聊天窗口。
```

### 模板 D：一体化 Agent 模式（推荐）

```text
如果你准备在当前项目直接使用 Agent，建议执行：
alimbo claude

或：
alimbo copilot

这两个命令会自动初始化 hooks、启动网关，并在会话结束后自动清理 hooks。
```

### 模板 C：排障采集

```text
请先执行：
alimbo logs gateway --lines 200
alimbo logs feishu --lines 200

把失败步骤、报错原文和日志一起发给我，我按步骤帮你定位。
```
