const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const pdfParse = require('pdf-parse');

// .env dosyasından API key yükle (dotenv gerektirmez)
function loadEnvApiKey() {
  try {
    const envPath = path.join(__dirname, '.env');
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const match = line.match(/^GEMINI_API_KEY\s*=\s*(.+)$/);
      if (match) return match[1].trim();
    }
  } catch {}
  return '';
}
const ENV_GEMINI_API_KEY = loadEnvApiKey();

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

const PASSING_GRADES = new Set([
  'D', 'D+', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+'
]);

const COURSE_ALIASES = {
  // Temel CS dersleri
  BİL101: ['BİL101', 'BIL101', 'CSE101'],
  BİL105: ['BİL105', 'BIL105', 'CSE105'],
  BİL122: ['BİL122', 'BIL122', 'CSE122'],
  BİL124: ['BİL124', 'BIL124', 'CSE124'],
  BİL240: ['BİL240', 'BIL240', 'CSE240'],
  BİL265: ['BİL265', 'BIL265', 'CSE265'],
  BİL300: ['BİL300', 'BIL300', 'CSE300'],
  BİL324: ['BİL324', 'BIL324', 'CSE324'],
  BİL332: ['BİL332', 'BIL332', 'CSE332'],
  BİL343: ['BİL343', 'BIL343', 'CSE343'],
  BİL344: ['BİL344', 'BIL344', 'CSE344'],
  BİL367: ['BİL367', 'BIL367', 'CSE367'],
  BİL386: ['BİL386', 'BIL386', 'CSE386'],
  BİL493: ['BİL493', 'BIL493', 'CSE493'],
  // Matematik
  MAT151: ['MAT151', 'MATH151'],
  MAT152: ['MAT152', 'MATH152'],
  // Fizik
  FİZ103: ['FİZ103', 'FIZ103', 'PHYS103'],
  FİZ104: ['FİZ104', 'FIZ104', 'PHYS104'],
  FİZ105: ['FİZ105', 'FIZ105', 'PHYS105'],
  FİZ110: ['FİZ110', 'FIZ110', 'PHYS110'],
};

const STAJ1_REQUIRED = ['BİL240', 'BİL265'];
const STAJ2_REQUIRED = ['BİL343', 'BİL367', 'BİL344', 'BİL386'];

// BİL493 ön koşul kuralı: Bölüm derslerinden en az 4 tanesi + tüm ortak dersler ≥ D
const BİL493_BOLUM     = ['BİL324', 'BİL332', 'BİL343', 'BİL344', 'BİL367', 'BİL386'];
const BİL493_BOLUM_MIN = 4;
const BİL493_ORTAK     = ['MAT151', 'MAT152', 'FİZ103', 'FİZ104', 'FİZ105', 'FİZ110',
                           'BİL101', 'BİL105', 'BİL122', 'BİL124'];

const TRACKED_COURSES = Object.keys(COURSE_ALIASES);

// Gemini'ye sadece karıştırılabilecek staj/bölüm dersleri gönderilir;
// MAT/FİZ/BİL101-124 regex ile zaten doğru okunuyor, prompt boyutunu küçültmek için dışarıda bırakılır.
const GEMINI_COURSES = [
  'BİL240', 'BİL265', 'BİL300',
  'BİL324', 'BİL332',
  'BİL343', 'BİL344', 'BİL367', 'BİL386',
  'BİL493'
];

// Gemini 2.5 Flash fiyatlandırması ($/1M token, Mayıs 2026)
const GEMINI_INPUT_PRICE_PER_1M  = 0.075;
const GEMINI_OUTPUT_PRICE_PER_1M = 0.300;

const GRADE_REGEX = /(?<![A-Z0-9])(A\s*[+\-]|A|B\s*[+\-]|B|C\s*[+\-]|C|D\s*\+|D|F\s*[12]|X\s*X|Y|P)(?![A-Z0-9])/g;

function normalizeText(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/\u0000/g, ' ')
    .replace(/￾/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/Bİ̇L/g, 'BİL')
    .replace(/BIL/g, 'BİL')
    .replace(/[ ]{2,}/g, ' ')
    .trim();
}

function normalizeCode(code) {
  return normalizeText(code)
    .toUpperCase()
    .replace(/I/g, 'İ')
    .replace(/\s+/g, '');
}

function cleanGradeToken(token) {
  return String(token || '')
    .toUpperCase()
    .replace(/[＋]/g, '+')
    .replace(/[−–—]/g, '-')
    .replace(/\s+/g, '')
    .trim();
}

