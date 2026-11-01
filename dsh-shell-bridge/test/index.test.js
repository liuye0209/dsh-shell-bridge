import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeCommand, apply } from '../index.js'

test('detects Bash HOME and gives the PowerShell environment fix', () => {
  const findings = analyzeCommand('Get-ChildItem "$HOME\\Desktop"')
  assert.equal(findings.some((finding) => finding.id === 'home-variable'), true)
  assert.match(findings.find((finding) => finding.id === 'home-variable').message, /\$env:USERPROFILE/)
})

test('detects POSIX /c/ paths', () => {
  const findings = analyzeCommand('Get-Item /c/Users/demo/project')
  assert.deepEqual(findings.map((finding) => finding.id), ['posix-path'])
  assert.equal(findings[0].decision, 'deny')
})

test('detects Bash source and asks about PowerShell 5.1 &&', () => {
  assert.equal(analyzeCommand('source script.sh')[0].id, 'source-command')
  assert.equal(analyzeCommand('source "script.sh"')[0].id, 'source-command')
  assert.equal(analyzeCommand('Get-Item a && Get-Item b')[0].id, 'and-and')
})

test('does not flag a legal native PowerShell command', () => {
  assert.deepEqual(analyzeCommand('Get-ChildItem -Path C:\\Temp'), [])
  assert.deepEqual(analyzeCommand('Write-Output $env:USERPROFILE'), [])
  assert.deepEqual(analyzeCommand("Write-Output '$HOME'"), [])
  assert.deepEqual(analyzeCommand('Write-Output "a && b"'), [])
})

test('Cordis hook returns non-allow for pwsh and delegates unrelated tools', async () => {
  const listeners = new Map()
  const sections = []
  const ctx = {
    on(event, listener) {
      listeners.set(event, listener)
    },
    systemPrompt: {
      section(section) {
        sections.push(section)
      },
    },
  }

  apply(ctx, { platform: 'win32', enabled: true, prompt: true })
  assert.equal(sections.length, 1)
  const hook = listeners.get('tools/pre-execute')
  assert.ok(hook)

  const blocked = await hook(
    { name: 'pwsh', arguments: { command: 'echo $HOME' } },
    async () => ({ kind: 'allow' }),
  )
  assert.notEqual(blocked.kind, 'allow')
  assert.match(blocked.displayReason?.zh ?? blocked.reason, /\$env:USERPROFILE/)

  const posixBlocked = await hook(
    { name: 'pwsh', arguments: { command: 'Get-Item /c/Users/demo' } },
    async () => ({ kind: 'allow' }),
  )
  assert.equal(posixBlocked.kind, 'deny')
  assert.match(posixBlocked.reason, /C:\\Users/)

  const sourceBlocked = await hook(
    { name: 'pwsh', arguments: { command: 'source script.sh' } },
    async () => ({ kind: 'allow' }),
  )
  assert.equal(sourceBlocked.kind, 'deny')
  assert.match(sourceBlocked.reason, /\. \.\\script\.ps1/)

  const passed = await hook(
    { name: 'pwsh', arguments: { command: 'Get-ChildItem -Path C:\\Temp' } },
    async () => ({ kind: 'allow' }),
  )
  assert.deepEqual(passed, { kind: 'allow' })

  let delegated = false
  const unrelated = await hook(
    { name: 'bash', arguments: { command: 'echo $HOME' } },
    async () => {
      delegated = true
      return { kind: 'allow' }
    },
  )
  assert.equal(delegated, true)
  assert.deepEqual(unrelated, { kind: 'allow' })
})

test('does not mount the guard or prompt by default on non-Windows', () => {
  const events = []
  const sections = []
  apply({
    on(event) { events.push(event) },
    systemPrompt: { section(section) { sections.push(section) } },
  }, { platform: 'linux' })
  assert.deepEqual(events, [])
  assert.deepEqual(sections, [])
})

test('can keep the hook while disabling prompt injection', () => {
  const events = []
  const sections = []
  apply({
    on(event) { events.push(event) },
    systemPrompt: { section(section) { sections.push(section) } },
  }, { platform: 'win32', prompt: false })
  assert.deepEqual(events, ['tools/pre-execute'])
  assert.deepEqual(sections, [])
})
