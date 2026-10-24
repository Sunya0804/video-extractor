# 앱 아이콘 생성: public/icon.png(파비콘)와 install/icon.ico(바로가기)
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot

function New-IconPng([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::Transparent)
  $s = $size / 256.0
  # 둥근 사각형 배경
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $r = 56 * $s; $m = 8 * $s; $w = $size - 2 * $m
  $path.AddArc($m, $m, $r, $r, 180, 90)
  $path.AddArc($m + $w - $r, $m, $r, $r, 270, 90)
  $path.AddArc($m + $w - $r, $m + $w - $r, $r, $r, 0, 90)
  $path.AddArc($m, $m + $w - $r, $r, $r, 90, 90)
  $path.CloseFigure()
  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.PointF 0, 0), (New-Object System.Drawing.PointF $size, $size), ([System.Drawing.Color]::FromArgb(255, 59, 130, 246)), ([System.Drawing.Color]::FromArgb(255, 29, 78, 216))
  $g.FillPath($bg, $path)
  $white = [System.Drawing.Brushes]::White
  # 재생 삼각형
  $tri = @(
    (New-Object System.Drawing.PointF (92 * $s), (52 * $s)),
    (New-Object System.Drawing.PointF (92 * $s), (148 * $s)),
    (New-Object System.Drawing.PointF (172 * $s), (100 * $s))
  )
  $g.FillPolygon($white, $tri)
  # 아래쪽 내려받기 막대
  $g.FillRectangle($white, 64 * $s, 182 * $s, 128 * $s, 18 * $s)
  $g.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  return ,$ms.ToArray()
}

$sizes = 256, 64, 48, 32, 16
$images = @{}
foreach ($sz in $sizes) { $images[$sz] = New-IconPng $sz }
[System.IO.File]::WriteAllBytes((Join-Path $root 'public\icon.png'), $images[64])

# ICO: 헤더 + 크기별 PNG 항목
$out = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter $out
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
foreach ($sz in $sizes) {
  $d = if ($sz -ge 256) { 0 } else { $sz }
  $bw.Write([byte]$d); $bw.Write([byte]$d); $bw.Write([byte]0); $bw.Write([byte]0)
  $bw.Write([UInt16]1); $bw.Write([UInt16]32)
  $bw.Write([UInt32]$images[$sz].Length); $bw.Write([UInt32]$offset)
  $offset += $images[$sz].Length
}
foreach ($sz in $sizes) { $bw.Write($images[$sz]) }
$bw.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $PSScriptRoot 'icon.ico'), $out.ToArray())
Write-Host '아이콘 생성 완료'
