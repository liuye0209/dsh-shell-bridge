# DSH Shell Bridge

DSH Shell Bridge is a Cordis plugin that adds a conservative PowerShell compatibility guard to DSH's official `tools/pre-execute` hook. It does not modify DSH, start another shell, or rewrite commands.

Version 1.2 adds profile metadata normalization, an extensible rule registry, conservative incomplete-syntax detection, and repeatable benchmark/environment checks.

The installable package is available at the repository root and delegates to the implementation in [`dsh-shell-bridge/`](./dsh-shell-bridge/). The root [`index.html`](./index.html) is an unrelated project file and remains untouched by the plugin.

## Install

From GitHub:

```powershell
dsh plugin --profile web add github:liuye0209/dsh-shell-bridge
```

From a local checkout:

```powershell
dsh plugin --profile web add .
```

The nested bundle can also be installed directly:

```powershell
dsh plugin --profile web add .\dsh-shell-bridge
```

Restart the existing DSH App Server after installation.

## Behavior

- `$HOME` and `$env:USERPROFILE` are valid PowerShell variables.
- Explicit `/c/...` paths and Bash `source script.sh` are denied.
- Ambiguous path text is asked about; strings, comments, URLs, and here-strings are filtered by the lexer.
- `&&` and `||` are allowed for PowerShell 7 and asked about for PowerShell 5.1 or unknown versions.
- `promptMode` supports `minimal`, `full`, and `off`; `off` disables prompt injection while keeping pre-execute checks.

See [`dsh-shell-bridge/README.md`](./dsh-shell-bridge/README.md) for configuration, compatibility ranges, rule fields, and development commands.

## Test

```powershell
npm test
```

Run the V1.2 checks directly:

```powershell
npm run benchmark  # reports BLOCKED when the official tokenizer is unavailable
npm run check:dsh  # reports BLOCKED when the dsh CLI is unavailable
npm run pack:check
```

The Rule API is documented in [`dsh-shell-bridge/README.md`](./dsh-shell-bridge/README.md). The current machine does not have the `dsh` CLI or an official tokenizer, so those two checks must remain `BLOCKED` until the corresponding tools are installed.

This forwards to the plugin's Node.js test suite. Node.js `22.19.0` or newer is required.

## License

MIT.
