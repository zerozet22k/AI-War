param(
  [string]$RaceAssetsRoot = (Join-Path $PSScriptRoot '..\src\assets\races')
)

$ErrorActionPreference = 'Stop'
$resolvedRoot = (Resolve-Path -LiteralPath $RaceAssetsRoot).Path

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;

public static class OverlapSpriteSplitter
{
    public static void Extract(string sourcePath, string destinationPath, int column, int row, int columns, int rows)
    {
        using (var source = new Bitmap(sourcePath))
        {
            double cellWidth = (double)source.Width / columns;
            double cellHeight = (double)source.Height / rows;
            // Recover effects and silhouettes that cross a generated grid
            // line. The cleanup pass understands that the intended cell is
            // the central two-thirds of this padded crop and rejects detached
            // components whose centers belong to a neighboring cell.
            double overlapX = cellWidth * 0.25;
            double overlapY = cellHeight * 0.25;
            int left = Math.Max(0, (int)Math.Floor(column * cellWidth - overlapX));
            int top = Math.Max(0, (int)Math.Floor(row * cellHeight - overlapY));
            int right = Math.Min(source.Width, (int)Math.Ceiling((column + 1) * cellWidth + overlapX));
            int bottom = Math.Min(source.Height, (int)Math.Ceiling((row + 1) * cellHeight + overlapY));
            int canvasWidth = (int)Math.Ceiling(cellWidth + overlapX * 2);
            int canvasHeight = (int)Math.Ceiling(cellHeight + overlapY * 2);

            using (var output = new Bitmap(canvasWidth, canvasHeight, PixelFormat.Format32bppArgb))
            using (var graphics = Graphics.FromImage(output))
            {
                graphics.Clear(Color.Transparent);
                graphics.CompositingMode = CompositingMode.SourceCopy;
                int targetX = (canvasWidth - (right - left)) / 2;
                int targetY = (canvasHeight - (bottom - top)) / 2;
                graphics.DrawImage(source, new Rectangle(targetX, targetY, right - left, bottom - top), left, top, right - left, bottom - top, GraphicsUnit.Pixel);
                string temporary = destinationPath + ".split.png";
                output.Save(temporary, ImageFormat.Png);
                source.Dispose();
                if (System.IO.File.Exists(destinationPath)) System.IO.File.Delete(destinationPath);
                System.IO.File.Move(temporary, destinationPath);
            }
        }
    }
}
'@

$unitFrames = @('idle-a', 'idle-b', 'move-a', 'move-b', 'windup', 'action', 'recovery', 'destroyed')
$buildingFrames = @('idle-a', 'idle-b', 'production-a', 'production-b', 'research-a', 'research-b', 'damaged', 'destroyed')

$jobs = @(
  @{ Race = 'ironclad'; Source = 'units-base-animated.png'; Kind = 'units'; Rows = @('fabricator', 'warden', 'lynx', 'bastion'); Frames = $unitFrames },
  @{ Race = 'ironclad'; Source = 'units-advanced-animated.png'; Kind = 'units'; Rows = @('breaker', 'longshot', 'thunderhead', 'shrike'); Frames = $unitFrames },
  @{ Race = 'ironclad'; Source = 'units-expansion-animated.png'; Kind = 'units'; Rows = @('fieldMedic', 'harrier', 'cutlass', 'leviathan', 'undertow'); Frames = $unitFrames },
  @{ Race = 'ironclad'; Source = 'buildings-animated.png'; Kind = 'buildings'; Rows = @('citadel', 'garrison', 'foundry', 'sentinel', 'relay', 'harbor', 'arsenal'); Frames = $buildingFrames },
  @{ Race = 'aether'; Source = 'units-base-animated.png'; Kind = 'units'; Rows = @('shaper', 'lancer', 'wisp', 'behemoth'); Frames = $unitFrames },
  @{ Race = 'aether'; Source = 'units-advanced-animated.png'; Kind = 'units'; Rows = @('ruptor', 'seer', 'worldspine', 'seraph'); Frames = $unitFrames },
  @{ Race = 'aether'; Source = 'units-expansion-animated.png'; Kind = 'units'; Rows = @('mender', 'tempest', 'riptide', 'abyssCrown', 'shadefin'); Frames = $unitFrames },
  @{ Race = 'aether'; Source = 'buildings-animated.png'; Kind = 'buildings'; Rows = @('heartspire', 'spawningVault', 'titanCrucible', 'gaze', 'whisperNode', 'tidewomb', 'memoryBloom'); Frames = $buildingFrames }
)

$written = 0
foreach ($job in $jobs) {
  $source = Join-Path (Join-Path $resolvedRoot $job.Race) $job.Source
  foreach ($rowIndex in 0..($job.Rows.Count - 1)) {
    $destinationDirectory = Join-Path (Join-Path (Join-Path (Join-Path $resolvedRoot $job.Race) 'sprites') $job.Kind) $job.Rows[$rowIndex]
    [IO.Directory]::CreateDirectory($destinationDirectory) | Out-Null
    foreach ($columnIndex in 0..7) {
      $destination = Join-Path $destinationDirectory ($job.Frames[$columnIndex] + '.png')
      if (-not $source.StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase) -or
          -not $destination.StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Refusing to split sprites outside the race asset root.'
      }
      [OverlapSpriteSplitter]::Extract($source, $destination, $columnIndex, $rowIndex, 8, $job.Rows.Count)
      $written += 1
    }
  }
}

Write-Output "Extracted $written overlapping sprite frames."
& (Join-Path $PSScriptRoot 'clean-sprite-frames.ps1') -RaceAssetsRoot $resolvedRoot
