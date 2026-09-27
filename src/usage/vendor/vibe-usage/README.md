# Vendored vibe-usage parsers

Source: https://github.com/vibe-cafe/vibe-usage
Version copied: `0.12.0` (Hermes parser and dependencies; existing parsers remain from `0.10.14`)
Package license declaration: MIT
Copied on: 2026-08-24

This directory contains the parser implementation needed by alimbo for `copilot-cli`, `claude-code`, `codex`, `hermes`, and `kimi-code`. Alimbo's adapter, incremental state, upload client, and cloud storage remain outside this directory.

When updating, copy the parser files and their direct dependencies together, then run alimbo's build and parser contract validation. Keep the bucket accounting unchanged unless a deliberate schema migration is made.
