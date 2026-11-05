# DSH Shell Bridge 1.2.0

DSH Shell Bridge is a conservative Cordis plugin for Windows DSH installations that use DSH's official PowerShell tool. It checks commands at `tools/pre-execute` and returns the existing `allow`/`ask`/`deny` hook decisions.

It never starts a shell, adds a shell backend, rewrites a command, or changes DSH's official runtime.

## Checks

- `$HOME` and `$env:USERPROFILE` are valid PowerShell variables and pass through.
- Explicit `/c/...` paths are denied with a native Windows path suggestion.
- A quoted POSIX-looking path is denied for known path commands and asked about when its meaning is uncertain.
- `source script.sh` at a real command position is denied; strings, comments, URLs, and here-strings are ignored.
- `&&` and `||` are allowed for PowerShell 7, asked about for PowerShell 5.1 or an unknown version.

Each finding has `id`, `severity`, `confidence`, `decision`, `message`, and `suggestion` fields. The scanner is intentionally small and conservative; it does not pretend to be a full PowerShell parser.

## Rule API

Third-party rules can be registered without changing the built-in checks:

```js
import { createBuiltinRuleRegistry } from 'dsh-shell-bridge'

const registry = createBuiltinRuleRegistry(profile, [{
  id: 'my-rule',
  priority: 50,
  match: ({ command }) => command.includes('Invoke-Expression')
    ? { id: 'my-rule', severity: 'high', confidence: 'high', decision: 'ask', message: '确认动态执行。', suggestion: '请人工确认。' }
    : [],
}])
```

Rule IDs must be unique. Higher `priority` runs first; equal priorities keep registration order. A throwing rule becomes a low-confidence `ask` finding and does not stop other rules. Use `unregisterRule(id)` and `listRules()` on the returned registry. `analyzeCommand(command, profile, registry)` accepts a custom registry while preserving the two-argument form.

## Parser and benchmark limits

The plugin accepts an injected pure parser adapter through `createParserAdapter({ parse })`. It never starts PowerShell to parse user input. Without an adapter it tracks quotes, here-strings, comments, delimiters, multiline boundaries, and incomplete expressions with a JavaScript fallback. Ambiguous or incomplete input receives `ask`.

`npm run benchmark` uses the fixed cases in `benchmark/cases.json`. It reports `PASS` only when a tokenizer adapter supplies source, version, metric, and a `count()` function; otherwise it reports `BLOCKED` without token estimates. `npm run check:dsh` only checks `dsh --version` and reports `BLOCKED` when the CLI is missing.

## Installation

The repository root is an installable forwarding bundle, so this command works from GitHub:

```powershell
dsh plugin --profile web add github:liuye0209/dsh-shell-bridge
```

For a local checkout, either command targets the same implementation:

```powershell
dsh plugin --profile web add .
dsh plugin --profile web add .\dsh-shell-bridge
```

Restart the existing DSH App Server after installation. The root `index.html` is unrelated and is retained.

## Configuration

The bundle patch enables the plugin and its full prompt by default. Configuration can be supplied in the DSH profile:

```yaml
- id: dsh-shell-bridge
  name: dsh-shell-bridge
  config:
    enabled: true
    promptMode: minimal # minimal | full | off
    powershellVersion: 7 # 5.1 | 7 | unknown
```

`promptMode: off` removes only the system prompt section; pre-execute checks remain active. The older `prompt: true|false` option remains supported (`true` maps to `full`, `false` to `off`). `shellProfile.version` and `shellProfile.capabilities` remain accepted for hosts that already provide profile metadata. Invalid values use the conservative unknown profile and full prompt defaults.

Other options are `enabled`, `toolNames`, `platform`, and `shellProfile`. The plugin is enabled by default only on `win32`; non-Windows hosts delegate unchanged unless explicitly enabled.

## Compatibility

| Input | PowerShell 7 | PowerShell 5.1 | Unknown |
| --- | --- | --- | --- |
| `$HOME`, `$env:USERPROFILE` | allow | allow | allow |
| `&&`, `||` | allow | ask | ask |
| `source script.sh` | deny | deny | deny |
| explicit `/c/Users/...` | deny | deny | deny |

The target range is DSH Cordis `>=4.0.0 <5.0.0`, DSH tools `>=0.1.0-rc.5 <0.3.0`, and DSH system prompt `>=0.1.0-rc.5 <0.3.0`. Node.js `22.19.0` or newer is required.

## Development

```powershell
cd .\dsh-shell-bridge
npm test
node --check index.js
npm pack --dry-run
```

The GitHub Actions matrix runs these checks on Windows and Linux. No `child_process` or alternate shell runtime is used.

## License

MIT.
