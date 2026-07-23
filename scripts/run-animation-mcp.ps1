$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$previousLocation = Get-Location

try {
    Set-Location -LiteralPath $repoRoot
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:3002/health" -TimeoutSec 2
        if ($health.status -eq "ok" -and $health.app -eq "Sanverse Excalidraw Animation") {
            Write-Host "Animation MCP is already running on 127.0.0.1:3002."
            exit 0
        }
    }
    catch {}

    $listener = Get-NetTCPConnection -LocalPort 3002 -State Listen -ErrorAction SilentlyContinue
    if ($listener) {
        $owner = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
        throw "Port 3002 is owned by another process: $($owner.ProcessName) (PID $($listener.OwningProcess)). Nothing was stopped."
    }

    $envPath = Join-Path $repoRoot ".env"
    if (-not (Test-Path -LiteralPath $envPath)) {
        $bytes = New-Object byte[] 32
        [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        $secret = [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
        @(
            "ANIMATION_MCP_SECRET=$secret"
            "ANIMATION_OUTPUT_DIR=outputs/mcp-animations"
        ) | Set-Content -LiteralPath $envPath -Encoding UTF8
        Write-Host "Created local .env with a new route secret (secret not printed)."
    }

    foreach ($line in Get-Content -LiteralPath $envPath) {
        if ($line -match "^\s*([^#][^=]+)=(.*)$") {
            [Environment]::SetEnvironmentVariable(
                $matches[1].Trim(),
                $matches[2].Trim(),
                "Process"
            )
        }
    }
    npm run mcp:start
    if ($LASTEXITCODE -ne 0) { throw "Animation MCP exited with code $LASTEXITCODE" }
}
finally {
    Set-Location -LiteralPath $previousLocation
}
