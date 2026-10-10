@echo off
title ELEV18 AI Research Reproduction - Judging Demo Runner
color 0A

echo ======================================================================
echo   ELEV18: AI Research Reproduction Platform with Model Context Protocol
echo ======================================================================
echo.

echo [1/3] Ensuring Docker services (Postgres & Redis) are active...
docker start tapu-sena-redis-1 2>nul
docker start tapu-sena-postgres-1 2>nul
echo        Docker containers online.
echo.

echo [2/3] Launching Backend Server on port 8080...
start "ELEV18 Backend (:8080)" cmd /k "cd /d %~dp0backend && .\server.exe"
timeout /t 2 /nobreak >nul

echo [3/3] Launching Frontend on port 3000...
start "ELEV18 Frontend (:3000)" cmd /k "cd /d %~dp0frontend && npm run dev"
timeout /t 3 /nobreak >nul

echo.
echo ======================================================================
echo   ALL SYSTEMS ONLINE AND READY FOR JUDGING!
echo   - Web UI:      http://localhost:3000
echo   - Backend API: http://localhost:8080
echo   - MCP Server:  http://localhost:8080/mcp  (and Gemini CLI stdio)
echo ======================================================================
echo.
pause
