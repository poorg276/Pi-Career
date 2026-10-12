param([Parameter(Mandatory=$true)][string]$InputDoc,[Parameter(Mandatory=$true)][string]$OutputPdf)
$ErrorActionPreference='Stop'
$word=New-Object -ComObject Word.Application
$word.Visible=$false
$word.DisplayAlerts=0
try {
  $doc=$word.Documents.Open([IO.Path]::GetFullPath($InputDoc),$false,$true)
  try { $doc.ExportAsFixedFormat([IO.Path]::GetFullPath($OutputPdf),17); Write-Output 'Word rendering complete' }
  finally { $doc.Close(0) }
} finally { $word.Quit(); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($word) }
