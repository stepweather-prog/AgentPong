@echo off
chcp 65001 >nul
title AgentPong — локальные тесты
cd /d "D:\stepweather-prog\AgentPong"

echo.
echo ============================================
echo  AgentPong — локальные тесты протокола HTTPR
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [ОШИБКА] Node.js не найден в PATH. Установи node или добавь в PATH.
    pause
    exit /b 1
)

echo [1/1] Прогон тест-каркаса ratchet (test-ratchet.js)...
echo.
node test-ratchet.js
set RC=%errorlevel%

echo.
if %RC%==0 (
    echo ===== ИТОГ: ВСЕ ТЕСТЫ ПРОШЛИ =====
) else (
    echo ===== ИТОГ: ЕСТЬ ПРОВАЛЫ (код %RC%) =====
)
echo.
pause
exit /b %RC%
