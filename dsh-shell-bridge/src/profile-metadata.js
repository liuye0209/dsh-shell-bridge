const UNKNOWN_CAPABILITIES = Object.freeze({ chainOperator: false, posixSource: false })

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function versionParts(value) {
  if (typeof value === 'number' && Number.isFinite(value)) value = String(value)
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (text.toLowerCase() === 'unknown') return { label: null, family: 'unknown' }
  if (/^5\.1(?:\.\d+)?$/.test(text)) return { label: '5.1', family: '5.1' }
  if (/^7(?:\.\d+)?(?:\.\d+)?$/.test(text)) return { label: text === '7' ? '7' : text, family: '7' }
  return undefined
}

function candidateSource(config = {}) {
  if (!isRecord(config)) return {}
  if (isRecord(config.profileMetadata)) return config.profileMetadata
  if (isRecord(config.shellProfile)) return config.shellProfile
  if (isRecord(config.profile)) return config.profile
  return {}
}

export function normalizeProfileMetadata(input = {}, fallback = {}) {
  const supplied = isRecord(input) ? input : {}
  const base = isRecord(fallback) ? fallback : {}
  const versionValue = supplied.version ?? base.version
  const parts = versionParts(versionValue)
  const platform = supplied.platform ?? base.platform ?? process.platform
  const shell = typeof supplied.shell === 'string' ? supplied.shell : 'powershell'
  const suppliedCapabilities = isRecord(supplied.capabilities) ? supplied.capabilities : {}
  const isPowerShell = shell.toLowerCase() === 'powershell'

  if (!isPowerShell || !parts || parts.family === 'unknown') {
    return {
      shell: 'powershell',
      version: null,
      platform,
      capabilities: { ...UNKNOWN_CAPABILITIES },
      confidence: 'unknown',
      source: supplied.source ?? base.source ?? 'fallback',
    }
  }

  return {
    shell: 'powershell',
    version: parts.label,
    platform,
    capabilities: {
      chainOperator: suppliedCapabilities.chainOperator === undefined
        ? parts.family === '7'
        : Boolean(suppliedCapabilities.chainOperator),
      posixSource: Boolean(suppliedCapabilities.posixSource),
    },
    confidence: 'detected',
    source: supplied.source ?? base.source ?? 'metadata',
  }
}

export function readProfileMetadata(ctx = {}, config = {}) {
  const safeConfig = isRecord(config) ? config : {}
  const configured = candidateSource(safeConfig)
  if (Object.keys(configured).length > 0) {
    const profile = normalizeProfileMetadata(configured, { platform: safeConfig.platform, source: 'config' })
    return { profile, source: 'config', status: profile.confidence === 'detected' ? 'detected' : 'partial' }
  }

  const shell = isRecord(ctx) && isRecord(ctx.shell) ? ctx.shell : undefined
  const hostMetadata = shell && (isRecord(shell.profile) ? shell.profile : isRecord(shell.metadata) ? shell.metadata : undefined)
  if (hostMetadata) {
    const profile = normalizeProfileMetadata(hostMetadata, { platform: safeConfig.platform, source: 'ctx.shell' })
    return { profile, source: 'ctx.shell', status: profile.confidence === 'detected' ? 'detected' : 'partial' }
  }

  return {
    profile: normalizeProfileMetadata({}, { platform: safeConfig.platform, source: 'fallback' }),
    source: 'fallback',
    status: 'missing',
  }
}

export { isRecord, versionParts }
