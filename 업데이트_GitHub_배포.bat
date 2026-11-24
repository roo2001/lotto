@echo off
chcp 65001 >nul
echo.
echo ====================================================
echo   LottoPro v4.0 GitHub Pages 안전 배포
echo   https://roo2001.github.io/lotto/
echo ====================================================
echo.

cd /d "F:\Antigravity\[APP]\LottoPro"

echo [1/4] 원격 최신 당첨 데이터 동기화 (git pull --rebase)...
git pull --rebase origin main
if errorlevel 1 (
    echo [ERROR] 원격 동기화 중 충돌이 발생했습니다. 상태를 확인하세요.
    pause
    exit /b 1
)
echo.

echo [2/4] 변경 파일 확인...
git status -s
echo.

echo [3/4] 변경사항 스테이징 및 커밋...
git add index.html sw.js manifest.json draws.json engine.js wheels.js app.js style.css .github/scripts/update_draws.py 업데이트_GitHub_배포.bat 2>nul
git diff --cached --quiet
if errorlevel 1 (
    git commit -m "update: LottoPro %DATE% %TIME%"
) else (
    echo 커밋할 변경사항이 없습니다.
)
echo.

echo [4/4] GitHub Pages 배포 (안전 푸시)...
git push origin main
if errorlevel 1 (
    echo [ERROR] 푸시에 실패했습니다.
    pause
    exit /b 1
)
echo.

echo ====================================================
echo   배포 완료: https://roo2001.github.io/lotto/
echo   모바일에서 새로고침하면 새 버전이 자동 반영됩니다.
echo ====================================================
echo.
pause
