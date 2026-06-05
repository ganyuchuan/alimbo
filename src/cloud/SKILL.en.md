# Alimbo Desktop Onboarding

Alimbo is a desktop companion that connects your AI assistant with your devices and services.
It helps you:
- pair with Apple Watch
- run a local gateway safely
- optionally connect Feishu for message bridge workflows

This document is intended to help users install Alimbo on desktop, complete first-time setup, pair with Alimbo Buddy on Apple Watch, and optionally connect a Feishu bot.

## Quick Start

1. Install Alimbo:

```bash
npm i -g alimbo
```

2. Start setup:

```bash
alimbo setup
```

3. Answer the prompts on screen.

## Alternative Quick Path: Install From GitHub Release Package

Use this path when global npm install is not preferred.

1. Download a release source archive (for example, `alimbo-v0.2.2-source.tar.gz` or `.zip`).

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

## Pair With Apple Watch (Simple Setup Steps)

Setup is short and guided. Most users finish in a few minutes.

1. Enter your Cloud URL.
- What you do: paste the URL shown by your service.

2. Enter the 4-digit code from Apple Watch.
- What you do: open the watch pairing screen and type the code.

3. Choose whether to start Feishu bridge now.
- What you do: type `y` for yes, or press Enter for no.

4. If you chose yes, enter Feishu App ID and App Secret.
- What you do: paste both values, or press Enter to reuse saved values.

5. Wait for success output.
- What you do: confirm that setup shows gateway started (and Feishu started if selected).

## Stop Alimbo Desktop

If you need to stop running services, use PM2:

```bash
pm2 list
pm2 stop <gateway_process_name_or_id>
pm2 stop <feishu_process_name_or_id>
```

If you are not sure of names, run `pm2 list` first and stop only Alimbo-related processes.

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
