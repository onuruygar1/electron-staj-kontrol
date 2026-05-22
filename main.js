const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const pdfParse = require('pdf-parse');
const { Document, Packer, Table, TableRow, TableCell, Paragraph, TextRun, WidthType, AlignmentType, HeadingLevel, BorderStyle } = require('docx');

function getPdfParserExePath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'pdf_parser.exe');
  }
  return path.join(__dirname, 'pdf_parser.exe');
}


function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    icon: path.join(__dirname, 'logo.jpeg'),
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

const GRADE_ORDER = {
  F: 0, F1: 0, F2: 0, XX: 0,
  D: 1, 'D+': 2,
  'C-': 3, C: 4, 'C+': 5,
  'B-': 6, B: 7, 'B+': 8,
  'A-': 9, A: 10, 'A+': 11,
  Y: 5, P: 5,
};

function gradeRank(grade) {
  return GRADE_ORDER[cleanGradeToken(grade)] ?? -1;
}

const COURSE_ALIASES = {
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
  BİL494: ['BİL494', 'BIL494', 'CSE494'],
  BİL498: ['BİL498', 'BIL498', 'CSE498'],
  MAT151: ['MAT151', 'MATH151'],
  MAT152: ['MAT152', 'MATH152'],
  FİZ103: ['FİZ103', 'FIZ103', 'PHYS103'],
  FİZ104: ['FİZ104', 'FIZ104', 'PHYS104'],
  FİZ105: ['FİZ105', 'FIZ105', 'PHYS105'],
  FİZ110: ['FİZ110', 'FIZ110', 'PHYS110'],
};

const DEFAULT_REQUIREMENTS = {
  staj1: ['BİL240', 'BİL265'],
  staj1Min: 2,
  staj1Course: 'BİL300',
  staj2: ['BİL343', 'BİL367', 'BİL344', 'BİL386'],
  staj2Min: 4,
  staj2Course: 'BİL498',
  bil493Bolum: ['BİL324', 'BİL332', 'BİL343', 'BİL344', 'BİL367', 'BİL386'],
  bil493BolumMin: 4,
  bil493Ortak: ['MAT151', 'MAT152', 'FİZ103', 'FİZ104', 'FİZ105', 'FİZ110',
                 'BİL101', 'BİL105', 'BİL122', 'BİL124'],
  bil494Prereq: 'BİL493'
};

const TRACKED_COURSES = Object.keys(COURSE_ALIASES);

// Kullanıcı kendi koşul listesine bir ders eklediğinde, kanonik koda göre
// otomatik alias üretip TRACKED_COURSES'a dahil ederiz; böylece parser
// o dersin notunu da çıkarmaya çalışır.
function ensureCourseRegistered(rawCode) {
  if (!rawCode) return null;
  const canonical = normalizeCode(rawCode);
  if (!canonical) return null;
  if (COURSE_ALIASES[canonical]) return canonical;

  const aliases = new Set([canonical]);
  if (canonical.startsWith('BİL')) {
    const num = canonical.slice(3);
    aliases.add('BIL' + num);
    aliases.add('CSE' + num);
  } else if (canonical.startsWith('BIL')) {
    const num = canonical.slice(3);
    aliases.add('BİL' + num);
    aliases.add('CSE' + num);
  } else if (canonical.startsWith('CSE')) {
    const num = canonical.slice(3);
    aliases.add('BİL' + num);
    aliases.add('BIL' + num);
  } else if (canonical.startsWith('MAT')) {
    const num = canonical.slice(3);
    aliases.add('MATH' + num);
  } else if (canonical.startsWith('MATH')) {
    const num = canonical.slice(4);
    aliases.add('MAT' + num);
  } else if (canonical.startsWith('FİZ') || canonical.startsWith('FIZ')) {
    const num = canonical.slice(3);
    aliases.add('FİZ' + num);
    aliases.add('FIZ' + num);
    aliases.add('PHYS' + num);
  } else if (canonical.startsWith('PHYS')) {
    const num = canonical.slice(4);
    aliases.add('FİZ' + num);
    aliases.add('FIZ' + num);
  }

  COURSE_ALIASES[canonical] = [...aliases];
  TRACKED_COURSES.push(canonical);
  return canonical;
}

