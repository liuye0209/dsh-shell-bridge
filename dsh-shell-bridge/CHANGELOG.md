# Changelog

## 1.2.0 - 2026-11-05

- Add profile metadata normalization with safe fallback and source/status reporting.
- Add priority-ordered Rule Registry with duplicate detection and exception isolation.
- Add pure parser adapter and conservative incomplete PowerShell syntax findings.
- Add repeatable tokenizer benchmark and non-destructive DSH CLI environment check.
- Add CI manual trigger, PowerShell version check, benchmark smoke, and acceptance documentation.

## 1.1.0 - 2026-11-04

- Treat `$HOME` as a valid PowerShell automatic variable and remove the old replacement guidance.
- Add `powershellVersion` support for `5.1`, `7`, and `unknown` without starting a second shell.
- Improve lexical handling for quoted strings, comments, URLs, here-strings, and multiline `source` checks.
- Add explicit deny versus uncertain ask decisions for POSIX-looking paths.
- Add unified rule metadata: severity, confidence, decision, message, and suggestion.
- Add `promptMode: minimal|full|off` while keeping the legacy `prompt` option.
- Add Windows/Linux CI and root package forwarding so GitHub installation matches the package location.

## 0.1.1

- Initial compatibility guard improvements and expanded tests.
