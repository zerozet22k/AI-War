param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
  [int]$FrameSize = 320,
  [string[]]$Races = @('aether')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function New-Canvas {
  $bitmap = New-Object Drawing.Bitmap($FrameSize, $FrameSize, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bitmap.SetResolution(96, 96)
  return $bitmap
}

function New-Graphics([Drawing.Bitmap]$bitmap) {
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  $graphics.Clear([Drawing.Color]::Transparent)
  $graphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceOver
  $graphics.CompositingQuality = [Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::HighQuality
  return $graphics
}

function Get-VisibleBounds([Drawing.Bitmap]$bitmap) {
  $minX = $bitmap.Width; $minY = $bitmap.Height; $maxX = -1; $maxY = -1
  for ($y = 0; $y -lt $bitmap.Height; $y += 1) {
    for ($x = 0; $x -lt $bitmap.Width; $x += 1) {
      if ($bitmap.GetPixel($x, $y).A -le 10) { continue }
      if ($x -lt $minX) { $minX = $x }; if ($y -lt $minY) { $minY = $y }
      if ($x -gt $maxX) { $maxX = $x }; if ($y -gt $maxY) { $maxY = $y }
    }
  }
  if ($maxX -lt 0) { throw 'Building master has no visible pixels.' }
  return [Drawing.Rectangle]::new($minX, $minY, $maxX - $minX + 1, $maxY - $minY + 1)
}

function New-ColorAttributes([double]$brightness, [double]$saturation, [double]$alpha = 1) {
  $lr = 0.3086; $lg = 0.6094; $lb = 0.0820; $inverse = 1 - $saturation
  $matrix = New-Object Drawing.Imaging.ColorMatrix
  $matrix.Matrix00 = [single](($inverse * $lr + $saturation) * $brightness)
  $matrix.Matrix01 = [single](($inverse * $lr) * $brightness)
  $matrix.Matrix02 = [single](($inverse * $lr) * $brightness)
  $matrix.Matrix10 = [single](($inverse * $lg) * $brightness)
  $matrix.Matrix11 = [single](($inverse * $lg + $saturation) * $brightness)
  $matrix.Matrix12 = [single](($inverse * $lg) * $brightness)
  $matrix.Matrix20 = [single](($inverse * $lb) * $brightness)
  $matrix.Matrix21 = [single](($inverse * $lb) * $brightness)
  $matrix.Matrix22 = [single](($inverse * $lb + $saturation) * $brightness)
  $matrix.Matrix33 = [single]$alpha; $matrix.Matrix44 = 1
  $attributes = New-Object Drawing.Imaging.ImageAttributes
  $attributes.SetColorMatrix($matrix)
  return $attributes
}

function Draw-Building(
  [Drawing.Graphics]$graphics,
  [Drawing.Bitmap]$source,
  [Drawing.Rectangle]$bounds,
  [double]$fitScale,
  [double]$scaleX,
  [double]$scaleY,
  [double]$offsetY,
  [Drawing.Imaging.ImageAttributes]$attributes = $null
) {
  $width = [single]($bounds.Width * $fitScale * $scaleX)
  $height = [single]($bounds.Height * $fitScale * $scaleY)
  $destination = [Drawing.Rectangle]::Round([Drawing.RectangleF]::new(($FrameSize - $width) / 2, ($FrameSize - $height) / 2 + $offsetY, $width, $height))
  if ($null -eq $attributes) {
    $graphics.DrawImage($source, $destination, $bounds, [Drawing.GraphicsUnit]::Pixel)
  } else {
    $graphics.DrawImage($source, $destination, $bounds.X, $bounds.Y, $bounds.Width, $bounds.Height, [Drawing.GraphicsUnit]::Pixel, $attributes)
  }
}

function Save-StateFrame(
  [string]$path,
  [Drawing.Bitmap]$source,
  [Drawing.Rectangle]$bounds,
  [double]$fitScale,
  [string]$state,
  [int]$index
) {
  $phase = $index / 8.0
  $wave = [Math]::Sin($phase * [Math]::PI * 2)
  $scaleX = 1.0; $scaleY = 1.0; $offsetY = 0.0; $brightness = 1.0; $saturation = 1.0
  if ($state -eq 'idle') {
    $scaleX = 1 + $wave * 0.004; $scaleY = 1 - $wave * 0.004; $brightness = 1 + $wave * 0.018
  } elseif ($state -eq 'production') {
    $pulse = @([double]0.00, 0.16, 0.42, 0.75, 1.00, 0.72, 0.34, 0.08)[$index]
    $scaleX = 1 + $pulse * 0.012; $scaleY = 1 - $pulse * 0.009
    $offsetY = $pulse * 1.5; $brightness = 1 + $pulse * 0.10; $saturation = 1 + $pulse * 0.08
  } elseif ($state -eq 'research') {
    $pulse = (1 + $wave) / 2
    $scaleX = 1 - $wave * 0.004; $scaleY = 1 + $wave * 0.004
    $brightness = 1 + $pulse * 0.12; $saturation = 1 + $pulse * 0.16
  }
  $bitmap = New-Canvas
  $attributes = New-ColorAttributes $brightness $saturation
  try {
    $graphics = New-Graphics $bitmap
    try { Draw-Building $graphics $source $bounds $fitScale $scaleX $scaleY $offsetY $attributes }
    finally { $graphics.Dispose() }
    $bitmap.Save($path, [Drawing.Imaging.ImageFormat]::Png)
  } finally { $attributes.Dispose(); $bitmap.Dispose() }
}

function Save-DamageFrame(
  [string]$path,
  [Drawing.Bitmap]$source,
  [Drawing.Rectangle]$bounds,
  [double]$fitScale,
  [bool]$destroyed,
  [int]$seed
) {
  $bitmap = New-Canvas
  $attributes = if ($destroyed) { New-ColorAttributes 0.34 0.22 0.90 } else { New-ColorAttributes 0.64 0.55 0.98 }
  try {
    $graphics = New-Graphics $bitmap
    try {
      $scaleY = if ($destroyed) { 0.72 } else { 0.98 }
      $offsetY = if ($destroyed) { 18 } else { 2 }
      Draw-Building $graphics $source $bounds $fitScale 1 $scaleY $offsetY $attributes
      $random = [Random]::new($seed)
      $crackPen = [Drawing.Pen]::new([Drawing.Color]::FromArgb(205, 18, 10, 28), $(if ($destroyed) { 6 } else { 4 }))
      $emberBrush = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(225, 54, 220, 255))
      $rubbleBrush = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(220, 31, 20, 47))
      try {
        $cracks = if ($destroyed) { 9 } else { 5 }
        for ($i = 0; $i -lt $cracks; $i += 1) {
          $x1 = 88 + $random.Next(0, 144); $y1 = 78 + $random.Next(0, 150)
          $graphics.DrawLine($crackPen, $x1, $y1, $x1 + $random.Next(-34, 35), $y1 + $random.Next(18, 48))
        }
        for ($i = 0; $i -lt $(if ($destroyed) { 10 } else { 5 }); $i += 1) {
          $x = 82 + $random.Next(0, 156); $y = 84 + $random.Next(0, 148); $s = 2 + $random.Next(0, 4)
          $graphics.FillRectangle($emberBrush, $x, $y, $s, $s)
        }
        if ($destroyed) {
          for ($i = 0; $i -lt 10; $i += 1) {
            $x = 64 + $random.Next(0, 192); $y = 112 + $random.Next(0, 122); $w = 5 + $random.Next(0, 11)
            $points = @([Drawing.Point]::new($x,$y),[Drawing.Point]::new($x+$w,$y+2),[Drawing.Point]::new($x+$random.Next(1,$w),$y+$random.Next(5,13)))
            $graphics.FillPolygon($rubbleBrush, $points)
          }
        }
      } finally { $crackPen.Dispose(); $emberBrush.Dispose(); $rubbleBrush.Dispose() }
    } finally { $graphics.Dispose() }
    $bitmap.Save($path, [Drawing.Imaging.ImageFormat]::Png)
  } finally { $attributes.Dispose(); $bitmap.Dispose() }
}