function buildRequirements(input) {
  const cfg = input && typeof input === 'object' ? input : {};
  const cleanList = (arr, fallback) => {
    if (!Array.isArray(arr)) return [...fallback];
    const out = [];
    for (const c of arr) {
      const canonical = ensureCourseRegistered(c);
      if (canonical && !out.includes(canonical)) out.push(canonical);
    }
    return out;
  };
  const clampMin = (val, fallback, list) => {
    const n = Number.isFinite(val) ? Math.max(0, Math.floor(val)) : fallback;
    return Math.min(n, list.length);
  };
  const cleanSingle = (val, fallback) => {
    const canonical = val ? ensureCourseRegistered(String(val)) : null;
    return canonical || fallback;
  };
  const staj1  = cleanList(cfg.staj1,      DEFAULT_REQUIREMENTS.staj1);
  const staj2  = cleanList(cfg.staj2,      DEFAULT_REQUIREMENTS.staj2);
  const bolum  = cleanList(cfg.bil493Bolum, DEFAULT_REQUIREMENTS.bil493Bolum);
  const ortak  = cleanList(cfg.bil493Ortak, DEFAULT_REQUIREMENTS.bil493Ortak);
  return {
    staj1,
    staj1Min: clampMin(cfg.staj1Min, DEFAULT_REQUIREMENTS.staj1Min, staj1),
    staj1Course: cleanSingle(cfg.staj1Course, DEFAULT_REQUIREMENTS.staj1Course),
    staj2,
    staj2Min: clampMin(cfg.staj2Min, DEFAULT_REQUIREMENTS.staj2Min, staj2),
    staj2Course: cleanSingle(cfg.staj2Course, DEFAULT_REQUIREMENTS.staj2Course),
    bil493Bolum: bolum,
    bil493BolumMin: clampMin(cfg.bil493BolumMin, DEFAULT_REQUIREMENTS.bil493BolumMin, bolum),
    bil493Ortak: ortak,
    bil494Prereq: cleanSingle(cfg.bil494Prereq, DEFAULT_REQUIREMENTS.bil494Prereq)
  };
}


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
  const text = normalizeText(pageText);

  const patterns = [
    /Öğrenci\s+No[:\-\s]+(\d{7,10})/i,
    /Öğrenci\s+Numara[sı]+[:\-\s]+(\d{7,10})/i,
    /Öğr\.\s*No[:\-\s]+(\d{7,10})/i,
    /Student\s+No[:\-\s]+(\d{7,10})/i,
    /Student\s+Number[:\-\s]+(\d{7,10})/i,
    /No\s*[:\-]\s*(\d{7,10})\b/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1];
  }

  const allNums = [...text.matchAll(/\b(\d{8})\b/g)].map(m => m[1]);
  if (allNums.length === 1) return allNums[0];

  return 'Bilinmiyor';
}

function findStudentName(pageText) {
  const normalized = normalizeText(pageText);

  const labelRe = /(?:Adı?\s*\/?)\s*Soyadı?|Ad\s+Soyad|Name\s*:/i;

  const stopRe = /(?:K:\s*AKTS|AKTS|K:|Bölüm|GNO|Program|Fakülte|Faculty|Dept|T\.C\.|Doğum|Mezun|Şube|Tarih)/i;

  const labelMatch = normalized.match(labelRe);
  if (labelMatch) {
    const afterLabel = normalized.slice(labelMatch.index + labelMatch[0].length);
    const afterClean = afterLabel.replace(/^[\s:\-]+/, '');
    const stopMatch = afterClean.match(stopRe);
    const raw = stopMatch ? afterClean.slice(0, stopMatch.index) : afterClean.split('\n')[0];
    const candidate = raw.split('\n')[0].trim();
    if (candidate.length >= 3 && !/\d/.test(candidate)) return candidate;
  }

  for (const line of normalized.split('\n').slice(0, 15)) {
    const trimmed = line.trim();
    if (/^[A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜ\s]{4,}$/.test(trimmed)) {
      const words = trimmed.split(/\s+/).filter(Boolean);
      if (words.length >= 2 && words.every(w => w.length >= 2)) {
        if (!/\b[A-Z]{2,4}\d{3}\b/.test(trimmed)) return trimmed;
      }
    }
  }

  return 'Bilinmiyor';
}

