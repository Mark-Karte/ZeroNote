# Генерирует временную иконку-заглушку assets/icon-source.png.
#
# Это именно заглушка: нейтральный тёмный квадрат с буквой Z. Настоящая иконка —
# работа этапа полировки (см. DESIGN.md, раздел «Отложено»). Скрипт лежит в
# репозитории, чтобы заглушку можно было воспроизвести, а не хранить как
# непонятно откуда взявшийся бинарник.
#
# Из полученного PNG набор для сборки делается командой:
#   npx tauri icon assets/icon-source.png

Add-Type -AssemblyName System.Drawing

$size = 1024
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

# Скруглённый квадрат-подложка.
$radius = 180
$rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$d = $radius * 2
$path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
$path.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)
$path.AddArc($rect.Right - $d, $rect.Bottom - $d, $d, $d, 0, 90)
$path.AddArc($rect.X, $rect.Bottom - $d, $d, $d, 90, 90)
$path.CloseFigure()

$back = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 30, 33, 39))
$g.FillPath($back, $path)

# Буква Z.
$fore = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 226, 229, 234))
$font = New-Object System.Drawing.Font('Segoe UI', 520, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$format = New-Object System.Drawing.StringFormat
$format.Alignment = [System.Drawing.StringAlignment]::Center
$format.LineAlignment = [System.Drawing.StringAlignment]::Center
$g.DrawString('Z', $font, $fore, (New-Object System.Drawing.RectangleF(0, -20, $size, $size)), $format)

$outDir = Join-Path $PSScriptRoot ''
$out = Join-Path $outDir 'icon-source.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)

$g.Dispose(); $bmp.Dispose(); $font.Dispose(); $back.Dispose(); $fore.Dispose(); $path.Dispose()
Write-Output "Иконка-заглушка записана: $out"
