# 与 GitHub Copilot 命令行界面 (CLI) 一起使用挂钩

在代理执行期间，在关键点使用自定义 shell 命令扩展 GitHub Copilot 代理行为。

挂钩允许你在代理执行过程中通过在关键点执行自定义 shell 命令来扩展和自定义代理的行为 GitHub Copilot 。 有关挂钩的概念性概述（包括可用挂钩触发器的详细信息），请参阅 [关于钩子 GitHub Copilot](/zh/copilot/concepts/agents/hooks)。

## 先决条件

**For Windows only：** 本文中的示例使用 PowerShell。 如果使用 Windows，则必须在 PATH 中安装 PowerShell 7.0 或更高版本。 可以通过在终端中运行 `pwsh --version` 来检查 PowerShell 版本。 若要安装 PowerShell，请运行 `winget install Microsoft.PowerShell`，然后重启终端。

## 创建仓库级钩子

1. 在存储库的文件夹中创建一个新 `NAME.json` 文件（其中 `NAME` 描述了文件 `.github/hooks/` 的目的）。

2. 在文本编辑器中，复制并粘贴以下挂钩模板。 从 `hooks` 数组中删除您不打算使用的任何挂钩。

   ```json copy
   {
     "version": 1,
     "hooks": {
       "sessionStart": [...],
       "sessionEnd": [...],
       "userPromptSubmitted": [...],
       "preToolUse": [...],
       "postToolUse": [...],
       "errorOccurred": [...]
     }
   }
   ```

3. 在`bash` 和 `powershell` 键下配置挂钩语法，或直接引用已创建的脚本文件。

   > \[!NOTE]
   > 包括 `bash` 键（包含适用于 Linux 和 macOS 的脚本）和 `powershell` 键（适用于 Windows 脚本），以允许挂钩在所有三个操作系统上运行。
   > Copilot 根据用户的操作系统使用相应的密钥。

   * 此示例运行一个脚本，该脚本使用 `sessionStart` 挂钩将会话的开始日期输出到日志文件：

     ```json copy
     "sessionStart": [
       {
         "type": "command",
         "bash": "echo \"Session started: $(date)\" >> logs/session.log",
         "powershell": "Add-Content -Path logs/session.log -Value \"Session started: $(Get-Date)\"",
         "cwd": ".",
         "timeoutSec": 10
       }
     ],
     ```

   * 此示例调用外部 `log-prompt` 脚本：

     ```json copy
     "userPromptSubmitted": [
       {
         "type": "command",
         "bash": "./scripts/log-prompt.sh",
         "powershell": "./scripts/log-prompt.ps1",
         "cwd": "scripts",
         "env": {
           "LOG_LEVEL": "INFO"
         }
       }
     ],
     ```

     有关代理会话中的输入 JSON 以及示例脚本的完整参考，请参阅 [GitHub Copilot 挂钩参考](/zh/copilot/reference/hooks-reference)。

4. 将文件提交到存储库，并将其合并到默认分支中。 你的挂钩现在将在智能体会话期间运行。

## 创建用户级钩子

用户级挂钩的配置就像存储库级挂钩一样，但挂钩文件存储在本地，位于主目录下方。

macOS 和 Windows 以下示例演示如何配置挂钩，这些挂钩将在 CLI 完成响应提示时以及退出 Copilot 命令行界面（CLI）时播放声音并显示消息框。 适用于 Linux 的挂钩类似于 macOS 示例，但使用 Linux 工具播放声音和显示消息。

### macOS 的用户级示例

1. 在`~/.copilot/hooks/`中创建一个名为`notification-hooks.json`的文件。

   > \[!NOTE]
   > 如果设置了 `COPILOT_HOME`，请在 `$COPILOT_HOME/hooks/` 中创建该文件。

2. 将以下 JSON 复制并粘贴到文件中：

   ```json copy
   {
     "version": 1,
     "hooks": {
       "agentStop": [
         {
           "type": "command",
           "bash": "osascript -e 'do shell script \"afplay /System/Library/Sounds/Funk.aiff &> /dev/null &\"' -e 'display dialog \"Agent stopped.\" with title \"Hook-generated message\" buttons {\"OK\"} default button \"OK\"'",
           "timeoutSec": 5
         }
       ],
       "sessionEnd": [
         {
           "type": "command",
           "bash": "osascript -e 'do shell script \"afplay /System/Library/Sounds/Funk.aiff &> /dev/null &\"' -e 'display dialog \"Session ended.\" with title \"Hook-generated message\" buttons {\"OK\"} default button \"OK\"'",
           "timeoutSec": 5
         }
       ]
     }
   }
   ```

