# Alimbo 桌面端引导安装说明

Alimbo 是一个桌面端助手，用来把你的 AI 助手与设备和服务连接起来。
它可以帮助你：
- 与 Apple Watch 配对
- 安全运行本地网关
- 按需连接飞书桥接消息流程

本说明用于帮助用户在桌面端安装 Alimbo、完成首次配置并与 Apple Watch 上的 Alimbo Buddy 进行配对，以及按需连接飞书机器人。

## 快速开始

1. 安装 Alimbo：

```bash
npm i -g alimbo
```

2. 启动安装向导，按屏幕提示完成配置：

```bash
alimbo setup
```

## 或从 GitHub Release 包安装

如果你不想全局安装 npm 包，可以使用这个路径。

1. 从 Release 页面下载源码包（例如 `alimbo-v0.2.2-source.tar.gz` 或 `.zip`）。

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

## 与 Apple Watch 配对（简明步骤）

setup 全程有引导，大多数用户几分钟就能完成。

1. 输入 Cloud URL。
- 你需要做什么：粘贴服务提供给你的 URL。

2. 输入 Apple Watch 上的 4 位配对码。
- 你需要做什么：打开手表配对页面，输入看到的 4 位数字。

3. 选择是否立即启动飞书桥接。
- 你需要做什么：输入 `y` 表示是，或直接回车表示否。

4. 如果你选择了是，输入飞书 App ID 和 App Secret。
- 你需要做什么：粘贴这两个值；如果已有保存值，也可以直接回车复用。

5. 等待 setup 成功提示。
- 你需要做什么：确认页面显示 gateway 已启动（如果你选择了飞书，也会显示飞书已启动）。

## 如何关闭 Alimbo Desktop

如果你需要停止服务，可使用 PM2：

```bash
pm2 list
pm2 stop <gateway_process_name_or_id>
pm2 stop <feishu_process_name_or_id>
```

如果不确定进程名，先执行 `pm2 list`，只停止与 Alimbo 相关的进程。

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