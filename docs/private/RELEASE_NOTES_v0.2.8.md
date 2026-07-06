# Alimbo v0.2.8 Release Notes

发布日期：2026-07-06

## 版本概览

v0.2.8 聚焦发布与运维可用性增强：新增 cloud 用户创建脚本、完善环境变量模板对齐，并优化默认配置安全性。

## 主要更新

1. 新增 cloud 用户创建脚本
- 新增 `src/cloud/create-user.ts`，用于写入 `users` 表并生成高熵随机 token。
- 新增 npm 命令：`npm run cloud:create-user -- --username <name>`。

2. 环境变量模板与本地配置对齐
- 对齐并补充 `.env.example` 的关键字段，覆盖 LLM、Claude、Intercept、SQL 等配置项。
- 同步 `.env` 字段键，提升部署和排障的一致性。

3. 默认配置安全性优化
- 移除默认 `GATEWAY_TOKEN` 兜底依赖，强调必须由环境变量显式提供。
- 便于在多环境部署时避免误用固定 token。

## 兼容性说明

- Node.js 版本要求保持 `>=22`
- 本次为增强与稳定性迭代，不引入破坏性协议变更

## 发布产物

- Tag: `v0.2.8`
- npm: `alimbo@0.2.8`
- Source Archive:
  - `alimbo-v0.2.8-source.tar.gz`
  - `alimbo-v0.2.8-source.zip`