$generated = 0
$raceRoot = Join-Path $ProjectRoot 'src\assets\races'
foreach ($raceId in $Races) {
  $manifestPath = Join-Path $raceRoot "$raceId\$raceId.race.json"
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $raceDir = Split-Path -Parent $manifestPath
  foreach ($property in $manifest.buildings.PSObject.Properties) {
    $buildingDir = Join-Path $raceDir $property.Value.asset
    $sourcePath = Join-Path $buildingDir 'model-topdown.png'
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { continue }
    $source = [Drawing.Bitmap]::FromFile($sourcePath)
    try {
      $bounds = Get-VisibleBounds $source
      $fitScale = [Math]::Min(($FrameSize * 0.82) / $bounds.Width, ($FrameSize * 0.82) / $bounds.Height)
      foreach ($state in @('idle', 'production', 'research')) {
        $frames = $manifest.buildingAnimations.$state
        for ($index = 0; $index -lt $frames.Count; $index += 1) {
          Save-StateFrame (Join-Path $buildingDir ($frames[$index] + '.png')) $source $bounds $fitScale $state $index
          $generated += 1
        }
      }
      $seed = [Math]::Abs([string]$property.Name.GetHashCode())
      Save-DamageFrame (Join-Path $buildingDir 'damaged.png') $source $bounds $fitScale $false $seed
      Save-DamageFrame (Join-Path $buildingDir 'destroyed.png') $source $bounds $fitScale $true ($seed + 17)
      $generated += 2
    } finally { $source.Dispose() }
  }
}

Write-Output "Generated $generated top-down building animation frames."
