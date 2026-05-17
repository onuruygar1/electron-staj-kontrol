@echo off
chcp 65001 >nul
echo.
echo === pdfplumber ayrıştırıcısı derleniyor ===
echo.

REM Bağımlılıkları yükle
pip install pdfplumber pyinstaller --quiet
if %errorlevel% neq 0 (
    echo HATA: pip install başarısız oldu.
    pause
    exit /b 1
)

REM Önceki derleme kalıntılarını temizle
if exist dist\pdf_parser.exe del /q dist\pdf_parser.exe
if exist build rmdir /s /q build
if exist pdf_parser.spec del /q pdf_parser.spec

REM Derle
python -m PyInstaller --onefile --name pdf_parser --clean --noconfirm pdf_parser.py
if %errorlevel% neq 0 (
    echo HATA: PyInstaller derleme başarısız oldu.
    pause
    exit /b 1
)

REM exe'yi proje köküne kopyala
copy dist\pdf_parser.exe pdf_parser.exe >nul
echo.
echo === Derleme tamamlandı: pdf_parser.exe ===
echo Electron uygulamasını çalıştırabilirsiniz.
echo.
pause