function hasPassingGrade(grade) {
  return PASSING_GRADES.has(cleanGradeToken(grade));
}

function extractPages(fullText) {
  return normalizeText(fullText)
    .split(/===PAGE_BREAK===/g)
    .map(page => page.trim())
    .filter(Boolean);
}

function findStudentNo(pageText) {
  const m = pageText.match(/Öğrenci No\s+(\d+)/i);
  return m ? m[1] : 'Bilinmiyor';
}

function findStudentName(pageText) {
  const normalized = normalizeText(pageText);

  // Format: "Adı Soyadı İSİM K: AKTS T: ..."
  let m = normalized.match(/Adı Soyadı\s+(.+?)\s+K:\s*AKTS/i);
  if (m) return m[1].trim();

  // Fallback: before "K:" without AKTS
  m = normalized.match(/Adı Soyadı\s+(.+?)\s+K:/i);
  if (m) return m[1].trim();

  // Fallback: before "Bölüm"
  m = normalized.match(/Adı Soyadı\s+(.+?)\s+Bölüm/i);
  if (m) return m[1].trim();

  // Fallback: before "GNO:"
  m = normalized.match(/Adı Soyadı\s+(.+?)\s+GNO:/i);
  if (m) return m[1].trim();

  return 'Bilinmiyor';
}

function isLisansPage(pageText) {
  const text = normalizeText(pageText).toUpperCase();

  const hasGraduateWords =
    text.includes('YÜKSEK LİSANS') ||
    text.includes('TEZLİ YÜKSEK LİSANS') ||
    text.includes('DOKTORA') ||
    text.includes('FEN BİLİMLERİ ENSTİTÜSÜ');

  const hasUndergradWords =
    text.includes('MÜHENDİSLİK FAKÜLTESİ') ||
    text.includes('LİSANS PROGRAMI') ||
    (
      text.includes('BİLGİSAYAR MÜHENDİSLİĞİ') &&
      !text.includes('YÜKSEK LİSANS') &&
      !text.includes('DOKTORA')
    );

  return hasUndergradWords && !hasGraduateWords;
}

function isRelevantPage(pageText) {
  const text = normalizeText(pageText).toUpperCase();

  return [
    'BİL240', 'BİL265', 'BİL300', 'BİL324', 'BİL332',
    'BİL343', 'BİL344', 'BİL367', 'BİL386', 'BİL493',
    'CSE240', 'CSE265', 'CSE300', 'CSE324', 'CSE332',
    'CSE343', 'CSE344', 'CSE367', 'CSE386', 'CSE493',
    'BIL240', 'BIL265', 'BIL300', 'BIL324', 'BIL332',
    'BIL343', 'BIL344', 'BIL367', 'BIL386', 'BIL493'
  ].some(code => text.includes(code));
}

function mapCanonicalCourse(code) {
  const normalized = normalizeCode(code);

  for (const [canonical, aliases] of Object.entries(COURSE_ALIASES)) {
    const normalizedAliases = aliases.map(alias => normalizeCode(alias));
    if (normalizedAliases.includes(normalized)) {
      return canonical;
    }
  }

  return null;
}

function extractGradeFromLine(line) {
  const normalized = normalizeText(line).toUpperCase();

  // PDF text extraction can split symbols: "B +", "C -", "F 1", "X X".
  const matches = normalized.match(GRADE_REGEX);

  if (!matches || matches.length === 0) return null;
  return cleanGradeToken(matches[0]);
}

function getGradeMatchesWithIndex(line) {
  const normalized = normalizeText(line).toUpperCase();
  const regex = new RegExp(GRADE_REGEX.source, 'g');
  const matches = [];

  let m;
  while ((m = regex.exec(normalized)) !== null) {
    matches.push({
      index: m.index,
      raw: m[0],
      grade: cleanGradeToken(m[0])
    });
  }

  return matches;
}

function getTrackedCourseMentions(line) {
  const normalized = normalizeText(line).toUpperCase();
  const mentions = [];

  for (const [canonical, aliases] of Object.entries(COURSE_ALIASES)) {
    for (const alias of aliases) {
      const aliasText = normalizeText(alias).toUpperCase();
      let from = 0;

      while (from < normalized.length) {
        const idx = normalized.indexOf(aliasText, from);
        if (idx === -1) break;

        mentions.push({
          canonical,
          index: idx,
          end: idx + aliasText.length
        });

        from = idx + aliasText.length;
      }
    }
  }

  mentions.sort((a, b) => a.index - b.index || (b.end - b.index) - (a.end - a.index));

  const deduped = [];
  for (const item of mentions) {
    const sameStart = deduped.find(existing => existing.index === item.index && existing.canonical === item.canonical);
    if (!sameStart) deduped.push(item);
  }

  return deduped;
}

