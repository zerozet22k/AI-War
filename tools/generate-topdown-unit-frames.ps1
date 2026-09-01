param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
  [int]$FrameSize = 256,
  [string[]]$Races = @('ironclad', 'aether', 'nullforge')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$raceRoot = Join-Path $ProjectRoot 'src\assets\races'
$manifestPaths = $Races | ForEach-Object { Join-Path $raceRoot "$_\$_.race.json" }

function New-FrameBitmap {
  $bitmap = New-Object Drawing.Bitmap($FrameSize, $FrameSize, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bitmap.SetResolution(96, 96)
  return $bitmap
}

function Initialize-Graphics([Drawing.Bitmap]$bitmap) {
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  $graphics.Clear([Drawing.Color]::Transparent)
  $graphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceOver
  $graphics.CompositingQuality = [Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::HighQuality
  return $graphics
}

function Get-AlphaBounds([Drawing.Bitmap]$bitmap) {
  $minX = $bitmap.Width
  $minY = $bitmap.Height
  $maxX = -1
  $maxY = -1
  for ($y = 0; $y -lt $bitmap.Height; $y += 1) {
    for ($x = 0; $x -lt $bitmap.Width; $x += 1) {
      if ($bitmap.GetPixel($x, $y).A -le 8) { continue }
      if ($x -lt $minX) { $minX = $x }
      if ($y -lt $minY) { $minY = $y }
      if ($x -gt $maxX) { $maxX = $x }
      if ($y -gt $maxY) { $maxY = $y }
    }
  }
  if ($maxX -lt 0) { throw 'The source model has no visible pixels.' }
  return [Drawing.Rectangle]::new($minX, $minY, $maxX - $minX + 1, $maxY - $minY + 1)
}

function New-ColorAttributes([double]$brightness, [double]$saturation, [double]$alpha = 1) {
  $lumR = 0.3086
  $lumG = 0.6094
  $lumB = 0.0820
  $inverse = 1 - $saturation
  $matrix = New-Object Drawing.Imaging.ColorMatrix
  $matrix.Matrix00 = [single](($inverse * $lumR + $saturation) * $brightness)
  $matrix.Matrix01 = [single](($inverse * $lumR) * $brightness)
  $matrix.Matrix02 = [single](($inverse * $lumR) * $brightness)
  $matrix.Matrix10 = [single](($inverse * $lumG) * $brightness)
  $matrix.Matrix11 = [single](($inverse * $lumG + $saturation) * $brightness)
  $matrix.Matrix12 = [single](($inverse * $lumG) * $brightness)
  $matrix.Matrix20 = [single](($inverse * $lumB) * $brightness)
  $matrix.Matrix21 = [single](($inverse * $lumB) * $brightness)
  $matrix.Matrix22 = [single](($inverse * $lumB + $saturation) * $brightness)
  $matrix.Matrix33 = [single]$alpha
  $matrix.Matrix44 = 1
  $attributes = New-Object Drawing.Imaging.ImageAttributes
  $attributes.SetColorMatrix($matrix)
  return $attributes
}

function Draw-Model(
  [Drawing.Graphics]$graphics,
  [Drawing.Bitmap]$source,
  [Drawing.Rectangle]$sourceBounds,
  [double]$fitScale,
  [double]$scaleX,
  [double]$scaleY,
  [double]$offsetX,
  [double]$offsetY,
  [double]$rotation,
  [Drawing.Imaging.ImageAttributes]$attributes = $null
) {
  $graphics.TranslateTransform([single]($FrameSize / 2 + $offsetX), [single]($FrameSize / 2 + $offsetY))
  $graphics.RotateTransform([single]$rotation)
  $width = [single]($sourceBounds.Width * $fitScale * $scaleX)
  $height = [single]($sourceBounds.Height * $fitScale * $scaleY)
  $destination = [Drawing.RectangleF]::new(-$width / 2, -$height / 2, $width, $height)
  $sourceRectangle = [Drawing.RectangleF]::new($sourceBounds.X, $sourceBounds.Y, $sourceBounds.Width, $sourceBounds.Height)
  if ($null -eq $attributes) {
    $graphics.DrawImage($source, $destination, $sourceRectangle, [Drawing.GraphicsUnit]::Pixel)
  } else {
    $destinationPixels = [Drawing.Rectangle]::Round($destination)
    $graphics.DrawImage($source, $destinationPixels, $sourceBounds.X, $sourceBounds.Y, $sourceBounds.Width, $sourceBounds.Height, [Drawing.GraphicsUnit]::Pixel, $attributes)
  }
  $graphics.ResetTransform()
}

function Projectile-Color([string]$projectile, [string]$raceId) {
  switch ($projectile) {
    'bullet' { return [Drawing.Color]::FromArgb(255, 255, 222, 116) }
    'missile' { return [Drawing.Color]::FromArgb(255, 255, 116, 38) }
    'railgun' { return [Drawing.Color]::FromArgb(255, 176, 247, 255) }
    'laser' { return [Drawing.Color]::FromArgb(255, 62, 238, 255) }
    'pulse' { return [Drawing.Color]::FromArgb(255, 34, 211, 238) }
    'plasma' { return [Drawing.Color]::FromArgb(255, 255, 82, 176) }
    'ion' { return [Drawing.Color]::FromArgb(255, 84, 176, 255) }
    'bomb' { return [Drawing.Color]::FromArgb(255, 255, 142, 42) }
    'cannon' { return [Drawing.Color]::FromArgb(255, 255, 187, 76) }
    default {
      if ($raceId -eq 'nullforge') { return [Drawing.Color]::FromArgb(255, 255, 104, 32) }
      return [Drawing.Color]::FromArgb(255, 255, 198, 92)
    }
  }
}

function Save-AnimatedFrame(
  [string]$path,
  [Drawing.Bitmap]$source,
  [Drawing.Rectangle]$sourceBounds,
  [double]$fitScale,
  [string]$state,
  [int]$index
) {
  $phase = $index / 8.0
  $wave = [Math]::Sin($phase * [Math]::PI * 2)
  $bitmap = New-FrameBitmap
  try {
    $graphics = Initialize-Graphics $bitmap
    try {
      $scaleX = 1.0
      $scaleY = 1.0
      $offsetX = 0.0
      $offsetY = 0.0
      $rotation = 0.0
      $flash = 0.0

      if ($state -eq 'idle') {
        $scaleX = 1 + $wave * 0.006
        $scaleY = 1 - $wave * 0.006
        $offsetY = $wave * 1.25
      } elseif ($state -eq 'move') {
        $scaleX = 1 + [Math]::Abs($wave) * 0.018
        $scaleY = 1 - [Math]::Abs($wave) * 0.012
        $offsetX = $wave * 1.4
        $offsetY = -[Math]::Abs($wave) * 2.2
        $rotation = $wave * 1.35
      } elseif ($state -eq 'fire') {
        $fireCurve = @([double]0, 0.12, 0.52, 1, 0.72, 0.34, 0.08, 0)
        $flash = $fireCurve[$index]
        $offsetY = $flash * 5.5
        $scaleX = 1 + $flash * 0.012
        $scaleY = 1 - $flash * 0.018
      }

      Draw-Model $graphics $source $sourceBounds $fitScale $scaleX $scaleY $offsetX $offsetY $rotation
    } finally { $graphics.Dispose() }
    $bitmap.Save($path, [Drawing.Imaging.ImageFormat]::Png)
  } finally { $bitmap.Dispose() }
}

function Save-DestroyedFrame(
  [string]$path,
  [Drawing.Bitmap]$source,
  [Drawing.Rectangle]$sourceBounds,
  [double]$fitScale,
  [Drawing.Color]$effectColor,
  [int]$seed
) {
  $bitmap = New-FrameBitmap
  $attributes = New-ColorAttributes 0.42 0.28 0.92
  try {
    $graphics = Initialize-Graphics $bitmap
    try {
      Draw-Model $graphics $source $sourceBounds $fitScale 0.98 0.83 0 8 11 $attributes
      $random = [Random]::new($seed)
      $crackPen = [Drawing.Pen]::new([Drawing.Color]::FromArgb(195, 10, 13, 16), 4)
      $emberBrush = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(220, $effectColor))
      $debrisBrush = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(210, 33, 38, 42))
      try {
        for ($i = 0; $i -lt 5; $i += 1) {
          $x1 = 76 + $random.Next(0, 104)
          $y1 = 70 + $random.Next(0, 116)
          $x2 = $x1 + $random.Next(-35, 36)
          $y2 = $y1 + $random.Next(22, 54)
          $graphics.DrawLine($crackPen, $x1, $y1, $x2, $y2)
        }
        for ($i = 0; $i -lt 7; $i += 1) {
          $x = 70 + $random.Next(0, 116)
          $y = 74 + $random.Next(0, 112)
          $size = 2 + $random.Next(0, 4)
          $graphics.FillEllipse($emberBrush, $x, $y, $size, $size)
        }
        for ($i = 0; $i -lt 5; $i += 1) {
          $x = 44 + $random.Next(0, 168)
          $y = 52 + $random.Next(0, 156)
          $size = 4 + $random.Next(0, 8)
          $graphics.FillEllipse($debrisBrush, $x, $y, $size, [single]($size * 0.65))
        }
      } finally {
        $crackPen.Dispose()
        $emberBrush.Dispose()
        $debrisBrush.Dispose()
      }
    } finally { $graphics.Dispose() }
    $bitmap.Save($path, [Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $attributes.Dispose()
    $bitmap.Dispose()
  }
}

$generated = 0
foreach ($manifestPath in $manifestPaths) {
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $raceDir = Split-Path -Parent $manifestPath
  foreach ($unitProperty in $manifest.units.PSObject.Properties) {
    $unit = $unitProperty.Value
    $unitDir = Join-Path $raceDir $unit.asset
    $sourceName = if ($unit.model) { $unit.model } else { 'model-topdown.png' }
    $sourcePath = Join-Path $unitDir $sourceName
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { continue }
    $source = [Drawing.Bitmap]::FromFile($sourcePath)
    try {
      $bounds = Get-AlphaBounds $source
      $fitScale = [Math]::Min(($FrameSize * 0.78) / $bounds.Width, ($FrameSize * 0.78) / $bounds.Height)
      $animation = $manifest.animations.($unit.animation)
      $effectColor = Projectile-Color ([string]$unit.projectile) $manifest.id
      foreach ($state in @('idle', 'move', 'fire')) {
        $frames = $animation.$state
        for ($index = 0; $index -lt $frames.Count; $index += 1) {
          $outputPath = Join-Path $unitDir ($frames[$index] + '.png')
          Save-AnimatedFrame $outputPath $source $bounds $fitScale $state $index
          $generated += 1
        }
      }
      $seed = [Math]::Abs([string]$unitProperty.Name.GetHashCode())
      Save-DestroyedFrame (Join-Path $unitDir 'destroyed.png') $source $bounds $fitScale $effectColor $seed
      $generated += 1
    } finally { $source.Dispose() }
  }
}

Write-Output "Generated $generated top-down animation frames."
