import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export async function runBenchmark({ cases = [], tokenizer } = {}) {
  const safeCases = Array.isArray(cases) ? cases : []
  if (!tokenizer || typeof tokenizer.count !== 'function') {
    return {
      status: 'BLOCKED',
      tokenizer: { source: null, version: null, metric: null },
      cases: safeCases.map(({ id, category }) => ({ id, category: category ?? null, status: 'BLOCKED' })),
      summary: null,
    }
  }

  const results = safeCases.map((item, index) => {
    const original = String(item.prompt ?? '')
    const optimized = String(item.optimizedPrompt ?? original)
    const originalTokens = tokenizer.count(original)
    const optimizedTokens = tokenizer.count(optimized)
    const reduction = originalTokens - optimizedTokens
    return {
      id: item.id ?? `case-${index + 1}`,
      category: item.category ?? null,
      originalTokens,
      optimizedTokens,
      reduction,
      reductionRate: originalTokens === 0 ? 0 : Number(((reduction / originalTokens) * 100).toFixed(2)),
    }
  })
  const totalOriginal = results.reduce((sum, item) => sum + item.originalTokens, 0)
  const totalOptimized = results.reduce((sum, item) => sum + item.optimizedTokens, 0)
  return {
    status: 'PASS',
    tokenizer: { source: tokenizer.source ?? 'unknown', version: tokenizer.version ?? 'unknown', metric: tokenizer.metric ?? 'unknown' },
    cases: results,
    summary: {
      originalTokens: totalOriginal,
      optimizedTokens: totalOptimized,
      reduction: totalOriginal - totalOptimized,
      reductionRate: totalOriginal === 0 ? 0 : Number((((totalOriginal - totalOptimized) / totalOriginal) * 100).toFixed(2)),
      averageReductionRate: results.length === 0 ? 0 : Number((results.reduce((sum, item) => sum + item.reductionRate, 0) / results.length).toFixed(2)),
    },
  }
}

async function cli() {
  const casesPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'cases.json')
  const cases = JSON.parse(await readFile(casesPath, 'utf8'))
  const report = await runBenchmark({ cases })
  const outIndex = process.argv.indexOf('--out')
  if (outIndex >= 0 && process.argv[outIndex + 1]) {
    await writeFile(path.resolve(process.argv[outIndex + 1]), `${JSON.stringify(report, null, 2)}\n`)
  } else {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await cli()
