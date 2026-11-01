# DSH Shell Bridge

DSH Shell Bridge 是一个面向 Windows 原生 DeepSeek Harness（DSH）和 PowerShell 执行器的兼容护栏插件。

它通过 DSH 的 `tools/pre-execute` 扩展点检查模型生成的 PowerShell 命令，识别常见的 Bash/PowerShell 语法冲突，并在执行前给出修正提示。插件复用 DSH 官方 Shell Runtime，不启动额外的 Shell 后端，也不修改 DSH 官方源码。

## 支持的检查

- `$HOME`：提示使用 `$env:USERPROFILE`
- `/c/...` 等 POSIX 路径：提示使用 `C:\Users\...` 原生 Windows 路径
- `source script.sh`：提示使用 `. .\script.ps1`
- `&&`：提示确认 PowerShell 7，或改用 `;`
- 合法 PowerShell 命令，例如 `Get-ChildItem -Path C:\Temp`，会正常放行

护栏默认只在 Windows 启用，提示词可以通过配置关闭。

## 目录

插件实现位于 [`dsh-shell-bridge/`](./dsh-shell-bridge/)：

- `index.js`：Cordis `apply(ctx)` 插件入口和检测逻辑
- `package.json`：包元数据和 DSH bundle 声明
- `cordis.patch.yml`：自动插入 DSH profile 的配置
- `test/index.test.js`：最小可复现测试

## 安装

在 DSH profile 中安装本地插件：

```powershell
dsh plugin --profile web add .\dsh-shell-bridge
```

也可以安装 GitHub 仓库：

```powershell
dsh plugin --profile web add github:liuye0209/dsh-shell-bridge
```

安装后重启原来的 DSH Web 进程。

## 测试

```powershell
cd .\dsh-shell-bridge
npm test
```

## 许可证

本项目使用 [MIT License](./LICENSE)。
