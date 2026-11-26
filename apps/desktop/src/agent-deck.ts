import { execFile, spawn } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'

// Read Unicode install paths from both current and older per-user installers.
const detect = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
function CheckExe($candidate) {
  if ($candidate -and ($candidate -match '^(?:[A-Za-z]:\\|\\\\)') -and
      [IO.Path]::GetFileName($candidate) -eq 'AgentDeck.exe' -and [IO.File]::Exists($candidate)) {
    Write-Output $candidate
    exit 0
  }
}
$proto = Get-Item 'HKCU:\Software\Classes\agentdeck\shell\open\command' -ErrorAction SilentlyContinue
if ($proto -and $proto.GetValue('') -match '^"([^"]+)"') { CheckExe $Matches[1] }
foreach ($key in Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue) {
  if ($key.GetValue('DisplayName') -notmatch '^AgentDeck(?:\s|$)') { continue }
  $dir = $key.GetValue('InstallLocation')
  if ($dir) { CheckExe (Join-Path $dir 'AgentDeck.exe') }
  $icon = $key.GetValue('DisplayIcon')
  if ($icon) { CheckExe (($icon -replace ',\s*-?\d+$','').Trim('"')) }
}
CheckExe (Join-Path $env:LOCALAPPDATA 'Programs\AgentDeck\AgentDeck.exe')
`

export async function openAgentDeck(openExternal: (url: string) => Promise<void>): Promise<'opened' | 'download'> {
  if (process.platform !== 'win32' || !process.env.SystemRoot) throw new Error('Windows required')
  const powershell = join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const { stdout } = await promisify(execFile)(powershell, ['-NoProfile', '-NonInteractive', '-Command', detect], { windowsHide: true, timeout: 15000 })
  const exe = stdout.trim()
  if (!exe) {
    await openExternal('https://agentdeck.haierxj.cn/')
    return 'download'
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(exe, ['--from', 'hibuddy', '--theme', 'haier', '--focus'], { detached: true, stdio: 'ignore' })
    child.once('error', reject)
    child.once('spawn', () => { child.unref(); resolve() })
  })
  return 'opened'
}
