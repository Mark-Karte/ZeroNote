# Цвет точки на снимке — и самый частый цвет прямоугольника.
#
# Зачем отдельный скрипт: часть оформления не ловится ни одним тестом. Тест
# токенов проверяет объявления, тест читаемости — значения, а доехало ли
# значение до пикселя, не знает ни тот ни другой: чужое правило бывает
# специфичнее нашего и перебивает его молча (задача 100).
#
#   powershell -File bench\ui\pixel.ps1 снимок.png 600 300
#   powershell -File bench\ui\pixel.ps1 снимок.png 600 300 -Width 120 -Height 18
#
# Без размеров печатается одна точка; с ними — пятёрка самых частых цветов
# прямоугольника с долями. Второе нужно чаще: попасть точкой в букву вместо
# подложки легко, а цвет подложки в полосе всё равно самый частый.

param(
  [Parameter(Mandatory = $true)][string]$Path,
  [Parameter(Mandatory = $true)][int]$X,
  [Parameter(Mandatory = $true)][int]$Y,
  [int]$Width = 1,
  [int]$Height = 1
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$bmp = [System.Drawing.Bitmap]::FromFile((Resolve-Path $Path))
try {
  if ($X -lt 0 -or $Y -lt 0 -or ($X + $Width) -gt $bmp.Width -or ($Y + $Height) -gt $bmp.Height) {
    throw "прямоугольник выходит за снимок $($bmp.Width)x$($bmp.Height)"
  }

  $counts = @{}
  for ($dy = 0; $dy -lt $Height; $dy++) {
    for ($dx = 0; $dx -lt $Width; $dx++) {
      $c = $bmp.GetPixel($X + $dx, $Y + $dy)
      $hex = '#{0:x2}{1:x2}{2:x2}' -f $c.R, $c.G, $c.B
      if ($counts.ContainsKey($hex)) { $counts[$hex]++ } else { $counts[$hex] = 1 }
    }
  }

  $total = $Width * $Height
  $counts.GetEnumerator() |
    Sort-Object -Property Value -Descending |
    Select-Object -First 5 |
    ForEach-Object {
      '{0}  {1,6:p1}  ({2} точек)' -f $_.Key, ($_.Value / $total), $_.Value
    }
}
finally {
  $bmp.Dispose()
}
