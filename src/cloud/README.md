# Alimbo 桌面端引导安装说明

Alimbo 是一个桌面端助手，用来把你的 AI 助手与设备和服务连接起来。
它可以帮助你：
- 与 Apple Watch 配对
- 安全运行本地网关
- 按需连接飞书桥接消息流程

本说明用于帮助用户在桌面端安装 Alimbo、完成首次配置并与 Apple Watch 上的 Alimbo Watch（原名 Alimbo Buddy） 进行配对，以及按需连接飞书机器人。

## 前提（必读）

### 版本仅限

- Alimbo 桌面版本 0.2.7 | [alimbo-v0.2.7](https://github.com/ganyuchuan/alimbo/releases/tag/v0.2.7)
- Alimbo Watch 版本 1.0 Build 4｜Alimbo Watch 1.0(4)

### 桌面环境

- 操作系统 macOS 或 Windows
- 已安装 Node.js（推荐版本 20 及以上，我的是 v25.6.1）
- 已安装 npm（随 Node.js 一起安装）
- 已安装 PM2（可选，用于管理后台服务）
- 如果你平时使用 GitHub Copilot，请确保 CLI 安装并登录：

```bash
copilot --version
```

- 如果你平时使用 Claude Code，请确保 CLI 安装并登录：

```bash
claude --version
```

### Apple Watch & iPhone

- watchOS 26.0 或更高版本
- iOS 26.0 或更高版本

## 快速开始

1. 安装 Alimbo CLI：

```bash
npm install -g alimbo
```

安装完后可以检查版本：

```bash
alimbo --version
```

2. 启动本地网关：

```bash
alimbo
```

如果你要自定义端口：

```bash
alimbo --port 18789
```

3. 完成手表配对

```bash
alimbo watch --pairing-code 1234
```

> 首次打开 Alimbo Watch，输入完用户名后会显示 4 位配对码，比如这里的 1234。非首次想再次获取配对码，请在 Alimbo Watch 的设置里点击「new pairing code」。

你会在 Apple Watch 收到一条消息 `Setup intercept decision connectivity check` ，以及在电脑终端收到 setup 成功提示 `[alimbo-setup] Success`！

4. 在你的项目里配置 hooks

```bash
cd /path/to/your/project
alimbo init-hooks
```

如果要覆盖已有 hook：

```bash
alimbo init-hooks --force
```

5. 启动飞书桥（可选）

```bash
alimbo feishu --app-id YOUR_FEISHU_APP_ID --app-secret YOUR_FEISHU_APP_SECRET
```

> 打开 [飞书开放平台](https://open.feishu.cn/app) 在应用的 凭证与基础信息 页面，复制 App ID（格式如 cli_xxxxxxxxx）和 App Secret。

## 关闭 Alimbo Desktop

Alimbo 桌面端启动后会一直挂在后台服务，如果你需要停止服务，可使用 PM2：

```bash
pm2 list
pm2 stop <gateway_process_name_or_id>
pm2 stop <feishu_process_name_or_id>
```

如果不确定进程名，先执行 `pm2 list`，只停止与 `alimbo-xxx` 相关的进程。

## 卸载 Alimbo Desktop

```bash
npm uninstall -g alimbo
```

可选清理：
- 删除 alimbo 目录（如果你使用的是 Release 包或源码安装）。
- 如果 PM2 里还有相关进程，可继续删除：

```bash
pm2 delete <gateway_process_name_or_id>
pm2 delete <feishu_process_name_or_id>
```

## 遇到问题怎么办？

如果遇到报错，请先收集日志并发给开发者：

```bash
alimbo logs gateway --lines 200
alimbo logs feishu --lines 200
```

发送时请同时附上：
- 失败发生在哪一步
- 报错截图或报错文本
- 上面的日志输出