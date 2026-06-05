# Alimbo Desktop Onboarding Skill

## 目标

用于指导 Agent 帮助用户在桌面端完成 Alimbo 的首次安装与配置，包括：
- 安装并构建 Alimbo
- 运行 setup 向导
- 与 Apple Watch 上的 Alimbo Buddy 配对
- 按需连接飞书机器人

本 Skill 同时适用于 GitHub Copilot 与 Claude Code。

## 适用场景

- 用户首次在桌面端安装 Alimbo
- 用户需要从 Release 源码包完成安装
- 用户要完成 Apple Watch 配对与可选飞书接入
- 用户需要关闭、卸载或排查 Alimbo

## 前提检查

执行流程前，先确认：
- Node.js 已安装（建议 20+）
- npm 可用
- PM2 可用（可选，但建议）

如果用户使用 Copilot：

```bash
copilot --version
```

如果用户使用 Claude Code：

```bash
claude --version
```

## 推荐流程（从 Release 包安装）

1. 从 [Release](https://github.com/ganyuchuan/alimbo/releases) 页面下载源码包，例如：
- [alimbo-v0.2.2-source.tar.gz](https://github.com/ganyuchuan/alimbo/releases/download/v0.2.2/alimbo-v0.2.2-source.tar.gz)
- [alimbo-v0.2.2-source.zip](https://github.com/ganyuchuan/alimbo/releases/download/v0.2.2/alimbo-v0.2.2-source.zip)
2. 解压并进入目录。
3. 安装依赖并构建。
4. 运行 setup。

```bash
tar -xzf alimbo-v0.2.2-source.tar.gz
cd alimbo-v0.2.2-source
npm install
npm run build
node dist/cli.js setup
```

如果是 zip：

```bash
unzip alimbo-v0.2.2-source.zip
cd alimbo-v0.2.2-source
npm install
npm run build
node dist/cli.js setup
```

## setup 交互指导（用户可理解版本）

Agent 在交互时应按以下顺序引导用户：

1. Cloud URL
- 用户可直接回车使用默认值。

2. Pairing code（4 位）
- 来自 Apple Watch 上的 Alimbo Buddy。
- 首次安装时，用户在手表完成用户名输入后可看到配对码和 Cloud URL。

3. 是否启动飞书桥接
- 需要在飞书审批 Agent 指令时输入 `y`。
- 不需要则回车跳过。

4. 飞书凭据（仅在上一步选择 `y` 时）
- 输入 `FEISHU_APP_ID` 与 `FEISHU_APP_SECRET`。
- 可在飞书开放平台应用的“凭证与基础信息”页面获取。

5. 成功判据
- Apple Watch 收到：`Setup intercept decision connectivity check`
- 终端显示：`[alimbo-setup] Success`

## 关闭与卸载

关闭服务：

```bash
pm2 list
pm2 stop <gateway_process_name_or_id>
pm2 stop <feishu_process_name_or_id>
```

卸载全局安装：

```bash
npm uninstall -g alimbo
```

可选清理：
- 删除本地项目目录（Release/源码安装场景）
- 删除或归档 `.env`
- 删除 PM2 进程

```bash
pm2 delete <gateway_process_name_or_id>
pm2 delete <feishu_process_name_or_id>
```

## 故障排查与反馈

当用户遇到问题时，引导其收集日志并发送给开发者：

```bash
alimbo logs gateway --lines 200
alimbo logs feishu --lines 200
```

反馈信息至少包含：
- 失败发生在哪一步
- 终端报错截图或原文
- 上述日志输出

## Agent 执行规范

- 优先使用用户可复制的最短命令，不输出冗长解释。
- 遇到交互式问题（如是否启动飞书）先解释影响，再给建议默认值。
- 不要求用户提供敏感凭据到聊天中；敏感值应在终端本地输入。
- 若 setup 在 health 成功后仍出现 token 问题，优先排查旧进程残留与 `.env` 一致性。
