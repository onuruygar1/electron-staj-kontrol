const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const pdfParse = require('pdf-parse');

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
  BİL240: ['BİL240', 'BIL240', 'CSE240'],
  BİL265: ['BİL265', 'BIL265', 'CSE265'],
  BİL300: ['BİL300', 'BIL300', 'CSE300'],
  BİL343: ['BİL343', 'BIL343', 'CSE343'],
  BİL367: ['BİL367', 'BIL367', 'CSE367'],
  BİL344: ['BİL344', 'BIL344', 'CSE344'],
  BİL386: ['BİL386', 'BIL386', 'CSE386']
};

const STAJ1_REQUIRED = ['BİL240', 'BİL265'];
const STAJ2_REQUIRED = ['BİL343', 'BİL367', 'BİL344', 'BİL386'];

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
    'BİL240', 'BİL265', 'BİL300', 'BİL343', 'BİL344', 'BİL367', 'BİL386',
    'CSE240', 'CSE265', 'CSE300', 'CSE343', 'CSE344', 'CSE367', 'CSE386',
    'BIL240', 'BIL265', 'BIL300', 'BIL343', 'BIL344', 'BIL367', 'BIL386'
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
  const matches = normalizeText(line).match(/(?<!\w)(A\+|A-|A|B\+|B-|B|C\+|C-|C|D\+|D|F1|F2|XX|Y|P)(?!\w)/g);
  if (!matches || matches.length === 0) return null;
  return cleanGradeToken(matches[0]);
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

function findGradeForCourseFromLines(lines, aliases) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (lineContainsAnyAlias(line, aliases)) {
      // İki sütunlu layoutlarda aynı satırda birden fazla ders kodu olabilir.
      // Ders kodunun bittiği pozisyondan sonrasına bakarak doğru notu bul.
      const normalizedLine = normalizeText(line);
      let codeEndPos = 0;

      for (const alias of aliases) {
        const normalizedAlias = normalizeText(alias).toUpperCase();
        const idx = normalizedLine.toUpperCase().indexOf(normalizedAlias);
        if (idx !== -1) {
          codeEndPos = idx + normalizedAlias.length;
          break;
        }
      }

      const sameLineGrade = extractGradeFromLine(normalizedLine.substring(codeEndPos));
      if (sameLineGrade) return sameLineGrade;

      if (i + 1 < lines.length) {
        const nextLineGrade = extractGradeFromLine(lines[i + 1]);
        if (nextLineGrade) return nextLineGrade;
      }

      if (i + 2 < lines.length) {
        const secondNextLineGrade = extractGradeFromLine(lines[i + 2]);
        if (secondNextLineGrade) return secondNextLineGrade;
      }
    }
  }

  return null;
}

function parseStudentPage(pageText) {
  const studentNo = findStudentNo(pageText);
  const studentName = findStudentName(pageText);
  const lines = extractLines(pageText);

  const courses = {
    BİL240: null,
    BİL265: null,
    BİL300: null,
    BİL343: null,
    BİL367: null,
    BİL344: null,
    BİL386: null
  };

  for (const canonicalCourse of Object.keys(courses)) {
    const aliases = COURSE_ALIASES[canonicalCourse];
    courses[canonicalCourse] = findGradeForCourseFromLines(lines, aliases);
  }

  return {
    studentNo,
    studentName,
    courses,
    _debug: {
      firstLines: lines.slice(0, 25)
    }
  };
}

function evaluateStudent(student) {
  const staj1Details = STAJ1_REQUIRED.map(code => {
    const grade = student.courses[code];
    return {
      code,
      grade,
      passed: hasPassingGrade(grade)
    };
  });

  const staj1Eligible = staj1Details.every(item => item.passed);

  const staj1CourseGrade = student.courses['BİL300'];
  const staj1TakenAndPassed = hasPassingGrade(staj1CourseGrade);

  const staj2Details = STAJ2_REQUIRED.map(code => {
    const grade = student.courses[code];
    return {
      code,
      grade,
      passed: hasPassingGrade(grade)
    };
  });

  const staj2Eligible =
    staj1Eligible &&
    staj1TakenAndPassed &&
    staj2Details.every(item => item.passed);

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

ipcMain.handle('pick-pdf-and-analyze', async () => {
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

    const parsed = await pdfParse(buffer, {
      pagerender: async (pageData) => {
        const textContent = await pageData.getTextContent();
        const lines = groupTextItemsToRows(textContent.items);
        return lines.join('\n') + '\n===PAGE_BREAK===\n';
      }
    });

    const pages = extractPages(parsed.text);

    const relevantPages = pages.filter(page => {
      const normalized = normalizeText(page);
      return (
        normalized.includes('Öğrenci No') &&
        isLisansPage(normalized) &&
        isRelevantPage(normalized)
      );
    });

    const students = relevantPages
      .map(parseStudentPage)
      .map(evaluateStudent)
      .filter(student => student.studentNo !== 'Bilinmiyor');

    console.log(`Toplam sayfa: ${parsed.numpages} | Öğrenci sayfası: ${relevantPages.length} | Öğrenci: ${students.length}`);

    return {
      canceled: false,
      filePath,
      totalPages: parsed.numpages,
      totalStudents: students.length,
      students
    };
  } catch (error) {
    console.error('PDF analiz hatası:', error);
    throw error;
  }
});