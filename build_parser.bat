@echo off
python -m PyInstaller --onefile --name pdf_parser --distpath . ^
  --hidden-import pdfplumber ^
  --hidden-import pdfminer ^
  --hidden-import pdfminer.high_level ^
  --hidden-import pdfminer.layout ^
  --hidden-import Pillow ^
  pdf_parser.py
pause
