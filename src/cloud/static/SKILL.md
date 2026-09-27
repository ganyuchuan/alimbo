---
name: alimbo-pairing
description: '帮助 iOS 用户在 macOS 或 Windows 上安装 Alimbo，将 iPhone/Apple Watch 与桌面 Claude Code、Codex、GitHub Copilot CLI 或 Hermes Agent 配对。用于首次安装、获取配对码、一体化启动、重新配对、hooks 备份及连接排障。'
---

# Alimbo 手机与手表配对

## 目标与边界

指导桌面 AI 助手帮助用户完成：移动端登录并取码、桌面安装、在目标项目配对并启动 Agent、在 iPhone/Apple Watch 验证事件与审批。

- 本 Skill 是操作指南，不是网关或手机 App；安装 Skill 本身不会完成配对。
- 手机与手表通过同一 Alimbo Cloud 账户访问桌面上报的事件，不是与电脑直接蓝牙配对。Windows 电脑不需要安装 Apple 软件；Apple Watch 与 iPhone 的系统配对仍在手机上完成。
- 首选一体化命令，不要求用户先单独启动网关、部署服务器或配置飞书。
- 默认云端：`https://limbo.ganyuchuan.cn`。私有云必须与 App 设置中的服务地址一致。
- 本文按 2026-09-27 的 Alimbo / AgentCompanion 实现核对。npm 已发布版本可能落后于源码；以本机 `alimbo --help` 和实际功能为准，不假定旧版本支持新 Agent。
- 不承诺所有 Agent 都支持远程 prompt。Hermes 支持 CLI hooks、工具审批、事件和 Token Usage，但不支持远程 prompt。

## 安装本 Skill

公开下载地址：`https://limbo.ganyuchuan.cn/SKILL.md`。私有部署使用该服务器的 `/SKILL.md`，内容以其已部署版本为准。

将此文件放到执行引导的桌面 AI 客户端支持的 Skill 目录，目录名为 `alimbo-pairing`，文件名必须是 `SKILL.md`：

| 执行引导的客户端 | 用户级安装位置 |
|---|---|
| GitHub Copilot CLI | `~/.copilot/skills/alimbo-pairing/SKILL.md` |
| Claude Code | `~/.claude/skills/alimbo-pairing/SKILL.md` |
| Codex | `~/.agents/skills/alimbo-pairing/SKILL.md` |

Windows 将 `~` 理解为 `$HOME` / 当前用户目录。其他客户端使用其官方 Skill 导入方式；不要把不同客户端的目录当作通用约定。已有同名 Skill 时先备份再替换。

重新打开客户端或刷新其 Skill 列表后，告诉它：“使用 alimbo-pairing，帮我把 iPhone/Apple Watch 与当前项目的 Agent 配对。”支持斜杠调用的客户端也可选择 `/alimbo-pairing`。若未识别，检查安装目录、文件名和 YAML 元数据，不要声称已加载。

执行引导的 AI 与被接入的 Agent 可以不同。安装 Skill 不会安装 Claude/Codex/Copilot/Hermes 本身。

## AI 执行规则

1. 先确认系统与终端（macOS、Windows PowerShell/CMD 或 WSL）、目标项目绝对路径、目标 Agent，以及移动端是否已登录、使用哪个 Cloud 地址。
2. 只询问缺失信息；先完成环境检查和文件备份，再让用户刷新配对码，避免码过期。
3. 只检查用户选择的 CLI，不批量安装其他 Agent。缺失时参考其官方安装文档；登录和模型 API 凭据让用户在本机终端完成。
4. 执行安装、配对前，说明会下载 npm 包、写入项目 `.env`、调整 hooks、启动 PM2 网关，并把事件/用量上传到所选 Cloud，取得确认。
5. 不在同一个正运行的 Agent 会话里强行覆盖自身 hooks；建议用户在目标项目的新终端运行一体化命令。Agent 是交互式长驻进程，启动后交还用户，不等待它退出才报告配对结果。
6. 不索取密码、auth token、API key 或 App Secret。配对码也能换取账户凭据，优先让用户直接粘贴到本机终端，不记录到日志、提交或公开截图。
7. 不自动开启全局信任、跳过审批、放宽防火墙、开放公网端口或修改系统执行策略。不要执行 `pm2 delete all` 等影响其他应用的命令。