function hasAnyTrackedCourseAlias(line) {
  return getTrackedCourseMentions(line).length > 0;
}

function extractGradeForCanonicalFromLine(line, canonicalCourse) {
  const mentions = getTrackedCourseMentions(line)
    .filter(item => item.canonical === canonicalCourse)
    .sort((a, b) => a.index - b.index);

  if (mentions.length === 0) return null;

  const allMentions = getTrackedCourseMentions(line).sort((a, b) => a.index - b.index);
  const gradeMatches = getGradeMatchesWithIndex(line);

  for (const mention of mentions) {
    const nextMention = allMentions.find(item => item.index > mention.index);
    const rightBound = nextMention ? nextMention.index : Number.POSITIVE_INFINITY;

    const grade = gradeMatches.find(g => g.index >= mention.end && g.index < rightBound);
    if (grade) return grade.grade;
  }

  return null;
}

function extractLines(pageText) {
  return normalizeText(pageText)
    .split('\n')
    .map(line => normalizeText(line))
    .filter(Boolean);
}

function lineContainsAnyAlias(line, aliases) {
  const normalizedLine = normalizeCode(line);
  return aliases.some(alias => normalizedLine.includes(normalizeCode(alias)));
}

function buildEmptyCourseMap(defaultValueFactory) {
  const map = {};
  for (const course of TRACKED_COURSES) {
    map[course] = defaultValueFactory(course);
  }
  return map;
}

function pickBestCandidate(candidates) {
  if (!candidates || candidates.length === 0) return null;

  const sorted = [...candidates].sort((a, b) => {
    if (a.confidence !== b.confidence) return b.confidence - a.confidence;
    return b.lineIndex - a.lineIndex;
  });

  return sorted[0];
}

function extractCoursesAndGradesInOrder(pageText) {
  const text = normalizeText(pageText).toUpperCase();

  const mentionRegexParts = TRACKED_COURSES.flatMap(course => {
    const uniqueAliases = [...new Set(
      COURSE_ALIASES[course]
        .map(alias => normalizeText(alias).toUpperCase())
    )];

    return uniqueAliases
      .sort((a, b) => b.length - a.length)
      .map(alias => ({ course, alias }));
  });

  const orderedCourseMentions = [];
  for (const { course, alias } of mentionRegexParts) {
    let from = 0;
    while (from < text.length) {
      const idx = text.indexOf(alias, from);
      if (idx === -1) break;

      orderedCourseMentions.push({
        course,
        alias,
        index: idx
      });

      from = idx + alias.length;
    }
  }

  orderedCourseMentions.sort((a, b) => a.index - b.index);

  const dedupedCourseMentions = [];
  const seenCourseMention = new Set();
  for (const mention of orderedCourseMentions) {
    const key = `${mention.course}:${mention.index}`;
    if (seenCourseMention.has(key)) continue;
    seenCourseMention.add(key);
    dedupedCourseMentions.push(mention);
  }

  const orderedGrades = [];
  const gradeRegex = new RegExp(GRADE_REGEX.source, 'g');
  let match;
  while ((match = gradeRegex.exec(text)) !== null) {
    orderedGrades.push({
      grade: cleanGradeToken(match[0]),
      index: match.index
    });
  }

  return {
    orderedCourseMentions: dedupedCourseMentions,
    orderedGrades
  };
}

