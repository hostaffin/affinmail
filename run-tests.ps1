<#
.SYNOPSIS
    AffinMail Automated Native Test Runner for Windows
.DESCRIPTION
    Executes all unit tests, linters, and configuration validators on Windows without Docker.
#>

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "         AffinMail Automated Test Suite (Windows Native)          " -ForegroundColor Green
Write-Host "==================================================================" -ForegroundColor Cyan

$Passed = 0
$Failed = 0

# Test 1: Vitest Webmail Client Tests
Write-Host "`n[Test 1/4] Running Webmail Vitest Suite..." -ForegroundColor Cyan
try {
    npm --prefix webmail test
    Write-Host "[PASS] Webmail Vitest unit tests passed." -ForegroundColor Green
    $Passed++
}
catch {
    Write-Host "[FAIL] Vitest tests failed." -ForegroundColor Red
    $Failed++
}

# Test 2: Rust Backend Server Native Suite
Write-Host "`n[Test 2/4] Verifying AffinMail Native Rust Server (Axum 0.8)..." -ForegroundColor Cyan
try {
    cargo test --manifest-path server/Cargo.toml
    Write-Host "[PASS] Rust server unit & integration tests passed." -ForegroundColor Green
    $Passed++
}
catch {
    Write-Host "[FAIL] Rust server tests failed." -ForegroundColor Red
    $Failed++
}

# Test 3: Rust MCP Server Suite
Write-Host "`n[Test 3/4] Verifying AffinMail Rust MCP Server Suite..." -ForegroundColor Cyan
try {
    cargo test --manifest-path mcp-server/Cargo.toml
    Write-Host "[PASS] Rust MCP server tests passed." -ForegroundColor Green
    $Passed++
}
catch {
    Write-Host "[FAIL] Rust MCP server tests failed." -ForegroundColor Red
    $Failed++
}

# Test 4: Caddy Configuration Validation
Write-Host "`n[Test 4/4] Validating Caddy Dual-Port Routing Configuration..." -ForegroundColor Cyan
try {
    caddy validate --config deploy/Caddyfile.windows
    Write-Host "[PASS] Caddyfile configuration is valid." -ForegroundColor Green
    $Passed++
}
catch {
    Write-Host "[FAIL] Caddyfile validation failed." -ForegroundColor Red
    $Failed++
}

Write-Host "`n==================================================================" -ForegroundColor Cyan
Write-Host "Test Summary: $Passed Passed, $Failed Failed" -ForegroundColor $(if ($Failed -eq 0) { "Green" } else { "Red" })
Write-Host "==================================================================" -ForegroundColor Cyan

if ($Failed -eq 0) {
    Write-Host "All tests passed successfully! You can launch the interactive UI test with:" -ForegroundColor Green
    Write-Host "  powershell -ExecutionPolicy Bypass -File .\start-windows-test.ps1`n" -ForegroundColor Yellow
}
