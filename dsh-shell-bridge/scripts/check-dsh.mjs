import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

async function defaultResolveCommand() {
  const lookup = process.platform === 'win32' ? 'where.exe' : 'which'
  try {
    const result = await execFileAsync(lookup, ['dsh'], { windowsHide: true })
    return result.stdout.trim().split(/\r?\n/)[0] || undefined
  } catch {
    return undefined
  }
}

async function defaultRunVersion(command) {
  try {
    const result = await execFileAsync(command, ['--version'], { windowsHide: true })
    return { code: 0, stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    return { code: error.code === undefined ? 1 : error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? String(error) }
  }
}

export async function checkDshEnvironment({ resolveCommand = defaultResolveCommand, runVersion = defaultRunVersion } = {}) {
  const command = await resolveCommand()
  if (!command) return { status: 'BLOCKED', reason: 'dsh-cli-missing', command: null, version: null }
  const result = await runVersion(command)
  if (result.code !== 0) return { status: 'FAIL', reason: 'dsh-version-failed', command, version: null, detail: result.stderr }
  const version = String(result.stdout ?? '').trim().split(/\r?\n/)[0] || 'unknown'
  return { status: 'PASS', reason: null, command, version }
}

if (process.argv[1] && process.argv[1].endsWith('check-dsh.mjs')) {
  const report = await checkDshEnvironment()
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}