function findGno(pageText) {
  const text = normalizeText(pageText);
  const agnoRe = /AGNO\s*[:\=]?\s*\d[\.,]\d{2}/gi;
  const agnoRanges = [];
  let am;
  while ((am = agnoRe.exec(text)) !== null) agnoRanges.push([am.index, am.index + am[0].length]);
  const inAgno = (pos) => agnoRanges.some(([s, e]) => pos >= s && pos < e);

  const patterns = [
    /Genel\s+Not\s+Ortalamas[ıi]\s*[:\=]?\s*(\d[\.,]\d{2})/i,
    /(?<![A-Za-z])GNO\s*[:\=]?\s*(\d[\.,]\d{2})/i,
    /GPA\s*[:\=]?\s*(\d[\.,]\d{2})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m && !inAgno(m.index)) {
      const val = m[1].replace(',', '.');
      const f = parseFloat(val);
      if (f >= 0 && f <= 4.0) return val;
    }
  }
  return null;
}

function findAgno(pageText) {
  const text = normalizeText(pageText);
  const patterns = [
    /Ağırlıklı\s+Genel\s+Not\s+Ortalamas[ıi]\s*[:\=]?\s*(\d[\.,]\d{2})/i,
    /AGNO\s*[:\=]?\s*(\d[\.,]\d{2})/i,
    /Cumulative\s+GPA\s*[:\=]?\s*(\d[\.,]\d{2})/i,
    /CGPA\s*[:\=]?\s*(\d[\.,]\d{2})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const val = m[1].replace(',', '.');
      const f = parseFloat(val);
      if (f >= 0 && f <= 4.0) return val;
    }
  }
  return null;
}

function findSinif(pageText) {
  const text = normalizeText(pageText);
  const patterns = [
    /(\d+)\.\s*Sınıf/i,
    /(\d+)\.\s*Yıl/i,
    /Class\s*[:\=]?\s*(\d+)/i,
    /Year\s*[:\=]?\s*(\d+)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1];
  }
  return null;
}

