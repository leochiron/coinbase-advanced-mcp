param(
    [string]$FtpEnvPath = (Join-Path (Split-Path $PSScriptRoot -Parent) "server-ftp.env"),
    [string]$ConfigPath = (Join-Path (Split-Path $PSScriptRoot -Parent) "server\coinbase-guard\config.local.php")
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

$env = Read-EnvFile -Path $FtpEnvPath
if (-not $env.ContainsKey("REMOTE_PUBLIC_URL") -or [string]::IsNullOrWhiteSpace($env["REMOTE_PUBLIC_URL"])) {
    throw "REMOTE_PUBLIC_URL is missing in $FtpEnvPath"
}

$config = Get-Content -LiteralPath $ConfigPath -Raw
$tokenMatch = [regex]::Match($config, "'status_token'\s*=>\s*'([^']+)'")
if (-not $tokenMatch.Success) {
    throw "status_token was not found in $ConfigPath"
}

$baseUrl = $env["REMOTE_PUBLIC_URL"].TrimEnd("/")
$url = "$baseUrl/status.php?token=$([uri]::EscapeDataString($tokenMatch.Groups[1].Value))"

try {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 20
    [pscustomobject]@{
        Url = "$baseUrl/status.php?token=<redacted>"
        StatusCode = [int] $response.StatusCode
        ContentType = $response.Headers["Content-Type"]
        Body = $response.Content
    }
} catch [System.Net.WebException] {
    $httpResponse = $_.Exception.Response
    $body = ""
    if ($httpResponse -ne $null) {
        $reader = New-Object System.IO.StreamReader($httpResponse.GetResponseStream())
        $body = $reader.ReadToEnd()
        $reader.Close()
    }

    [pscustomobject]@{
        Url = "$baseUrl/status.php?token=<redacted>"
        StatusCode = if ($httpResponse -eq $null) { $null } else { [int] $httpResponse.StatusCode }
        ContentType = if ($httpResponse -eq $null) { $null } else { $httpResponse.Headers["Content-Type"] }
        Body = $body
    }
}
