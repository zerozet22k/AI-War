param(
  [string]$RaceAssetsRoot = (Join-Path $PSScriptRoot '..\src\assets\races'),
  [string]$RaceFilter = ''
)

$ErrorActionPreference = 'Stop'
$resolvedRoot = (Resolve-Path -LiteralPath $RaceAssetsRoot).Path

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

public static class SmoothSpriteFrames
{
    private const int FrameCount = 8;

    private static Rectangle AlphaBounds(Bitmap image)
    {
        int minX = image.Width, minY = image.Height, maxX = -1, maxY = -1;
        for (int y = 0; y < image.Height; y++)
            for (int x = 0; x < image.Width; x++)
                if (image.GetPixel(x, y).A >= 8)
                {
                    minX = Math.Min(minX, x); minY = Math.Min(minY, y);
                    maxX = Math.Max(maxX, x); maxY = Math.Max(maxY, y);
                }
        return maxX < minX ? new Rectangle(0, 0, image.Width, image.Height) : Rectangle.FromLTRB(minX, minY, maxX + 1, maxY + 1);
    }

    private static void RemoveConnectedNeighborBleed(Bitmap image)
    {
        Rectangle bounds = AlphaBounds(image);
        if (bounds.Width < image.Width * .78) return;

        // Canonical idle-a is atlas column zero, so an abnormally wide body
        // can only be the next column bleeding in from the right. It may have
        // already lost its edge pixels in cleanup, so do not require it to
        // literally touch the canvas border here.
        bool bleedRight = bounds.Width >= image.Width * .78;
        bool bleedLeft = !bleedRight && bounds.Left <= 1;
        if (!bleedRight && !bleedLeft) return;

        int searchStart = bleedRight ? (int)(image.Width * .55) : (int)(image.Width * .22);
        int searchEnd = bleedRight ? (int)(image.Width * .80) : (int)(image.Width * .45);
        int valley = searchStart;
        int lowest = int.MaxValue;
        for (int x = searchStart; x <= searchEnd; x++)
        {
            int count = 0;
            for (int y = 0; y < image.Height; y++) if (image.GetPixel(x, y).A >= 32) count++;
            if (count < lowest) { lowest = count; valley = x; }
        }

        for (int y = 0; y < image.Height; y++)
            for (int x = 0; x < image.Width; x++)
                if ((bleedRight && x >= valley) || (bleedLeft && x <= valley)) image.SetPixel(x, y, Color.Transparent);
    }

    private static Color WithAlpha(Color color, int alpha)
    {
        return Color.FromArgb(Math.Max(0, Math.Min(255, alpha)), color.R, color.G, color.B);
    }

    private static void SaveFrame(Bitmap image, string directory, string name)
    {
        string path = Path.Combine(directory, name + ".png");
        string temporary = path + ".smooth.png";
        image.Save(temporary, ImageFormat.Png);
        if (File.Exists(path)) File.Delete(path);
        File.Move(temporary, path);
    }

    private static void DrawSoftOrb(Graphics graphics, float x, float y, float radius, Color color, float strength)
    {
        for (int layer = 3; layer >= 1; layer--)
        {
            float r = radius * layer / 2f;
            int alpha = (int)(strength * (layer == 1 ? 150 : layer == 2 ? 55 : 20));
            using (var brush = new SolidBrush(WithAlpha(color, alpha)))
                graphics.FillEllipse(brush, x - r, y - r, r * 2, r * 2);
        }
    }

