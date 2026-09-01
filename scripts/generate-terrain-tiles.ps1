param(
  [string]$OutputRoot = (Join-Path $PSScriptRoot '..\src\assets\tiles\frontier')
)

$ErrorActionPreference = 'Stop'
$resolvedOutput = [IO.Path]::GetFullPath($OutputRoot)
[IO.Directory]::CreateDirectory($resolvedOutput) | Out-Null

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

public static class TerrainTileGenerator
{
    private const int Size = 64;

    private static Random RandomFor(int seed) { return new Random(seed * 7919 + 104729); }

    private static void Save(Bitmap bitmap, string root, string name)
    {
        string path = Path.Combine(root, name + ".png");
        string temporary = path + ".new.png";
        bitmap.Save(temporary, ImageFormat.Png);
        if (File.Exists(path)) File.Delete(path);
        File.Move(temporary, path);
    }

    public static void Land(string root, string name, int seed, string topHex, string bottomHex, bool rocky)
    {
        using (var bitmap = new Bitmap(Size, Size, PixelFormat.Format32bppArgb))
        using (var graphics = Graphics.FromImage(bitmap))
        {
            graphics.SmoothingMode = SmoothingMode.AntiAlias;
            var top = ColorTranslator.FromHtml(topHex);
            var bottom = ColorTranslator.FromHtml(bottomHex);
            using (var gradient = new LinearGradientBrush(new Rectangle(0, 0, Size, Size), top, bottom, 45f))
                graphics.FillRectangle(gradient, 0, 0, Size, Size);
            var random = RandomFor(seed);
            for (int i = 0; i < 42; i++)
            {
                float x = (float)random.NextDouble() * Size;
                float y = (float)random.NextDouble() * Size;
                float radius = .5f + (float)random.NextDouble() * (rocky ? 2.6f : 1.5f);
                Color color = rocky && i % 5 == 0 ? Color.FromArgb(70, 118, 125, 116) :
                    i % 3 == 0 ? Color.FromArgb(38, 16, 24, 14) : Color.FromArgb(38, 135, 159, 91);
                using (var brush = new SolidBrush(color)) graphics.FillEllipse(brush, x, y, radius * 2, radius * 2);
            }
            using (var pen = new Pen(Color.FromArgb(42, 143, 173, 96), 1f))
                for (int blade = 0; blade < 9; blade++)
                {
                    float x = 4 + (float)random.NextDouble() * 56;
                    float y = 5 + (float)random.NextDouble() * 54;
                    graphics.DrawLine(pen, x, y + 2, x + (float)random.NextDouble() * 2 - 1, y - 2);
                }
            Save(bitmap, root, name);
        }
    }

    public static void Water(string root, string name, int seed)
    {
        using (var bitmap = new Bitmap(Size, Size, PixelFormat.Format32bppArgb))
        using (var graphics = Graphics.FromImage(bitmap))
        {
            graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using (var gradient = new LinearGradientBrush(new Rectangle(0, 0, Size, Size), Color.FromArgb(23, 61, 84), Color.FromArgb(12, 35, 54), 90f))
                graphics.FillRectangle(gradient, 0, 0, Size, Size);
            var random = RandomFor(seed);
            for (int wave = 0; wave < 5; wave++)
            {
                float y = 7 + wave * 13 + (seed * 3 + wave * 2) % 5;
                float start = 3 + (float)random.NextDouble() * 12;
                using (var pen = new Pen(wave % 2 == 0 ? Color.FromArgb(58, 112, 204, 229) : Color.FromArgb(42, 65, 145, 181), 1.4f))
                {
                    var path = new GraphicsPath();
                    path.AddBezier(start, y, start + 7, y - 2, start + 13, y + 2, start + 20, y);
                    path.AddBezier(start + 20, y, start + 27, y - 2, start + 34, y + 2, start + 42, y);
                    graphics.DrawPath(pen, path);
                }
            }
            Save(bitmap, root, name);
        }
    }

    public static void Shore(string root, string name, int mask, int seed)
    {
        string scratch = Path.Combine(root, ".shore-water.png");
        Water(root, ".shore-water", seed);
        using (var disk = new Bitmap(scratch))
        using (var bitmap = new Bitmap(disk))
        using (var graphics = Graphics.FromImage(bitmap))
        {
            graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using (var land = new SolidBrush(Color.FromArgb(53, 71, 42)))
            {
                if ((mask & 1) != 0) graphics.FillRectangle(land, 0, 0, Size, 12);
                if ((mask & 2) != 0) graphics.FillRectangle(land, Size - 12, 0, 12, Size);
                if ((mask & 4) != 0) graphics.FillRectangle(land, 0, Size - 12, Size, 12);
                if ((mask & 8) != 0) graphics.FillRectangle(land, 0, 0, 12, Size);
            }
            using (var sand = new SolidBrush(Color.FromArgb(199, 175, 159, 101)))
            {
                if ((mask & 1) != 0) graphics.FillRectangle(sand, 0, 12, Size, 5);
                if ((mask & 2) != 0) graphics.FillRectangle(sand, Size - 17, 0, 5, Size);
                if ((mask & 4) != 0) graphics.FillRectangle(sand, 0, Size - 17, Size, 5);
                if ((mask & 8) != 0) graphics.FillRectangle(sand, 12, 0, 5, Size);
            }
            using (var foam = new Pen(Color.FromArgb(94, 181, 229, 228), 1f))
            {
                if ((mask & 1) != 0) graphics.DrawLine(foam, 0, 18, Size, 18);
                if ((mask & 2) != 0) graphics.DrawLine(foam, Size - 18, 0, Size - 18, Size);
                if ((mask & 4) != 0) graphics.DrawLine(foam, 0, Size - 18, Size, Size - 18);
                if ((mask & 8) != 0) graphics.DrawLine(foam, 18, 0, 18, Size);
            }
            Save(bitmap, root, name);
        }
        if (File.Exists(scratch)) File.Delete(scratch);
    }
}
'@

$land = @(
  @('grass-a', '#34472a', '#25381f', $false),
  @('grass-b', '#304327', '#283b21', $false),
  @('grass-c', '#3a492c', '#293920', $false),
  @('grass-d', '#32442a', '#22331d', $false),
  @('soil-a', '#4b4430', '#353424', $false),
  @('soil-b', '#514633', '#393426', $false),
  @('rock-a', '#3d4439', '#29322b', $true),
  @('rock-b', '#42483d', '#2d342e', $true)
)

for ($index = 0; $index -lt $land.Count; $index += 1) {
  [TerrainTileGenerator]::Land($resolvedOutput, $land[$index][0], $index + 1, $land[$index][1], $land[$index][2], $land[$index][3])
}
for ($index = 0; $index -lt 4; $index += 1) {
  [TerrainTileGenerator]::Water($resolvedOutput, "water-$([char](97 + $index))", $index + 1)
}
for ($mask = 0; $mask -lt 16; $mask += 1) {
  [TerrainTileGenerator]::Shore($resolvedOutput, "shore-$mask", $mask, $mask + 11)
}

Write-Output "Generated 28 reusable 64px terrain tile assets in $resolvedOutput"