## 1. 前置检查

在桌面终端运行：

```text
node --version
npm --version
```

要求 Node.js >=22，npm >=10；优先使用当前受支持的 Node.js LTS。Node >=22.5 可使用内置 SQLite 采集 Hermes 用量，旧的 Node 22 小版本需额外的 sqlite3 或升级。

| 目标 Agent | 版本检查 | 一体化子命令 |
|---|---|---|
| Claude Code | `claude --version` | `claude` |
| OpenAI Codex CLI | `codex --version` | `codex` |
| GitHub Copilot CLI | `copilot --version` | `copilot` |
| Hermes Agent | `hermes --version` | `hermes` |

CLI 必须已安装、已完成自身认证/模型配置，并能在同一终端独立启动。Hermes 需要支持 Shell hooks 的版本。

macOS 用 `command -v node`、`command -v <CLI>` 检查路径；PowerShell 用 `Get-Command node,npm`、`Get-Command <CLI>`。选择用户实际运行 Agent 的环境，不混用 Windows Node、WSL Node 和不同环境的项目目录。

### Windows 兼容性提示

可以使用下面的 PowerShell 安装与配对步骤，但当前源码没有经过本 Skill 的原生 Windows 端到端验证。Alimbo 直接通过 `spawn` 启动 Agent；只有 `.cmd` shim 的 CLI 可能无法被拉起，部分 hooks 还依赖 shell 环境。

- PowerShell 拦截 `npm.ps1` / `npx.ps1` 时，可使用对应的 `npm.cmd` / `npx.cmd`，不要修改系统执行策略。
- 这只解决入口命令问题，不能保证 Alimbo 内部能启动 `.cmd` Agent。
- 若用户已在 WSL 中正常使用 Agent，可在同一 WSL 环境检查 Node、安装 Alimbo 并尝试配对；WSL 路径按 Linux 处理，不把它描述为已验证的保证方案。
- 原生启动失败时按末尾排障流程处理，不把“能获取配对码”误报为完整 hooks 接入成功。

## 2. 备份目标项目配置

一体化启动会自动执行 `hook --force`，不是只读操作。先在目标项目保存以下已有文件/目录的带时间戳副本，备份到 hooks 目录之外；保留权限并避免覆盖旧备份：

- `.env`、`.claude/`、`.github/hooks/`、`.codex/`、`.kimi-code/`。
- Hermes 还需备份 `$HERMES_HOME/config.yaml`（默认 `~/.hermes/config.yaml`）和项目 `.hermes/alimbo/`。

告知用户备份位置，不显示其中的凭据。没有的文件无需创建。已有 Agent 会话使用这些配置时先协商停止，不自动中断。

普通 provider 的 hook 安装会写入多个 Agent 的配置；内置 `.alimbo.backup` 只保留首次备份，不能替代本次完整备份。退出时 `unhook` 会恢复配置并清理脚本目录，用户放在这些目录中的自定义文件也可能受影响。Hermes 合并用户级 YAML 并在退出时移除本项目项，但仍需备份。

## 3. 安装 Alimbo

默认使用 npm 全局安装：

```text
npm install -g alimbo@latest
alimbo --version
alimbo --help
```

不自动使用管理员权限或 `sudo`。权限不足时使用用户自己的 Node 版本管理环境，或在用户同意后采用 `npx alimbo@latest`。

iPhone 配对页复制的命令形如 `npx alimbo claude 1234`。可直接使用；如果为了获得新 Agent 支持要避免旧缓存，使用 `npx alimbo@latest claude 1234`。不要同时运行全局命令和 npx 启动两个会话。

若最新 npm 包仍不认识目标子命令，报告已安装版本，等待支持该 Agent 的发布；仅在用户同意后采用源码构建，不把源码安装作为首次默认流程。

## 4. 在 iPhone / Apple Watch 获取配对码

### 推荐：从 iPhone 开始

1. 打开 Alimbo iOS App，完成首次引导和登录。支持 Sign in with Apple 或 Alimbo 用户名/密码；登录 Agent CLI 不能替代 App 登录。
2. 从 Dashboard 或 Settings 顶部的配对入口进入配对页，选择 Claude Code、Codex、GitHub Copilot 或 Hermes。
3. 页面生成 4 位配对码及桌面命令；若为空或已过期，点击刷新。复制命令，并保持 App 前台以便验收。
4. 如使用私有云，记录 App 当前服务地址；复制的命令不一定包含该地址，桌面配对时需补 `--base-url`。

