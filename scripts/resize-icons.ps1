<#
  Resizes PNG icons with System.Drawing (built into Windows, nothing to install).
  Called by extract-icons.mjs with a UTF-8 list file of "source<TAB>destination" lines.
#>
param(
  [Parameter(Mandatory = $true)][string]$List,
  [int]$Size = 64
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$count = 0
foreach ($line in [System.IO.File]::ReadAllLines($List, [System.Text.Encoding]::UTF8)) {
  if (-not $line) { continue }
  $source, $destination = $line -split "`t"
  $image = [System.Drawing.Image]::FromFile($source)
  try {
    $bitmap = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      # Clamp the edges so transparent borders don't bleed in when scaling down.
      $attributes = New-Object System.Drawing.Imaging.ImageAttributes
      $attributes.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
      $rect = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
      $graphics.DrawImage($image, $rect, 0, 0, $image.Width, $image.Height, [System.Drawing.GraphicsUnit]::Pixel, $attributes)
      $bitmap.Save($destination, [System.Drawing.Imaging.ImageFormat]::Png)
      $count++
    } finally {
      $graphics.Dispose()
      $bitmap.Dispose()
    }
  } finally {
    $image.Dispose()
  }
}
Write-Output $count
