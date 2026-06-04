param(
    [string]$EnvPath = (Join-Path (Split-Path $PSScriptRoot -Parent) "server-ftp.env"),
    [switch]$IncludeLocalConfig
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path $PSScriptRoot -Parent
$SourceDir = Join-Path $ProjectRoot "server\coinbase-guard"

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
        $key = $trimmed.Substring(0, $index).Trim()
        $value = $trimmed.Substring($index + 1).Trim()
        $result[$key] = $value
    }
    return $result
}

function New-FtpRequest {
    param(
        [string]$Uri,
        [string]$Method,
        [hashtable]$Env
    )
    $request = [System.Net.FtpWebRequest]::Create($Uri)
    $request.Method = $Method
    $request.Credentials = New-Object System.Net.NetworkCredential($Env["FTP_USER"], $Env["FTP_PASSWORD"])
    $request.UseBinary = $true
    $request.UsePassive = $true
    $request.KeepAlive = $false
    return $request
}

function ConvertTo-FtpUri {
    param(
        [hashtable]$Env,
        [string]$RemotePath
    )
    $hostName = $Env["FTP_HOST"].TrimEnd("/")
    $path = "/" + $RemotePath.TrimStart("/")
    return "ftp://$hostName$path"
}

function Ensure-FtpDirectory {
    param(
        [hashtable]$Env,
        [string]$RemoteDir
    )
    $parts = $RemoteDir.Trim("/").Split("/", [System.StringSplitOptions]::RemoveEmptyEntries)
    $current = ""
    foreach ($part in $parts) {
        $current += "/" + $part
        $uri = ConvertTo-FtpUri -Env $Env -RemotePath $current
        try {
            $request = New-FtpRequest -Uri $uri -Method ([System.Net.WebRequestMethods+Ftp]::MakeDirectory) -Env $Env
            $response = $request.GetResponse()
            $response.Close()
        } catch {
            # Directory probably already exists.
        }
    }
}

function Upload-FtpFile {
    param(
        [hashtable]$Env,
        [string]$LocalPath,
        [string]$RemotePath
    )
    $uri = ConvertTo-FtpUri -Env $Env -RemotePath $RemotePath
    $request = New-FtpRequest -Uri $uri -Method ([System.Net.WebRequestMethods+Ftp]::UploadFile) -Env $Env
    $bytes = [System.IO.File]::ReadAllBytes($LocalPath)
    $request.ContentLength = $bytes.Length
    $stream = $request.GetRequestStream()
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Close()
    $response = $request.GetResponse()
    $response.Close()
}

$env = Read-EnvFile -Path $EnvPath
foreach ($required in @("FTP_HOST", "FTP_USER", "FTP_PASSWORD", "FTP_REMOTE_DIR")) {
    if (-not $env.ContainsKey($required) -or [string]::IsNullOrWhiteSpace($env[$required])) {
        throw "$required is missing in $EnvPath"
    }
}

Ensure-FtpDirectory -Env $env -RemoteDir $env["FTP_REMOTE_DIR"]

$files = Get-ChildItem -LiteralPath $SourceDir -Recurse -File -Force | Where-Object {
    ($IncludeLocalConfig -or $_.Name -ne "config.local.php") -and
    $_.FullName -notmatch "\\state\\"
}

foreach ($file in $files) {
    $sourcePrefix = $SourceDir.TrimEnd("\") + "\"
    $relative = $file.FullName.Substring($sourcePrefix.Length).Replace("\", "/")
    $remotePath = ($env["FTP_REMOTE_DIR"].TrimEnd("/") + "/" + $relative).Replace("//", "/")
    $remoteDir = Split-Path $remotePath -Parent
    Ensure-FtpDirectory -Env $env -RemoteDir $remoteDir
    Upload-FtpFile -Env $env -LocalPath $file.FullName -RemotePath $remotePath
    Write-Host "Uploaded $relative"
}

Write-Host "Deployment complete."
