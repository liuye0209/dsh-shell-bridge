/**
 * DSH Shell Bridge: a conservative PowerShell compatibility guard.
 * DSH owns shell execution; this plugin only participates in tools/pre-execute.
 */

import { normalizeProfileMetadata, readProfileMetadata } from './src/profile-metadata.js'
import { createRuleRegistry } from './src/rule-registry.js'
import { scanPowerShell } from './src/powershell-parser.js'

export const name = 'dsh-shell-bridge'
export const inject = ['tools', 'systemPrompt']

const DEFAULT_TOOL_NAMES = Object.freeze(['pwsh', 'powershell', 'dsh-tool-pwsh', 'tool-pwsh'])
const OUTPUT_COMMANDS = new Set(['write-output', 'write-host', 'echo', 'printf', 'out-string'])
const PATH_COMMANDS = new Set([
  'cd', 'chdir', 'set-location', 'sl', 'push-location', 'pop-location',
  'get-item', 'gi', 'get-childitem', 'gci', 'dir', 'ls', 'get-content', 'gc',
  'set-content', 'sc', 'add-content', 'ac', 'remove-item', 'ri', 'copy-item',
  'ci', 'move-item', 'mi', 'test-path', 'resolve-path', 'join-path', 'split-path',
  'new-item', 'ni', 'invoke-item', 'ii', 'start-process', 'cat', 'cp', 'mv', 'rm',
])

const MINIMAL_GUIDANCE = [
  'Use PowerShell syntax with the official pwsh tool.',
  '$HOME is a valid PowerShell automatic variable.',
  'Use Windows paths such as C:\\Users\\name and . .\\script.ps1; confirm PowerShell 7 before using && or ||.',
].join(' ')

const FULL_GUIDANCE = [
  'Windows PowerShell compatibility guard: use PowerShell syntax with the official pwsh tool.',
  '$HOME and $env:USERPROFILE are valid PowerShell profile variables.',
  'Use native Windows paths such as C:\\Users\\name\\file.txt instead of /c/Users/name/file.txt.',
  'Use . .\\script.ps1 to dot-source a PowerShell script; source script.sh is Bash syntax.',
  'PowerShell 5.1 does not support && or ||; PowerShell 7+ supports both.',
].join(' ')

const GUIDANCE = FULL_GUIDANCE

const UNKNOWN_PROFILE = Object.freeze({
  shell: 'powershell',
  version: null,
  platform: 'unknown',
  capabilities: Object.freeze({ chainOperator: false, posixSource: false }),
  confidence: 'unknown',
})

const RULES = Object.freeze([
  Object.freeze({ id: 'posix-path', severity: 'high', confidence: 'high', decision: 'deny', message: '检测到明确的 /c/... POSIX 路径。', suggestion: '请改用原生 Windows 路径。' }),
  Object.freeze({ id: 'posix-path-uncertain', severity: 'medium', confidence: 'low', decision: 'ask', message: '字符串中出现可能的 /c/... 路径。', suggestion: '请确认它是数据文本还是要传给 PowerShell 的路径。' }),
  Object.freeze({ id: 'source-command', severity: 'high', confidence: 'high', decision: 'deny', message: '检测到 Bash 的 source 命令。', suggestion: '请使用 PowerShell 点源语法。' }),
  Object.freeze({ id: 'and-and', severity: 'medium', confidence: 'low', decision: 'ask', message: '无法确认 PowerShell 是否支持 &&。', suggestion: '请改用 ;，或确认执行器是 PowerShell 7+。' }),
  Object.freeze({ id: 'or-or', severity: 'medium', confidence: 'low', decision: 'ask', message: '无法确认 PowerShell 是否支持 ||。', suggestion: '请改用 ;，或确认执行器是 PowerShell 7+。' }),
])

