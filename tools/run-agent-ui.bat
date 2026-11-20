@echo off
chcp 65001 >nul
title Агент Понг — UI
cd /d "D:\stepweather-prog\AgentPong"

where node >nul 2>nul
if errorlevel 1 (
    echo [ОШИБКА] Node.js не найден в PATH.
    pause
    exit /b 1
)

echo.
echo  Запускаю Агента Понга на http://localhost:8087/ui/
echo  (окно можно свернуть — сервер работает, пока оно открыто; закрытие = остановка)
echo.
start "" "http://localhost:8087/ui/"
node tools\serve-ui.js 8087
