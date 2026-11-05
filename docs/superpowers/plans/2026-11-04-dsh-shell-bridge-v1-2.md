# DSH Shell Bridge V1.2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 将 DSH Shell Bridge 升级为可扩展、可验证且对复杂 PowerShell 输入更保守的 V1.2 插件。

**Architecture:** 在现有单文件插件入口旁增加职责清晰的 registry、metadata、scanner/parser、benchmark 和真实环境检查模块；`apply()` 仍只注册 DSH 官方 `tools/pre-execute` 与 `systemPrompt.section()`。规则注册表统一产生 finding，Parser/Tokenizer 采用可选适配器，缺失时显式回退或标记 `BLOCKED`。

**Tech Stack:** Node.js 22.19+、ES modules、Node built-in test runner、PowerShell 7 检查命令、GitHub Actions。

**Spec:** `docs/superpowers/specs/2026-11-04-dsh-shell-bridge-v1-2-design.md`

## Global Constraints

- 不修改 DSH 官方 Shell Runtime 或官方包源码。
- 不引入第二个 Shell 后端，不使用 `child_process` 执行用户脚本，不自动改写命令。
- 保持现有公开 API、配置（`enabled`、`prompt`、`promptMode`、`toolNames`、`powershellVersion`、`shellProfile`）和既有测试兼容。
- 规则结果必须含 `id`、`severity`、`confidence`、`decision`、`message`、`suggestion`；decision 只能是 `allow`、`ask`、`deny`。
- 真实 DSH CLI、Linux 和官方 Tokenizer 不可用时必须输出 `BLOCKED`，不得用 mock 或估算数据冒充 PASS。
- 根目录 `index.html` 保持不变；根 package 和 `dsh-shell-bridge/` bundle 都必须可安装。

---

### Task 1: 拆分核心模块并建立 metadata 适配层

**Files:**
- Create: `dsh-shell-bridge/src/profile-metadata.js`
- Create: `dsh-shell-bridge/src/rule-types.js`
- Modify: `dsh-shell-bridge/index.js`
- Modify: `dsh-shell-bridge/test/index.test.js`

**Interfaces:**
- `normalizeProfileMetadata(input, fallback?) -> ShellProfile`
- `readProfileMetadata(ctx, config) -> { profile, source, status }`
- `ShellProfile = { shell: string, version: string|null, platform: string, capabilities: { chainOperator: boolean, posixSource: boolean }, confidence: 'detected'|'unknown', source: string }`
- Existing `resolveShellProfile(config)` delegates to the adapter and keeps its current return fields.

- [x] **Step 1: Write failing metadata tests**

```js
test('normalizes complete, partial, and missing profile metadata', () => {
  assert.equal(normalizeProfileMetadata({ shell: 'powershell', version: '7.4', platform: 'win32' }).capabilities.chainOperator, true)
  assert.equal(normalizeProfileMetadata({ version: '5.1' }).capabilities.chainOperator, false)
  assert.equal(normalizeProfileMetadata({ version: 'wat' }).confidence, 'unknown')
})

test('reports metadata source without invoking a shell', () => {
  const result = readProfileMetadata({ shell: { profile: { version: '7' } } }, {})
  assert.equal(result.profile.version, '7')
  assert.equal(result.status, 'detected')
})
```

- [x] **Step 2: Run the focused tests and verify failure**

Run: `node --test test/index.test.js --test-name-pattern "metadata"`

Expected: FAIL because the adapter exports do not exist yet.

- [x] **Step 3: Implement the adapter**

Read only plain metadata objects already present on `config.profileMetadata`, `config.shellProfile`, `config.profile`, or `ctx.shell.profile`/`ctx.shell.metadata`; never call methods or spawn processes. Normalize versions `5.1`, `7.x`, `unknown`, preserve `platform`, derive only documented capabilities, and return `status: 'missing'|'partial'|'detected'` plus `source`.

- [x] **Step 4: Keep the compatibility wrapper**

Change `resolveShellProfile()` to return the existing five fields while ignoring the adapter-only `source` field. `apply()` obtains the profile once from the adapter and uses its conservative fallback when metadata is absent.

- [x] **Step 5: Run regression tests**

Run: `npm test`

Expected: all existing tests plus metadata tests PASS.

### Task 2: Add the rule registry and migrate built-ins

**Files:**
- Create: `dsh-shell-bridge/src/rule-registry.js`
- Modify: `dsh-shell-bridge/index.js`
- Modify: `dsh-shell-bridge/test/index.test.js`
- Modify: `dsh-shell-bridge/README.md`

**Interfaces:**
- `createRuleRegistry(initialRules = []) -> RuleRegistry`
- `registry.registerRule(rule) -> void`
- `registry.unregisterRule(id) -> boolean`
- `registry.listRules() -> RuleDescriptor[]`
- `registry.evaluateRules(context) -> Finding[]`
- Rule descriptor: `{ id, priority, match(context): boolean|Finding[]|Promise<...>, describe?: string }`

- [x] **Step 1: Write failing registry tests**

