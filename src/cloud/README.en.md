# Alimbo Desktop Onboarding

Alimbo is a desktop companion that connects your AI assistant with your devices and services.
It helps you:
- pair with Apple Watch
- run a local gateway safely
- optionally connect Feishu for message bridge workflows

This document is intended to help users install Alimbo on desktop, complete first-time setup, pair with Alimbo Buddy on Apple Watch, and optionally connect a Feishu bot.

## Prerequisites

- Node.js installed (recommended version 20 or above)
- npm installed (comes with Node.js)
- PM2 installed (optional, for managing background services)
- If you usually use GitHub Copilot, make sure CLI is installed and signed in:

```bash
copilot --version
```

- If you usually use Claude Code, make sure CLI is installed and signed in:

```bash
claude --version
```

## Quick Start

1. Download a source archive from the [Release](https://github.com/ganyuchuan/alimbo/releases) page, for example:

- [alimbo-v0.2.2-source.tar.gz](https://github.com/ganyuchuan/alimbo/releases/download/v0.2.2/alimbo-v0.2.2-source.tar.gz)
- [alimbo-v0.2.2-source.zip](https://github.com/ganyuchuan/alimbo/releases/download/v0.2.2/alimbo-v0.2.2-source.zip)

2. Extract and enter the folder:

```bash
tar -xzf alimbo-v0.2.2-source.tar.gz
cd alimbo-v0.2.2-source
```

For zip:

```bash
unzip alimbo-v0.2.2-source.zip
cd alimbo-v0.2.2-source
```

3. Install and build:

```bash
npm install
npm run build
```

4. Run setup:

```bash
node dist/cli.js setup
```

## Pair With Apple Watch

Setup is short and guided. Most users finish in a few minutes.

1. Enter your Cloud URL, or press Enter to skip.

2. Enter the 4-digit code from Apple Watch.

> Open Alimbo Buddy. After first-time username setup, it will show both the pairing code and Cloud URL.

3. Choose whether to start Feishu bridge now. If you want to approve your Agent actions from Feishu, type `y`; otherwise press Enter to skip.

4. If you chose yes, enter Feishu App ID and App Secret.

> Open the [Feishu Open Platform](https://open.feishu.cn/app), then go to your app's Credentials and Basic Info page. Copy App ID (format like `cli_xxxxxxxxx`) and App Secret.

5. If everything goes well, you will receive `Setup intercept decision connectivity check` on Apple Watch, and `[alimbo-setup] Success` in your terminal.

## Stop Alimbo Desktop

If you need to stop running services, use PM2:

```bash
pm2 list
pm2 stop <gateway_process_name_or_id>
pm2 stop <feishu_process_name_or_id>
```

If you are not sure of names, run `pm2 list` first and stop only processes named like `alimbo-xxx`.

## Uninstall Alimbo Desktop

If installed globally with npm:

```bash
npm uninstall -g alimbo
```

Optional cleanup:
- Remove local project folder (if you used release package/source install).
- Remove or archive your `.env` file if you no longer need saved settings.
- Remove related PM2 processes if still present:

```bash
pm2 delete <gateway_process_name_or_id>
pm2 delete <feishu_process_name_or_id>
```

## Need Help?

If anything fails, collect logs and send them to the developer.

```bash
alimbo logs gateway --lines 200
alimbo logs feishu --lines 200
```

Please include in your message:
- what step failed
- a screenshot or pasted error text
- the log output above
