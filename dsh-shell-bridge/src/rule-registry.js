const DECISIONS = new Set(['allow', 'ask', 'deny'])
const SEVERITIES = new Set(['low', 'medium', 'high'])
const CONFIDENCES = new Set(['low', 'medium', 'high'])

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isFinding(value) {
  return isRecord(value)
    && typeof value.id === 'string'
    && SEVERITIES.has(value.severity)
    && CONFIDENCES.has(value.confidence)
    && DECISIONS.has(value.decision)
    && typeof value.message === 'string'
    && typeof value.suggestion === 'string'
}

function normalizeResult(rule, result) {
  if (result === undefined || result === null || result === false) return []
  const values = Array.isArray(result) ? result : [result]
  if (!values.every(isFinding)) throw new TypeError(`rule ${rule.id} returned an invalid finding`)
  return values.map((value) => ({ ...value, ruleId: value.ruleId ?? value.id }))
}

function errorFinding(rule, error) {
  return {
    id: `rule-error:${rule.id}`,
    severity: 'medium',
    confidence: 'low',
    decision: 'ask',
    message: `规则 ${rule.id} 执行失败。`,
    suggestion: '请确认规则实现后重试。',
    error: error instanceof Error ? error.message : String(error),
  }
}

function validateRule(rule) {
  if (!isRecord(rule) || typeof rule.id !== 'string' || rule.id.trim() === '') {
    throw new TypeError('rule id must be a non-empty string')
  }
  if (!Number.isInteger(rule.priority)) throw new TypeError(`rule ${rule.id} priority must be an integer`)
  if (typeof rule.match !== 'function') throw new TypeError(`rule ${rule.id} match must be a function`)
}

export function createRuleRegistry(initialRules = []) {
  const rules = new Map()
  let sequence = 0

  const ordered = () => [...rules.values()]
    .sort((left, right) => right.priority - left.priority || left.sequence - right.sequence)
    .map(({ sequence: _sequence, ...rule }) => Object.freeze({ ...rule }))

  const registerRule = (rule) => {
    validateRule(rule)
    if (rules.has(rule.id)) throw new Error(`duplicate rule id: ${rule.id}`)
    rules.set(rule.id, { ...rule, sequence: sequence += 1 })
  }

  const unregisterRule = (id) => rules.delete(id)

  const evaluateOne = (rule, context) => {
    try {
      return normalizeResult(rule, rule.match(context))
    } catch (error) {
      return [errorFinding(rule, error)]
    }
  }

  const evaluateRulesSync = (context) => ordered().flatMap((rule) => evaluateOne(rule, context))

  const evaluateRules = async (context) => {
    const findings = []
    for (const rule of ordered()) {
      try {
        findings.push(...normalizeResult(rule, await rule.match(context)))
      } catch (error) {
        findings.push(errorFinding(rule, error))
      }
    }
    return findings
  }

  for (const rule of initialRules) registerRule(rule)

  return Object.freeze({
    registerRule,
    unregisterRule,
    listRules: ordered,
    evaluateRules,
    evaluateRulesSync,
  })
}

export { isFinding }
