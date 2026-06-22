# Alimbo v0.2.7 Release Notes

发布日期：2026-06-22

## 版本概览

v0.2.7 主要修复 Claude Code SessionStart hook 在全局安装后初始化 hooks 时的启动失败问题。根因是 hooks 公共脚本对 `dotenv` 存在硬依赖，而目标仓库通常没有本地安装该依赖。

## 主要更新

1. 修复 hooks 启动对 dotenv 的硬依赖
- `hooks/scripts/_common.mjs` 改为优先使用内置 `.env` 解析逻辑，避免目标项目缺少 `dotenv` 时 SessionStart 直接崩溃。
- 对 `.env` 读取与解析失败做静默兜底，保证 startup hook 尽量不中断。

2. 保持初始化流程不变
- `alimbo init-hooks` 仍然会复制 Claude / Copilot hooks 模板到目标仓库。
- 现有配置与行为保持兼容，只修复启动时的依赖问题。

## 兼容性说明

- Node.js 要求保持 `>=22`
- 该版本为稳定性修复，不影响现有协议和配置字段

## 发布产物

- Tag: `v0.2.7`
- npm: `alimbo@0.2.7`
- Source Archive:
  - `alimbo-v0.2.7-source.tar.gz`
  - `alimbo-v0.2.7-source.zip`