3. 启动或重启 Copilot 命令行界面（CLI）。

   > \[!NOTE]
   > CLI 启动时会加载对挂钩配置的更改。

4. 输入提示并检查是否听到声音，并在代理完成响应时以及退出 CLI 时看到消息框。

5. 删除`notification-hooks.json`文件以移除这些挂钩。

### Windows的用户级示例

1. 在 `%USERPROFILE%\.copilot\hooks\` 中创建一个名为 `notification-hooks.json` 的文件。

   > \[!NOTE]
   > 如果设置了 `COPILOT_HOME`，请在 `%COPILOT_HOME%\hooks\` 中创建该文件。

2. 将以下 JSON 复制并粘贴到文件中：

   ```json copy
   {
     "version": 1,
     "hooks": {
       "agentStop": [
         {
           "type": "command",
           "powershell": "Add-Type -AssemblyName System.Windows.Forms; [System.Media.SystemSounds]::Asterisk.Play(); [System.Windows.Forms.MessageBox]::Show('Agent stopped.', 'Hook-generated message') | Out-Null",
           "timeoutSec": 5
         }
       ],
       "sessionEnd": [
         {
           "type": "command",
           "powershell": "Add-Type -AssemblyName System.Windows.Forms; [System.Media.SystemSounds]::Asterisk.Play(); [System.Windows.Forms.MessageBox]::Show('Session ended.', 'Hook-generated message') | Out-Null",
           "timeoutSec": 5
         }
       ]
     }
   }
   ```

3. 启动或重启 Copilot 命令行界面（CLI）。

   > \[!NOTE]
   > CLI 启动时会加载对挂钩配置的更改。

4. 输入提示并检查是否听到声音，并在代理完成响应时以及退出 CLI 时看到消息框。

5. 删除`notification-hooks.json`文件以移除这些挂钩。

## 故障排除

如果使用挂钩遇到问题，请使用下表进行故障排除。

| 問题        | Action                                                                                                                                                                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 钩子没有运行    | <ul><li>验证 JSON 文件是否在 `.github/hooks/` 目录中。</li><li>检查有效的 JSON 语法（例如 `jq .  hooks.json`）。</li><li>确保 `version: 1` 已在 `hooks.json` 文件中指定。</li><li>验证从挂钩调用的脚本是否可执行 （`chmod +x script.sh`）</li><li>检查该脚本是否有适当的 shebang（例如，`#!/bin/bash`）</li></ul> |
| 挂钩超时      | <ul><li>默认超时值为 30 秒。 如有需要，增加配置中的 `timeoutSec`。</li><li>通过避免不必要的作来优化脚本性能。</li></ul>                                                                                                                                                              |
| JSON 输出无效 | <ul><li>确保输出位于单行上。</li><li>在 Unix 上，用于 `jq -c` 压缩和验证 JSON 输出。</li><li>在 Windows 上，使用 PowerShell 中的 `ConvertTo-Json -Compress` 命令执行相同的操作。</li></ul>                                                                                              |

## 调试

可以使用以下方法调试挂钩：

* 在脚本中**启用详细日志记录**以检查输入数据和跟踪脚本执行。

  ```shell copy
  #!/bin/bash
  set -x  # Enable bash debug mode
  INPUT=$(cat)
  echo "DEBUG: Received input" >&2
  echo "$INPUT" >&2
  # ... rest of script
  ```

* 在本地测试挂钩的方法是，将测试输入通过管道传递到挂钩，以验证其行为\*\*\*\*。

  ```shell copy
  # Create test input
  echo '{"timestamp":1704614400000,"cwd":"/tmp","toolName":"bash","toolArgs":"{\"command\":\"ls\"}"}' | ./my-hook.sh

  # Check exit code
  echo $?

  # Validate output is valid JSON
  ./my-hook.sh | jq .
  ```

## 延伸阅读

* [GitHub Copilot 挂钩参考](/zh/copilot/reference/hooks-reference)
* [关于 GitHub Copilot 云代理](/zh/copilot/concepts/agents/cloud-agent/about-cloud-agent)
* [关于 GitHub Copilot CLI](/zh/copilot/concepts/agents/about-copilot-cli)
* [配置开发环境](/zh/copilot/how-tos/use-copilot-agents/cloud-agent/customize-the-agent-environment)