不要让用户按旧流程“只输入用户名即可配对”。用户名密码登录依赖云端允许密码授权且账户已设密码；不具备时使用 App 可用的登录方式或联系管理员，不要求普通用户部署 cloud-server。

### 同时使用 Apple Watch

- 先通过 iPhone 的 Watch App 完成系统配对并安装 Alimbo Watch App。
- iPhone 登录后会通过 WatchConnectivity 同步 Cloud 地址、auth token 和账户资料。需要 WatchConnectivity 可用、会话激活、Watch 已配对且安装 App；条件不满足时同步可能延迟。
- 打开手表 App 确认登录/配置已同步，必要时保持两端 App 活跃。不要要求用户从手机复制原始 token。
- Watch 也有独立引导：输入 Alimbo 用户名与密码，认证成功后显示 4 位配对码。可用该码执行桌面命令；手机与手表要看到同一账户数据，必须使用一致的 Cloud 与账户。
- 只需要 iPhone 的用户不必安装手表 App；只在 iPhone 验证成功，不代表手表通知或审批已验证。

## 5. 在目标项目配对并启动

先进入真实项目目录，不要在下载目录、系统目录或 Alimbo 安装目录中启动。

macOS：

```bash
cd "/path/to/your/project"
alimbo claude 1234
```

Windows PowerShell：

```powershell
Set-Location "C:\path\to\your\project"
alimbo claude 1234
```

`1234` 是示例，执行时替换为 App 当前显示的码，保留前导零。按用户选择只执行下面一条：

```text
alimbo claude 1234
alimbo codex 1234
alimbo copilot 1234
alimbo hermes 1234
```

私有云示例：

```text
alimbo codex 1234 --base-url https://your-cloud.example.com
```

这些命令依次换取账户凭据、写入当前项目 `.env`、执行配对连通性检查、安装 hooks、启动 PM2 网关，再启动所选 CLI。若 App 出现配对验证审批，用户应核对项目和 Agent 后批准；CLI 当前最多等待约 60 秒。

已有本项目配对配置时，可直接 `alimbo claude`、`alimbo codex`、`alimbo copilot` 或 `alimbo hermes`。本地未配对时交互终端会提示输入码，非交互环境必须显式提供码。`--base-url` 只在配对时接受；换账户或云端时取新码重新配对。

PM2 网关使用固定进程名，多个项目同时启动可能互相影响。先检查现有网关归属，避免为新项目覆盖正在工作的会话。

### Hermes 补充

- 自定义 profile 必须在安装 hooks、运行和清理时使用同一 `HERMES_HOME`。macOS 设置 `export HERMES_HOME="/path/to/profile"`，PowerShell 设置 `$env:HERMES_HOME = "C:\path\to\profile"`。
- 首次启动需由用户在 Hermes 终端批准 Shell hooks 的信任提示。不要开启全局自动信任；`HERMES_SAFE_MODE` 或未批准 hooks 会阻止加载。
- 使用 CLI Shell hooks，而不是 Hermes Gateway 的 `HOOK.yaml`。项目脚本位于 `.hermes/alimbo/`，只处理该项目及子目录；避免同时接入嵌套项目。
- 移动审批不会绕过 Hermes 自身或其他插件的安全检查。通信失败时工具可能被阻止执行，不应建议自动放行。

### 其他 Agent

只对已实现的 provider 给出命令。当前 iPhone 选择器包含上述四种；Kimi 是进阶路径，可先 `alimbo pair 1234 --provider kimi` 再 `alimbo kimi`，不能使用 `alimbo kimi 1234`。不要声称所有第三方 Agent 都已兼容。

## 6. 分层验收

| 层级 | 成功判据 |
|---|---|
| 配对 API 与本地网关 | 终端出现 `[alimbo-pair] Success`，并显示网关已启动 |
| 手机事件链路 | App 配对页转为已配对，或出现 `pairing succeeded, welcome to alimbo` 配对事件 |
| 真实 Agent hooks | 用户在 CLI 请求一次只读操作，例如查看当前目录，手机收到对应 Agent/项目的工具事件；若出现审批则由用户确认 |
| Apple Watch（如需要） | 手表也能看到对应事件，并对一个实际待审批项完成操作 |

