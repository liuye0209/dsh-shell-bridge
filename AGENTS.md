# 项目指导

## DSH PowerShell 兼容护栏插件
- 本项目是一个 DSH hook plugin，目标宿主是 Windows 原生 DSH + PowerShell 执行器。
- 扩展点：`tools/pre-execute`；辅助扩展点：`system-prompt/assemble`（本实现使用 `ctx.systemPrompt.section()` 注册静态指导）。
- 禁止修改官方 DSH 包源码；所有行为通过插件注册。
- 拦截原则：只拦明确 Bash 风格命令，不确定时 ask，不误杀 PowerShell。
- 测试必须覆盖：`$HOME` / `$env:`、`/c/` 路径、`source` 命令三类冲突，并保留合法 PowerShell 放行用例。
- `dsh-shell-bridge/` 是可独立安装的 bundle；执行器仍由 DSH 官方 `pwsh` 工具负责，插件不得引入第二个 Shell 后端。
