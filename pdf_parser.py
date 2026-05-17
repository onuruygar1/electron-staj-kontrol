#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
pdf_parser.py — pdfplumber tabanlı transkript ayrıştırıcı

Kullanım : pdf_parser.exe <pdf_yolu>
Çıktı    : stdout'a UTF-8 JSON
"""

import sys
import json
import re
import os

try:
    import pdfplumber
except ImportError:
    out = json.dumps({"error": "pdfplumber modülü bulunamadı"}, ensure_ascii=False)
    sys.stdout.buffer.write(out.encode("utf-8"))
    sys.exit(1)

# ── Ders kodu tablosu (main.js ile senkron) ─────────────────────────────────
COURSE_ALIASES = {
    "BİL101": ["BİL101", "BIL101", "CSE101"],
    "BİL105": ["BİL105", "BIL105", "CSE105"],
    "BİL122": ["BİL122", "BIL122", "CSE122"],
    "BİL124": ["BİL124", "BIL124", "CSE124"],
    "BİL240": ["BİL240", "BIL240", "CSE240"],
    "BİL265": ["BİL265", "BIL265", "CSE265"],
    "BİL300": ["BİL300", "BIL300", "CSE300"],
    "BİL324": ["BİL324", "BIL324", "CSE324"],
    "BİL332": ["BİL332", "BIL332", "CSE332"],
    "BİL343": ["BİL343", "BIL343", "CSE343"],
    "BİL344": ["BİL344", "BIL344", "CSE344"],
    "BİL367": ["BİL367", "BIL367", "CSE367"],
    "BİL386": ["BİL386", "BIL386", "CSE386"],
    "BİL493": ["BİL493", "BIL493", "CSE493"],
    "MAT151": ["MAT151", "MATH151"],
    "MAT152": ["MAT152", "MATH152"],
    "FİZ103": ["FİZ103", "FIZ103", "PHYS103"],
    "FİZ104": ["FİZ104", "FIZ104", "PHYS104"],
    "FİZ105": ["FİZ105", "FIZ105", "PHYS105"],
    "FİZ110": ["FİZ110", "FIZ110", "PHYS110"],
}
TRACKED_COURSES = list(COURSE_ALIASES.keys())

# Geçerli harf notları (F1/F2/XX/Y/P da geçerli token)
VALID_GRADE_RE = re.compile(
    r"^(A[+\-]?|B[+\-]?|C[+\-]?|D[+]?|D|F[12]?|XX|Y|P)$"
)

# Satır içi not arama — boşluklu varyantları da yakala
GRADE_SCAN_RE = re.compile(
    r"(?<![A-ZÇĞİÖŞÜ0-9])"
    r"(A\s*[+\-]|A|B\s*[+\-]|B|C\s*[+\-]|C|D\s*\+|D|F\s*[12]|X\s*X|Y|P)"
    r"(?![A-ZÇĞİÖŞÜ0-9])",
    re.UNICODE,
)


# ── Yardımcı fonksiyonlar ────────────────────────────────────────────────────
def norm(text):
    if not text:
        return ""
    t = str(text).replace("\r", "\n").replace("\t", " ")
    t = t.replace("Bİ\u0307L", "BİL").replace("BIL", "BİL")
    t = re.sub(r" {2,}", " ", t)
    return t.strip()


def norm_code(code):
    c = norm(code).upper().replace("I", "İ")
    return re.sub(r"\s+", "", c)


def clean_grade(token):
    t = str(token or "").upper()
    t = t.replace("＋", "+").replace("−", "-").replace("–", "-").replace("—", "-")
    return re.sub(r"\s+", "", t).strip()


def map_canonical(code):
    nc = norm_code(code)
    for canonical, aliases in COURSE_ALIASES.items():
        if nc in [norm_code(a) for a in aliases]:
            return canonical
    return None


# Kalma notları
FAILING_GRADES = {"F1", "F2", "XX", "F"}


def is_passing(grade):
    return bool(grade) and clean_grade(grade) not in FAILING_GRADES


def best_grade(existing, new):
    """
    İki not arasından en doğru olanı seçer:
      - Geçer not her zaman kalan/F notuna üstün gelir.
      - İkisi de aynı türdeyse (ikisi de geçer veya ikisi de kalan) en son görülen (new) kazanr.
    Bu kural belgenin sırasından bağımsız dönüşümü garanti eder.
    """
    if existing is None:
        return new
    if new is None:
        return existing
    p_ex = is_passing(existing)
    p_new = is_passing(new)
    if p_new and not p_ex:
        return new   # yeni geçer, eski kaldı → yeni
    if p_ex and not p_new:
        return existing  # eski geçer, yeni kaldı → mevcut koru
    return new  # ikisi de aynı türde → en son görülen


def find_student_no(text):
    patterns = [
        r"Öğrenci\s+No[:\-\s]+(\d{7,10})",
        r"Öğrenci\s+Numara[sı]+[:\-\s]+(\d{7,10})",
        r"Öğr\.\s*No[:\-\s]+(\d{7,10})",
        r"Student\s+No[:\-\s]+(\d{7,10})",
        r"No\s*[:\-]\s*(\d{7,10})\b",
    ]
    for pat in patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            return m.group(1)
    nums = re.findall(r"\b(\d{8})\b", text)
    if len(nums) == 1:
        return nums[0]
    return "Bilinmiyor"


def find_gno(text):
    """Genel Not Ortalaması (GNO) — 0.00-4.00 arası ondalıklı sayı."""
    patterns = [
        r"AGNO\s*[:\=]?\s*(\d[\.,]\d{2})",          # önce AGNO'yu atla
        r"Genel\s+Not\s+Ortalamas[ıi]\s*[:\=]?\s*(\d[\.,]\d{2})",
        r"(?<![A-Za-z])GNO\s*[:\=]?\s*(\d[\.,]\d{2})",
        r"GPA\s*[:\=]?\s*(\d[\.,]\d{2})",
    ]
    # AGNO satırlarını bul, sonra GNO ara
    agno_positions = set()
    for m in re.finditer(r"AGNO\s*[:\=]?\s*\d[\.,]\d{2}", text, re.IGNORECASE):
        agno_positions.update(range(m.start(), m.end()))

    for pat in patterns[1:]:  # AGNO pattern'i atla
        for m in re.finditer(pat, text, re.IGNORECASE):
            if m.start() not in agno_positions:
                val = m.group(1).replace(",", ".")
                try:
                    f = float(val)
                    if 0.0 <= f <= 4.0:
                        return val
                except ValueError:
                    pass
    return None


def find_agno(text):
    """Ağırlıklı Genel Not Ortalaması (AGNO)."""
    patterns = [
        r"Ağırlıklı\s+Genel\s+Not\s+Ortalamas[ıi]\s*[:\=]?\s*(\d[\.,]\d{2})",
        r"AGNO\s*[:\=]?\s*(\d[\.,]\d{2})",
        r"Cumulative\s+GPA\s*[:\=]?\s*(\d[\.,]\d{2})",
        r"CGPA\s*[:\=]?\s*(\d[\.,]\d{2})",
    ]
    for pat in patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            val = m.group(1).replace(",", ".")
            try:
                f = float(val)
                if 0.0 <= f <= 4.0:
                    return val
            except ValueError:
                pass
    return None


def find_sinif(text):
    """Kaçıncı sınıfta olduğunu döndürür (ör. '3')."""
    patterns = [
        r"(\d+)\.\s*Sınıf",
        r"(\d+)\.\s*Yıl",
        r"Class\s*[:\=]?\s*(\d+)",
        r"Year\s*[:\=]?\s*(\d+)",
    ]
    for pat in patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            return m.group(1)
    return None


def find_donem(text):
    """Mevcut dönemi döndürür (ör. '2023-2024 Güz' veya '3. Yarıyıl')."""
    patterns = [
        r"(\d{4}[-/]\d{4})\s*(Güz|Bahar|Fall|Spring)",
        r"(\d+)\.\s*(Yarıyıl|Dönem|Semester)",
    ]
    for pat in patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            return " ".join(m.groups())
    return None


def find_student_name(text):
    label_re = re.compile(
        r"(?:Adı?\s*\/?)\s*Soyadı?|Ad\s+Soyad|Name\s*:", re.IGNORECASE
    )
    # Etiketten sonra isim alanını bitiren kelimeler — önce boşluk aramaz
    stop_re = re.compile(
        r"(?:K:\s*AKTS|AKTS|K:|Bölüm|GNO|Program|Fakülte|Faculty|Dept|"
        r"T\.C\.|TC\s*Kimlik|Doğum|Mezun|Diploma|Üniversite|Enstitü|Şube|Tarih)",
        re.IGNORECASE,
    )
    m = label_re.search(text)
    if m:
        after = text[m.end():]
        # Baştaki tüm boşluk / iki nokta / tire karakterlerini temizle
        after_clean = re.sub(r"^[\s:\-]+", "", after)
        s = stop_re.search(after_clean)
        raw = after_clean[: s.start()].strip() if s else after_clean.split("\n")[0].strip()
        # İlk satırı al, rakam içeriyorsa geçersiz say
        candidate = raw.split("\n")[0].strip()
        if len(candidate) >= 3 and not re.search(r"\d", candidate):
            return candidate
    # Fallback: ilk 15 satırda tamamen büyük harfli Türkçe isim ara
    for line in text.split("\n")[:15]:
        t = line.strip()
        if re.match(r"^[A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜ\s]{4,}$", t):
            words = t.split()
            if len(words) >= 2 and all(len(w) >= 2 for w in words):
                if not re.search(r"\b[A-Z]{2,4}\d{3}\b", t):
                    return t
    return "Bilinmiyor"


def is_lisans_page(text):
    up = norm(text).upper()
    grad = any(
        k in up
        for k in [
            "YÜKSEK LİSANS",
            "TEZLİ YÜKSEK LİSANS",
            "DOKTORA",
            "FEN BİLİMLERİ ENSTİTÜSÜ",
        ]
    )
    undergrad = (
        "MÜHENDİSLİK FAKÜLTESİ" in up
        or "LİSANS PROGRAMI" in up
        or ("BİLGİSAYAR MÜHENDİSLİĞİ" in up and not grad)
    )
    return undergrad and not grad


# ── Tablo bazlı çıkarım ──────────────────────────────────────────────────────
def extract_from_tables(tables):
    """
    pdfplumber tablo hücrelerinden ders kodu → not eşleşmesi çıkarır.
    • Kurs kodu olmayan satırlar bir önceki dersin tekrar kaydı sayılır.
    • best_grade politikası: geçer not kalan nota her zaman üstündür;
      ikisi de aynı türdeyse en son görülen seçilir.
    """
    results = {}
    for table in tables or []:
        current_canonical = None
        for row in table:
            cells = [str(c or "").strip() for c in row]
            canonical = None
            course_idx = None
            for i, cell in enumerate(cells):
                c = map_canonical(cell)
                if c:
                    canonical = c
                    course_idx = i
                    break

            if canonical is not None:
                current_canonical = canonical
                search_cells = cells[course_idx + 1:]
            elif current_canonical is not None:
                # Kurs kodu yok — muhtemelen tekrar satırı
                search_cells = cells
            else:
                continue

            for cell in search_cells:
                g = clean_grade(cell)
                if VALID_GRADE_RE.match(g):
                    results[current_canonical] = best_grade(results.get(current_canonical), g)
                    break
    return results


# ── Metin bazlı çıkarım ──────────────────────────────────────────────────────
def extract_from_text(text):
    """
    Koordinat bilgisi sayesinde pdfplumber metni daha temiz verir;
    mevcut JS mantığını Python'a aktarır.
    """
    results = {}
    lines = [norm(ln) for ln in text.split("\n") if norm(ln)]

    for i, line in enumerate(lines):
        lu = line.upper()
        found = []
        for canonical, aliases in COURSE_ALIASES.items():
            for alias in aliases:
                au = norm(alias).upper()
                idx = lu.find(au)
                if idx != -1:
                    found.append((idx, canonical, len(au)))
                    break
        if not found:
            continue
        found.sort()

        for pos, canonical, alen in found:
            after = lu[pos + alen:]
            gm = GRADE_SCAN_RE.search(after)
            if gm:
                results[canonical] = best_grade(results.get(canonical), clean_grade(gm.group(0)))
                continue
            # Sonraki satırda ara
            if i + 1 < len(lines):
                nxt = lines[i + 1].upper()
                has_course = any(
                    norm(a).upper() in nxt
                    for als in COURSE_ALIASES.values()
                    for a in als
                )
                if not has_course:
                    gm2 = GRADE_SCAN_RE.search(nxt)
                    if gm2:
                        results[canonical] = best_grade(results.get(canonical), clean_grade(gm2.group(0)))
    return results


# ── Soldan sağa düzgün sıralı metin çıkarımı ────────────────────────────────
def extract_ordered_text(plumber_page):
    """
    extract_words() ile kelimeleri önce y (satır), sonra x (soldan sağa)
    sırasına göre birleştirir. Çift sütunlu sayfalarda extract_text()
    kelimeleri karıştırabilir; bu yöntem daha güvenilirdir.
    """
    try:
        words = plumber_page.extract_words(x_tolerance=5, y_tolerance=3)
    except Exception:
        return plumber_page.extract_text(x_tolerance=3, y_tolerance=3) or ""

    if not words:
        return plumber_page.extract_text(x_tolerance=3, y_tolerance=3) or ""

    # Satırları y koordinatına göre grupla (5 piksel tolerans)
    ROW_SNAP = 5
    lines_dict = {}
    for w in words:
        row_key = round(w["top"] / ROW_SNAP) * ROW_SNAP
        lines_dict.setdefault(row_key, []).append(w)

    ordered_lines = []
    for row_key in sorted(lines_dict):
        row_words = sorted(lines_dict[row_key], key=lambda w: w["x0"])
        ordered_lines.append(" ".join(w["text"] for w in row_words))

    return "\n".join(ordered_lines)


# ── Sayfa işleme ─────────────────────────────────────────────────────────────
def parse_page(plumber_page):
    text = norm(extract_ordered_text(plumber_page))

    student_no = find_student_no(text)
    student_name = find_student_name(text)
    gno = find_gno(text)
    agno = find_agno(text)
    sinif = find_sinif(text)
    donem = find_donem(text)

    # Önce tablo bazlı
    tables = plumber_page.extract_tables()
    courses = extract_from_tables(tables)

    # Metin bazlı çıkarım; best_grade ile birleştir.
    text_courses = extract_from_text(text)
    for c, g in text_courses.items():
        courses[c] = best_grade(courses.get(c), g)

    return {
        "studentNo": student_no,
        "studentName": student_name,
        "gno": gno,
        "agno": agno,
        "sinif": sinif,
        "donem": donem,
        "courses": {c: courses.get(c) for c in TRACKED_COURSES},
    }


# ── PDF ayrıştırma ────────────────────────────────────────────────────────────
def parse_pdf(pdf_path):
    students = []
    total_pages = 0
    try:
        with pdfplumber.open(pdf_path) as pdf:
            total_pages = len(pdf.pages)
            for page in pdf.pages:
                text = norm(extract_ordered_text(page))
                if "Öğrenci No" not in text and "Student No" not in text:
                    continue
                if not is_lisans_page(text):
                    continue
                result = parse_page(page)
                if result["studentNo"] != "Bilinmiyor":
                    students.append(result)
    except Exception as e:
        return {"error": str(e), "students": [], "totalPages": 0}

    return {"students": students, "totalPages": total_pages}


# ── Giriş noktası ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    if len(sys.argv) < 2:
        out = json.dumps({"error": "PDF yolu gerekli"}, ensure_ascii=False)
        sys.stdout.buffer.write(out.encode("utf-8"))
        sys.exit(1)

    text_only = "--text-only" in sys.argv
    # Bayrakları çıkar, geri kalanın ilki PDF yolu
    positional = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not positional:
        out = json.dumps({"error": "PDF yolu gerekli"}, ensure_ascii=False)
        sys.stdout.buffer.write(out.encode("utf-8"))
        sys.exit(1)
    pdf_path = positional[0]
    if not os.path.exists(pdf_path):
        out = json.dumps(
            {"error": f"Dosya bulunamadı: {pdf_path}"}, ensure_ascii=False
        )
        sys.stdout.buffer.write(out.encode("utf-8"))
        sys.exit(1)

    if text_only:
        # Sadece sayfa metinlerini dönür (Gemini için)
        pages_out = []
        total_pages = 0
        try:
            with pdfplumber.open(pdf_path) as pdf:
                total_pages = len(pdf.pages)
                for i, page in enumerate(pdf.pages):
                    text = norm(extract_ordered_text(page))
                    if text.strip():
                        pages_out.append({"pageNum": i + 1, "text": text})
        except Exception as e:
            out = json.dumps({"error": str(e)}, ensure_ascii=False)
            sys.stdout.buffer.write(out.encode("utf-8"))
            sys.exit(1)
        result = {"pages": pages_out, "totalPages": total_pages}
    else:
        result = parse_pdf(pdf_path)

    sys.stdout.buffer.write(json.dumps(result, ensure_ascii=False).encode("utf-8"))
    sys.stdout.buffer.flush()