配对事件不是真实 hook。App 的“已配对”可由新事件触发，因此不能仅凭该状态宣称工具审批已打通。若只读命令不在审批范围或被本地缓存执行，不能强求弹出审批，也不要扩大权限制造测试。

不要再以 `[alimbo-watch] Success`、`[alimbo-setup] Success` 或 `Setup intercept decision connectivity check` 作为当前成功标志。

配对会启用 Usage 同步：从本地 Agent 数据采集 Token 用量上报所选 Cloud。Hermes 读取默认及 named profile 的 `state.db`，按 session 开始时间归入 bucket；缓存读取独立统计，reasoning 不重复计入输出。它不是每条消息的精确实时日统计。已有 `USAGE_SYNC_SOURCES` 白名单时需显式加入 `hermes` 才会采集；没有真实用量时不承诺立即出现数字。用户不希望上传用量时，在其确认后将 `USAGE_SYNC_ENABLED=false` 并重启本项目网关。

## 7. 退出、重新配对与排障

- 正常退出 Agent 后会自动 `unhook`，但不会删除 `.env` 中的配对凭据。默认配置允许 session-end 停网关；Hermes 的退出流程另有网关清理。用进程状态确认，不保证所有异常退出都自动停止。
- 强制退出后先核对备份与当前配置，再按 provider 清理：Hermes 用 `alimbo unhook --provider hermes`，其他用 `alimbo unhook`。不要在其他 Agent 仍使用 hooks 时执行。
- 重新连接时在同一项目重跑一体化命令；换目录、账户或云端时使用新码。`alimbo setup` 已废弃。

先获取不含秘密的诊断：

```text
alimbo --version
alimbo logs gateway --lines 200
```

macOS 本地健康检查：`curl http://127.0.0.1:18789/health`；PowerShell：`Invoke-RestMethod http://127.0.0.1:18789/health`。如果项目自定义 `PORT`，使用实际端口。health 成功仅代表网关存活。

| 现象 | 优先检查 |
|---|---|
| 配对码无效/过期 | App 刷新新码；Cloud 地址一致；确认完整 4 位及前导零 |
| `pairing was not approved` | 查看手机/手表配对审批是否拒绝或超时，确认后用新码重试 |
| health 成功但 token 错误 | 排查旧 PM2 网关使用旧 token 或其他项目目录；只重启归属确认的 Alimbo 进程 |
| unknown provider/子命令 | 检查 npm 版本和 `--help`，发布包可能不含新代码 |
| `failed to launch` / `ENOENT` | CLI 是否在同一终端 PATH；Windows 是否只有 `.cmd` shim |
| Windows 已配对但 CLI 起不来 | 保留 `[alimbo-pair] Success` 的局部结果，报告启动不兼容；不要把重配对当作修复，也不自动改源码或 shell 安全设置 |
| 只有配对事件，没有工具事件 | 必须从 `alimbo <agent>` 启动新会话；检查 hooks 是否加载、工作目录、网关与云端连通性；Hermes 检查信任与 safe mode |
| iPhone 正常、Watch 无事件 | 检查 Watch 安装、系统配对、账户/服务地址同步以及网络；通知权限与 App 内事件读取分开验证 |

需要管理 PM2 时，先确认命令可用并运行 `pm2 list`；只对已核实的 Alimbo 网关执行 `pm2 stop <name-or-id>` / `pm2 delete <name-or-id>`。卸载 CLI 使用 `npm uninstall -g alimbo`；卸载不会自动撤销云端 token 或删除项目配置。

日志、`.env`、hooks 配置和备份可能含凭据或项目内容。分享诊断前脱敏，只提供失败阶段、版本、平台和必要错误行。若泄露凭据，提示撤销/轮换，不重复展示原值。

飞书、自建云、管理员建号均不是手机/手表配对前提；仅在用户另外提出时处理。

## 完成时的回复

用简短中文给出：目标项目、Agent、Cloud 地址、已验证的设备与层级、下次启动命令、备份位置。若 Windows CLI 启动或 Watch 验收尚未完成，明确写出阻断点，不把部分成功报告成全部完成。
