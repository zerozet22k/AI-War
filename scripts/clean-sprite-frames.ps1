param(
  [string]$RaceAssetsRoot = (Join-Path $PSScriptRoot '..\src\assets\races')
)

$ErrorActionPreference = 'Stop'
$resolvedRoot = (Resolve-Path -LiteralPath $RaceAssetsRoot).Path

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;

public static class SpriteFrameCleaner
{
    private sealed class Component
    {
        public readonly List<int> Pixels = new List<int>();
        public long SumX;
        public long SumY;
        public int MinX = int.MaxValue;
        public int MinY = int.MaxValue;
        public int MaxX;
        public int MaxY;
        public double CenterX { get { return Pixels.Count == 0 ? 0 : (double)SumX / Pixels.Count; } }
        public double CenterY { get { return Pixels.Count == 0 ? 0 : (double)SumY / Pixels.Count; } }
    }

    public static void Clean(string path)
    {
        using (var source = new Bitmap(path))
        using (var output = new Bitmap(source.Width, source.Height, PixelFormat.Format32bppArgb))
        {
            int width = source.Width;
            int height = source.Height;
            bool[] core = new bool[width * height];
            bool[] visited = new bool[width * height];

            for (int y = 0; y < height; y++)
                for (int x = 0; x < width; x++)
                    core[y * width + x] = source.GetPixel(x, y).A >= 220;

            var components = new List<Component>();
            var queue = new Queue<int>();
            for (int index = 0; index < core.Length; index++)
            {
                if (!core[index] || visited[index]) continue;
                var component = new Component();
                visited[index] = true;
                queue.Enqueue(index);
                while (queue.Count > 0)
                {
                    int current = queue.Dequeue();
                    int x = current % width;
                    int y = current / width;
                    component.Pixels.Add(current);
                    component.SumX += x;
                    component.SumY += y;
                    component.MinX = Math.Min(component.MinX, x);
                    component.MinY = Math.Min(component.MinY, y);
                    component.MaxX = Math.Max(component.MaxX, x);
                    component.MaxY = Math.Max(component.MaxY, y);

                    for (int oy = -1; oy <= 1; oy++)
                        for (int ox = -1; ox <= 1; ox++)
                        {
                            if (ox == 0 && oy == 0) continue;
                            int nx = x + ox;
                            int ny = y + oy;
                            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
                            int next = ny * width + nx;
                            if (core[next] && !visited[next])
                            {
                                visited[next] = true;
                                queue.Enqueue(next);
                            }
                        }
                }
                if (component.Pixels.Count >= 4) components.Add(component);
            }

            if (components.Count == 0) return;
            double cx = (width - 1) / 2.0;
            double cy = (height - 1) / 2.0;
            double diagonal = Math.Sqrt(width * width + height * height);
            Component main = null;
            double bestScore = double.MinValue;
            foreach (var component in components)
            {
                double distance = Math.Sqrt(Math.Pow(component.CenterX - cx, 2) + Math.Pow(component.CenterY - cy, 2));
                // The intended sprite is centered in the overlapping crop;
                // neighboring cells may be larger, so center proximity must
                // dominate raw component area when choosing the main body.
                double score = component.Pixels.Count / (1.0 + 10.0 * distance / diagonal);
                if (score > bestScore) { bestScore = score; main = component; }
            }

            bool[] selected = new bool[width * height];
            foreach (var component in components)
            {
                double distanceToMain = Math.Sqrt(Math.Pow(component.CenterX - main.CenterX, 2) + Math.Pow(component.CenterY - main.CenterY, 2));
                bool touchesEdge = component.MinX <= 1 || component.MinY <= 1 || component.MaxX >= width - 2 || component.MaxY >= height - 2;
                bool substantial = component.Pixels.Count >= Math.Max(6, main.Pixels.Count / 100);
                // The splitter's 25% overlap creates a 1.5-cell canvas. The
                // actual atlas cell occupies the central two-thirds. Detached
                // parts centered outside it belong to a neighboring row or
                // column even when they happen to sit near the real sprite.
                bool centerBelongsToCell =
                    component.CenterX >= width / 6.0 && component.CenterX <= width * 5.0 / 6.0 &&
                    component.CenterY >= height / 6.0 && component.CenterY <= height * 5.0 / 6.0;
                bool nearbyEffect = distanceToMain <= diagonal * 0.32 && substantial && !touchesEdge && centerBelongsToCell;
                if (component == main || nearbyEffect)
                    foreach (int pixel in component.Pixels) selected[pixel] = true;
            }

            bool[] expanded = new bool[width * height];
            const int halo = 3;
            for (int index = 0; index < selected.Length; index++)
            {
                if (!selected[index]) continue;
                int x = index % width;
                int y = index / width;
                for (int oy = -halo; oy <= halo; oy++)
                    for (int ox = -halo; ox <= halo; ox++)
                    {
                        int nx = x + ox;
                        int ny = y + oy;
                        if (nx >= 0 && ny >= 0 && nx < width && ny < height) expanded[ny * width + nx] = true;
                    }
            }

            for (int y = 0; y < height; y++)
                for (int x = 0; x < width; x++)
                {
                    Color color = source.GetPixel(x, y);
                    output.SetPixel(x, y, expanded[y * width + x] && color.A >= 4 ? color : Color.Transparent);
                }

            string temporary = path + ".clean.png";
            output.Save(temporary, ImageFormat.Png);
            source.Dispose();
            System.IO.File.Replace(temporary, path, null);
        }
    }
}
'@

$frames = Get-ChildItem -LiteralPath $resolvedRoot -Recurse -File -Filter '*.png' |
  Where-Object { $_.FullName -match '[\\/]sprites[\\/](units|buildings)[\\/][^\\/]+[\\/][^\\/]+\.png$' }

foreach ($frame in $frames) {
  if (-not $frame.FullName.StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to edit a frame outside the race asset root: $($frame.FullName)"
  }
  [SpriteFrameCleaner]::Clean($frame.FullName)
}

Write-Output "Cleaned $($frames.Count) separate sprite frames."
