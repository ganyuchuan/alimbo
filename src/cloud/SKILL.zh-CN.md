# Alimbo 桌面端引导安装说明

## 目标

本说明用于帮助用户在桌面端安装 alimbo、完成首次配置，并按需启动飞书桥接。

这份文档同时适用于：
- 需要按步骤执行安装流程的 agent
- 希望手动阅读并完成安装配置的中文用户

## 推荐流程

1. 全局安装 alimbo：

```bash
npm i -g alimbo
```

2. 运行安装向导：

```bash
alimbo setup
```

3. 按终端中的交互提示完成配置。

安装向导会依次询问：
- Cloud URL
- Pairing code（配对码）
- setup 完成后是否立即启动飞书桥接
- 如果选择启动飞书桥接，是否需要输入飞书应用凭据

## 配对行为

### 正常配对模式

输入来自手机端或穿戴设备的 4 位配对码。

在该模式下，setup 会执行以下操作：
- 调用 `/auth/pairing-token`
- 解析共享认证 token
- 将 token 写入以下环境变量：
  - `GATEWAY_TOKEN`
  - `FEISHU_GATEWAY_TOKEN`
  - `FEISHU_INTERCEPT_AUTH_TOKEN`
  - `COPILOT_INTERCEPT_AUTH_TOKEN`
- 创建或更新 `.env`
- 启用 intercept 相关环境变量配置
- 停止当前端口上已存在的 gateway 进程
- 在后台启动 gateway
- 校验 gateway health 接口
- 校验 intercept decision API 连通性
- 上报 setup 的 intercept 验证事件

### 跳过配对模式

只有在 `.env` 中以下四个环境变量都存在、都非空、且值完全一致时，才可以将 pairing code 留空：
- `GATEWAY_TOKEN`
- `FEISHU_GATEWAY_TOKEN`
- `FEISHU_INTERCEPT_AUTH_TOKEN`
- `COPILOT_INTERCEPT_AUTH_TOKEN`

在该模式下，setup 会执行以下操作：
- 直接复用 `.env` 中已有的共享 token
- 跳过 `/auth/pairing-token`
- 跳过 intercept 校验与事件上报
- 仍然会停止旧的 gateway 进程
- 仍然会在后台启动 gateway
- 仍然会校验 gateway health

## 飞书桥接启动

当 gateway setup 成功后，安装向导会询问：

```text
Start Feishu bridge now? (y/N)
```

如果回答 yes，setup 会执行以下操作：
- 请求输入 `FEISHU_APP_ID`
- 请求输入 `FEISHU_APP_SECRET`
- 支持直接按 Enter 复用 `.env` 中已有的这两个值
- 只有在“用户未输入且 `.env` 也不存在值”时才会报错
- 将飞书配置写回 `.env`
- 在启动前先停止已存在的飞书桥接进程
- 在后台启动 `bridge/feishu.js`

如果回答 no，则 setup 会在 gateway 启动完成后直接成功退出。

## Setup 成功后的输出

setup 成功后会输出：
- gateway 的进程名与 PID
- Feishu 的进程名与 PID；如果未启动，则显示 `not-started`
- 一段 JSON 摘要，包含：
  - `skipPairing`
  - `startedFeishu`
  - `gatewayProcess`
  - `feishuProcess`

## 日志查看

安装完成后，可以使用以下命令查看日志：

```bash
alimbo logs gateway
alimbo logs feishu
alimbo logs gateway --lines 200
alimbo logs feishu --follow
```

## 手动模式

如果你不使用安装向导，也可以手动完成配置：

1. 基于 `.env.example` 创建 `.env`。
2. 将同一个已解析的 token 写入以下四个环境变量：
   - `GATEWAY_TOKEN`
   - `FEISHU_GATEWAY_TOKEN`
   - `FEISHU_INTERCEPT_AUTH_TOKEN`
   - `COPILOT_INTERCEPT_AUTH_TOKEN`
3. 按需设置 cloud / intercept 地址：
   - `COPILOT_INTERCEPT_SERVER_URL`
   - `FEISHU_INTERCEPT_SERVER_URL`
4. 如果需要启用飞书，再额外设置：
   - `FEISHU_ENABLED=true`
   - `FEISHU_APP_ID`
   - `FEISHU_APP_SECRET`
5. 再次运行 `alimbo setup`，并使用“跳过配对模式”，让向导帮助你停止旧进程、启动 gateway，并按需启动 Feishu。

## 给 Agent 的提示

- 当交互式安装可用时，优先使用 `alimbo setup`，而不是手动修改文件。
- 如果用户已经有有效的 `.env`，可以建议其将 pairing code 留空，以复用已有 token。
- 如果用户只需要 gateway，在飞书启动提示处回答 `N` 即可。
- 如果用户需要飞书，且 `.env` 中已经存在飞书凭据，那么在凭据输入步骤直接按 Enter 是有效的。
- 如果 setup 在 gateway health 成功后仍然出现 token 不匹配，优先检查是否存在使用旧环境变量启动的残留后台进程。