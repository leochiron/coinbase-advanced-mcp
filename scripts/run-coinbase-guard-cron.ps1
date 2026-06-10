param(
    [string]$FtpEnvPath = (Join-Path (Split-Path $PSScriptRoot -Parent) "server-ftp.env"),
    [string]$ConfigPath = (Join-Path (Split-Path $PSScriptRoot -Parent) "server\coinbase-guard\config.local.php"),
    [string]$LogPath = (Join-Path (Split-Path $PSScriptRoot -Parent) "data\coinbase-guard-cron-local.log")
)

$ErrorActionPreference = "Stop"

function Read-EnvFile {
    param([string]$Path)
    $result = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if ($trimmed.Length -eq 0 -or $trimmed.StartsWith("#")) {
            continue
        }
        $index = $trimmed.IndexOf("=")
        if ($index -lt 1) {
            continue
        }
        $result[$trimmed.Substring(0, $index).Trim()] = $trimmed.Substring($index + 1).Trim()
    }
    return $result
}

function Write-LocalLog {
    param([string]$Message)
    $directory = Split-Path -Parent $LogPath
    if (-not (Test-Path -LiteralPath $directory)) {
        New-Item -ItemType Directory -Path $directory | Out-Null
    }
    Add-Content -LiteralPath $LogPath -Value $Message
}

$env = Read-EnvFile -Path $FtpEnvPath
if (-not $env.ContainsKey("REMOTE_PUBLIC_URL") -or [string]::IsNullOrWhiteSpace($env["REMOTE_PUBLIC_URL"])) {
    throw "REMOTE_PUBLIC_URL is missing in $FtpEnvPath"
}

$config = Get-Content -LiteralPath $ConfigPath -Raw
$tokenMatch = [regex]::Match($config, "'cron_token'\s*=>\s*'([^']+)'")
if (-not $tokenMatch.Success) {
    throw "cron_token was not found in $ConfigPath"
}

$baseUrl = $env["REMOTE_PUBLIC_URL"].TrimEnd("/")
$url = "$baseUrl/cron.php?token=$([uri]::EscapeDataString($tokenMatch.Groups[1].Value))"
$timestamp = (Get-Date).ToString("o")

try {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 60
    $body = $response.Content | ConvertFrom-Json
    $summaries = @($body.protectionEvents | ForEach-Object {
        "$($_.productId):$($_.parentStatus):filled=$($_.filledSize):protected=$($_.protectedSize):status=$($_.status):reason=$($_.reason)"
    })
    Write-LocalLog "$timestamp OK status=$($response.StatusCode) started=$($body.startedAt) protection=$($body.liveProtectionEnabled) events=[$($summaries -join '; ')]"
} catch {
    Write-LocalLog "$timestamp ERROR $($_.Exception.Message)"
    throw
}