    private static void DrawMotionEffects(Graphics graphics, Rectangle bounds, string style, Color accent, double phase)
    {
        float cx = bounds.Left + bounds.Width / 2f;
        float rearY = bounds.Bottom - Math.Max(2f, bounds.Height * 0.03f);
        float wave = (float)Math.Sin(phase);
        if (style == "air")
        {
            DrawSoftOrb(graphics, cx - bounds.Width * .13f, rearY, bounds.Width * .045f, accent, .45f + .2f * wave);
            DrawSoftOrb(graphics, cx + bounds.Width * .13f, rearY, bounds.Width * .045f, accent, .45f + .2f * wave);
            using (var pen = new Pen(WithAlpha(accent, 80), Math.Max(1f, bounds.Width * .015f)))
            {
                graphics.DrawLine(pen, cx - bounds.Width * .13f, rearY, cx - bounds.Width * .13f, rearY + bounds.Height * (.09f + .025f * wave));
                graphics.DrawLine(pen, cx + bounds.Width * .13f, rearY, cx + bounds.Width * .13f, rearY + bounds.Height * (.09f + .025f * wave));
            }
        }
        else if (style == "naval")
        {
            using (var pen = new Pen(WithAlpha(accent, 75), Math.Max(1f, bounds.Width * .018f)))
            {
                pen.StartCap = LineCap.Round; pen.EndCap = LineCap.Round;
                float spread = bounds.Width * (.30f + .025f * wave);
                graphics.DrawArc(pen, cx - spread, rearY - bounds.Height * .04f, spread, bounds.Height * .20f, 30, 105);
                graphics.DrawArc(pen, cx, rearY - bounds.Height * .04f, spread, bounds.Height * .20f, 45, 105);
            }
        }
        else if (style == "ground")
        {
            DrawSoftOrb(graphics, cx - bounds.Width * .18f, rearY, bounds.Width * .035f, accent, .28f + .1f * wave);
            DrawSoftOrb(graphics, cx + bounds.Width * .18f, rearY, bounds.Width * .035f, accent, .28f + .1f * wave);
        }
        else if (style == "foot")
        {
            using (var brush = new SolidBrush(WithAlpha(accent, 34)))
            {
                float offset = bounds.Width * .12f * wave;
                graphics.FillEllipse(brush, cx - bounds.Width * .20f + offset, rearY, bounds.Width * .11f, bounds.Height * .045f);
                graphics.FillEllipse(brush, cx + bounds.Width * .08f - offset, rearY + bounds.Height * .015f, bounds.Width * .10f, bounds.Height * .04f);
            }
        }
        else
        {
            for (int dot = 0; dot < 3; dot++)
            {
                double angle = phase + dot * Math.PI * 2 / 3;
                DrawSoftOrb(graphics, cx + (float)Math.Cos(angle) * bounds.Width * .42f,
                    bounds.Top + bounds.Height * .48f + (float)Math.Sin(angle) * bounds.Height * .22f,
                    Math.Max(2f, bounds.Width * .025f), accent, .38f);
            }
        }
    }

    private static void DrawBody(Graphics graphics, Bitmap source, Rectangle bounds, float dx, float dy, float rotation, float sx, float sy)
    {
        float cx = bounds.Left + bounds.Width / 2f;
        float cy = bounds.Top + bounds.Height / 2f;
        GraphicsState state = graphics.Save();
        graphics.TranslateTransform(cx + dx, cy + dy);
        graphics.RotateTransform(rotation);
        graphics.ScaleTransform(sx, sy);
        graphics.TranslateTransform(-cx, -cy);
        graphics.DrawImageUnscaled(source, 0, 0);
        graphics.Restore(state);
    }

    private static void DrawFireEffects(Graphics graphics, Rectangle bounds, string style, Color accent, double progress)
    {
        double envelope = Math.Sin(Math.PI * Math.Max(0, Math.Min(1, progress)));
        if (envelope <= .02) return;
        float cx = bounds.Left + bounds.Width / 2f;
        if (style == "support")
        {
            for (int dot = 0; dot < 5; dot++)
            {
                double angle = progress * Math.PI * 2 + dot * Math.PI * 2 / 5;
                float radiusX = bounds.Width * (.33f + .08f * (float)envelope);
                float radiusY = bounds.Height * (.20f + .05f * (float)envelope);
                DrawSoftOrb(graphics, cx + (float)Math.Cos(angle) * radiusX,
                    bounds.Top + bounds.Height * .48f + (float)Math.Sin(angle) * radiusY,
                    Math.Max(2f, bounds.Width * .03f), accent, (float)envelope * .75f);
            }
            using (var pen = new Pen(WithAlpha(accent, (int)(120 * envelope)), Math.Max(1f, bounds.Width * .025f)))
                graphics.DrawLine(pen, cx, bounds.Top + bounds.Height * .25f, cx, bounds.Top - bounds.Height * .10f * (float)envelope);
            return;
        }

        float muzzleY = bounds.Top + bounds.Height * .02f;
        float radius = Math.Max(3f, bounds.Width * (.055f + .06f * (float)envelope));
        DrawSoftOrb(graphics, cx, muzzleY, radius, accent, (float)envelope);
        using (var brush = new SolidBrush(WithAlpha(accent, (int)(220 * envelope))))
        {
            float length = bounds.Height * (.10f + .18f * (float)envelope);
            PointF[] flash = {
                new PointF(cx, muzzleY - length),
                new PointF(cx - radius * .38f, muzzleY + radius * .35f),
                new PointF(cx + radius * .38f, muzzleY + radius * .35f)
            };
            graphics.FillPolygon(brush, flash);
        }
    }

