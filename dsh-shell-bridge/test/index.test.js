import test from 'node:test'
import assert from 'node:assert/strict'
import {
  analyzeCommand,
  analyzeResult,
  apply,
  createBuiltinRuleRegistry,
  FULL_GUIDANCE,
  MINIMAL_GUIDANCE,
  resolveShellProfile,
} from '../index.js'
import { normalizeProfileMetadata, readProfileMetadata } from '../src/profile-metadata.js'
import { createRuleRegistry } from '../src/rule-registry.js'
import { createParserAdapter, scanPowerShell } from '../src/powershell-parser.js'
import { runBenchmark } from '../benchmark/runner.mjs'
import { checkDshEnvironment } from '../scripts/check-dsh.mjs'

const ids = (command, profile) => analyzeCommand(command, profile).map((finding) => finding.id)
const finding = (id) => ({ id, ruleId: id, severity: 'low', confidence: 'high', decision: 'ask', message: id, suggestion: 'check' })

test('registers, orders, lists, and unregisters rules', async () => {
  const registry = createRuleRegistry()
  registry.registerRule({ id: 'low', priority: 1, match: () => finding('low') })
  registry.registerRule({ id: 'high', priority: 10, match: () => finding('high') })
  assert.deepEqual(registry.listRules().map((rule) => rule.id), ['high', 'low'])
  assert.deepEqual(await registry.evaluateRules({ command: 'x' }), [finding('high'), finding('low')])
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

test('runs third-party rules through the built-in registry without core edits', () => {
  const registry = createBuiltinRuleRegistry(resolveShellProfile({ powershellVersion: '7' }), [{
    id: 'custom-command',
    priority: 200,
    match: ({ command }) => command.includes('Invoke-Expression')
      ? finding('custom-command')
      : [],
  }])
  const result = analyzeResult('Invoke-Expression $code', resolveShellProfile({ powershellVersion: '7' }))
  const findings = analyzeCommand('Invoke-Expression $code', resolveShellProfile({ powershellVersion: '7' }), registry)
  assert.deepEqual(findings.map((item) => item.id), ['custom-command'])
  assert.equal(result.decision, 'allow')
})

test('does not inspect nested PowerShell syntax inside strings and containers', () => {
  assert.deepEqual(ids('$x = $(Get-Item C:\\x); @($x); @{Path="/c/Users/demo"}'), ['posix-path-uncertain'])
  assert.deepEqual(ids('Write-Output @"\nsource script.sh && /c/Users/demo\n"@'), [])
  assert.deepEqual(ids('Get-Item (Join-Path $HOME ("a`"b"))'), [])
})

test('marks incomplete expressions conservatively', () => {
  const result = analyzeResult('Get-Item (', resolveShellProfile({ powershellVersion: '7' }))
  assert.ok(['ask', 'deny'].includes(result.decision))
})

test('covers arrays, hash tables, script blocks, pipelines, escapes, and malformed input', () => {
  assert.deepEqual(ids('$items = @($HOME, $env:USERPROFILE)'), [])
  assert.deepEqual(ids('$map = @{ Path = "C:\\Work" }'), [])
  assert.deepEqual(ids('$block = { Get-Item C:\\Work }; & { Get-Location }'), [])
  assert.deepEqual(ids('Get-Item C:\\Work | ForEach-Object { $_.Name }'), [])
  assert.deepEqual(ids('Write-Output "a`"b"; Write-Output $HOME'), [])
  assert.equal(analyzeResult('Get-Item @{', resolveShellProfile({ powershellVersion: '7' })).decision, 'ask')
  assert.equal(analyzeResult('@"\nunfinished', resolveShellProfile({ powershellVersion: '7' })).decision, 'ask')
})

test('uses an injected parser only when it is a pure adapter', () => {
  const adapter = createParserAdapter({ parse: (text) => ({ tokens: [{ value: text }], errors: [] }) })
  assert.equal(adapter.available, true)
  assert.equal(scanPowerShell('Get-Date', adapter).parser, 'injected')
})

test('benchmark reports BLOCKED without an official tokenizer', async () => {
  const report = await runBenchmark({ cases: [{ id: 'plain', prompt: 'Get-Date' }] })
  assert.equal(report.status, 'BLOCKED')
  assert.equal(report.summary, null)
})

test('benchmark uses one tokenizer for original and optimized prompts', async () => {
  const tokenizer = { source: 'test', version: '1', metric: 'tokens', count: (text) => text.length }
  const report = await runBenchmark({
    cases: [{ id: 'plain', prompt: 'abcdef', optimizedPrompt: 'abc' }],
    tokenizer,
  })
  assert.equal(report.status, 'PASS')
  assert.equal(report.cases[0].reductionRate, 50)
})

test('DSH check distinguishes missing CLI from a failed command', async () => {
  const report = await checkDshEnvironment({ resolveCommand: () => undefined })
  assert.equal(report.status, 'BLOCKED')
  assert.equal(report.reason, 'dsh-cli-missing')
})

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

test('allows PowerShell automatic variables including $HOME and $env:', () => {
  assert.deepEqual(ids('Get-ChildItem "$HOME\\Desktop"'), [])
  assert.deepEqual(ids('Write-Output $env:USERPROFILE'), [])
  assert.deepEqual(ids('Write-Output "$HOME"'), [])
})

test('denies explicit POSIX drive paths and allows native paths', () => {
  assert.deepEqual(ids('Get-Item /c/Users/demo/project'), ['posix-path'])
  assert.deepEqual(ids('Get-Item "/c/Users/demo/project"'), ['posix-path'])
  assert.deepEqual(ids('Get-Item C:\\Users\\demo\\project'), [])
  assert.deepEqual(ids('Get-Item C:/Users/demo/project'), [])
  assert.deepEqual(ids('Get-Item .\\project'), [])
})

test('does not mistake URLs or output strings for POSIX paths', () => {
  assert.deepEqual(ids('Get-Item https://example.com/c/Users'), [])
  assert.deepEqual(ids('Write-Output "/c/Users/demo"'), [])
  assert.deepEqual(ids("Write-Output '/c/Users/demo'"), [])
  assert.deepEqual(ids('$text = "/c/Users/demo"'), ['posix-path-uncertain'])
  assert.deepEqual(ids('# Get-Item /c/Users/demo'), [])
  assert.deepEqual(ids('<# Get-Item /c/Users/demo #> Get-Location'), [])
})

test('detects source only at command positions across multiple lines', () => {
  assert.deepEqual(ids('source script.sh'), ['source-command'])
  assert.deepEqual(ids('Get-Item a; source script.sh'), ['source-command'])
  assert.deepEqual(ids('Get-Item a\nsource "script.sh"'), ['source-command'])
  assert.deepEqual(ids('Write-Output "source script.sh"'), [])
  assert.deepEqual(ids("Write-Output 'source script.sh'"), [])
  assert.deepEqual(ids('# source script.sh'), [])
  assert.deepEqual(ids('<# source script.sh #> Get-Location'), [])
  assert.deepEqual(ids("@'\nsource script.sh\n'@"), [])
  assert.deepEqual(ids('Get-Location; . .\\script.ps1'), [])
})

test('ignores operators and paths inside strings, comments, and here-strings', () => {
  assert.deepEqual(ids('Write-Output "a && b"'), [])
  assert.deepEqual(ids('# Get-Item /c/Users/demo && source x'), [])
  assert.deepEqual(ids('<# Get-Item /c/Users/demo && source x #> Get-Location'), [])
  assert.deepEqual(ids('@"\nGet-Item /c/Users/demo && source x\n"@'), [])
  assert.deepEqual(ids('$text = @"\nsource script.sh && Get-Item /c/Users/demo\n"@'), [])
})

test('gates && and || by PowerShell 5.1, 7, and unknown profiles', () => {
  const ps7 = resolveShellProfile({ powershellVersion: '7' })
  const ps51 = resolveShellProfile({ powershellVersion: '5.1' })
  const unknown = resolveShellProfile({ powershellVersion: 'unknown' })
  assert.deepEqual(ids('Get-Item a && Get-Item b', ps7), [])
  assert.deepEqual(ids('Get-Item a || Get-Item b', ps7), [])
  assert.deepEqual(ids('Get-Item a && Get-Item b', ps51), ['and-and'])
  assert.deepEqual(ids('Get-Item a || Get-Item b', ps51), ['or-or'])
  assert.deepEqual(ids('Get-Item a && Get-Item b', unknown), ['and-and'])
  assert.equal(analyzeResult('Get-Item a && Get-Item b', ps51).decision, 'ask')
})

test('normalizes versions and invalid configuration conservatively', () => {
  assert.deepEqual(resolveShellProfile({ shellProfile: { version: '7.4.2' } }), {
    shell: 'powershell', version: '7.4.2', platform: process.platform,
    capabilities: { chainOperator: true, posixSource: false }, confidence: 'detected',
  })
  assert.equal(resolveShellProfile({ powershellVersion: 5.1 }).capabilities.chainOperator, false)
  assert.equal(resolveShellProfile({ powershellVersion: 'wat' }).confidence, 'unknown')
  assert.doesNotThrow(() => apply({ on() {}, systemPrompt: {} }, null))
})

test('each finding uses the unified rule shape', () => {
  const findings = analyzeCommand('source script.sh && Get-Item /c/Users/demo')
  assert.ok(findings.length >= 2)
  for (const finding of findings) {
    assert.equal(typeof finding.id, 'string')
    assert.match(finding.severity, /^(low|medium|high)$/)
    assert.match(finding.confidence, /^(low|medium|high)$/)
    assert.match(finding.decision, /^(allow|ask|deny)$/)
    assert.equal(typeof finding.message, 'string')
    assert.equal(typeof finding.suggestion, 'string')
  }
})

test('Cordis hook delegates, asks, denies, and never rewrites commands', async () => {
  const listeners = new Map()
  const sections = []
  const ctx = {
    on(event, listener) { listeners.set(event, listener) },
    systemPrompt: { section(section) { sections.push(section) } },
  }
  apply(ctx, { platform: 'win32', enabled: true, promptMode: 'full', powershellVersion: '5.1' })
  assert.equal(sections.length, 1)
  const hook = listeners.get('tools/pre-execute')
  const original = 'Get-Item a && Get-Item b'
  const warning = await hook({ name: 'pwsh', arguments: { command: original } }, async () => ({ kind: 'allow' }))
  assert.equal(warning.kind, 'ask')
  assert.match(warning.reason, /PowerShell 5\.1/)
  assert.equal(original, 'Get-Item a && Get-Item b')
  const allowed = await hook({ name: 'pwsh', arguments: { command: 'Get-ChildItem $HOME' } }, async () => ({ kind: 'allow' }))
  assert.deepEqual(allowed, { kind: 'allow' })
  const denied = await hook({ name: 'pwsh', arguments: { command: 'source script.sh' } }, async () => ({ kind: 'allow' }))
  assert.equal(denied.kind, 'deny')
  assert.match(denied.reason, /\. \.\\script\.ps1/)
  let delegated = false
  const unrelated = await hook({ name: 'bash', arguments: { command: 'source x' } }, async () => {
    delegated = true
    return { kind: 'allow' }
  })
  assert.equal(delegated, true)
  assert.deepEqual(unrelated, { kind: 'allow' })
})

test('promptMode controls only prompt injection and preserves the hook', () => {
  assert.ok(MINIMAL_GUIDANCE.length < FULL_GUIDANCE.length)
  for (const [mode, expectedText] of [['minimal', '最小'], ['full', '完整'], ['off', null]]) {
    const events = []
    const sections = []
    apply({
      on(event) { events.push(event) },
      systemPrompt: { section(section) { sections.push(section) } },
    }, { platform: 'win32', promptMode: mode })
    assert.deepEqual(events, ['tools/pre-execute'])
    assert.equal(sections.length, expectedText ? 1 : 0)
    if (expectedText) assert.ok(sections[0].text.length > 0)
  }
  const legacy = []
  apply({ on(event) { legacy.push(event) }, systemPrompt: { section() {} } }, { platform: 'win32', prompt: false })
  assert.deepEqual(legacy, ['tools/pre-execute'])
})

test('does not mount by default outside Windows', () => {
  const events = []
  const sections = []
  apply({ on(event) { events.push(event) }, systemPrompt: { section(section) { sections.push(section) } } }, { platform: 'linux' })
  assert.deepEqual(events, [])
  assert.deepEqual(sections, [])
})

test('delegates unknown tool names to DSH unchanged', async () => {
  let delegated = false
  const listeners = []
  apply({ on(event, listener) { listeners.push(listener) }, systemPrompt: {} }, { platform: 'win32' })
  const result = await listeners[0]({ name: 'unknown-tool', arguments: { command: 'source x' } }, async () => {
    delegated = true
    return { kind: 'allow' }
  })
  assert.equal(delegated, true)
  assert.deepEqual(result, { kind: 'allow' })
})
