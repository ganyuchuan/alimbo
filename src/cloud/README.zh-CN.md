# Alimbo 桌面端引导安装说明

Alimbo 是一个桌面端助手，用来把你的 AI 助手与设备和服务连接起来。
它可以帮助你：
- 与 Apple Watch 配对
- 安全运行本地网关
- 按需连接飞书桥接消息流程

本说明用于帮助用户在桌面端安装 Alimbo、完成首次配置并与 Apple Watch 上的 Alimbo Buddy 进行配对，以及按需连接飞书机器人。

## 前提

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

## 快速开始

1. 从 [Release](https://github.com/ganyuchuan/alimbo/releases) 页面下载源码包，例如：

- [alimbo-v0.2.2-source.tar.gz](https://github.com/ganyuchuan/alimbo/releases/download/v0.2.2/alimbo-v0.2.2-source.tar.gz)

- [alimbo-v0.2.2-source.zip](https://github.com/ganyuchuan/alimbo/releases/download/v0.2.2/alimbo-v0.2.2-source.zip)

2. 解压并进入目录：

```bash
tar -xzf alimbo-v0.2.2-source.tar.gz
cd alimbo-v0.2.2-source
```

如果是 zip：

```bash
unzip alimbo-v0.2.2-source.zip
cd alimbo-v0.2.2-source
```

3. 安装依赖并构建：

```bash
npm install
npm run build
```

4. 运行安装向导：

```bash
node dist/cli.js setup
```

## 与 Apple Watch 配对

setup 全程有引导，大多数用户几分钟就能完成。

1. 输入 Cloud URL，直接回车跳过。

2. 输入 Apple Watch 上的 4 位配对码。

> 打开 Alimbo Buddy，首次安装输入完用户名后会显示配对码和 Cloud URL。

3. 选择是否立即启动飞书桥接，如果想要在飞书上审批你的 Agent 指令，输入 `y` 表示是，否则回车跳过。

4. 如果你选择了是，输入飞书 App ID 和 App Secret。

> 打开 [飞书开放平台](https://open.feishu.cn/app) 在应用的 凭证与基础信息 页面，复制 App ID（格式如 cli_xxxxxxxxx）和 App Secret。

5. 如果一切顺利，你会在 Apple Watch 收到一条消息 `Setup intercept decision connectivity check` ，以及在电脑终端收到 setup 成功提示 `[alimbo-setup] Success`！

## 如何关闭 Alimbo Desktop

Alimbo 桌面端启动后会一直挂在后台服务，如果你需要停止服务，可使用 PM2：

```bash
pm2 list
pm2 stop <gateway_process_name_or_id>
pm2 stop <feishu_process_name_or_id>
```

如果不确定进程名，先执行 `pm2 list`，只停止与 `alimbo-xxx` 相关的进程。

## 如何卸载 Alimbo Desktop

如果你是通过 npm 全局安装的：

```bash
npm uninstall -g alimbo
```

可选清理：
- 删除本地项目目录（如果你使用的是 Release 包或源码安装）。
- 如果不再需要保留配置，删除或归档 `.env` 文件。
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