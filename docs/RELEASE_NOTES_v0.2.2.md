# Alimbo v0.2.2 Release Notes

发布日期：2026-06-05

## 版本概览

v0.2.2 聚焦权限语义收敛与配置减负：移除 Copilot 侧 `permissionRequestMode` 暴露能力，与 Claude 侧统一到 hook/intercept 决策链路，减少跨 runtime 配置歧义。

## 主要更新

1. 移除 Copilot permissionRequestMode 运行时能力
- 删除 `onPermissionRequest` 注入逻辑
- 移除 `approveAll/denyAll` 相关分支
- 相关文件：
  - `src/agent-runtime/copilot.ts`

2. 移除对应配置与类型字段
- 删除环境变量解析项：`COPILOT_PERMISSION_REQUEST_MODE`
- 删除 runtime config 类型字段 `permissionRequestMode`
- 相关文件：
  - `src/config.ts`
  - `src/tool/cron.ts`
  - `src/tool/sql.ts`

3. 文档与示例同步
- `.env.example` 删除 `COPILOT_PERMISSION_REQUEST_MODE`
- `README.md` 删除该参数说明与示例
- README 中对齐为“权限由 hook/intercept 流程处理”，并补充 Claude permission 模式参考

## 兼容性说明

- Node.js 要求保持 `>=22`
- 本版本为兼容性收敛改动，不涉及外部 API 破坏性变更

## 发布产物

- Tag: `v0.2.2`
- npm: `alimbo@0.2.2`
- Source Archive:
  - `alimbo-v0.2.2-source.tar.gz`
  - `alimbo-v0.2.2-source.zip`
