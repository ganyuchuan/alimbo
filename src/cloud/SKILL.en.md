# Alimbo Desktop Onboarding Skill

## Goal

Use this guide to install alimbo on desktop, finish first-time setup, and optionally start the Feishu bridge.

This document is written for both:
- agents that need a reliable onboarding script to follow
- users who want to read and run the steps manually

## Recommended Flow

1. Install alimbo globally:

```bash
npm i -g alimbo
```

2. Run setup:

```bash
alimbo setup
```

3. Follow the interactive prompts.

The setup wizard will ask for:
- Cloud URL
- Pairing code
- whether to start the Feishu bridge after setup
- optional Feishu app credentials when Feishu bridge startup is requested

## Pairing Behavior

### Normal pairing mode

Enter the 4-digit pairing code from the mobile or wearable device.

In this mode, setup will:
- call `/auth/pairing-token`
- resolve the shared auth token
- write the token into these env keys:
  - `GATEWAY_TOKEN`
  - `FEISHU_GATEWAY_TOKEN`
  - `FEISHU_INTERCEPT_AUTH_TOKEN`
  - `COPILOT_INTERCEPT_AUTH_TOKEN`
- write or update `.env`
- enable intercept-related env settings
- stop any existing gateway process on the configured port
- start the gateway in background
- verify the gateway health endpoint
- verify intercept decision API connectivity
- report the setup intercept verification event

### Skip-pairing mode

You may leave the pairing code empty only when `.env` already contains these four keys and they are all non-empty and identical:
- `GATEWAY_TOKEN`
- `FEISHU_GATEWAY_TOKEN`
- `FEISHU_INTERCEPT_AUTH_TOKEN`
- `COPILOT_INTERCEPT_AUTH_TOKEN`

In this mode, setup will:
- reuse the existing shared token from `.env`
- skip `/auth/pairing-token`
- skip intercept verification and verification event reporting
- still stop any old gateway process
- still start the gateway in background
- still verify gateway health

## Feishu Bridge Startup

After gateway setup succeeds, the wizard asks:

```text
Start Feishu bridge now? (y/N)
```

If the answer is yes, setup will:
- request `FEISHU_APP_ID`
- request `FEISHU_APP_SECRET`
- allow pressing Enter to reuse existing `.env` values for those two keys
- fail only if both the prompt input and `.env` value are empty
- write Feishu config into `.env`
- stop any previously running Feishu bridge process
- start `bridge/feishu.js` in background

If the answer is no, setup exits successfully after gateway startup.

## Setup Success Output

On success, setup prints:
- gateway process name and PID
- Feishu process name and PID, or `not-started`
- a JSON summary including:
  - `skipPairing`
  - `startedFeishu`
  - `gatewayProcess`
  - `feishuProcess`

## Logs

After installation, logs can be viewed with:

```bash
alimbo logs gateway
alimbo logs feishu
alimbo logs gateway --lines 200
alimbo logs feishu --follow
```

## Manual Mode

If you do not use the wizard, you can configure manually:

1. Create `.env` from `.env.example`.
2. Fill these token keys with the same resolved token:
   - `GATEWAY_TOKEN`
   - `FEISHU_GATEWAY_TOKEN`
   - `FEISHU_INTERCEPT_AUTH_TOKEN`
   - `COPILOT_INTERCEPT_AUTH_TOKEN`
3. Set cloud/intercept URLs as needed:
   - `COPILOT_INTERCEPT_SERVER_URL`
   - `FEISHU_INTERCEPT_SERVER_URL`
4. If Feishu is needed, also set:
   - `FEISHU_ENABLED=true`
   - `FEISHU_APP_ID`
   - `FEISHU_APP_SECRET`
5. Run `alimbo setup` again and use skip-pairing mode to let the wizard stop old processes, start gateway, and optionally start Feishu.

## Notes For Agents

- Prefer `alimbo setup` over manual file editing when interactive setup is available.
- If the user already has a valid `.env`, suggest leaving the pairing code empty to reuse the existing token.
- If the user only wants gateway, answer `N` to the Feishu startup prompt.
- If the user wants Feishu and `.env` already has app credentials, pressing Enter at the credential prompts is valid.
- If setup fails after gateway health succeeds but token verification is mismatched, check for stale background processes using old env values.
