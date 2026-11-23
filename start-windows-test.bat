@echo off
title AffinMail Windows Test Environment
echo Starting AffinMail Native Windows Test Server (Zero Docker)...
powershell -ExecutionPolicy Bypass -File "%~dp0start-windows-test.ps1"
pause
