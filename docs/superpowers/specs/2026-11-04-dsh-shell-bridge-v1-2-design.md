# DSH Shell Bridge V1.2 设计规格

## 目标与边界

V1.2 将现有 DSH Shell Bridge 从轻量兼容护栏升级为可扩展、可验证的规则框架，同时保持既有 Cordis 插件入口、公开导出和配置兼容。插件继续只注册 `tools/pre-execute` 与 `systemPrompt.section()`；不修改 DSH 官方 runtime，不启动第二个 shell，不改写或执行用户提交的命令。

当前环境检查结果：PowerShell 7.6.7 和 Windows PowerShell 5.1 可用；`dsh` CLI 未安装，因此真实 DSH 安装、加载、启动、执行和卸载验证必须标记为 `BLOCKED`，不得用 mock 冒充。现有 Node 测试 12 项全部通过。

## 架构

### ProfileMetadataAdapter

新增适配层负责把宿主提供的 profile metadata 归一化为内部 `ShellProfile`：`shell`、`version`、`platform`、`capabilities`、`confidence` 和 `source`。适配器只读取已存在的对象或宿主上下文，不调用 shell、不推测未公开的 DSH API。支持完整、部分和缺失 metadata；缺失时回退到现有 unknown profile，并保留可诊断状态。现有 `resolveShellProfile()` 继续作为兼容入口。

### Rule Registry

新增内部注册表和公开 API：

- `createRuleRegistry(options?)`
- `registerRule(rule)`
- `unregisterRule(id)`
- `listRules()`
- `evaluateRules(context)`

规则必须有唯一 `id`，并包含 `priority`、匹配器和结果生成器。注册时拒绝重复 ID 和非法决策；执行时按 `priority` 降序、注册序号升序排序。单条规则抛错时转为保守 `ask` finding，并继续执行其他规则。内置 POSIX 路径、`source`、`&&` 和 `||` 规则迁移到同一注册机制，`analyzeCommand()` 和 `analyzeResult()` 保持原签名与语义。第三方规则只能返回统一 finding，不能绕过既有 `allow`、`ask`、`deny` 决策模型。

### Parser 与扫描器

新增可选 Parser 适配接口，用于接入宿主实际提供的 PowerShell Parser/Token API；适配器不可用时继续使用当前纯 JavaScript 扫描器。不会通过 `child_process` 或 `pwsh -Command` 执行用户脚本来完成解析。扫描器补齐并测试子表达式、数组表达式、数组变量、哈希表、脚本块和嵌套脚本块、反引号、单双引号、Here-String、嵌套括号、Pipeline、多行、分号、注释、转义引号、不完整表达式和解析失败输入。无法可靠识别的结构保持 `ask` 或不自动改写。

### Benchmark

新增 benchmark runner、固定命令数据集和报告格式。Tokenizer 通过适配器注入，记录来源、版本和统计口径。未发现官方 tokenizer 时 runner 仍生成结构化报告，但状态为 `BLOCKED`，不填充伪造 token 数或减少比例。官方 tokenizer 可用后，使用同一版本和口径计算原始/优化 prompt token、减少数量、减少率、平均值和命令类型分组。

### CI 与真实集成检查

GitHub Actions 增加 `workflow_dispatch`，保留 push 和 pull request；Windows/Linux 矩阵运行 Node 测试、语法检查、打包检查、PowerShell 版本检查和 benchmark smoke。新增本地真实 DSH 检查脚本：先检测 `dsh --version`、安装位置和 profile 能力；找不到 CLI 时输出机器可读的 `BLOCKED` 记录并退出成功，以免把环境缺失误报为测试通过。真实 DSH 场景在 CLI 可用时才执行安装、加载、普通命令、Pipeline、特殊字符、规则判断、异常和卸载检查。

## 数据流

`apply(ctx, config)` 创建 metadata 适配器和规则注册表，注册 `tools/pre-execute` listener。listener 先识别目标 PowerShell 工具，再提取命令文本，解析 profile，运行规则注册表，合并 findings，最后返回 DSH 原生 `allow`、`ask` 或 `deny` decision。任何未知工具直接 `next()`；任何异常都转换为保守 `ask` 或明确 `deny`，不会让 hook 返回 undefined，也不会改变命令参数。`promptMode` 只控制静态 system prompt section。

## 错误与兼容策略

- 缺失或不完整 metadata：回退 unknown profile，链式操作按现有保守策略询问。
- 重复规则 ID、非法规则结果或越界优先级：注册失败并保留已有规则。
- 规则运行异常：生成带规则 ID 的低置信度 `ask` finding，继续其余规则。
- Parser 不可用或解析失败：使用后备扫描器；含歧义的复杂结构不自动放行。
- 官方 tokenizer 或 DSH CLI 不可用：报告 `BLOCKED`，不伪造数据。
- 所有现有配置（`enabled`、`prompt`、`promptMode`、`toolNames`、`powershellVersion`、`shellProfile`）和导出函数保持兼容。

## 测试方案

### Unit

覆盖 metadata 完整/部分/缺失、规则注册/注销/冲突/排序/异常隔离、扫描器复杂语法、统一 finding 结构和配置兼容。

### Integration

使用真实插件上下文桩验证 `tools/pre-execute` 的 allow/ask/deny、未知工具委托、promptMode 和命令不改写；不伪造 DSH CLI 成功结果。

### DSH Integration

运行真实 `dsh` CLI 检查脚本。当前机器因 CLI 缺失记录 `BLOCKED`；CI 或用户机器安装后执行完整安装/加载/命令/卸载流程。

### Regression

保留并扩展现有 `$HOME`、`$env:`、`/c/`、`source`、PowerShell 5.1/7/unknown、字符串/注释、多行和 `promptMode` 用例。

### CI/Benchmark

验证 workflow 触发配置、PowerShell 版本输出、benchmark 报告 schema 和 `BLOCKED` 语义；不把 Windows 结果冒充 Linux 结果。

## 文档交付

同步更新根 README、子包 README、CHANGELOG，并新增 Rule API、Parser 兼容性、Benchmark、Linux/DSH 集成和已知限制说明。最终验收报告按 `PASS`、`FAIL`、`BLOCKED`、`SKIPPED` 分类，列出真实版本、运行 ID（如可用）、报告路径和剩余问题。

## 明确不做

- 不修改 DSH 官方 runtime 或官方包源码。
- 不新增 shell backend，不执行用户脚本，不自动改写命令。
- 不把字符数或估算比例写成官方 tokenizer 结果。
- 不在未授权情况下推送或合并到 `main`。
