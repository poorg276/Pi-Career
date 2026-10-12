$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$root = Split-Path $PSScriptRoot -Parent
$folder = Join-Path $root '.test-data/leetcode-raw'
New-Item -ItemType Directory -Path $folder -Force | Out-Null
$utf8 = New-Object System.Text.UTF8Encoding($false)
$problems = Get-Content (Join-Path $root 'content/problems.json') -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($problem in $problems) {
  $path = Join-Path $folder "$($problem.id).json"
  if (Test-Path -LiteralPath $path) { continue }
  $url = "https://leetcode.cn/problems/$($problem.slug)/description/"
  $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 40
  $match = [regex]::Match($response.Content, '<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', 'Singleline')
  if (-not $match.Success) { Write-Warning "Official page unavailable: $($problem.id)"; continue }
  $data = $match.Groups[1].Value | ConvertFrom-Json
  $question = ($data.props.pageProps.dehydratedState.queries | Where-Object { $_.queryKey[0] -eq 'questionDetail' }).state.data.question
  if ([int]$question.questionFrontendId -ne $problem.id -or $question.titleSlug -ne $problem.slug) { throw "Identity mismatch: $($problem.id)" }
  $snapshot = @{ source = $url; fetchedAt = [DateTime]::UtcNow.ToString('o'); question = $question }
  [IO.File]::WriteAllText($path, ($snapshot | ConvertTo-Json -Depth 80), $utf8)
  Write-Output "$($problem.id) $($problem.slug)"
}