function parseCoursesFromLinesWithDiagnostics(lines) {
  const diagnostics = buildEmptyCourseMap(() => ({
    source: 'none',
    confidence: 0,
    candidates: [],
    conflict: false,
    selectedLine: null
  }));

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const mentions = getTrackedCourseMentions(line).sort((a, b) => a.index - b.index);
    if (mentions.length === 0) continue;

    const gradeMatches = getGradeMatchesWithIndex(line);

    for (let mIdx = 0; mIdx < mentions.length; mIdx++) {
      const mention = mentions[mIdx];
      const nextMention = mentions[mIdx + 1];
      const rightBound = nextMention ? nextMention.index : Number.POSITIVE_INFINITY;

      const sameLineGrade = gradeMatches.find(g => g.index >= mention.end && g.index < rightBound);
      if (sameLineGrade) {
        diagnostics[mention.canonical].candidates.push({
          grade: sameLineGrade.grade,
          source: 'line-same',
          confidence: 0.92,
          lineIndex: i
        });
        continue;
      }

      if (i + 1 < lines.length && !hasAnyTrackedCourseAlias(lines[i + 1])) {
        const nextLineGrade = extractGradeFromLine(lines[i + 1]);
        if (nextLineGrade) {
          diagnostics[mention.canonical].candidates.push({
            grade: nextLineGrade,
            source: 'line-next-1',
            confidence: 0.79,
            lineIndex: i + 1
          });
          continue;
        }
      }

      if (i + 2 < lines.length && !hasAnyTrackedCourseAlias(lines[i + 2])) {
        const secondNextLineGrade = extractGradeFromLine(lines[i + 2]);
        if (secondNextLineGrade) {
          diagnostics[mention.canonical].candidates.push({
            grade: secondNextLineGrade,
            source: 'line-next-2',
            confidence: 0.67,
            lineIndex: i + 2
          });
        }
      }
    }
  }

  const courses = buildEmptyCourseMap(() => null);

  for (const course of TRACKED_COURSES) {
    const best = pickBestCandidate(diagnostics[course].candidates);
    if (best) {
      courses[course] = best.grade;
      diagnostics[course].source = best.source;
      diagnostics[course].confidence = best.confidence;
      diagnostics[course].selectedLine = best.lineIndex;

      const uniqueGrades = new Set(diagnostics[course].candidates.map(c => c.grade));
      diagnostics[course].conflict = uniqueGrades.size > 1;
      if (diagnostics[course].conflict) {
        diagnostics[course].confidence = Math.max(0.45, diagnostics[course].confidence - 0.18);
      }
    }
  }

  return { courses, diagnostics };
}

function applyGlobalFallback(pageText, courses, diagnostics) {
  const { orderedCourseMentions, orderedGrades } = extractCoursesAndGradesInOrder(pageText);
  if (orderedCourseMentions.length === 0 || orderedGrades.length === 0) return;

  const lastMentionIndexByCourse = buildEmptyCourseMap(() => -1);
  for (let i = 0; i < orderedCourseMentions.length; i++) {
    lastMentionIndexByCourse[orderedCourseMentions[i].course] = i;
  }

  for (const course of TRACKED_COURSES) {
    if (courses[course]) continue;

    const mentionIdx = lastMentionIndexByCourse[course];
    if (mentionIdx === -1) continue;
    if (mentionIdx >= orderedGrades.length) continue;

    const mappedGrade = orderedGrades[mentionIdx].grade;
    courses[course] = mappedGrade;
    diagnostics[course].source = 'global-index-fallback';
    diagnostics[course].confidence = 0.58;
    diagnostics[course].selectedLine = null;
  }
}

function normalizeNameForMatch(name) {
  return String(name || '')
    .replace(/ı/g, 'İ')
    .replace(/i/g, 'İ')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .sort()
    .join(' ');
}

// Transkriptteki isim kelimelerinin TAMAMI liste girişindeki isimde geçiyorsa eşleşir.
// Böylece listede önde fazladan kelime olsa da eşleşme çalışır.
function nameWordsMatch(transcriptName, listEntryName) {
  const normalize = s => String(s || '')
    .replace(/ı/g, 'İ').replace(/i/g, 'İ')
    .toUpperCase().trim().split(/\s+/).filter(Boolean);

  const transcriptWords = normalize(transcriptName);
  const listWords       = normalize(listEntryName);
  if (transcriptWords.length === 0 || listWords.length === 0) return false;

  // İki yönlü alt-küme kontrolü: kısa olan tarafın tüm kelimeleri uzun olan tarafta mı?
  const [shorter, longerSet] = transcriptWords.length <= listWords.length
    ? [transcriptWords, new Set(listWords)]
    : [listWords,       new Set(transcriptWords)];

  return shorter.every(w => longerSet.has(w));
}