```js
test('registers, orders, lists, and unregisters rules', async () => {
  const registry = createRuleRegistry()
  registry.registerRule({ id: 'low', priority: 1, match: () => finding('low') })
  registry.registerRule({ id: 'high', priority: 10, match: () => finding('high') })
  assert.deepEqual(registry.listRules().map((rule) => rule.id), ['high', 'low'])
  assert.equal(registry.unregisterRule('low'), true)
  assert.equal(registry.unregisterRule('low'), false)
})

test('isolates duplicate and throwing rules', async () => {
  const registry = createRuleRegistry([{ id: 'same', priority: 1, match: () => [] }])
  assert.throws(() => registry.registerRule({ id: 'same', priority: 2, match: () => [] }), /duplicate/i)
  registry.registerRule({ id: 'throws', priority: 3, match: () => { throw new Error('boom') } })
  const findings = await registry.evaluateRules({ command: 'x' })
  assert.equal(findings[0].decision, 'ask')
  assert.equal(findings[0].id, 'rule-error:throws')
})
```

- [x] **Step 2: Run focused tests and verify failure**

Run: `node --test test/index.test.js --test-name-pattern "registry|rules"`

Expected: FAIL because the registry API is absent.

- [x] **Step 3: Implement registry validation and ordering**

Validate non-empty unique IDs, finite integer priorities, callable matchers, and findings against the unified shape. Sort by descending priority and ascending registration sequence. Convert matcher exceptions and invalid outputs into one low-confidence `ask` finding and continue.

- [x] **Step 4: Move built-in checks behind the registry**

Represent POSIX paths, `source`, `&&`, and `||` as built-in rules. Keep `analyzeCommand()` synchronous for existing callers by using a synchronous registry evaluation path for built-ins; expose async evaluation only for third-party rules when explicitly requested. Preserve finding IDs and decision precedence.

- [x] **Step 5: Export and document the API**

Export `createRuleRegistry` and the default registry factory. Add registration, removal, priority, collision, and exception examples to the package README. Do not expose mutable internal arrays.

- [x] **Step 6: Run full regression tests**

Run: `npm test; node --check dsh-shell-bridge/index.js`

Expected: PASS with unchanged legacy behavior.

### Task 3: Upgrade syntax scanning with parser adapter fallback

**Files:**
- Create: `dsh-shell-bridge/src/powershell-parser.js`
- Modify: `dsh-shell-bridge/index.js`
- Modify: `dsh-shell-bridge/test/index.test.js`
- Modify: `dsh-shell-bridge/README.md`

**Interfaces:**
- `createParserAdapter(candidate?) -> { available: boolean, parse(text): ParseResult }`
- `scanPowerShell(text, parserAdapter?) -> { tokens, syntax: { complete: boolean, errors: ParseError[] }, parser: string }`

- [x] **Step 1: Add failing complex syntax tests**

```js
test('does not inspect nested PowerShell syntax inside strings and containers', () => {
  assert.deepEqual(ids('$x = $(Get-Item C:\\x); @($x); @{Path="/c/Users/demo"}'), ['posix-path-uncertain'])
  assert.deepEqual(ids('Write-Output @"\nsource script.sh && /c/Users/demo\n"@'), [])
  assert.deepEqual(ids('Get-Item (Join-Path $HOME ("a``"b"))'), [])
})

test('marks incomplete and parser-error input conservatively', () => {
  const result = analyzeResult('Get-Item (', resolveShellProfile({ powershellVersion: '7' }))
  assert.ok(['ask', 'deny'].includes(result.decision))
})
```

- [x] **Step 2: Run focused tests and verify failure**

Run: `node --test test/index.test.js --test-name-pattern "nested|incomplete|parser"`

Expected: FAIL for currently unclassified nested/incomplete inputs.

- [x] **Step 3: Implement parser adapter without execution**

Accept only an injected parser object exposing a pure `parse(text)` function or a host-provided static parser value. Do not import or spawn a shell process, and never execute the submitted script. If no adapter is available, return `parser: 'fallback-scanner'` with empty or conservative syntax diagnostics.

- [x] **Step 4: Extend the fallback scanner state machine**

Track quote mode, here-string mode, backtick escapes, bracket depth, script-block depth, command boundaries, comments, pipelines, semicolons, and incomplete delimiters. Keep rule matching disabled inside strings/comments/here-strings. If the input ends with an open quote, here-string, or delimiter, attach a low-confidence syntax finding so the decision cannot be silently treated as fully safe.

- [x] **Step 5: Add the complete syntax matrix**

Cover `$()`, `@()`, arrays, `@{}`, `{}`, nested blocks, escaped quotes, single/double strings, here-strings, nested parentheses, pipelines, multiline and semicolon commands, comments, strings containing operators, incomplete expressions, and malformed input. Preserve all previous `$HOME`, `$env:`, `/c/`, and `source` tests.

- [x] **Step 6: Run syntax and regression checks**

Run: `npm test; node --check dsh-shell-bridge/src/powershell-parser.js`

Expected: PASS; no command text is rewritten or executed.

### Task 4: Add tokenizer benchmark and real DSH environment checks