    public static void GenerateUnit(string directory, string style, int accentRgb)
    {
        string canonicalPath = Path.Combine(directory, "idle-a.png");
        Bitmap canonical;
        using (var disk = new Bitmap(canonicalPath)) canonical = new Bitmap(disk);
        using (canonical)
        {
            RemoveConnectedNeighborBleed(canonical);
            Rectangle bounds = AlphaBounds(canonical);
            Color accent = Color.FromArgb(255, (accentRgb >> 16) & 255, (accentRgb >> 8) & 255, accentRgb & 255);
            string[] idleNames = { "idle-a", "idle-1", "idle-2", "idle-3", "idle-4", "idle-5", "idle-6", "idle-b" };
            string[] moveNames = { "move-a", "move-1", "move-2", "move-3", "move-4", "move-5", "move-6", "move-b" };
            string[] fireNames = { "windup", "fire-1", "fire-2", "action", "fire-4", "fire-5", "fire-6", "recovery" };

            for (int i = 0; i < FrameCount; i++)
            {
                double phase = i * Math.PI * 2 / FrameCount;
                using (var output = new Bitmap(canonical.Width, canonical.Height, PixelFormat.Format32bppArgb))
                using (var graphics = Graphics.FromImage(output))
                {
                    graphics.Clear(Color.Transparent); graphics.SmoothingMode = SmoothingMode.AntiAlias;
                    float breathe = (float)Math.Sin(phase);
                    DrawBody(graphics, canonical, bounds, 0, -breathe * .45f, breathe * .25f, 1f + breathe * .004f, 1f - breathe * .006f);
                    DrawSoftOrb(graphics, bounds.Left + bounds.Width / 2f, bounds.Top + bounds.Height * .45f,
                        Math.Max(2f, bounds.Width * .025f), accent, .16f + .05f * breathe);
                    SaveFrame(output, directory, idleNames[i]);
                }

                using (var output = new Bitmap(canonical.Width, canonical.Height, PixelFormat.Format32bppArgb))
                using (var graphics = Graphics.FromImage(output))
                {
                    graphics.Clear(Color.Transparent); graphics.SmoothingMode = SmoothingMode.AntiAlias;
                    DrawMotionEffects(graphics, bounds, style, accent, phase);
                    float stride = (float)Math.Sin(phase);
                    float rotation = style == "foot" || style == "support" ? stride * 1.25f : style == "air" ? stride * .8f : stride * .35f;
                    float scaleX = style == "air" ? 1f + stride * .018f : 1f;
                    float scaleY = style == "foot" ? 1f - Math.Abs(stride) * .012f : 1f;
                    DrawBody(graphics, canonical, bounds, stride * .75f, -(float)Math.Abs(Math.Cos(phase)) * .7f, rotation, scaleX, scaleY);
                    SaveFrame(output, directory, moveNames[i]);
                }

                using (var output = new Bitmap(canonical.Width, canonical.Height, PixelFormat.Format32bppArgb))
                using (var graphics = Graphics.FromImage(output))
                {
                    graphics.Clear(Color.Transparent); graphics.SmoothingMode = SmoothingMode.AntiAlias;
                    double progress = i / (double)(FrameCount - 1);
                    float recoil = (float)Math.Sin(Math.PI * progress);
                    DrawBody(graphics, canonical, bounds, 0, recoil * (style == "ground" || style == "naval" ? 2.2f : 1.3f), 0, 1f, 1f - recoil * .01f);
                    DrawFireEffects(graphics, bounds, style, accent, progress);
                    SaveFrame(output, directory, fireNames[i]);
                }
            }
        }
    }

    private static void DrawBuildingActivity(Graphics graphics, Rectangle bounds, Color accent, double phase, bool research)
    {
        float cx = bounds.Left + bounds.Width / 2f;
        float cy = bounds.Top + bounds.Height * .48f;
        float pulse = .5f + .5f * (float)Math.Sin(phase);
        if (research)
        {
            using (var pen = new Pen(WithAlpha(accent, 55 + (int)(55 * pulse)), Math.Max(1f, bounds.Width * .012f)))
                graphics.DrawEllipse(pen, cx - bounds.Width * .36f, cy - bounds.Height * .20f, bounds.Width * .72f, bounds.Height * .40f);
            for (int dot = 0; dot < 4; dot++)
            {
                double angle = phase + dot * Math.PI / 2;
                DrawSoftOrb(graphics, cx + (float)Math.Cos(angle) * bounds.Width * .36f,
                    cy + (float)Math.Sin(angle) * bounds.Height * .20f, Math.Max(2f, bounds.Width * .026f), accent, .55f);
            }
            DrawSoftOrb(graphics, cx, bounds.Top + bounds.Height * .24f, bounds.Width * (.035f + .02f * pulse), accent, .7f);
        }
        else
        {
            DrawSoftOrb(graphics, cx, cy, bounds.Width * (.055f + .025f * pulse), accent, .75f);
            for (int spark = 0; spark < 3; spark++)
            {
                double local = phase + spark * Math.PI * 2 / 3;
                float x = cx + (float)Math.Sin(local) * bounds.Width * .28f;
                float y = bounds.Bottom - (float)((local % (Math.PI * 2)) / (Math.PI * 2)) * bounds.Height * .55f;
                DrawSoftOrb(graphics, x, y, Math.Max(1.5f, bounds.Width * .018f), accent, .45f);
            }
            using (var pen = new Pen(WithAlpha(accent, 60 + (int)(60 * pulse)), Math.Max(1f, bounds.Width * .018f)))
                graphics.DrawArc(pen, cx - bounds.Width * .30f, bounds.Bottom - bounds.Height * .25f, bounds.Width * .60f, bounds.Height * .18f, 190, 160);
        }
    }

