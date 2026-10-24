# Video Extractor 실행기: 서버가 꺼져 있으면 창 없이 켜고, 브라우저로 화면을 연다.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$port = if ($env:PORT) { $env:PORT } else { 5280 }
$url = "http://127.0.0.1:$port/"

function Show-Error([string]$text) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show($text, 'Video Extractor', 'OK', 'Error') | Out-Null
}

function Test-Server {
  try { Invoke-WebRequest -UseBasicParsing -Uri "${url}api/state" -TimeoutSec 2 | Out-Null; return $true } catch { return $false }
}

if (-not (Test-Server)) {
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $node -and (Test-Path "$env:ProgramFiles\nodejs\node.exe")) { $node = "$env:ProgramFiles\nodejs\node.exe" }
  if (-not $node) { Show-Error "Node.js 22 이상이 필요합니다.`nhttps://nodejs.org 에서 설치한 뒤 다시 실행하세요."; exit 1 }

  $data = Join-Path $root 'data'
  New-Item -ItemType Directory -Force $data | Out-Null
  Start-Process -FilePath $node -ArgumentList 'server.mjs' -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $data 'server.log') -RedirectStandardError (Join-Path $data 'server.err.log')

  $deadline = (Get-Date).AddSeconds(20)
  while (-not (Test-Server)) {
    if ((Get-Date) -gt $deadline) { Show-Error "서버를 시작하지 못했습니다.`n$data\server.err.log 를 확인하세요."; exit 1 }
    Start-Sleep -Milliseconds 300
  }
}

Start-Process $url
