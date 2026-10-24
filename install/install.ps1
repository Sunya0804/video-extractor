# Video Extractor 설치: 아이콘 생성, 바탕화면·시작 메뉴 바로가기 만들기
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$ico = Join-Path $PSScriptRoot 'icon.ico'
$launcher = Join-Path $PSScriptRoot 'launcher.ps1'

if (-not (Test-Path $ico)) { & (Join-Path $PSScriptRoot 'make-icon.ps1') }

$shell = New-Object -ComObject WScript.Shell
$targets = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Video Extractor.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'Video Extractor.lnk')
)
foreach ($lnk in $targets) {
  $s = $shell.CreateShortcut($lnk)
  $s.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $s.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`""
  $s.WorkingDirectory = $root
  $s.IconLocation = "$ico,0"
  $s.WindowStyle = 7   # 최소화 상태로 시작(콘솔 깜빡임 최소화)
  $s.Description = '영상 추출기: yt-dlp → 페이지 스캔 → 헤드리스 브라우저'
  $s.Save()
  Write-Host "바로가기 생성: $lnk"
}