/** Return a command-like string from the argument shapes used by DSH shell tools. */
export function commandText(args) {
  if (typeof args === 'string') return args
  if (args === null || typeof args !== 'object') return undefined
  for (const key of ['command', 'cmd', 'script', 'input']) {
    if (typeof args[key] === 'string') return args[key]
  }
  return undefined
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function resolveShellProfile(config = {}) {
  const safeConfig = isRecord(config) ? config : {}
  const supplied = isRecord(safeConfig.profileMetadata)
    ? safeConfig.profileMetadata
    : isRecord(safeConfig.shellProfile)
      ? safeConfig.shellProfile
      : isRecord(safeConfig.profile)
        ? safeConfig.profile
        : {}
  const profile = normalizeProfileMetadata({
    ...supplied,
    version: supplied.version ?? safeConfig.powershellVersion ?? safeConfig.shellVersion,
    platform: supplied.platform ?? safeConfig.platform,
  }, { platform: safeConfig.platform ?? process.platform })
  const { source, ...compatibilityProfile } = profile
  return compatibilityProfile
}

function blankLike(char) {
  return char === ' ' || char === '\t' || char === '\r' || char === '\n'
}

function scannerToken(value, type, commandStart, commandIndex) {
  return { value, type, commandStart, commandIndex }
}

/** Scan only enough PowerShell syntax to keep strings/comments out of rules. */
function scanCommand(text) {
  let index = 0
  let token = ''
  let commandStart = true
  let commandIndex = 0
  const tokens = []
  const flush = () => {
    if (!token) return
    tokens.push(scannerToken(token, 'word', commandStart, commandIndex))
    token = ''
    commandStart = false
  }
  const separator = () => {
    flush()
    commandStart = true
    commandIndex += 1
  }
  const addString = (value, type = 'string') => {
    flush()
    tokens.push(scannerToken(value, type, commandStart, commandIndex))
    commandStart = false
  }

  while (index < text.length) {
    const char = text[index]
    const next = text[index + 1]
    if (char === '<' && next === '#') {
      flush()
      const end = text.indexOf('#>', index + 2)
      const comment = end < 0 ? text.slice(index) : text.slice(index, end + 2)
      index = end < 0 ? text.length : end + 2
      continue
    }
    if (char === '#') {
      flush()
      const end = text.indexOf('\n', index + 1)
      const comment = end < 0 ? text.slice(index) : text.slice(index, end)
      index = end < 0 ? text.length : end
      continue
    }
    if (char === '@' && (next === "'" || next === '"') && (index === 0 || blankLike(text[index - 1]) || /[=(,:;|&{}]/.test(text[index - 1]))) {
      const terminator = next + '@'
      const end = text.indexOf(terminator, index + 2)
      const here = end < 0 ? text.slice(index + 2) : text.slice(index + 2, end)
      addString(here, 'here-string')
      index = end < 0 ? text.length : end + 2
      continue
    }
    if (char === "'" || char === '"') {
      const opening = char
      let value = ''
      index += 1
      while (index < text.length) {
        const current = text[index]
        const following = text[index + 1]
        if (opening === "'" && current === "'" && following === "'") {
          value += "''"
          index += 2
          continue
        }
        if (opening === '"' && current === '`' && following !== undefined) {
          value += current + following
          index += 2
          continue
        }
        if (current === opening) {
          index += 1
          break
        }
        value += current
        index += 1
      }
      addString(value)
      continue
    }
    if (blankLike(char)) {
      flush()
      if (char === '\n') separator()
      index += 1
      continue
    }
    if ((char === '&' && next === '&') || (char === '|' && next === '|')) {
      flush()
      const operator = char + next
      tokens.push(scannerToken(operator, 'operator', false, commandIndex))
      separator()
      index += 2
      continue
    }
    if (char === ';' || char === '|' || char === '&' || char === '{' || char === '}') {
      flush()
      tokens.push(scannerToken(char, 'operator', false, commandIndex))
      separator()
      index += 1
      continue
    }
    token += char
    index += 1
  }
  flush()
  return { tokens }
}

function isPosixPath(value) {
  return typeof value === 'string' && /^\/[A-Za-z](?:\/|$)/.test(value.trim())
}

function isUrl(value) {
  return typeof value === 'string' && /^(?:[A-Za-z][A-Za-z\d+.-]*:)?\/\//.test(value.trim())
}

function commandNames(tokens) {
  const names = new Map()
  for (const token of tokens) {
    if (token.commandStart && token.type === 'word') names.set(token.commandIndex, token.value.toLowerCase())
  }
  return names
}

function pathFindings(scanned) {
  const names = commandNames(scanned.tokens)
  const findings = []
  for (const token of scanned.tokens) {
    if (token.type === 'here-string' || !isPosixPath(token.value) || isUrl(token.value)) continue
    if (token.type === 'word') {
      findings.push(ruleFinding('posix-path', 'high', 'high', 'deny', '检测到明确的 /c/... POSIX 路径。', '请改用原生 Windows 路径，例如 C:\\Users\\...。'))
      continue
    }
    const command = names.get(token.commandIndex)
    if (OUTPUT_COMMANDS.has(command)) continue
    if (PATH_COMMANDS.has(command)) {
      findings.push(ruleFinding('posix-path', 'high', 'high', 'deny', '检测到路径命令使用 /c/... POSIX 路径。', '请改用原生 Windows 路径，例如 C:\\Users\\...。'))
    } else {
      findings.push(ruleFinding('posix-path-uncertain', 'medium', 'low', 'ask', '字符串中出现可能的 /c/... 路径。', '请确认它是数据文本还是要传给 PowerShell 的路径。'))
    }
  }
  return findings
}

function hasBashSource(tokens) {
  return tokens.some((token, index) => (
    token.type === 'word'
    && token.commandStart
    && token.value.toLowerCase() === 'source'
    && tokens[index + 1]
    && tokens[index + 1].type !== 'operator'
  ))
}

function ruleFinding(id, severity, confidence, decision, message, suggestion) {
  return { id, ruleId: id, severity, confidence, decision, message, suggestion }
}

function chainFinding(operator, profile) {
  const detected = profile.confidence === 'detected'
  const version = detected ? `PowerShell ${profile.version}` : '当前 PowerShell'
  const message = detected
    ? `${version} 不支持 ${operator}。`
    : `无法确认 PowerShell 版本；${operator} 可能不受支持。`
  return ruleFinding(
    operator === '&&' ? 'and-and' : 'or-or',
    'medium',
    detected ? 'high' : 'low',
    'ask',
    message,
    '请改用 ;，或确认执行器是 PowerShell 7+。',
  )
}

export function analyzeCommand(command, profile = resolveShellProfile(), registry) {
  if (typeof command !== 'string' || command.trim() === '') return []
  const resolvedProfile = profile?.capabilities ? profile : resolveShellProfile(profile)
  const scanned = scanCommand(command)
  const syntax = scanPowerShell(command).syntax
  const activeRegistry = registry ?? createBuiltinRuleRegistry(resolvedProfile)
  return activeRegistry.evaluateRulesSync({ command, profile: resolvedProfile, scanned, syntax })
}

export function createBuiltinRuleRegistry(profile = resolveShellProfile(), extraRules = []) {
  const registry = createRuleRegistry([
    {
      id: 'builtin-posix-path',
      priority: 100,
      match: ({ scanned }) => pathFindings(scanned),
    },
    {
      id: 'builtin-source-command',
      priority: 90,
      match: ({ scanned }) => hasBashSource(scanned.tokens)
        ? ruleFinding('source-command', 'high', 'high', 'deny', '检测到 Bash 的 source 命令。', 'PowerShell 脚本应使用 . .\\script.ps1，并确认脚本本身是 PowerShell 格式。')
        : [],
    },
    {
      id: 'builtin-chain-operators',
      priority: 80,
      match: ({ scanned }) => {
        if (profile.capabilities.chainOperator) return []
        const findings = []
        if (scanned.tokens.some((token) => token.value === '&&')) findings.push(chainFinding('&&', profile))
        if (scanned.tokens.some((token) => token.value === '||')) findings.push(chainFinding('||', profile))
        return findings
      },
    },
    {
      id: 'builtin-syntax-incomplete',
      priority: 70,
      match: ({ syntax }) => syntax?.complete === false
        ? ruleFinding('syntax-incomplete', 'medium', 'low', 'ask', 'PowerShell 输入可能不完整或解析失败。', '请补全引号、括号、脚本块或 Here-String 后重试。')
        : [],
    },
    ...extraRules,
  ])
  return registry
}

export function analyzeResult(command, profile = resolveShellProfile()) {
  const findings = analyzeCommand(command, profile)
  if (findings.length === 0) return { decision: 'allow', ruleId: null, message: null, confidence: 'high', findings }
  const first = findings.find((item) => item.decision === 'deny') ?? findings[0]
  return {
    decision: first.decision,
    ruleId: first.ruleId,
    message: first.message,
    confidence: first.confidence,
    findings,
  }
}

function isPowerShellTool(name, toolNames) {
  return typeof name === 'string' && toolNames.some((candidate) => candidate.toLowerCase() === name.toLowerCase())
}

function decisionFor(findings) {
  if (findings.length === 0) return { kind: 'allow' }
  const unique = [...new Map(findings.map((item) => [item.id, item])).values()]
  const reason = '[Shell Bridge] ' + unique.map((item) => `${item.message} ${item.suggestion}`).join(' ')
  if (unique.some((item) => item.decision === 'deny')) {
    const fullReason = reason + ' 不会自动改写命令，请修正后重试。'
    return {
      kind: 'deny',
      reason: fullReason,
      info: { name: 'DshPowerShellCompatibilityError', code: 'DSH_PWSH_BASH_SYNTAX', reason: fullReason },
    }
  }
  return { kind: 'ask', reason, displayReason: { en: reason, zh: reason } }
}

function promptMode(config) {
  if (['minimal', 'full', 'off'].includes(config.promptMode)) return config.promptMode
  if (config.prompt === false) return 'off'
  return 'full'
}

function resolveConfig(config = {}) {
  const safeConfig = isRecord(config) ? config : {}
  const platformIsWindows = (safeConfig.platform ?? process.platform) === 'win32'
  const enabled = safeConfig.enabled === undefined ? platformIsWindows : Boolean(safeConfig.enabled)
  const configuredNames = Array.isArray(safeConfig.toolNames)
    ? safeConfig.toolNames.filter((value) => typeof value === 'string' && value.trim())
    : []
  return {
    enabled,
    promptMode: promptMode(safeConfig),
    toolNames: configuredNames.length > 0 ? configuredNames : DEFAULT_TOOL_NAMES,
    shellProfile: resolveShellProfile(safeConfig),
    rules: Array.isArray(safeConfig.rules) ? safeConfig.rules : [],
  }
}

export function apply(ctx, config = {}) {
  const metadata = readProfileMetadata(ctx, config)
  const resolved = resolveConfig({ ...config, shellProfile: metadata.profile })
  if (!resolved.enabled) return
  const registry = createBuiltinRuleRegistry(resolved.shellProfile, resolved.rules)
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (!isPowerShellTool(exec?.name, resolved.toolNames)) return next()
    const decision = decisionFor(analyzeCommand(commandText(exec?.arguments), resolved.shellProfile, registry))
    if (decision.kind === 'allow') return next()
    return decision
  })
  if (resolved.promptMode !== 'off' && ctx.systemPrompt?.section) {
    ctx.systemPrompt.section({
      name: 'dsh-shell-bridge:powershell-guidance',
      order: 9500,
      text: resolved.promptMode === 'minimal' ? MINIMAL_GUIDANCE : FULL_GUIDANCE,
    })
  }
}

export { createRuleRegistry, DEFAULT_TOOL_NAMES, FULL_GUIDANCE, GUIDANCE, MINIMAL_GUIDANCE, RULES, UNKNOWN_PROFILE }
