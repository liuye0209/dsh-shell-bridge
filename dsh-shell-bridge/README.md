# DSH Shell Bridge Pro

这是一个面向 Windows 原生 DSH + PowerShell 执行器的 Cordis hook plugin。它复用 DSH 已有的 `pwsh` 工具，只在 `tools/pre-execute` 检查模型发出的命令；插件不会启动第二个 Shell、不会调用 `child_process`，也不会改写已记录的参数。

护栏默认只在 Windows (`process.platform === 'win32'`) 启用。它识别以下明确冲突：

- `$HOME`：追问并提示 `$env:USERPROFILE`；PowerShell 版本不同会影响 `$HOME` 可用性，因此保守地走 `ask`。
- `/c/...`：拒绝并提示 `C:\Users\...` 等原生路径。
- `source script.sh`：拒绝并提示 `. .\script.ps1`，同时要求确认脚本确实是 PowerShell 脚本。
- `&&`：追问 PowerShell 5.1 兼容性，建议 `;` 或确认使用 PowerShell 7+。

合法命令例如 `Get-ChildItem -Path C:\Temp` 会直接放行。未知工具、没有可识别命令字段的调用也会直接交给后续 Hook。

## 安装

在 DSH 项目中执行：

```powershell
dsh plugin --profile web add .\dsh-shell-bridge
```

也可以安装发布包：

```powershell
dsh plugin --profile web add dsh-shell-bridge
```

安装后重启原来的 DSH Web 进程。Bundle 通过 `package.json` 的 `dsh.bundle.patch` 自动插入 `cordis.patch.yml`；不需要修改 DSH 官方包源码。

## 配置

Bundle 默认配置为：

```yaml
- id: dsh-shell-bridge
  config:
    prompt: true
```

省略 `enabled` 会按宿主平台判断：Windows 默认启用，其他平台默认关闭。

在 profile 的 `cordis.patch.yml` 中替换这一行的完整 `config` 即可关闭提示词或整个护栏：

```yaml
- id: dsh-shell-bridge
  config:
    enabled: false
    prompt: false
```

`toolNames` 可用于适配自定义 PowerShell 工具名，例如 `['pwsh', 'my-pwsh']`。非 Windows 环境默认关闭；如确实在兼容的模拟宿主中需要启用，可显式设置 `enabled: true`。

## 测试

无需安装依赖，在插件目录运行：

```powershell
npm test
```

测试覆盖 `$HOME`、`/c/`、`source`、`&&`、合法 PowerShell 命令，以及真实 Cordis Hook 形态的 `allow`/非 `allow` 决策。