// "Son Not Döküm Belgesi" türü PDF'ten öğrenci numaralarını ve ders bilgisini çıkarır.
// Yaklaşım: satır satır işle → 8 haneli numarayı bul → numara sonrasındaki
// büyük harfli Türkçe kelimeleri (≥3 harf) topla.
// Not kodları (AA, BB, CC, XX… = 2 harf), sıra no'ları ve tarihler otomatik elenir.
function parseStudentListFromPages(pages) {
  const studentEntries = [];
  const seenNos = new Set();
  let courseCode = null;
  let courseName = null;

  for (const page of pages) {
    const text = normalizeText(page);

    if (!courseCode) {
      const codeMatch = text.match(/Dersin Kodu\s*[:\-]\s*(\S+)/i);
      if (codeMatch) courseCode = codeMatch[1].trim();
    }
    if (!courseName) {
      const nameMatch = text.match(/Dersin Ad[ıi]\s*[:\-]\s*(.+)/i);
      if (nameMatch) courseName = nameMatch[1].trim();
    }

    for (const line of text.split('\n')) {
      // 8 haneli öğrenci numarası içeren satır mı?
      const noMatch = line.match(/\b(\d{8})\b/);
      if (!noMatch) continue;
      const studentNo = noMatch[1];
      if (seenNos.has(studentNo)) continue;

      // Numara sonrasındaki büyük harfli Türkçe kelimeler (≥3 harf) → isim
      // 2 harfli not kodları (AA/BB/CC/XX…) ve kısa token'lar bu şekilde elenir
      const afterNo = line.slice(noMatch.index + studentNo.length);
      const nameWords = [...afterNo.matchAll(/[A-ZÇĞİÖŞÜ]{3,}/g)].map(m => m[0]);
      if (nameWords.length < 2) continue; // en az 2 isim kelimesi olmalı

      seenNos.add(studentNo);
      const name = nameWords.join(' ');
      studentEntries.push({
        studentNo,
        name,
        normalizedName: normalizeNameForMatch(name)
      });
    }
  }

  return {
    studentEntries,
    courseCode: courseCode || null,
    courseName: courseName || null,
    totalFound: studentEntries.length
  };
}

// Progress state for polling
let _analyzeProgress = null;
ipcMain.handle('get-analyze-progress', () => _analyzeProgress);

