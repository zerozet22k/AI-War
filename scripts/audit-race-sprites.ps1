param(
  [string]$RaceAssetsRoot = (Join-Path $PSScriptRoot '..\src\assets\races'),
  [string]$OutputRoot = (Join-Path ([IO.Path]::GetTempPath()) 'ai-war-sprite-audit')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
[IO.Directory]::CreateDirectory($OutputRoot) | Out-Null

$unitGroups = @{
  idle = @('idle-a', 'idle-1', 'idle-2', 'idle-3', 'idle-4', 'idle-5', 'idle-6', 'idle-b')
  move = @('move-a', 'move-1', 'move-2', 'move-3', 'move-4', 'move-5', 'move-6', 'move-b')
  fire = @('windup', 'fire-1', 'fire-2', 'action', 'fire-4', 'fire-5', 'fire-6', 'recovery')
  terminal = @('destroyed')
}
$buildingGroups = @{
  idle = @('idle-a', 'idle-1', 'idle-2', 'idle-3', 'idle-4', 'idle-5', 'idle-6', 'idle-b')
  production = @('production-a', 'production-1', 'production-2', 'production-3', 'production-4', 'production-5', 'production-6', 'production-b')
  research = @('research-a', 'research-1', 'research-2', 'research-3', 'research-4', 'research-5', 'research-6', 'research-b')
  terminal = @('damaged', 'destroyed')
}

foreach ($race in @('ironclad', 'aether')) {
  foreach ($kind in @('units', 'buildings')) {
    $entityRoot = Join-Path (Join-Path (Join-Path $RaceAssetsRoot $race) 'sprites') $kind
    $entities = @(Get-ChildItem -LiteralPath $entityRoot -Directory | Sort-Object Name)
    $groups = if ($kind -eq 'units') { $unitGroups } else { $buildingGroups }
    foreach ($group in $groups.GetEnumerator() | Sort-Object Key) {
    $frames = $group.Value
    $cell = 132
    $labelWidth = 130
    $headerHeight = 30
    $canvas = New-Object Drawing.Bitmap(($labelWidth + $cell * $frames.Count), ($headerHeight + $cell * $entities.Count))
    $graphics = [Drawing.Graphics]::FromImage($canvas)
    $graphics.Clear([Drawing.Color]::FromArgb(22, 27, 34))
    $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $font = New-Object Drawing.Font('Arial', 9)
    $brush = [Drawing.Brushes]::White
    for ($column = 0; $column -lt $frames.Count; $column += 1) {
      $graphics.DrawString($frames[$column], $font, $brush, ($labelWidth + $column * $cell + 5), 7)
    }
    for ($row = 0; $row -lt $entities.Count; $row += 1) {
      $graphics.DrawString($entities[$row].Name, $font, $brush, 5, ($headerHeight + $row * $cell + 55))
      for ($column = 0; $column -lt $frames.Count; $column += 1) {
        $framePath = Join-Path $entities[$row].FullName ($frames[$column] + '.png')
        $image = [Drawing.Image]::FromFile($framePath)
        $scale = [Math]::Min(($cell - 8) / $image.Width, ($cell - 8) / $image.Height)
        $width = [int]($image.Width * $scale)
        $height = [int]($image.Height * $scale)
        $x = $labelWidth + $column * $cell + [int](($cell - $width) / 2)
        $y = $headerHeight + $row * $cell + [int](($cell - $height) / 2)
        $graphics.DrawImage($image, $x, $y, $width, $height)
        $image.Dispose()
      }
    }
    $graphics.Dispose()
    $font.Dispose()
    $output = Join-Path $OutputRoot ($race + '-' + $kind + '-' + $group.Key + '.png')
    $canvas.Save($output, [Drawing.Imaging.ImageFormat]::Png)
    $canvas.Dispose()
    Write-Output $output
    }
  }
}