    public static void GenerateBuilding(string directory, int accentRgb)
    {
        string canonicalPath = Path.Combine(directory, "idle-a.png");
        Bitmap canonical;
        using (var disk = new Bitmap(canonicalPath)) canonical = new Bitmap(disk);
        using (canonical)
        {
            RemoveConnectedNeighborBleed(canonical);
            Rectangle bounds = AlphaBounds(canonical);
            Color accent = Color.FromArgb(255, (accentRgb >> 16) & 255, (accentRgb >> 8) & 255, accentRgb & 255);
            string[] idleNames = { "idle-a", "idle-1", "idle-2", "idle-3", "idle-4", "idle-5", "idle-6", "idle-b" };
            string[] productionNames = { "production-a", "production-1", "production-2", "production-3", "production-4", "production-5", "production-6", "production-b" };
            string[] researchNames = { "research-a", "research-1", "research-2", "research-3", "research-4", "research-5", "research-6", "research-b" };
            for (int i = 0; i < FrameCount; i++)
            {
                double phase = i * Math.PI * 2 / FrameCount;
                using (var idle = new Bitmap(canonical.Width, canonical.Height, PixelFormat.Format32bppArgb))
                using (var graphics = Graphics.FromImage(idle))
                {
                    graphics.Clear(Color.Transparent); graphics.SmoothingMode = SmoothingMode.AntiAlias;
                    graphics.DrawImageUnscaled(canonical, 0, 0);
                    float pulse = .5f + .5f * (float)Math.Sin(phase);
                    DrawSoftOrb(graphics, bounds.Left + bounds.Width / 2f, bounds.Top + bounds.Height * .48f,
                        Math.Max(2f, bounds.Width * (.022f + .009f * pulse)), accent, .12f + .07f * pulse);
                    SaveFrame(idle, directory, idleNames[i]);
                }
                using (var production = new Bitmap(canonical.Width, canonical.Height, PixelFormat.Format32bppArgb))
                using (var graphics = Graphics.FromImage(production))
                {
                    graphics.Clear(Color.Transparent); graphics.SmoothingMode = SmoothingMode.AntiAlias;
                    graphics.DrawImageUnscaled(canonical, 0, 0);
                    DrawBuildingActivity(graphics, bounds, accent, phase, false);
                    SaveFrame(production, directory, productionNames[i]);
                }
                using (var research = new Bitmap(canonical.Width, canonical.Height, PixelFormat.Format32bppArgb))
                using (var graphics = Graphics.FromImage(research))
                {
                    graphics.Clear(Color.Transparent); graphics.SmoothingMode = SmoothingMode.AntiAlias;
                    graphics.DrawImageUnscaled(canonical, 0, 0);
                    DrawBuildingActivity(graphics, bounds, accent, phase, true);
                    SaveFrame(research, directory, researchNames[i]);
                }
            }
        }
    }
}
'@

$generated = 0
foreach ($raceDirectory in Get-ChildItem -LiteralPath $resolvedRoot -Directory) {
  if ($RaceFilter -and $raceDirectory.Name -ne $RaceFilter) { continue }
  $manifestPath = Join-Path $raceDirectory.FullName ($raceDirectory.Name + '.race.json')
  if (-not (Test-Path -LiteralPath $manifestPath)) { continue }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $accent = [int64]$manifest.colors.accent

  foreach ($property in $manifest.units.PSObject.Properties) {
    $unitDirectory = Join-Path $raceDirectory.FullName (($property.Value.asset -replace '\.png$', '') -replace '/', '\')
    if (-not $unitDirectory.StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unit sprite path escaped the race asset root.' }
    [SmoothSpriteFrames]::GenerateUnit($unitDirectory, [string]$property.Value.animation, [int]$accent)
    $generated += 24
  }
  foreach ($property in $manifest.buildings.PSObject.Properties) {
    $buildingDirectory = Join-Path $raceDirectory.FullName (($property.Value.asset -replace '\.png$', '') -replace '/', '\')
    if (-not $buildingDirectory.StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Building sprite path escaped the race asset root.' }
    [SmoothSpriteFrames]::GenerateBuilding($buildingDirectory, [int]$accent)
    $generated += 24
  }
}

Write-Output "Generated $generated stable, separate animation frames."
