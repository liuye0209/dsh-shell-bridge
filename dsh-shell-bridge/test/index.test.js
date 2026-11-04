import test from 'node:test'
import assert from 'node:assert/strict'
import {
  analyzeCommand,
  analyzeResult,
  apply,
  FULL_GUIDANCE,
  MINIMAL_GUIDANCE,
  resolveShellProfile,
} from '../index.js'

const ids = (command, profile) => analyzeCommand(command, profile).map((finding) => finding.id)

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
