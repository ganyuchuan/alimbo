# Alimbo v0.2.9 Release Notes

发布日期：2026-07-11

## 版本概览

v0.2.9 聚焦 cloud 鉴权链路稳定性：增强 Apple 登录兼容、补齐当前用户查询接口，并优化 Apple 用户名的稳定策略。

## 主要更新

1. Apple 登录链路稳定性增强
- 服务端 Apple identity token 验证流程稳定化，提升不同端 nonce 形态下的兼容表现。
- 继续沿用 cloud 鉴权签发路径，降低 iOS 侧登录失败概率。

2. 新增当前用户查询接口
- 新增 `GET /auth/me`，支持通过 Bearer token 查询当前登录用户信息。
- 返回字段覆盖 `userId`、`username`、`authType`、`appleSub`、`email` 等常用身份信息，方便客户端启动阶段校验会话。

3. Apple 用户名策略优化
- 首次 Apple 登录时生成稳定短用户名：`apple-<sha1前8位>`。
- 后续登录保持已存在用户名，不再被 email 变化覆盖。

## 兼容性说明

- Node.js 版本要求保持 `>=22`
- 本次为增强与稳定性迭代，不引入破坏性协议变更

## 发布产物

- Tag: `v0.2.9`
- npm: `alimbo@0.2.9`
- Source Archive:
  - `alimbo-v0.2.9-source.tar.gz`
  - `alimbo-v0.2.9-source.zip`