**Files:**
- Create: `dsh-shell-bridge/benchmark/cases.json`
- Create: `dsh-shell-bridge/benchmark/runner.mjs`
- Create: `dsh-shell-bridge/scripts/check-dsh.mjs`
- Create: `dsh-shell-bridge/test/benchmark.test.js`
- Modify: `dsh-shell-bridge/package.json`
- Modify: root `package.json`
- Modify: `dsh-shell-bridge/README.md`

**Interfaces:**
- `runBenchmark({ cases, tokenizer }) -> BenchmarkReport`
- `BenchmarkReport = { status: 'PASS'|'BLOCKED', tokenizer: { source, version, metric }, cases: [...], summary: ... }`
- `checkDshEnvironment({ resolveCommand?, runVersion? }) -> EnvironmentReport`

- [x] **Step 1: Write failing benchmark and environment tests**

```js
test('benchmark reports BLOCKED without an official tokenizer', async () => {
  const report = await runBenchmark({ cases: [{ id: 'plain', prompt: 'Get-Date' }] })
  assert.equal(report.status, 'BLOCKED')
  assert.equal(report.summary, null)
})

test('DSH check distinguishes missing CLI from a failed command', async () => {
  const report = await checkDshEnvironment({ resolveCommand: () => undefined })
  assert.equal(report.status, 'BLOCKED')
  assert.equal(report.reason, 'dsh-cli-missing')
})
```

- [x] **Step 2: Run focused tests and verify failure**

Run: `node --test test/benchmark.test.js`

Expected: FAIL because runner and environment check do not exist.

- [x] **Step 3: Implement benchmark report generation**

Load JSON cases covering plain commands, long commands, pipelines, multiline, nested expressions, complex strings, repeated context, and multi-step commands. Accept only a tokenizer adapter returning `{ count(text), source, version, metric }`; if absent, emit `BLOCKED` with no token counts. When present, compute reduction as `(original - optimized) / original * 100` using the same adapter for both sides.

- [x] **Step 4: Implement non-destructive DSH check**

Use platform command lookup and `dsh --version` only; do not install packages or run arbitrary profile commands. Return `PASS` only when the CLI responds successfully and include version/path. Return `BLOCKED` for missing CLI or unavailable permissions, and `FAIL` for an installed CLI that returns a nonzero version result.

- [x] **Step 5: Add scripts and smoke tests**

Add `npm run benchmark`, `npm run check:dsh`, and root forwarding scripts. Make benchmark write JSON to `benchmark/report.json` only when explicitly given `--out`; default output is stdout. Add a smoke test that validates the report schema without claiming token results.

- [x] **Step 6: Run benchmark checks**

Run: `npm run benchmark; npm run check:dsh; npm test`

Expected: benchmark and DSH checks report `BLOCKED` on this machine; unit tests PASS.

### Task 5: Complete CI, documentation, and acceptance report

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `docs/v1.2-acceptance-report.md`
- Modify: `README.md`
- Modify: `dsh-shell-bridge/README.md`
- Modify: `dsh-shell-bridge/CHANGELOG.md`
- Modify: `dsh-shell-bridge/package.json`
- Modify: root `package.json`

**Interfaces:**
- CI must run Windows/Linux Node 22.19.x, PowerShell version checks, tests, syntax checks, package dry-run, and benchmark smoke.
- Acceptance report must use only `PASS`, `FAIL`, `BLOCKED`, and `SKIPPED` labels.

- [x] **Step 1: Update workflow triggers and matrix**

Add `workflow_dispatch:` while retaining `push` and `pull_request`. Keep Windows/Linux matrix, run `pwsh -NoProfile -Command '$PSVersionTable.PSVersion.ToString()'`, then `npm test`, `node --check`, `npm pack --dry-run`, and benchmark smoke. Do not claim a remote run ID unless one is actually observed.

- [x] **Step 2: Update package and user documentation**

Document Rule API signatures and examples, parser adapter availability and fallback behavior, benchmark commands and `BLOCKED` output, Linux setup, DSH CLI prerequisites, and known limitations. Keep install commands for both root and nested bundles.

- [x] **Step 3: Write acceptance report from observed evidence**

Record local Windows results, current missing DSH CLI, current official tokenizer availability, CI configuration, and any unexecuted Linux/remote workflow checks. Use exact timestamps and commands only when observed; leave unavailable fields as `BLOCKED` with reasons.

- [x] **Step 4: Run final verification**

Run:

```powershell
npm test
node --check dsh-shell-bridge/index.js
npm pack --dry-run
npm run benchmark
npm run check:dsh
git diff --check
```

Expected: code checks PASS; DSH and official tokenizer checks remain explicitly BLOCKED if the environment still lacks them. Confirm `index.html` is unchanged and no DSH runtime source or alternate shell backend was added.

- [x] **Step 5: Commit when repository permissions allow**

```powershell
git add dsh-shell-bridge docs .github package.json README.md
git commit -m "feat: upgrade dsh shell bridge to v1.2"
```

If `.git/index.lock` remains unwritable, report the exact permission failure and leave all generated artifacts in the workspace without claiming a commit.
