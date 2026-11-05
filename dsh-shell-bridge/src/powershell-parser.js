function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function fallbackScan(text) {
  const tokens = []
  const errors = []
  const stack = []
  let quote = null
  let hereString = null
  let escaped = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]
    if (hereString) {
      if (char === hereString && next === '@') {
        hereString = null
        index += 1
      }
      continue
    }
    if (quote) {
      if (quote === '"' && escaped) {
        escaped = false
      } else if (quote === '"' && char === '`') {
        escaped = true
      } else if (char === quote) {
        if (quote === "'" && next === "'") index += 1
        else quote = null
      }
      continue
    }
    if (char === '<' && next === '#') {
      const end = text.indexOf('#>', index + 2)
      if (end < 0) errors.push({ message: 'unterminated block comment' })
      index = end < 0 ? text.length : end + 1
      continue
    }
    if (char === '#' && (index === 0 || /\s/.test(text[index - 1]))) {
      const end = text.indexOf('\n', index + 1)
      index = end < 0 ? text.length : end
      continue
    }
    if (char === '@' && (next === '"' || next === "'")) {
      hereString = next
      index += 1
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if ('([{'.includes(char)) stack.push(char)
    if (')]}'.includes(char)) {
      const expected = { ')': '(', ']': '[', '}': '{' }[char]
      if (stack.at(-1) === expected) stack.pop()
      else errors.push({ message: `unexpected ${char}` })
    }
  }

  if (quote) errors.push({ message: 'unterminated string' })
  if (hereString) errors.push({ message: 'unterminated here-string' })
  if (stack.length > 0) errors.push({ message: 'unclosed delimiter' })
  return { tokens, errors }
}

export function createParserAdapter(candidate) {
  if (isRecord(candidate) && typeof candidate.parse === 'function') {
    return {
      available: true,
      parse: candidate.parse.bind(candidate),
      name: 'injected',
    }
  }
  return {
    available: false,
    parse: fallbackScan,
    name: 'fallback-scanner',
  }
}

export function scanPowerShell(text, parserAdapter) {
  const adapter = createParserAdapter(parserAdapter)
  const result = adapter.parse(String(text ?? ''))
  const parsed = isRecord(result) ? result : {}
  const errors = Array.isArray(parsed.errors) ? parsed.errors : []
  return {
    tokens: Array.isArray(parsed.tokens) ? parsed.tokens : [],
    syntax: { complete: errors.length === 0, errors },
    parser: adapter.name,
  }
}

export { fallbackScan }
