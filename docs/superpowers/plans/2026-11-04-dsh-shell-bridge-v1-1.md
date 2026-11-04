# DSH Shell Bridge V1.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将现有 Cordis PowerShell 兼容护栏补齐为低误报、可配置、可验证的 V1.1 插件。

**Architecture:** 保留 `tools/pre-execute` 单一拦截入口，在插件内部使用轻量词法扫描器和统一规则结果；`system-prompt/assemble` 只注册按 `promptMode` 选择的静态指导。所有版本、规则和配置都在插件内解析，不启动 Shell。

**Tech Stack:** Node.js 22.19+、ES modules、Node built-in test runner、GitHub Actions。

**Spec:** 用户提供的《DSH Shell Bridge V1.1 优化任务》与仓库 `AGENTS.md`。

## Global Constraints

- 不修改 DSH 官方 Shell Runtime 或官方源码。
- 不引入第二个 Shell 后端，不使用 `child_process`，不自动改写或执行命令。
- 继续使用 Cordis `tools/pre-execute` 和现有安装配置兼容性。
- Windows 默认启用，非 Windows 默认关闭；不确定语法只 ask，明确 Bash 冲突才 deny。

### Task 1: 规则与词法分析

**Files:** `dsh-shell-bridge/index.js`, `dsh-shell-bridge/test/index.test.js`

- [x] 保留 `$HOME` 合法放行，移除 Bash 专属提示。
- [x] 规范化 `powershellVersion` 为 `5.1`、`7`、`unknown`，并保留旧 `shellProfile` 配置。
- [x] 让扫描器区分命令代码、字符串、注释、URL 和多行边界；明确 POSIX 路径 deny，不确定路径 ask。
- [x] 为每条 finding 提供 `id`、`severity`、`confidence`、`decision`、`message`、`suggestion`。
- [x] 增加 `promptMode`，兼容旧 `prompt` 布尔配置。
- [x] 用测试覆盖规则、配置和 hook 行为。

### Task 2: 文档、打包与 CI

**Files:** `package.json`, `dsh-shell-bridge/package.json`, `README.md`, `dsh-shell-bridge/README.md`, `AGENTS.md`, `.github/workflows/ci.yml`, `dsh-shell-bridge/CHANGELOG.md`

- [x] 让根目录和子目录安装命令与实际 package 位置一致，并保留根目录 `index.html`。
- [x] 更新版本、兼容范围、配置和 V1.1 变更说明。
- [x] 添加 Node 22.19+ 的 Windows/Linux GitHub Actions，运行测试和 `npm pack --dry-run`。

### Task 3: 分阶段验证

- [x] 每阶段运行 `npm test` 和 `node --check`。
- [x] 使用临时 npm cache 运行 `npm pack --dry-run`，记录环境限制和结果。
- [x] 检查最终 diff，确认没有 DSH 官方 Runtime 或额外 Shell 后端改动。
