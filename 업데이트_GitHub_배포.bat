@echo off
chcp 65001 >nul
echo.
echo ╔══════════════════════════════════════════════════╗
echo ║   🚀 LottoPro GitHub 자동 배포                   ║
echo ║   https://roo2001.github.io/lotto/               ║
echo ╚══════════════════════════════════════════════════╝
echo.

cd /d "F:\Antigravity\[APP]\LottoPro"

echo [1/3] 변경 내용 확인...
git status
echo.

echo [2/3] 변경사항 커밋...
git add index.html
git commit -m "update: %DATE% %TIME%"
echo.

echo [3/3] GitHub Pages에 배포...
git push origin main --force
echo.

echo ============================================
echo ✅ 배포 완료!
echo    👉 https://roo2001.github.io/lotto/
echo    📱 폰에서 위 주소를 새로고침하면 반영됩니다.
echo    ⏱  최대 2분 소요될 수 있습니다.
echo ============================================
echo.
pause
