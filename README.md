# DSH Shell Bridge 1.2.1

DSH Shell Bridge 是一个面向 Windows DSH + PowerShell 的 Cordis 插件。它在 DSH 官方 `tools/pre-execute` 执行前检查命令，识别常见的 Bash/Unix 写法，给出放行、询问或拒绝结果，帮助模型使用正确的 PowerShell 语法。

插件只注册 DSH 的扩展点，不修改 DSH 官方 runtime，不新增 Shell 后端，不执行用户脚本，也不会自动改写命令。

## 解决的问题

在 Windows DSH 中，模型可能把 Bash 命令、POSIX 路径或不兼容的 PowerShell 语法交给 PowerShell 执行器。Bridge 会在命令执行前拦截明确冲突，询问无法确定的输入，并保留合法 PowerShell 命令的正常执行流程。

## 主要功能

- 识别 `/c/...` 等明确的 POSIX 路径，并建议改用 `C:\...` 或其他 Windows 路径。
- 拒绝命令位置上的 Bash `source script.sh`。
- 过滤字符串、注释、URL 和 Here-String，减少误报。
- 识别 `$HOME`、`$env:USERPROFILE`、数组、哈希表、脚本块、Pipeline、嵌套表达式和不完整输入。
- 根据 PowerShell 5.1、7.x 或未知版本处理 `&&` 和 `||`。
- 通过 Profile Metadata 适配层读取宿主信息；metadata 缺失时使用保守回退。
- 提供可扩展 Rule Registry，支持规则注册、注销、查询、优先级和异常隔离。
- 提供 tokenizer benchmark 和 DSH CLI 环境检查；缺少官方接口时明确输出 `BLOCKED`，不生成估算数据。
- 支持 `promptMode: minimal | full | off`，关闭提示词不会关闭执行前检查。
- 第三方规则使用不可变快照，决策按 `deny > ask > allow` 单调聚合。
- Parser Adapter 可以从生产分析路径注入；复杂 fallback 输入无法确定时返回 `ask`。
- Benchmark 明确区分 Full、Minimal、Off，Tokenizer 契约无效时保持 `BLOCKED`。

## 安装

从 GitHub 安装根目录 bundle：

```powershell
dsh plugin --profile web add github:liuye0209/dsh-shell-bridge
```

从本地 checkout 安装：

```powershell
dsh plugin --profile web add .
```

也可以直接安装实现目录：

```powershell
dsh plugin --profile web add .\dsh-shell-bridge
```

安装后重启对应的 DSH App Server。项目根目录的 [`index.html`](./index.html) 是其他项目文件，与插件无关。

## 配置

在 DSH profile 中配置插件：

```yaml
- id: dsh-shell-bridge
  name: dsh-shell-bridge
  config:
    enabled: true
    promptMode: full       # minimal | full | off
    powershellVersion: 7   # 5.1 | 7 | unknown
```

可选配置包括 `toolNames`、`platform`、`shellProfile`、`parserAdapter` 和 `rules`。旧配置 `prompt: true|false` 仍然兼容：`true` 等同于 `full`，`false` 等同于 `off`。插件默认只在 Windows 启用，非 Windows 环境默认直接委托给 DSH。

## 使用方法

安装并重启 DSH 后，继续使用官方 `pwsh` 工具即可。Bridge 会自动检查目标工具的命令，不需要替换调用方式。

本地开发检查：

```powershell
npm test
npm run benchmark
npm run check:dsh
npm run pack:check
```

`npm run benchmark` 没有有效的官方 tokenizer 时输出 `BLOCKED`；`npm run check:dsh` 找不到 `dsh` CLI 时输出 `BLOCKED`，已发现但版本探测失败时输出 `FAIL` 并返回非零退出码。这些状态不会被标记为 PASS。

## 输入与输出示例

以下示例展示规则分析结果。实际 DSH hook 会把它转换为官方的 `allow`、`ask` 或 `deny` decision。

| 输入命令 | PowerShell profile | 结果 | 规则 |
| --- | --- | --- | --- |
| `Get-ChildItem $HOME` | 7 | allow | 无 |
| `Get-Item /c/Users/demo` | 7 | deny | `posix-path` |
| `source script.sh` | 7 | deny | `source-command` |
| `Get-Item a && Get-Item b` | 7 | allow | 无 |
| `Get-Item a && Get-Item b` | 5.1 / unknown | ask | `and-and` |
| `Get-Item (` | 7 | ask | `syntax-incomplete` |

一条 finding 的结构如下：

```json
{
  "id": "posix-path",
  "severity": "high",
  "confidence": "high",
  "decision": "deny",
  "message": "检测到明确的 /c/... POSIX 路径。",
  "suggestion": "请改用原生 Windows 路径。"
}
```

拒绝结果会返回原因和结构化错误信息；询问结果会返回 DSH 可显示的 `displayReason`；放行结果则继续调用 DSH 官方执行器。Bridge 不会修改原始命令文本。

Hook 决策示例：

```json
// 合法 PowerShell：继续调用官方工具
{ "kind": "allow" }

// 需要确认：PowerShell 5.1 不支持 &&
{ "kind": "ask", "reason": "无法确认 PowerShell 版本；&& 可能不受支持。" }

// 明确 Bash/Unix 冲突：拒绝执行
{
  "kind": "deny",
  "reason": "检测到明确的 /c/... POSIX 路径。请改用原生 Windows 路径。"
}
```

## 扩展规则

可以通过 `createBuiltinRuleRegistry(profile, extraRules)` 创建包含内置规则的注册表，再用 `analyzeCommand(command, profile, registry, parserAdapter)` 分析命令。规则必须提供唯一 `id`、整数 `priority` 和 `match(context)`，并返回统一 finding。优先级越高越先执行；规则异常会转换成保守的 `ask` finding，非法外部规则不会移除内置 Hook。

实现细节、兼容范围和扩展示例见 [`dsh-shell-bridge/README.md`](./dsh-shell-bridge/README.md)。V1.2.1 验收状态见 [`docs/v1.2-acceptance-report.md`](./docs/v1.2-acceptance-report.md)。真实 DSH、官方 Parser、官方 Tokenizer 和 Linux/PowerShell 环境不可用时仍会明确标记为 BLOCKED。

## 许可证

MIT
