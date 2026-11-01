/**
 * DSH Shell Bridge: a small, conservative PowerShell compatibility guard.
 *
 * This module intentionally does not execute or rewrite commands. DSH owns
 * shell execution; this plugin only participates in tools/pre-execute.
 */

export const name = 'dsh-shell-bridge'
export const inject = ['tools', 'systemPrompt']

const DEFAULT_TOOL_NAMES = Object.freeze([
  'pwsh',
  'powershell',
  'dsh-tool-pwsh',
  'tool-pwsh',
])

const GUIDANCE = [
  'Windows PowerShell compatibility guard: when calling the pwsh tool, use PowerShell syntax.',
  'Use `$env:USERPROFILE` instead of Bash `$HOME` when a user-profile path is needed.',
  'Use native Windows paths such as `C:\\Users\\name\\file.txt` instead of `/c/Users/name/file.txt`.',
  'Use `. .\\script.ps1` to dot-source a PowerShell script; `source script.sh` is Bash syntax.',
  'PowerShell 5.1 may reject `&&`; prefer `;` unless the selected executor is known to be PowerShell 7+.',
].join(' ')

/** Return a command-like string from the argument shapes used by DSH shell tools. */
export function commandText(args) {
  if (typeof args === 'string') return args
  if (args === null || typeof args !== 'object') return undefined
  for (const key of ['command', 'cmd', 'script', 'input']) {
    if (typeof args[key] === 'string') return args[key]
  }
  return undefined
}

function withoutComments(text) {
  let output = ''
  let quote
  let escaped = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]
    if (quote === "'") {
      output += char
      if (char === "'" && next === "'") {
        output += next
        index += 1
      } else if (char === "'") quote = undefined
      continue
    }
    if (quote === '"') {
      output += char
      if (escaped) escaped = false
      else if (char === '`') escaped = true
      else if (char === '"') quote = undefined
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      output += char
      continue
    }
    if (char === '#') {
      while (index < text.length && text[index] !== '\n') index += 1
      output += '\n'
      continue
    }
    output += char
  }
  return output
}

function withoutQuotesAndComments(text) {
  const source = withoutComments(text)
  let output = ''
  let quote
  let escaped = false

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    const next = source[index + 1]
    if (quote === "'") {
      if (char === "'" && next === "'") index += 1
      else if (char === "'") quote = undefined
      continue
    }
    if (quote === '"') {
      if (escaped) escaped = false
      else if (char === '`') escaped = true
      else if (char === '"') quote = undefined
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      // Keep one token placeholder so `source "script.ps1"` is still
      // recognized, while operators inside quoted text stay invisible.
      output += 'x'
    } else output += char
  }
  return output
}

function hasHomeVariable(text) {
  // `$HOME` in a single-quoted PowerShell string is literal text.
  const code = withoutComments(text).replace(/'(?:''|[^'])*'/g, ' ')
  return /(^|[^A-Za-z0-9_])\$HOME\b/.test(code)
}

function hasPosixDrivePath(text) {
  // Require a one-letter component so URLs such as https://example.com/c/ do
  // not look like shell paths.
  return /(?:^|[\s"'=(:,])\/[A-Za-z](?:\/[^\s"'`;,)]*)+/.test(withoutComments(text))
}

function hasBashSource(text) {
  return /(?:^|[;&|]\s*)source\s+[^\s;&|]+/.test(withoutQuotesAndComments(text))
}

function hasAndAnd(text) {
  return /&&/.test(withoutQuotesAndComments(text))
}

/** Analyze one command without exposing the command itself in a decision. */
export function analyzeCommand(command) {
  if (typeof command !== 'string' || command.trim() === '') return []
  const findings = []
  if (hasHomeVariable(command)) {
    findings.push({
      id: 'home-variable',
      decision: 'ask',
      message: '检测到 Bash 风格的 `$HOME`。请改用 `$env:USERPROFILE`。',
    })
  }
  if (hasPosixDrivePath(command)) {
    findings.push({
      id: 'posix-path',
      decision: 'deny',
      message: '检测到 `/c/...` POSIX 路径。请改用原生 Windows 路径，例如 `C:\\Users\\...`。',
    })
  }
  if (hasBashSource(command)) {
    findings.push({
      id: 'source-command',
      decision: 'deny',
      message: '检测到 Bash 的 `source` 命令。PowerShell 脚本应使用 `. .\\script.ps1`，并确认脚本是 PowerShell 格式。',
    })
  }
  if (hasAndAnd(command)) {
    findings.push({
      id: 'and-and',
      decision: 'ask',
      message: '检测到 `&&`。PowerShell 5.1 可能不支持它；请改用 `;`，或确认执行器是 PowerShell 7+。',
    })
  }
  return findings
}

function isPowerShellTool(name, toolNames) {
  return typeof name === 'string' && toolNames.some((candidate) => candidate.toLowerCase() === name.toLowerCase())
}

function decisionFor(findings) {
  if (findings.length === 0) return { kind: 'allow' }
  const reason = `Windows PowerShell 兼容护栏：${findings.map((finding) => finding.message).join(' ')} 不会自动改写命令，请修正后重试。`
  if (findings.some((finding) => finding.decision === 'deny')) {
    return {
      kind: 'deny',
      reason,
      info: {
        name: 'DshPowerShellCompatibilityError',
        code: 'DSH_PWSH_BASH_SYNTAX',
        reason,
      },
    }
  }
  return {
    kind: 'ask',
    reason: 'Bash 风格语法可能与当前 PowerShell 版本不兼容。',
    displayReason: { en: reason, zh: reason },
  }
}

function resolveConfig(config = {}) {
  const platformIsWindows = (config.platform ?? process.platform) === 'win32'
  const enabled = config.enabled === undefined ? platformIsWindows : Boolean(config.enabled)
  const toolNames = Array.isArray(config.toolNames) && config.toolNames.length > 0
    ? config.toolNames.filter((value) => typeof value === 'string')
    : DEFAULT_TOOL_NAMES
  return {
    enabled,
    prompt: config.prompt === undefined ? enabled : Boolean(config.prompt),
    toolNames,
  }
}

/** Cordis plugin entry point. */
export function apply(ctx, config = {}) {
  const resolved = resolveConfig(config)
  if (!resolved.enabled) return

  ctx.on('tools/pre-execute', async (exec, next) => {
    if (!isPowerShellTool(exec?.name, resolved.toolNames)) return next()
    const decision = decisionFor(analyzeCommand(commandText(exec?.arguments)))
    if (decision.kind === 'allow') return next()
    return decision
  })

  if (resolved.prompt && ctx.systemPrompt?.section) {
    ctx.systemPrompt.section({
      name: 'dsh-shell-bridge:powershell-guidance',
      order: 9500,
      text: GUIDANCE,
    })
  }
}

export { DEFAULT_TOOL_NAMES, GUIDANCE }