ipcMain.handle('pick-student-list-pdf', async () => {
  try {
    const result = await dialog.showOpenDialog({
      title: 'Öğrenci Listesi PDF seç (Son Not Döküm Belgesi)',
      properties: ['openFile'],
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }

    const filePath = result.filePaths[0];
    const buffer = fs.readFileSync(filePath);
    const { pages } = await extractPagesFromPdfTextLayer(buffer);
    const listData = parseStudentListFromPages(pages);

    return {
      canceled: false,
      filePath,
      studentEntries: listData.studentEntries,
      courseCode: listData.courseCode,
      courseName: listData.courseName,
      totalFound: listData.totalFound
    };
  } catch (error) {
    console.error('Öğrenci listesi okuma hatası:', error);
    throw error;
  }
});

// Sayfadaki son takip edilen ders kodu konumuna göre dinamik metin penceresi döndürür.
function getRelevantTextWindow(pageText, trailingBuffer = 800, maxChars = 25000) {
  const normalized = normalizeText(pageText).toUpperCase();

  let lastEnd = -1;
  for (const aliases of Object.values(COURSE_ALIASES)) {
    for (const alias of aliases) {
      const aliasText = normalizeText(alias).toUpperCase();
      let from = 0;
      while (from < normalized.length) {
        const idx = normalized.indexOf(aliasText, from);
        if (idx === -1) break;
        const end = idx + aliasText.length;
        if (end > lastEnd) lastEnd = end;
        from = end;
      }
    }
  }

  const cutoff = lastEnd === -1
    ? pageText.length          // ders kodu yoksa tüm sayfa
    : lastEnd + trailingBuffer;

  return pageText.substring(0, Math.min(cutoff, maxChars));
}

async function callGeminiForStudentWithContext(pageText, apiKey, regexCourses, _retryCount = 0) {
  const regexSummary = GEMINI_COURSES
    .map(c => `${c}: ${regexCourses[c] || 'bulunamadı'}`)
    .join(', ');

  const prompt =
    `Türk üniversitesi transkriptinden ders notlarını doğrula ve düzelt.\n\n` +
    `Regex parser şu sonuçları buldu: ${regexSummary}\n\n` +
    `Transkripti okuyarak:\n` +
    `- Yanlış eşleştirilmiş notları düzelt (not başka bir derse ait olabilir)\n` +
    `- "bulunamadı" olanları transkriptte varsa doldur\n` +
    `- Ders birden fazla alınmışsa EN SON alınan notu kullan\n` +
    `- Geçerli notlar: A+, A, A-, B+, B, B-, C+, C, C-, D+, D, F, XX, Y, P\n` +
    `- Ders yoksa null döndür\n` +
    `- "studentName" alanına transkript başlığındaki öğrencinin adı soyadını büyük harflerle yaz (örn: "HATİCE SILA AKMAN"), bulamazsan null\n` +
    `- SADECE JSON döndür\n\n` +
    `Transkript:\n${getRelevantTextWindow(pageText)}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  let response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            maxOutputTokens: 1024,
            thinkingConfig: { thinkingBudget: 0 }
          }
        })
      }
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errBody = await response.text();
    if (response.status === 429) {
      if (_retryCount >= 3) throw new Error('Gemini rate limit: 3 denemede 429 alındı, atlanıyor');
      const base = parseInt(response.headers.get('Retry-After') || '30', 10) * 1000;
      const jitter = Math.random() * 10000;
      const waitMs = Math.min(base + jitter, 90000);
      _analyzeProgress = { ..._analyzeProgress, rateLimited: true, waitUntil: Date.now() + waitMs };
      await new Promise(r => setTimeout(r, waitMs));
      _analyzeProgress = { ..._analyzeProgress, rateLimited: false };
      return callGeminiForStudentWithContext(pageText, apiKey, regexCourses, _retryCount + 1);
    }
    throw new Error(`Gemini API ${response.status}: ${errBody.slice(0, 200)}`);
  }

  const data = await response.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error(`Gemini boş yanıt (${data.candidates?.[0]?.finishReason || '?'})`);
  }

  const promptTokens = data.usageMetadata?.promptTokenCount     || 0;
  const outputTokens = data.usageMetadata?.candidatesTokenCount || 0;

  const parsed = JSON.parse(rawText);
  const courses = {};
  for (const course of TRACKED_COURSES) courses[course] = null;
  let studentName = null;
  for (const [key, value] of Object.entries(parsed)) {
    if (key === 'studentName') {
      studentName = value ? String(value).trim() : null;
      continue;
    }
    const canonical = mapCanonicalCourse(key) || (TRACKED_COURSES.includes(key) ? key : null);
    if (canonical) courses[canonical] = value ? cleanGradeToken(String(value)) : null;
  }
  return { courses, studentName, promptTokens, outputTokens };
}

function buildParseSummary(students) {
  const summary = {
    totalStudents: students.length,
    lowConfidenceStudents: 0,
    fallbackUsedStudents: 0,
    missingCourseEntries: 0,
    totalCourseEntries: students.length * TRACKED_COURSES.length,
    lowConfidenceCourses: 0
  };

  for (const student of students) {
    const diagnostics = student.parseDiagnostics?.courses || {};
    const lowConfidenceCount = student.parseDiagnostics?.lowConfidenceCourses?.length || 0;
    const fallbackUsed = Object.values(diagnostics).some(item => item?.source === 'global-index-fallback');

    if (lowConfidenceCount > 0) summary.lowConfidenceStudents += 1;
    if (fallbackUsed) summary.fallbackUsedStudents += 1;

    for (const course of TRACKED_COURSES) {
      if (!student.courses[course]) summary.missingCourseEntries += 1;
      if ((diagnostics[course]?.confidence || 0) < 0.75) {
        summary.lowConfidenceCourses += 1;
      }
    }
  }

  return summary;
}

function findGradeForCourseFromLines(lines, aliases) {
  const canonicalCourse = mapCanonicalCourse(aliases[0]);
  const foundGrades = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (lineContainsAnyAlias(line, aliases)) {
      const sameLineGrade = canonicalCourse
        ? extractGradeForCanonicalFromLine(line, canonicalCourse)
        : extractGradeFromLine(line);

      if (sameLineGrade) {
        foundGrades.push(sameLineGrade);
        continue;
      }

      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        const nextLineGrade = hasAnyTrackedCourseAlias(nextLine) ? null : extractGradeFromLine(nextLine);
        if (nextLineGrade) {
          foundGrades.push(nextLineGrade);
          continue;
        }
      }

      if (i + 2 < lines.length) {
        const secondNextLine = lines[i + 2];
        const secondNextLineGrade = hasAnyTrackedCourseAlias(secondNextLine) ? null : extractGradeFromLine(secondNextLine);
        if (secondNextLineGrade) {
          foundGrades.push(secondNextLineGrade);
        }
      }
    }
  }

  if (foundGrades.length === 0) return null;

  // Ayni ders birden fazla alindiginda en son denemenin notunu kullan.
  return foundGrades[foundGrades.length - 1];
}

function parseStudentPage(pageText) {
  const studentNo = findStudentNo(pageText);
  const studentName = findStudentName(pageText);
  const lines = extractLines(pageText);

  const parsedFromLines = parseCoursesFromLinesWithDiagnostics(lines);
  const courses = parsedFromLines.courses;
  const courseDiagnostics = parsedFromLines.diagnostics;

  applyGlobalFallback(pageText, courses, courseDiagnostics);

  const lowConfidenceCourses = TRACKED_COURSES.filter(course => {
    const conf = courseDiagnostics[course]?.confidence || 0;
    return conf < 0.75;
  });

  const avgConfidence = TRACKED_COURSES
    .map(course => courseDiagnostics[course]?.confidence || 0)
    .reduce((sum, value) => sum + value, 0) / TRACKED_COURSES.length;

  return {
    studentNo,
    studentName,
    courses,
    parseDiagnostics: {
      averageConfidence: Number(avgConfidence.toFixed(3)),
      lowConfidenceCourses,
      courses: courseDiagnostics
    },
    _debug: {
      firstLines: lines.slice(0, 25)
    }
  };
}

function evaluateStudent(student) {
  const staj1Details = STAJ1_REQUIRED.map(code => {
    const grade = student.courses[code];
    return { code, grade, passed: hasPassingGrade(grade) };
  });
  const staj1Eligible = staj1Details.every(item => item.passed);

  const staj1CourseGrade = student.courses['BİL300'];
  const staj1TakenAndPassed = hasPassingGrade(staj1CourseGrade);

  const staj2Details = STAJ2_REQUIRED.map(code => {
    const grade = student.courses[code];
    return { code, grade, passed: hasPassingGrade(grade) };
  });
  const staj2Eligible =
    staj1Eligible &&
    staj1TakenAndPassed &&
    staj2Details.every(item => item.passed);

  // BİL493 ön koşul: bölüm derslerinden en az 4 tanesi + tüm ortak dersler ≥ D
  const bil493BolumDetails = BİL493_BOLUM.map(code => {
    const grade = student.courses[code];
    return { code, grade, passed: hasPassingGrade(grade) };
  });
  const bil493BolumPassedCount = bil493BolumDetails.filter(i => i.passed).length;

  const bil493OrtakDetails = BİL493_ORTAK.map(code => {
    const grade = student.courses[code];
    return { code, grade, passed: hasPassingGrade(grade) };
  });
  const bil493OrtakAllPassed = bil493OrtakDetails.every(i => i.passed);

  const bil493Eligible = bil493BolumPassedCount >= BİL493_BOLUM_MIN && bil493OrtakAllPassed;

  // BİL494 ön koşul: BİL493 tamamlanmış olmalı
  const bil493AlreadyPassed = hasPassingGrade(student.courses['BİL493']);
  const bil494Eligible = bil493AlreadyPassed;

  return {
    studentNo: student.studentNo,
    studentName: student.studentName,
    courses: student.courses,
    staj1Details,
    staj1Eligible,
    staj1CourseGrade,
    staj1TakenAndPassed,
    staj2Details,
    staj2Eligible,
    bil493BolumDetails,
    bil493BolumPassedCount,
    bil493OrtakDetails,
    bil493OrtakAllPassed,
    bil493Eligible,
    bil493AlreadyPassed,
    bil494Eligible,
    parseDiagnostics: student.parseDiagnostics,
    _debug: student._debug
  };
}

function groupTextItemsToRows(items) {
  const rows = [];

  for (const item of items) {
    const str = String(item.str || '').trim();
    if (!str) continue;

    const x = item.transform[4];
    const y = item.transform[5];

    let existingRow = rows.find(row => Math.abs(row.y - y) <= 1.2);

    if (!existingRow) {
      existingRow = { y, items: [] };
      rows.push(existingRow);
    }

    existingRow.items.push({ x, str });
  }

  rows.sort((a, b) => b.y - a.y);

  const lines = rows.map(row => {
    row.items.sort((a, b) => a.x - b.x);
    return row.items.map(item => item.str).join(' ');
  });

  return lines;
}

async function extractPagesFromPdfTextLayer(buffer) {
  const parsed = await pdfParse(buffer, {
    pagerender: async (pageData) => {
      const textContent = await pageData.getTextContent();
      const lines = groupTextItemsToRows(textContent.items);
      return lines.join('\n') + '\n===PAGE_BREAK===\n';
    }
  });

  return {
    pages: extractPages(parsed.text),
    totalPages: parsed.numpages
  };
}

ipcMain.handle('pick-pdf-and-analyze', async (_event, options = {}) => {
  try {
    const result = await dialog.showOpenDialog({
      title: 'Transkript PDF seç',
      properties: ['openFile'],
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }

    const filePath = result.filePaths[0];
    const buffer = fs.readFileSync(filePath);

    const { pages, totalPages } = await extractPagesFromPdfTextLayer(buffer);

    const filterEntries = Array.isArray(options.filterStudentEntries) && options.filterStudentEntries.length > 0
      ? options.filterStudentEntries
      : null;

    const relevantPages = pages.filter(page => {
      const normalized = normalizeText(page);
      if (!normalized.includes('Öğrenci No')) return false;
      if (!isLisansPage(normalized)) return false;
      if (!isRelevantPage(normalized)) return false;
      return true;
    });

    const apiKey = (typeof options.apiKey === 'string' ? options.apiKey.trim() : '') || ENV_GEMINI_API_KEY;

    const parseResults = [];
    let totalPromptTokens = 0;
    let totalOutputTokens = 0;

    if (apiKey) {
      // Önce tüm öğrenciler için regex parser çalıştır
      const regexResults = relevantPages.map(parseStudentPage);
      const total = regexResults.length;
      let doneCount = 0;

      _analyzeProgress = { phase: 'gemini-start', done: 0, total };

      // 5'li gruplar halinde paralel Gemini doğrulaması — her öğrenci bitince progress gönder
      const CONCURRENCY = 5;
      for (let i = 0; i < regexResults.length; i += CONCURRENCY) {
        const chunk = regexResults.slice(i, i + CONCURRENCY);
        const chunkPages = relevantPages.slice(i, i + CONCURRENCY);

        const chunkResults = await Promise.all(
          chunk.map(async (regexResult, idx) => {
            let result;
            try {
              const { courses, studentName, promptTokens, outputTokens } = await callGeminiForStudentWithContext(
                chunkPages[idx], apiKey, regexResult.courses
              );
              totalPromptTokens += promptTokens;
              totalOutputTokens += outputTokens;
              // Gemini sadece GEMINI_COURSES'u doğrular; MAT/FİZ/BİL101-124 için regex değerini koru
              const mergedCourses = { ...regexResult.courses };
              for (const c of GEMINI_COURSES) mergedCourses[c] = courses[c];
              result = {
                ...regexResult,
                studentName: studentName || regexResult.studentName,
                courses: mergedCourses,
                parseDiagnostics: { geminiUsed: true, averageConfidence: 1.0, lowConfidenceCourses: [], courses: {} }
              };
            } catch (err) {
              console.warn(`Gemini hatası (${regexResult.studentNo}): ${err.message} — regex kullanılıyor`);
              result = regexResult;
            }
            doneCount++;
            _analyzeProgress = { phase: 'gemini', done: doneCount, total };
            console.log(`Gemini: ${doneCount}/${total} — ${result.studentName || result.studentNo}`);
            return result;
          })
        );
        parseResults.push(...chunkResults);
      }
    } else {
      for (const page of relevantPages) parseResults.push(parseStudentPage(page));
    }

    const students = parseResults
      .map(evaluateStudent)
      .filter(student => student.studentNo !== 'Bilinmiyor');

    // Liste verilmişse: isim eşleşmesi Gemini'nin çıkardığı adla yapılır
    const missingStudents = filterEntries
      ? filterEntries
          .filter(e => !students.some(s => nameWordsMatch(s.studentName, e.name)))
          .map(e => ({ studentNo: e.studentNo, studentName: e.name }))
      : [];

    // Her öğrenciye inList flag ekle: listede yer alıyor mu?
    const studentsTagged = students.map(s => ({
      ...s,
      inList: !filterEntries || filterEntries.some(e => nameWordsMatch(s.studentName, e.name))
    }));

    const estimatedCostUSD =
      (totalPromptTokens / 1_000_000) * GEMINI_INPUT_PRICE_PER_1M +
      (totalOutputTokens / 1_000_000) * GEMINI_OUTPUT_PRICE_PER_1M;

    console.log(`Toplam sayfa: ${totalPages} | Öğrenci sayfası: ${relevantPages.length} | Öğrenci: ${studentsTagged.length}${apiKey ? ` | Gemini kullanıldı | ${totalPromptTokens}p + ${totalOutputTokens}o token | ~$${estimatedCostUSD.toFixed(4)}` : ''}`);

    const parseSummary = buildParseSummary(studentsTagged);

    return {
      canceled: false,
      filePath,
      totalPages,
      totalStudents: studentsTagged.length,
      parseSummary,
      geminiUsed: Boolean(apiKey),
      tokenStats: apiKey ? { totalPromptTokens, totalOutputTokens, estimatedCostUSD } : null,
      missingStudents,
      students: studentsTagged
    };
  } catch (error) {
    console.error('PDF analiz hatası:', error);
    throw error;
  }
});