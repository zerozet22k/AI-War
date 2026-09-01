param(
  [Parameter(Mandatory = $true)][string]$SourcePath,
  [Parameter(Mandatory = $true)][string]$OutputRoot,
  [Parameter(Mandatory = $true)][ValidateSet('units', 'buildings')][string]$Kind,
  [Parameter(Mandatory = $true)][string[]]$Names,
  [Parameter(Mandatory = $true)][int]$Columns,
  [Parameter(Mandatory = $true)][int]$Rows
)

$ErrorActionPreference = 'Stop'
$source = (Resolve-Path -LiteralPath $SourcePath).Path
$root = [IO.Path]::GetFullPath($OutputRoot)
[IO.Directory]::CreateDirectory($root) | Out-Null

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

public static class GeneratedRosterExtractor
{
    private static bool BackgroundLike(Color c)
    {
        int high = Math.Max(c.R, Math.Max(c.G, c.B));
        int low = Math.Min(c.R, Math.Min(c.G, c.B));
        return high < 108 && high - low < 38;
    }

    private static int ColorDistance(Color a, Color b)
    {
        int dr = a.R - b.R, dg = a.G - b.G, db = a.B - b.B;
        return (int)Math.Sqrt(dr * dr + dg * dg + db * db);
    }

    private static Bitmap RemoveEdgeBackground(Bitmap cell)
    {
        int width = cell.Width, height = cell.Height;
        bool[] removed = new bool[width * height];
        var queue = new Queue<int>();
        Action<int, int> seed = (x, y) => {
            int index = y * width + x;
            if (!removed[index] && BackgroundLike(cell.GetPixel(x, y))) { removed[index] = true; queue.Enqueue(index); }
        };
        for (int x = 0; x < width; x++) { seed(x, 0); seed(x, height - 1); }
        for (int y = 0; y < height; y++) { seed(0, y); seed(width - 1, y); }
        int[] dx = { -1, 1, 0, 0 }, dy = { 0, 0, -1, 1 };
        while (queue.Count > 0)
        {
            int current = queue.Dequeue(), x = current % width, y = current / width;
            Color currentColor = cell.GetPixel(x, y);
            for (int d = 0; d < 4; d++)
            {
                int nx = x + dx[d], ny = y + dy[d];
                if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
                int next = ny * width + nx;
                Color nextColor = cell.GetPixel(nx, ny);
                // Generated mattes are smooth gradients. A hard local color
                // jump is an armor silhouette, even when that armor is dark
                // and neutral, so do not flood through it.
                if (!removed[next] && BackgroundLike(nextColor) && ColorDistance(currentColor, nextColor) <= 14)
                { removed[next] = true; queue.Enqueue(next); }
            }
        }
        var output = new Bitmap(width, height, PixelFormat.Format32bppArgb);
        for (int y = 0; y < height; y++)
            for (int x = 0; x < width; x++)
            {
                Color c = cell.GetPixel(x, y);
                output.SetPixel(x, y, removed[y * width + x] ? Color.Transparent : c);
            }
        return output;
    }

    private static Bitmap Normalize(Bitmap source)
    {
        var output = new Bitmap(256, 256, PixelFormat.Format32bppArgb);
        using (Graphics g = Graphics.FromImage(output))
        {
            g.Clear(Color.Transparent);
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.CompositingQuality = CompositingQuality.HighQuality;
            float scale = Math.Min(238f / source.Width, 238f / source.Height);
            int width = Math.Max(1, (int)(source.Width * scale));
            int height = Math.Max(1, (int)(source.Height * scale));
            g.DrawImage(source, (256 - width) / 2, (256 - height) / 2, width, height);
        }
        return output;
    }

    private static Bitmap DamageVariant(Bitmap source, bool destroyed)
    {
        var output = new Bitmap(source.Width, source.Height, PixelFormat.Format32bppArgb);
        for (int y = 0; y < source.Height; y++)
            for (int x = 0; x < source.Width; x++)
            {
                Color c = source.GetPixel(x, y);
                if (c.A == 0) { output.SetPixel(x, y, c); continue; }
                int gray = (c.R * 30 + c.G * 59 + c.B * 11) / 100;
                output.SetPixel(x, y, destroyed
                    ? Color.FromArgb((int)(c.A * .72), gray / 2, gray / 2, gray / 2)
                    : Color.FromArgb(c.A, Math.Min(255, (int)(c.R * .62 + 58)), (int)(c.G * .50), (int)(c.B * .42)));
            }
        return output;
    }

    public static void Extract(string sourcePath, string outputRoot, string kind, string[] names, int columns, int rows)
    {
        using (var sheet = new Bitmap(sourcePath))
        {
            int cellWidth = sheet.Width / columns, cellHeight = sheet.Height / rows;
            for (int index = 0; index < names.Length; index++)
            {
                int col = index % columns, row = index / columns;
                var rectangle = new Rectangle(col * cellWidth, row * cellHeight, cellWidth, cellHeight);
                using (var cell = sheet.Clone(rectangle, PixelFormat.Format32bppArgb))
                using (var cutout = RemoveEdgeBackground(cell))
                using (var canonical = Normalize(cutout))
                {
                    string directory = Path.Combine(outputRoot, kind, names[index]);
                    Directory.CreateDirectory(directory);
                    canonical.Save(Path.Combine(directory, "idle-a.png"), ImageFormat.Png);
                    using (var destroyed = DamageVariant(canonical, true)) destroyed.Save(Path.Combine(directory, "destroyed.png"), ImageFormat.Png);
                    if (kind == "buildings")
                        using (var damaged = DamageVariant(canonical, false)) damaged.Save(Path.Combine(directory, "damaged.png"), ImageFormat.Png);
                }
            }
        }
    }
}
'@

[GeneratedRosterExtractor]::Extract($source, $root, $Kind, $Names, $Columns, $Rows)
Write-Output "Extracted $($Names.Count) transparent $Kind into $root"
