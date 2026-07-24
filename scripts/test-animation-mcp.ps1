$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$previousLocation = Get-Location

try {
    Set-Location -LiteralPath $repoRoot
    $envPath = Join-Path $repoRoot ".env"
    if (-not (Test-Path -LiteralPath $envPath)) {
        throw "Run scripts\run-animation-mcp.ps1 first."
    }
    $values = @{}
    foreach ($line in Get-Content -LiteralPath $envPath) {
        if ($line -match "^\s*([^#][^=]+)=(.*)$") {
            $values[$matches[1].Trim()] = $matches[2].Trim()
        }
    }
    $secret = $values["ANIMATION_MCP_SECRET"]
    if ([string]::IsNullOrWhiteSpace($secret)) { throw "Missing route secret." }
    $url = "http://127.0.0.1:3002/mcp/$secret/"
    $headers = @{
        Origin = "https://chatgpt.com"
        Accept = "application/json, text/event-stream"
    }
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:3002/health" -TimeoutSec 5
    if ($health.status -ne "ok") { throw "Health check failed." }

    $initialize = @{
        jsonrpc = "2.0"
        id = 1
        method = "initialize"
        params = @{
            protocolVersion = "2025-06-18"
            capabilities = @{}
            clientInfo = @{ name = "local-test"; version = "1.0.0" }
        }
    } | ConvertTo-Json -Depth 10
    $initialized = Invoke-RestMethod -Uri $url -Method Post -Headers $headers -ContentType "application/json" -Body $initialize

    $toolsBody = @{
        jsonrpc = "2.0"
        id = 2
        method = "tools/list"
        params = @{}
    } | ConvertTo-Json -Depth 5
    $tools = Invoke-RestMethod -Uri $url -Method Post -Headers $headers -ContentType "application/json" -Body $toolsBody
    $toolNames = @($tools.result.tools | ForEach-Object { $_.name })
    $expectedTools = @(
        "get_animation_status"
        "create_animation"
        "revise_animation"
        "validate_animation"
        "list_animations"
        "open_animation_studio"
    )
    if (($toolNames -join ",") -ne ($expectedTools -join ",")) {
        throw "Unexpected MCP tool list."
    }

    $statusBody = @{
        jsonrpc = "2.0"
        id = 3
        method = "tools/call"
        params = @{
            name = "get_animation_status"
            arguments = @{}
        }
    } | ConvertTo-Json -Depth 10
    $statusResponse = Invoke-RestMethod -Uri $url -Method Post -Headers $headers -ContentType "application/json" -Body $statusBody
    $status = $statusResponse.result.content[0].text | ConvertFrom-Json
    if ($status.status -ne "ok") { throw "get_animation_status failed." }

    [pscustomobject]@{
        health = $health.status
        initialized = ($initialized.result.serverInfo.name -eq "sanverse-excalidraw-animation")
        tools = $toolNames
        toolStatus = $status.status
        endpoint = "http://127.0.0.1:3002/mcp/[REDACTED]/"
    } | ConvertTo-Json -Depth 5
}
finally {
    Set-Location -LiteralPath $previousLocation
}
