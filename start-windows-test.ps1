<#
.SYNOPSIS
    AffinMail Windows Local Native Test Environment Launcher
.DESCRIPTION
    Runs AffinMail natively on Windows without Docker using:
    - Native Caddy 2 for dual-port routing (Port 2087 Admin Panel & Port 2083 User Panel)
    - Lightweight Python Mock Backend for JMAP and Admin REST API (Port 8080)
    - Pre-built React 19 / DaisyUI 5 Webmail SPA
#>

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "       AffinMail Native Windows Test Environment (Zero Docker)    " -ForegroundColor Green
Write-Host "==================================================================" -ForegroundColor Cyan

# 1. Check Caddy
if (-not (Get-Command caddy -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Caddy is not found in PATH." -ForegroundColor Red
    Write-Host "Please install Caddy or add it to PATH." -ForegroundColor Yellow
    exit 1
}

# 2. Check Python
$PythonCmd = if (Get-Command python -ErrorAction SilentlyContinue) { "python" } elseif (Get-Command py -ErrorAction SilentlyContinue) { "py" } else { $null }
if (-not $PythonCmd) {
    Write-Host "[ERROR] Python 3 is not found in PATH." -ForegroundColor Red
    exit 1
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location "$ScriptDir"

# 3. Ensure webmail bundle exists
if (-not (Test-Path "$ScriptDir\webmail\dist\index.html")) {
    Write-Host "[*] Building Webmail SPA assets with npm..." -ForegroundColor Yellow
    npm --prefix "$ScriptDir\webmail" run build
}

# 4. Start Python Mock Backend on Port 8080 (background process)
Write-Host "[*] Starting AffinMail Local Mock Backend on 127.0.0.1:8080..." -ForegroundColor Cyan
$BackendProcess = Start-Process -FilePath $PythonCmd -ArgumentList "$ScriptDir\scripts\mock-backend.py" -PassThru -NoNewWindow

# Register cleanup on exit
Register-EngineEvent -SourceIdentifier ([System.Management.Automation.PsEngineEvent]::Exiting) -Action {
    if ($BackendProcess -and -not $BackendProcess.HasExited) {
        Stop-Process -Id $BackendProcess.Id -Force -ErrorAction SilentlyContinue
    }
} | Out-Null

Start-Sleep -Seconds 1

Write-Host "`n==================================================================" -ForegroundColor Cyan
Write-Host "  AffinMail Local Services are Active on Windows!                " -ForegroundColor Green
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "  Admin Panel (REST API):  http://localhost:2087" -ForegroundColor Yellow
Write-Host "  User Panel (MCP Ready):  http://localhost:2083" -ForegroundColor Yellow
Write-Host "  Mock JMAP / REST API:    http://127.0.0.1:8080" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "Press Ctrl+C at any time to stop the server.`n" -ForegroundColor DarkGray

# 5. Open browser tabs
Start-Process "http://localhost:2087"
Start-Sleep -Milliseconds 500
Start-Process "http://localhost:2083"

# 6. Run Caddy in foreground
try {
    caddy run --config "$ScriptDir\deploy\Caddyfile.windows"
}
finally {
    Write-Host "`n[*] Stopping background mock backend..." -ForegroundColor Yellow
    if ($BackendProcess -and -not $BackendProcess.HasExited) {
        Stop-Process -Id $BackendProcess.Id -Force -ErrorAction SilentlyContinue
    }
    Write-Host "[*] AffinMail Windows test environment closed cleanly." -ForegroundColor Green
}
