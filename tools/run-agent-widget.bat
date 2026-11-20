@echo off
chcp 65001 >nul
title Агент Понг — виджет
cd /d "D:\stepweather-prog\AgentPong"

where npx >nul 2>nul
if errorlevel 1 (
    echo [ОШИБКА] Node.js/npx не найден в PATH.
    pause
    exit /b 1
)

start "AgentPong widget" /b npx electron .
exit