function findDonem(pageText) {
  const text = normalizeText(pageText);
  const patterns = [
    /(\d{4}[-\/]\d{4})\s*(Güz|Bahar|Fall|Spring)/i,
    /(\d+)\.\s*(Yarıyıl|Dönem|Semester)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return `${m[1]} ${m[2]}`;
  }
  return null;
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

  const ALL_TRACKED_CODES = [
    'BİL101','BİL105','BİL122','BİL124','BİL240','BİL265',
    'BİL300','BİL324','BİL332','BİL343','BİL344','BİL367','BİL386','BİL493',
    'BIL101','BIL105','BIL122','BIL124','BIL240','BIL265',
    'BIL300','BIL324','BIL332','BIL343','BIL344','BIL367','BIL386','BIL493',
    'CSE101','CSE105','CSE122','CSE124','CSE240','CSE265',
    'CSE300','CSE324','CSE332','CSE343','CSE344','CSE367','CSE386','CSE493',
    'MAT151','MAT152','MATH151','MATH152',
    'FİZ103','FİZ104','FİZ105','FİZ110',
    'FIZ103','FIZ104','FIZ105','FIZ110',
    'PHYS103','PHYS104','PHYS105','PHYS110',
  ];
  return ALL_TRACKED_CODES.some(code => text.includes(code));
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

  const uniqueGrades = new Set(candidates.map(c => c.grade));
  if (uniqueGrades.size > 1) {
    const byLine = [...candidates].sort((a, b) => b.lineIndex - a.lineIndex);
    const latest = byLine[0];
    if (PASSING_GRADES.has(latest.grade)) {
      const passingCandidates = candidates.filter(c => PASSING_GRADES.has(c.grade));
      return passingCandidates.reduce((best, c) =>
        gradeRank(c.grade) > gradeRank(best.grade) ? c : best
      );
    }
    return latest;
  }

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

function nameWordsMatch(transcriptName, listEntryName) {
  // Türkçe karakterleri ASCII eşdeğerine indirgeyerek karşılaştır.
  // Farklı kaynaklarda İ/I, Ş/S gibi tutarsızlıklar olabileceğinden
  // tüm varyantlar aynı forma çekilir.
  const normalize = s => String(s || '')
    .normalize('NFC')
    .toUpperCase()
    .replace(/İ/g, 'I').replace(/I\u0307/g, 'I')
    .replace(/Ş/g, 'S').replace(/Ğ/g, 'G')
    .replace(/Ö/g, 'O').replace(/Ü/g, 'U')
    .replace(/Ç/g, 'C').replace(/Â/g, 'A')
    .replace(/Î/g, 'I').replace(/Û/g, 'U')
    .trim().split(/\s+/).filter(Boolean);

  const transcriptWords = normalize(transcriptName);
  const listWords       = normalize(listEntryName);
  if (transcriptWords.length === 0 || listWords.length === 0) return false;

  const [shorter, longerSet] = transcriptWords.length <= listWords.length
    ? [transcriptWords, new Set(listWords)]
    : [listWords,       new Set(transcriptWords)];

  return shorter.every(w => longerSet.has(w));
}

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
      const noMatch = line.match(/\b(\d{8})\b/);
      if (!noMatch) continue;
      const studentNo = noMatch[1];
      if (seenNos.has(studentNo)) continue;

      const afterNo  = line.slice(noMatch.index + studentNo.length);
      const beforeNo = line.slice(0, noMatch.index);
      let nameWords = [...afterNo.matchAll(/[A-ZÇĞİÖŞÜ]{3,}/g)].map(m => m[0]);
      if (nameWords.length < 2) {
        nameWords = [...beforeNo.matchAll(/[A-ZÇĞİÖŞÜ]{3,}/g)].map(m => m[0]);
      }
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

let _analyzeProgress = null;
ipcMain.handle('get-analyze-progress', () => _analyzeProgress);

ipcMain.handle('save-export-file', async (_event, { format, content, defaultFilename, wordData }) => {
  const extMap  = { csv: 'csv', word: 'docx', pdf: 'pdf' };
  const nameMap = { csv: 'CSV Dosyası', word: 'Word Belgesi', pdf: 'PDF Belgesi' };
  const result = await dialog.showSaveDialog({
    title: 'Dışa Aktar',
    defaultPath: defaultFilename,
    filters: [
      { name: nameMap[format], extensions: [extMap[format]] },
      { name: 'Tüm Dosyalar', extensions: ['*'] }
    ]
  });
  if (result.canceled) return { canceled: true };

  try {
    if (format === 'pdf') {
      const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } });
      const dataUrl = 'data:text/html;base64,' + Buffer.from(content, 'utf-8').toString('base64');
      await win.loadURL(dataUrl);
      const pdfData = await win.webContents.printToPDF({ landscape: true, marginsType: 1, printBackground: true });
      win.destroy();
      fs.writeFileSync(result.filePath, pdfData);
    } else if (format === 'word') {
      const { courseKeys, allStudents, missingStudents, stats } = wordData;

      const HEADER_COLOR = '1e3a5f';
      const PASS_COLOR   = '166534';
      const FAIL_COLOR   = '991b1b';
      const WARN_COLOR   = '92400e';
      const WARN_BG      = 'fffbeb';

      const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
      const cellBorder = {
        top:    { style: BorderStyle.SINGLE, size: 1, color: 'd1d5db' },
        bottom: { style: BorderStyle.SINGLE, size: 1, color: 'd1d5db' },
        left:   { style: BorderStyle.SINGLE, size: 1, color: 'd1d5db' },
        right:  { style: BorderStyle.SINGLE, size: 1, color: 'd1d5db' },
      };

      function hdrCell(text) {
        return new TableCell({
          shading: { fill: HEADER_COLOR },
          borders: cellBorder,
          children: [new Paragraph({
            children: [new TextRun({ text, bold: true, color: 'FFFFFF', size: 16 })],
            alignment: AlignmentType.CENTER,
          })]
        });
      }

      function dataCell(text, opts = {}) {
        const { color, bold, bg, align } = opts;
        return new TableCell({
          shading: bg ? { fill: bg } : undefined,
          borders: cellBorder,
          children: [new Paragraph({
            children: [new TextRun({ text: String(text ?? '-'), color: color || '000000', bold: bold || false, size: 16 })],
            alignment: align || AlignmentType.CENTER,
          })]
        });
      }

      function eligCell(val) {
        return dataCell(val ? '✓' : '✗', { color: val ? PASS_COLOR : FAIL_COLOR, bold: true });
      }

      // Header row
      const headerCells = [
        'Öğrenci No', 'Ad Soyad', 'Listede',
        'GNO', 'AGNO', 'Sınıf', 'Dönem',
        'Staj I', 'Staj II', 'BİL493', 'BİL494',
        ...courseKeys
      ].map(hdrCell);

      // Student rows
      const studentRows = allStudents.map(s => {
        const isUnlisted = s.inList === false;
        const bg = isUnlisted ? WARN_BG : undefined;
        return new TableRow({
          children: [
            dataCell(s.studentNo, { bg }),
            dataCell(s.studentName || '-', { bg, align: AlignmentType.LEFT }),
            dataCell(isUnlisted ? 'Hayır' : 'Evet', { bg, color: isUnlisted ? WARN_COLOR : undefined }),
            dataCell(s.gno || '-', { bg }),
            dataCell(s.agno || '-', { bg }),
            dataCell(s.sinif ? s.sinif + '. Sınıf' : '-', { bg }),
            dataCell(s.donem || '-', { bg }),
            eligCell(s.staj1Eligible),
            eligCell(s.staj2Eligible),
            eligCell(s.bil493Eligible),
            eligCell(s.bil494Eligible),
            ...courseKeys.map(c => dataCell(s.courses[c] || '-', { bg })),
          ]
        });
      });

      // Missing rows
      const missingRows = missingStudents.map(s => new TableRow({
        children: [
          dataCell(s.studentNo, { bg: 'fef9c3' }),
          dataCell(s.studentName || '-', { bg: 'fef9c3', align: AlignmentType.LEFT }),
          dataCell('Evet', { bg: 'fef9c3' }),
          ...Array(8 + courseKeys.length).fill(null).map((_, i) =>
            i === 0
              ? dataCell('⚠ Transkript bulunamadı', { bg: 'fef9c3', color: WARN_COLOR })
              : dataCell('', { bg: 'fef9c3' })
          )
        ]
      }));

      const table = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({ tableHeader: true, children: headerCells }),
          ...studentRows,
          ...missingRows
        ]
      });

      const doc = new Document({
        sections: [{
          children: [
            new Paragraph({
              text: 'Staj / BİL493 / BİL494 Uygunluk Raporu',
              heading: HeadingLevel.HEADING_1,
              spacing: { after: 100 }
            }),
            new Paragraph({
              children: [
                new TextRun({ text: `Toplam: ${stats.total} öğrenci  |  Staj I: ${stats.staj1}  |  Staj II: ${stats.staj2}  |  BİL493: ${stats.bil493}  |  BİL494: ${stats.bil494}  |  Tarih: ${stats.date}`, size: 16, color: '555555' })
              ],
              spacing: { after: 200 }
            }),
            table
          ]
        }]
      });

      const buffer = await Packer.toBuffer(doc);
      fs.writeFileSync(result.filePath, buffer);
    } else {
      fs.writeFileSync(result.filePath, content, 'utf-8');
    }
    return { canceled: false, filePath: result.filePath };
  } catch (err) {
    return { canceled: false, error: err.message };
  }
});

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

ipcMain.handle('pick-transcript-pdf', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Transkript PDF seç',
    properties: ['openFile'],
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
  });
  if (result.canceled || result.filePaths.length === 0) return { canceled: true };
  return { canceled: false, filePath: result.filePaths[0] };
});


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
  const gno = findGno(pageText);
  const agno = findAgno(pageText);
  const sinif = findSinif(pageText);
  const donem = findDonem(pageText);
  const lines = extractLines(pageText);

  const parsedFromLines = parseCoursesFromLinesWithDiagnostics(lines);
  const courses = parsedFromLines.courses;
  const courseDiagnostics = parsedFromLines.diagnostics;

  applyGlobalFallback(pageText, courses, courseDiagnostics);

  const lowConfidenceCourses = TRACKED_COURSES.filter(course => {
    const conf = courseDiagnostics[course]?.confidence || 0;
    return conf < 0.75;
  });

  // Sadece transkriptte bulunan dersler üzerinden ortalama al;
  // alınmamış dersler (confidence=0) ortalamayı yanıltıcı biçimde düşürmesin.
  const foundCourses = TRACKED_COURSES.filter(course => (courseDiagnostics[course]?.confidence || 0) > 0);
  const avgConfidence = foundCourses.length > 0
    ? foundCourses
        .map(course => courseDiagnostics[course].confidence)
        .reduce((sum, v) => sum + v, 0) / foundCourses.length
    : 0;

  return {
    studentNo,
    studentName,
    gno,
    agno,
    sinif,
    donem,
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

function evaluateStudent(student, requirements = DEFAULT_REQUIREMENTS) {
  const staj1Details = requirements.staj1.map(code => {
    const grade = student.courses[code];
    return { code, grade, passed: hasPassingGrade(grade) };
  });
  const staj1PassedCount = staj1Details.filter(i => i.passed).length;
  const staj1Min = Math.min(requirements.staj1Min, requirements.staj1.length);
  const staj1Eligible = staj1PassedCount >= staj1Min;

  const staj1CourseGrade = student.courses[requirements.staj1Course];
  const staj1TakenAndPassed = hasPassingGrade(staj1CourseGrade);

  const staj2Details = requirements.staj2.map(code => {
    const grade = student.courses[code];
    return { code, grade, passed: hasPassingGrade(grade) };
  });
  const staj2PassedCount = staj2Details.filter(i => i.passed).length;
  const staj2Min = Math.min(requirements.staj2Min, requirements.staj2.length);
  const staj2CourseGrade = student.courses[requirements.staj2Course];
  const staj2TakenAndPassed = hasPassingGrade(staj2CourseGrade);

  const staj2Eligible =
    staj1Eligible &&
    staj1TakenAndPassed &&
    staj2PassedCount >= staj2Min;

  // BİL493 ön koşul: bölüm derslerinden en az N tanesi + tüm ortak dersler ≥ D
  const bil493BolumDetails = requirements.bil493Bolum.map(code => {
    const grade = student.courses[code];
    return { code, grade, passed: hasPassingGrade(grade) };
  });
  const bil493BolumPassedCount = bil493BolumDetails.filter(i => i.passed).length;
  const bil493BolumMin = Math.min(requirements.bil493BolumMin, requirements.bil493Bolum.length);

  const bil493OrtakDetails = requirements.bil493Ortak.map(code => {
    const grade = student.courses[code];
    return { code, grade, passed: hasPassingGrade(grade) };
  });
  const bil493OrtakAllPassed = bil493OrtakDetails.every(i => i.passed);

  const bil493Eligible = bil493BolumPassedCount >= bil493BolumMin && bil493OrtakAllPassed;

  // BİL494 ön koşul: ayarlarda belirtilen ders tamamlanmış olmalı
  const bil493AlreadyPassed = hasPassingGrade(student.courses[requirements.bil494Prereq]);
  const bil494Eligible = bil493AlreadyPassed;

  return {
    studentNo: student.studentNo,
    studentName: student.studentName,
    gno: student.gno || null,
    agno: student.agno || null,
    sinif: student.sinif || null,
    donem: student.donem || null,
    courses: student.courses,
    staj1Details,
    staj1Eligible,
    staj1CourseGrade,
    staj1TakenAndPassed,
    staj2Details,
    staj2Eligible,
    staj2CourseGrade,
    staj2TakenAndPassed,
    bil493BolumDetails,
    bil493BolumPassedCount,
    bil493BolumTotal: requirements.bil493Bolum.length,
    bil493BolumMin,
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

// ── pdfplumber subprocess yardımcısı ────────────────────────────────────────────────────────────────
function runPdfplumber(filePath, extraCourses = []) {
  return new Promise((resolve, reject) => {
    const exePath = getPdfParserExePath();
    if (!fs.existsSync(exePath)) {
      return reject(new Error(
        'pdf_parser.exe bulunamadı. Lütfen önce build_parser.bat dosyasını çalıştırın.'
      ));
    }
    const args = [filePath];
    if (extraCourses.length > 0) {
      args.push(`--extra-courses=${extraCourses.join(',')}`);
    }
    execFile(
      exePath,
      args,
      { maxBuffer: 50 * 1024 * 1024, encoding: 'buffer', timeout: 120000 },
      (err, stdout, _stderr) => {
        if (err) return reject(new Error(`pdfplumber hatası: ${err.message}`));
        let parsed;
        try {
          parsed = JSON.parse(stdout.toString('utf8'));
        } catch (e) {
          return reject(new Error(`JSON parse hatası: ${e.message}`));
        }
        if (parsed.error) return reject(new Error(parsed.error));
        resolve(parsed);
      }
    );
  });
}

ipcMain.handle('pick-pdf-and-analyze', async (_event, options = {}) => {
  try {
    let filePath = options.filePath || null;
    if (!filePath) {
      const result = await dialog.showOpenDialog({
        title: 'Transkript PDF seç',
        properties: ['openFile'],
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
      });
      if (result.canceled || result.filePaths.length === 0) return { canceled: true };
      filePath = result.filePaths[0];
    }
    const requirements = buildRequirements(options.requirementsConfig);

    // ── pdfplumber modu ────────────────────────────────────────────────────────────────
    if (options.mode === 'pdfplumber') {
      _analyzeProgress = { phase: 'pdfplumber', filePath };
      const extraCourses = [
        ...(requirements.staj1       || []),
        ...(requirements.staj2       || []),
        ...(requirements.bil493Bolum || []),
      ];
      const plumberData = await runPdfplumber(filePath, extraCourses);

      const filterEntries =
        Array.isArray(options.filterStudentEntries) && options.filterStudentEntries.length > 0
          ? options.filterStudentEntries
          : null;

      const parseResults = plumberData.students.map(s => ({
        ...s,
        parseDiagnostics: {
          pdfplumberUsed: true,
          averageConfidence: 0.95,
          lowConfidenceCourses: [],
          courses: {}
        }
      }));

      const students = parseResults
        .map(s => evaluateStudent(s, requirements))
        .filter(s => s.studentNo !== 'Bilinmiyor');

      const studentMatches = (s, e) =>
        (s.studentNo && e.studentNo && s.studentNo === e.studentNo) ||
        nameWordsMatch(s.studentName, e.name);

      const missingStudents = filterEntries
        ? filterEntries
            .filter(e => !students.some(s => studentMatches(s, e)))
            .map(e => ({ studentNo: e.studentNo, studentName: e.name }))
        : [];

      const studentsTagged = students.map(s => ({
        ...s,
        inList: !filterEntries || filterEntries.some(e => studentMatches(s, e))
      }));

      const parseSummary = buildParseSummary(studentsTagged);
      _analyzeProgress = null;

      console.log(`pdfplumber | Sayfa: ${plumberData.totalPages} | Öğrenci: ${studentsTagged.length}`);

      return {
        canceled: false,
        filePath,
        totalPages: plumberData.totalPages || 0,
        totalStudents: studentsTagged.length,
        parseSummary,
        pdfplumberUsed: true,
        tokenStats: null,
        missingStudents,
        students: studentsTagged
      };
    }

    // ── Regex modu (pdf_parser.exe yoksa fallback) ──────────────────────────────────────────────
    let pages, totalPages;
    const exePath = getPdfParserExePath();
    if (fs.existsSync(exePath)) {
      // pdfplumber mevcut — daha iyi koordinat bazlı metin kullan
      const plumberResult = await new Promise((resolve, reject) => {
        execFile(
          exePath,
          ['--text-only', filePath],
          { maxBuffer: 100 * 1024 * 1024, encoding: 'buffer', timeout: 120000 },
          (err, stdout) => {
            if (err) return reject(new Error(`pdfplumber metin hatası: ${err.message}`));
            try {
              const parsed = JSON.parse(stdout.toString('utf8'));
              if (parsed.error) return reject(new Error(parsed.error));
              resolve(parsed);
            } catch (e) { reject(new Error(`JSON parse hatası: ${e.message}`)); }
          }
        );
      });
      pages = (plumberResult.pages || []).map(p => p.text);
      totalPages = plumberResult.totalPages || pages.length;
    } else {
      // Fallback: pdf-parse
      const buffer = fs.readFileSync(filePath);
      const extracted = await extractPagesFromPdfTextLayer(buffer);
      pages = extracted.pages;
      totalPages = extracted.totalPages;
    }

    const filterEntries = Array.isArray(options.filterStudentEntries) && options.filterStudentEntries.length > 0
      ? options.filterStudentEntries
      : null;

    const relevantPages = pages.filter(page => {
      const normalized = normalizeText(page);
      // Öğrenci No içeren lisans transkript sayfası olmalı
      if (!normalized.includes('Öğrenci No')) return false;
      if (!isLisansPage(normalized)) return false;
      // Takip edilen derslerden en az biri varsa dahil et;
      // yoksa da dahil et (öğrenci no eşleştirmesi için sayfaya ihtiyaç var)
      return true;
    });

    const parseResults = [];
    for (const page of relevantPages) parseResults.push(parseStudentPage(page));

    const students = parseResults
      .map(s => evaluateStudent(s, requirements))
      .filter(student => student.studentNo !== 'Bilinmiyor');

    // Öğrenci eşleştirme: önce numara (kesin), numara yoksa isim karşılaştırması
    const studentMatches = (s, e) =>
      (s.studentNo && e.studentNo && s.studentNo === e.studentNo) ||
      nameWordsMatch(s.studentName, e.name);

    // Liste verilmişse: eşleşmeyen liste girişlerini bul
    const missingStudents = filterEntries
      ? filterEntries
          .filter(e => !students.some(s => studentMatches(s, e)))
          .map(e => ({ studentNo: e.studentNo, studentName: e.name }))
      : [];

    // Her öğrenciye inList flag ekle: listede yer alıyor mu?
    const studentsTagged = students.map(s => ({
      ...s,
      inList: !filterEntries || filterEntries.some(e => studentMatches(s, e))
    }));

    console.log(`Toplam sayfa: ${totalPages} | Öğrenci sayfası: ${relevantPages.length} | Öğrenci: ${studentsTagged.length}`);

    const parseSummary = buildParseSummary(studentsTagged);

    return {
      canceled: false,
      filePath,
      totalPages,
      totalStudents: studentsTagged.length,
      parseSummary,
      pdfplumberUsed: false,
      tokenStats: null,
      missingStudents,
      students: studentsTagged
    };
  } catch (error) {
    console.error('PDF analiz hatası:', error);
    throw error;
  }
});