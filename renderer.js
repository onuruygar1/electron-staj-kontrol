/* ── Koşul (requirements) ayarları ── */
const DEFAULT_REQUIREMENTS = {
  staj1: ['BİL240', 'BİL265'],
  staj2: ['BİL343', 'BİL367', 'BİL344', 'BİL386'],
  bil493Bolum: ['BİL324', 'BİL332', 'BİL343', 'BİL344', 'BİL367', 'BİL386'],
  bil493BolumMin: 4
};

function normalizeCourseCode(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/I/g, 'İ')
    .trim();
}

function loadRequirements() {
  try {
    const raw = localStorage.getItem('requirementsConfig');
    if (!raw) return { ...DEFAULT_REQUIREMENTS, staj1: [...DEFAULT_REQUIREMENTS.staj1], staj2: [...DEFAULT_REQUIREMENTS.staj2], bil493Bolum: [...DEFAULT_REQUIREMENTS.bil493Bolum] };
    const parsed = JSON.parse(raw);
    const cleanArr = (arr, fallback) => Array.isArray(arr) ? [...new Set(arr.map(normalizeCourseCode).filter(Boolean))] : [...fallback];
    return {
      staj1: cleanArr(parsed.staj1, DEFAULT_REQUIREMENTS.staj1),
      staj2: cleanArr(parsed.staj2, DEFAULT_REQUIREMENTS.staj2),
      bil493Bolum: cleanArr(parsed.bil493Bolum, DEFAULT_REQUIREMENTS.bil493Bolum),
      bil493BolumMin: Number.isFinite(parsed.bil493BolumMin) ? Math.max(0, Math.floor(parsed.bil493BolumMin)) : DEFAULT_REQUIREMENTS.bil493BolumMin
    };
  } catch {
    return { ...DEFAULT_REQUIREMENTS, staj1: [...DEFAULT_REQUIREMENTS.staj1], staj2: [...DEFAULT_REQUIREMENTS.staj2], bil493Bolum: [...DEFAULT_REQUIREMENTS.bil493Bolum] };
  }
}

let requirements = loadRequirements();

const PASSING_GRADES_SET = new Set(['D', 'D+', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+']);
function clientHasPassingGrade(grade) {
  if (!grade) return false;
  return PASSING_GRADES_SET.has(String(grade).toUpperCase().replace(/\s+/g, '').trim());
}

function reEvaluateStudent(student) {
  const c = student.courses || {};

  const staj1Details = requirements.staj1.map(code => ({
    code, grade: c[code], passed: clientHasPassingGrade(c[code])
  }));
  const staj1Eligible = staj1Details.every(i => i.passed);
  const staj1CourseGrade = c['BİL300'];
  const staj1TakenAndPassed = clientHasPassingGrade(staj1CourseGrade);

  const staj2Details = requirements.staj2.map(code => ({
    code, grade: c[code], passed: clientHasPassingGrade(c[code])
  }));
  const staj2Eligible = staj1Eligible && staj1TakenAndPassed && staj2Details.every(i => i.passed);

  const bil493BolumDetails = requirements.bil493Bolum.map(code => ({
    code, grade: c[code], passed: clientHasPassingGrade(c[code])
  }));
  const bil493BolumPassedCount = bil493BolumDetails.filter(i => i.passed).length;
  const bil493BolumMin = Math.min(requirements.bil493BolumMin, requirements.bil493Bolum.length);

  const bil493OrtakDetails = student.bil493OrtakDetails || [];
  const bil493OrtakAllPassed = bil493OrtakDetails.every(i => i.passed);
  const bil493Eligible = bil493BolumPassedCount >= bil493BolumMin && bil493OrtakAllPassed;

  const bil493AlreadyPassed = clientHasPassingGrade(c['BİL493']);
  const bil494Eligible = bil493AlreadyPassed;

  return {
    ...student,
    staj1Details,
    staj1Eligible,
    staj1CourseGrade,
    staj1TakenAndPassed,
    staj2Details,
    staj2Eligible,
    bil493BolumDetails,
    bil493BolumPassedCount,
    bil493BolumTotal: requirements.bil493Bolum.length,
    bil493BolumMin,
    bil493OrtakDetails,
    bil493OrtakAllPassed,
    bil493Eligible,
    bil493AlreadyPassed,
    bil494Eligible,
  };
}

function saveRequirements() {
  localStorage.setItem('requirementsConfig', JSON.stringify(requirements));
  const toast = document.getElementById('settingsToast');
  if (toast) {
    toast.classList.add('show');
    clearTimeout(saveRequirements._t);
    saveRequirements._t = setTimeout(() => toast.classList.remove('show'), 1200);
  }
  if (allStudents.length > 0) {
    allStudents = allStudents.map(reEvaluateStudent);
    applyFilters();
  }
}

function renderChipList(containerId, list, onRemove) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = list.map((code, i) =>
    `<span class="course-chip" data-idx="${i}" title="Çıkarmak için tıkla">${code}<span class="chip-x">×</span></span>`
  ).join('');
  el.querySelectorAll('.course-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const idx = parseInt(chip.dataset.idx, 10);
      onRemove(idx);
    });
  });
}

function renderSettings() {
  renderChipList('chipsBil493', requirements.bil493Bolum, (idx) => {
    const removed = requirements.bil493Bolum[idx];
    requirements.bil493Bolum.splice(idx, 1);
    if (requirements.bil493BolumMin > requirements.bil493Bolum.length) {
      requirements.bil493BolumMin = requirements.bil493Bolum.length;
    }
    saveRequirements();
    renderSettings();
  });
  renderChipList('chipsStaj1', requirements.staj1, (idx) => {
    requirements.staj1.splice(idx, 1);
    saveRequirements();
    renderSettings();
  });
  renderChipList('chipsStaj2', requirements.staj2, (idx) => {
    requirements.staj2.splice(idx, 1);
    saveRequirements();
    renderSettings();
  });

  const total = requirements.bil493Bolum.length;
  const totalEl = document.getElementById('totalCountBil493');
  if (totalEl) totalEl.textContent = String(total);

  const minInput = document.getElementById('minCountBil493');
  if (minInput) {
    minInput.max = String(total);
    minInput.value = String(Math.min(requirements.bil493BolumMin, total));
  }
}

function addCourseTo(listKey, inputId) {
  const input = document.getElementById(inputId);
  const errEl = document.getElementById(inputId + 'Err');
  const showErr = (msg) => {
    if (errEl) {
      errEl.textContent = msg;
      clearTimeout(showErr._t);
      showErr._t = setTimeout(() => { errEl.textContent = ''; }, 2500);
    }
    input.focus();
  };
  const code = normalizeCourseCode(input.value);
  if (!code) return;
  if (!/^[A-ZÇĞİÖŞÜ]{2,5}\d{2,4}$/.test(code)) {
    showErr('Geçersiz ders kodu. Örnek: BİL324, MAT151');
    return;
  }
  if (requirements[listKey].includes(code)) {
    showErr(`${code} zaten listede.`);
    return;
  }
  requirements[listKey].push(code);
  saveRequirements();
  renderSettings();
  input.value = '';
  input.focus();
}

/* ── Tab navigation ── */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const page = document.getElementById('tab-' + btn.dataset.tab);
    if (page) page.classList.add('active');
    if (btn.dataset.tab === 'settings') renderSettings();
  });
});

/* ── Settings actions ── */
document.getElementById('addBil493Btn')?.addEventListener('click', () => addCourseTo('bil493Bolum', 'inputBil493'));
document.getElementById('addStaj1Btn') ?.addEventListener('click', () => addCourseTo('staj1', 'inputStaj1'));
document.getElementById('addStaj2Btn') ?.addEventListener('click', () => addCourseTo('staj2', 'inputStaj2'));

['inputBil493', 'inputStaj1', 'inputStaj2'].forEach((id, i) => {
  const keys = ['bil493Bolum', 'staj1', 'staj2'];
  document.getElementById(id)?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addCourseTo(keys[i], id);
  });
});

document.getElementById('minCountBil493')?.addEventListener('input', (e) => {
  const val = parseInt(e.target.value, 10);
  if (!Number.isFinite(val) || val < 0) return;
  const total = requirements.bil493Bolum.length;
  requirements.bil493BolumMin = Math.min(Math.max(0, val), total);
  saveRequirements();
});

document.getElementById('resetSettingsBtn')?.addEventListener('click', () => {
  if (!confirm('Tüm koşullar varsayılan değerlere döndürülecek. Devam edilsin mi?')) return;
  requirements = {
    staj1: [...DEFAULT_REQUIREMENTS.staj1],
    staj2: [...DEFAULT_REQUIREMENTS.staj2],
    bil493Bolum: [...DEFAULT_REQUIREMENTS.bil493Bolum],
    bil493BolumMin: DEFAULT_REQUIREMENTS.bil493BolumMin
  };
  saveRequirements();
  renderSettings();
});

const analyzeBtn   = document.getElementById('analyzeBtn');
const selectPdfBtn = document.getElementById('selectPdfBtn');
const listBtn      = document.getElementById('listBtn');
const listStatusEl = document.getElementById('listStatus');
const listStatusTx = document.getElementById('listStatusText');
const listClearBtn = document.getElementById('listClearBtn');
const summaryEl    = document.getElementById('summary');
const resultsEl    = document.getElementById('results');
const toolbarEl    = document.getElementById('toolbar');
const searchEl     = document.getElementById('searchInput');
const exportCsvBtn  = document.getElementById('exportCsvBtn');
const exportWordBtn = document.getElementById('exportWordBtn');
const exportPdfBtn  = document.getElementById('exportPdfBtn');

let allStudents      = [];
let missingStudents  = [];
let activeFilter     = 'all'; // 'all'|'staj1'|'staj2'|'bil493'|'bil494'|'unlisted'
let studentListData  = null;
let selectedPdfPath  = null;

function updateAnalyzeBtn() {
  if (analyzeBtn) analyzeBtn.disabled = !selectedPdfPath;
}

/* ── Dark mode ── */
const themeToggleBtn = document.getElementById('themeToggle');
(function initTheme() {
  const saved = localStorage.getItem('theme') || 'light';
  document.body.setAttribute('data-theme', saved);
  if (themeToggleBtn) themeToggleBtn.textContent = saved === 'dark' ? '☀️' : '🌙';
})();
if (themeToggleBtn) {
  themeToggleBtn.addEventListener('click', () => {
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    const next = isDark ? 'light' : 'dark';
    document.body.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    themeToggleBtn.textContent = next === 'dark' ? '☀️' : '🌙';
  });
}

/* ── Öğrenci listesi buton ── */
listBtn.addEventListener('click', async () => {
  listBtn.disabled = true;
  try {
    const data = await window.electronAPI.pickStudentListPdf();
    if (data.canceled) return;
    studentListData = data;
    const courseLabel = data.courseCode
      ? `${data.courseCode}${data.courseName ? ' – ' + data.courseName : ''}`
      : '';
    listStatusTx.textContent = `${data.totalFound} öğrenci yüklendi${courseLabel ? ' · ' + courseLabel : ''}`;
    listStatusEl.style.display = 'flex';
  } catch (err) {
    alert('Liste yüklenemedi: ' + err.message);
  } finally {
    listBtn.disabled = false;
  }
});

listClearBtn.addEventListener('click', () => {
  studentListData = null;
  listStatusEl.style.display = 'none';
  listStatusTx.textContent = '';
});

/* ── Transkript PDF seç ── */
if (selectPdfBtn) {
  selectPdfBtn.addEventListener('click', async () => {
    selectPdfBtn.disabled = true;
    try {
      const result = await window.electronAPI.pickTranscriptPdf();
      if (result.canceled) return;
      selectedPdfPath = result.filePath;
      const fileName = result.filePath.split(/[\\/]/).pop();
      const statusEl = document.getElementById('pdfFileStatus');
      const textEl   = document.getElementById('pdfFileStatusText');
      if (textEl) textEl.textContent = fileName;
      if (statusEl) statusEl.style.display = 'flex';
      updateAnalyzeBtn();
    } catch (err) {
      alert('PDF seçilemedi: ' + err.message);
    } finally {
      selectPdfBtn.disabled = false;
    }
  });
}

document.getElementById('clearPdfBtn')?.addEventListener('click', () => {
  selectedPdfPath = null;
  const statusEl = document.getElementById('pdfFileStatus');
  if (statusEl) statusEl.style.display = 'none';
  updateAnalyzeBtn();
});

/* ── Helpers ── */
function pill(ok, yesText, noText) {
  return `<span class="pill ${ok ? 'ok' : 'bad'}"><span class="dot"></span>${ok ? yesText : noText}</span>`;
}

function gradeCell(grade) {
  if (!grade) return '<span class="grade-badge missing">Bulunamadı</span>';
  return `<span class="grade-badge">${grade}</span>`;
}

function sectionLabel(type) {
  const map = { s1: 'Staj I', s2: 'Staj II', pre: 'Ön Koşul' };
  const cls = type;
  return `<span class="section-label ${cls}">${map[type]}</span>`;
}

function statusCell(passed) {
  return passed
    ? '<span class="status-ok">✓ Geçti</span>'
    : '<span class="status-bad">✗ Kaldı / Yok</span>';
}

function renderParseWarning(student) {
  const diagnostics = student.parseDiagnostics;
  if (!diagnostics) return '';

  const low = diagnostics.lowConfidenceCourses || [];
  if (low.length === 0) return '';

  const fallbackCourses = Object.entries(diagnostics.courses || {})
    .filter(([, info]) => info && info.source === 'global-index-fallback')
    .map(([course]) => course);

  const confPercent = Math.round((diagnostics.averageConfidence || 0) * 100);
  const fallbackText = fallbackCourses.length
    ? ` · Fallback: ${fallbackCourses.join(', ')}`
    : '';

  return `<div class="parse-warn">Düşük güven: ${low.join(', ')} · Ortalama güven: %${confPercent}${fallbackText}</div>`;
}

/* ── Render one student card ── */
function renderStudent(student) {
  const unlistedBadge = student.inList === false
    ? '<div class="unlisted-badge">⚠ Listede Yok</div>'
    : '';

  const bil493Total = student.bil493BolumTotal ?? student.bil493BolumDetails.length;
  const bil493Min   = student.bil493BolumMin   ?? 4;
  const bil493Summary = student.bil493Eligible
    ? `${student.bil493BolumPassedCount}/${bil493Total} bölüm geçildi, tüm ortak dersler ✔`
    : [
        `${student.bil493BolumPassedCount}/${bil493Total} bölüm geçildi (min. ${bil493Min})`,
        student.bil493OrtakAllPassed ? null : 'ortak dersler eksik'
      ].filter(Boolean).join(' · ');

  const rows = [
    ...student.staj1Details.map(i => ({ sec: 's1',    label: 'Staj I',         code: i.code,            grade: i.grade,                    passed: i.passed })),
    {                                   sec: 'pre',   label: 'Ön Koşul',       code: 'BİL300 (Staj I)', grade: student.staj1CourseGrade,   passed: student.staj1TakenAndPassed },
    ...student.staj2Details.map(i => ({ sec: 's2',    label: 'Staj II',        code: i.code,            grade: i.grade,                    passed: i.passed })),
    ...student.bil493BolumDetails.map(i => ({ sec: 'b493', label: 'BİL493 Bölüm', code: i.code, grade: i.grade, passed: i.passed })),
    ...student.bil493OrtakDetails.map(i => ({ sec: 'b493o', label: 'BİL493 Ortak', code: i.code, grade: i.grade, passed: i.passed })),
    { sec: 'b494', label: 'BİL494 Ön Koşul', code: 'BİL493 (tamamlandı mı?)', grade: student.courses?.['BİL493'], passed: student.bil493AlreadyPassed },
  ];

  return `
    <div class="card${student.inList === false ? ' unlisted' : ''}">
      <div class="card-head">
        <div>
          <div class="s-name">${student.studentName}</div>
          <div class="s-no">${student.studentNo}</div>
          ${unlistedBadge}
          ${renderParseWarning(student)}
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
          <div class="pills">
            <span class="pill ${student.staj1Eligible ? 'ok' : 'bad'}"><span class="pill-dot"></span>${student.staj1Eligible ? 'Staj I Alabilir' : 'Staj I Alamaz'}</span>
            <span class="pill ${student.staj2Eligible ? 'ok' : 'bad'}"><span class="pill-dot"></span>${student.staj2Eligible ? 'Staj II Alabilir' : 'Staj II Alamaz'}</span>
            <span class="pill ${student.bil493Eligible ? 'ok' : 'bad'}"><span class="pill-dot"></span>${student.bil493Eligible ? 'BİL493 Alabilir' : 'BİL493 Alamaz'}</span>
            <span class="pill ${student.bil494Eligible ? 'ok' : 'bad'}"><span class="pill-dot"></span>${student.bil494Eligible ? 'BİL494 Alabilir' : 'BİL494 Alamaz'}</span>
          </div>
          <div style="display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end">
            ${student.gno   ? `<span class="gno-badge">GNO ${student.gno}</span>` : ''}
            ${student.agno  ? `<span class="agno-badge">AGNO ${student.agno}</span>` : ''}
            ${student.sinif ? `<span class="sinif-badge">${student.sinif}. Sınıf</span>` : ''}
            ${student.donem ? `<span class="donem-info">${student.donem}</span>` : ''}
          </div>
        </div>
      </div>
      <table>
        <thead><tr><th>Kural</th><th>Ders</th><th>Not</th><th>Durum</th></tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td><span class="tag ${r.sec}">${r.label}</span></td>
              <td><strong>${r.code}</strong></td>
              <td>${r.grade ? `<span class="grade">${r.grade}</span>` : '<span class="grade none">Bulunamadı</span>'}</td>
              <td>${r.passed ? '<span class="ok-txt">✓ Geçti</span>' : '<span class="bad-txt">✗ Kaldı / Yok</span>'}</td>
            </tr>`).join('')}
          <tr class="b493-summary-row">
            <td colspan="4"><strong>BİL493 Özet:</strong> ${bil493Summary}</td>
          </tr>
        </tbody>
      </table>
    </div>`;
}

function renderMissingStudent(s) {
  return `
    <div class="card missing">
      <div class="card-head">
        <div>
          <div class="s-name">${s.studentName || ''}</div>
          <div class="s-no">${s.studentNo}</div>
          <div class="missing-badge">⚠ Transkript bulunamadı</div>
        </div>
      </div>
    </div>`;
}

/* ── Filter + search ── */
function applyFilters() {
  const raw = searchEl.value.trim();

  let filtered = allStudents;
  if (activeFilter === 'staj1')   filtered = filtered.filter(s => s.staj1Eligible);
  if (activeFilter === 'staj2')   filtered = filtered.filter(s => s.staj2Eligible);
  if (activeFilter === 'bil493')  filtered = filtered.filter(s => s.bil493Eligible);
  if (activeFilter === 'bil494')  filtered = filtered.filter(s => s.bil494Eligible);
  if (activeFilter === 'unlisted') filtered = filtered.filter(s => !s.inList);

  if (raw) {
    const query = raw.toLowerCase();

    // no:12345678 — öğrenci no araması
    const noMatch = raw.match(/^no:(\S+)/i);
    if (noMatch) {
      const num = noMatch[1];
      filtered = filtered.filter(s => s.studentNo.includes(num));
    }
    // gno>X, gno>=X, gno<X, gno<=X
    else if (/^gno\s*(>=|>|<=|<)\s*[\d.,]+/i.test(raw)) {
      const m = raw.match(/^gno\s*(>=|>|<=|<)\s*([\d.,]+)/i);
      if (m) {
        const op  = m[1];
        const val = parseFloat(m[2].replace(',', '.'));
        filtered = filtered.filter(s => {
          const g = parseFloat(s.gno);
          if (isNaN(g)) return false;
          if (op === '>')  return g >  val;
          if (op === '>=') return g >= val;
          if (op === '<')  return g <  val;
          if (op === '<=') return g <= val;
          return false;
        });
      }
    }
    // ders kodu araması (ör. BİL240) — öğrencinin o derste notu varsa göster
    else if (/^[A-ZÇĞİÖŞÜa-zçğışöü]{2,4}\d{3}$/i.test(raw.replace(/\s+/g, ''))) {
      const code = raw.toUpperCase().replace(/\s+/g, '').replace(/^BIL/, 'BİL').replace(/I/g, 'İ');
      filtered = filtered.filter(s => s.courses && s.courses[code] != null);
    }
    // Genel metin araması — isim veya öğrenci no
    else {
      filtered = filtered.filter(s =>
        s.studentName.toLowerCase().includes(query) ||
        s.studentNo.includes(query)
      );
    }
  }

  document.getElementById('filteredCount').textContent =
    filtered.length === allStudents.length
      ? `${filtered.length} öğrenci`
      : `${filtered.length} / ${allStudents.length} öğrenci`;

  resultsEl.innerHTML = filtered.length
    ? filtered.map(renderStudent).join('') + missingStudents.map(renderMissingStudent).join('')
    : missingStudents.length
      ? missingStudents.map(renderMissingStudent).join('')
      : '<div class="msg" style="margin-top:16px">Eşleşen öğrenci bulunamadı.</div>';
}

/* ── Filter button clicks ── */
document.querySelectorAll('.fbtn').forEach(btn => {
  btn.addEventListener('click', () => {
    const isActive = btn.classList.contains('active');
    document.querySelectorAll('.fbtn').forEach(b => b.classList.remove('active'));
    if (!isActive) {
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
    } else {
      activeFilter = 'all';
    }
    applyFilters();
  });
});

searchEl.addEventListener('input', applyFilters);

/* ── PDF analyze ── */
analyzeBtn.addEventListener('click', async () => {
  if (!selectedPdfPath) return;
  analyzeBtn.disabled = true;
  summaryEl.innerHTML = '<div class="msg">⏳ PDF okunuyor, lütfen bekleyin…</div>';
  resultsEl.innerHTML = '';
  toolbarEl.style.display = 'none';

  let _pollTimer = null;
  function startPolling() {
    summaryEl.innerHTML = '<div class="msg">⏳ pdfplumber ile ayrıştırılıyor…</div>';
  }
  function stopPolling() { if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; } }

  startPolling();
  try {
    const analyzeOptions = { mode: 'pdfplumber', requirementsConfig: requirements, filePath: selectedPdfPath };
    if (studentListData) analyzeOptions.filterStudentEntries = studentListData.studentEntries;
    const data = await window.electronAPI.pickPdfAndAnalyze(analyzeOptions);
    stopPolling();

    if (data.canceled) {
      summaryEl.innerHTML = '<div class="msg">İşlem iptal edildi.</div>';
      return;
    }

    allStudents     = data.students;
    missingStudents = data.missingStudents || [];
    const staj1Count    = data.students.filter(s => s.staj1Eligible).length;
    const staj2Count    = data.students.filter(s => s.staj2Eligible).length;
    const bil493Count   = data.students.filter(s => s.bil493Eligible).length;
    const bil494Count   = data.students.filter(s => s.bil494Eligible).length;
    const unlistedCount = data.students.filter(s => !s.inList).length;
    const parseSummary = data.parseSummary || {};

    const totalEntries = parseSummary.totalCourseEntries || 0;
    const missingEntries = parseSummary.missingCourseEntries || 0;
    const parseCoverage = totalEntries > 0
      ? Math.round(((totalEntries - missingEntries) / totalEntries) * 100)
      : 0;

    const parserInfo = data.pdfplumberUsed
      ? '<span class="pdfplumber-badge">pdfplumber (Yerleşik)</span>'
      : `Düşük güvenli öğrenci: <strong>${parseSummary.lowConfidenceStudents || 0}</strong> · Fallback: <strong>${parseSummary.fallbackUsedStudents || 0}</strong> · Düşük güvenli ders: <strong>${parseSummary.lowConfidenceCourses || 0}</strong>`;

    const listInfo = studentListData && missingStudents.length > 0
      ? `<div class="parse-summary" style="color:#b91c1c">⚠ ${missingStudents.length} öğrencinin transkripti bulunamadı${unlistedCount > 0 ? ` · ${unlistedCount} öğrenci listede yok` : ''}</div>`
      : studentListData && unlistedCount > 0
        ? `<div class="parse-summary" style="color:#92400e">⚠ ${unlistedCount} öğrenci transkriptte var ama öğrenci listesinde yok</div>`
        : studentListData
          ? `<div class="parse-summary" style="color:#166534">✓ Listedeki tüm öğrencilerin transkripti bulundu</div>`
          : '';

    summaryEl.innerHTML = `
      <div class="stats">
        <div class="stat">
          <div class="stat-label">Toplam Öğrenci</div>
          <div class="stat-value">${data.totalStudents}</div>
        </div>
        <div class="stat green">
          <div class="stat-label">Staj I Alabilir</div>
          <div class="stat-value">${staj1Count}</div>
        </div>
        <div class="stat amber">
          <div class="stat-label">Staj II Alabilir</div>
          <div class="stat-value">${staj2Count}</div>
        </div>
        <div class="stat purple">
          <div class="stat-label">BİL493 Alabilir</div>
          <div class="stat-value">${bil493Count}</div>
        </div>
        <div class="stat cyan">
          <div class="stat-label">BİL494 Alabilir</div>
          <div class="stat-value">${bil494Count}</div>
        </div>
        <div class="stat slate">
          <div class="stat-label">Parse Kapsamı</div>
          <div class="stat-value">%${parseCoverage}</div>
        </div>
      </div>
      <div class="file-path">📄 ${data.filePath}</div>
      <div class="parse-summary">${parserInfo}</div>
      ${listInfo}`;

    // Reset toolbar state
    activeFilter = 'all';
    searchEl.value = '';
    document.querySelectorAll('.fbtn').forEach(b => b.classList.remove('active'));
    toolbarEl.style.display = 'flex';

    applyFilters();
  } catch (error) {
    stopPolling();
    summaryEl.innerHTML = `<div class="msg err">Hata: ${error.message}</div>`;
  } finally {
    updateAnalyzeBtn();
  }
});

/* ── Export ── */
function getExportDate() {
  return new Date().toLocaleDateString('tr-TR').replace(/\./g, '-');
}

function buildExportCSV() {
  const courseKeys = allStudents.length > 0 ? Object.keys(allStudents[0].courses) : [];
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const headers = [
    'Öğrenci No', 'Ad Soyad', 'Listede',
    'GNO', 'AGNO', 'Sınıf', 'Dönem',
    'Staj I', 'Staj II', 'BİL493 Alabilir', 'BİL494 Alabilir',
    ...courseKeys
  ];
  const rows = [
    headers.map(esc).join(','),
    ...allStudents.map(s => [
      s.studentNo, s.studentName,
      s.inList !== false ? 'Evet' : 'Hayır',
      s.gno || '', s.agno || '', s.sinif || '', s.donem || '',
      s.staj1Eligible ? 'Alabilir' : 'Alamaz',
      s.staj2Eligible ? 'Alabilir' : 'Alamaz',
      s.bil493Eligible ? 'Alabilir' : 'Alamaz',
      s.bil494Eligible ? 'Alabilir' : 'Alamaz',
      ...courseKeys.map(c => s.courses[c] || '')
    ].map(esc).join(',')),
    ...missingStudents.map(s => [
      s.studentNo, s.studentName, 'Evet',
      '', '', '', '',
      'Transkript Yok', 'Transkript Yok', 'Transkript Yok', 'Transkript Yok',
      ...courseKeys.map(() => '')
    ].map(esc).join(','))
  ];
  return '\uFEFF' + rows.join('\r\n'); // BOM → Excel Türkçe karakter desteği
}

function buildExportHTML() {
  const courseKeys = allStudents.length > 0 ? Object.keys(allStudents[0].courses) : [];
  const elig = (v) => v
    ? '<span style="color:#166534;font-weight:700">✓</span>'
    : '<span style="color:#991b1b">✗</span>';

  const studentRows = allStudents.map(s => `
    <tr style="${s.inList === false ? 'background:#fffbeb' : ''}">
      <td>${s.studentNo}</td>
      <td>${s.studentName || '-'}</td>
      <td>${s.inList !== false ? 'Evet' : '<span style="color:#92400e">Hayır</span>'}</td>
      <td style="text-align:center">${s.gno || '-'}</td>
      <td style="text-align:center">${s.agno || '-'}</td>
      <td style="text-align:center">${s.sinif ? s.sinif + '. Sınıf' : '-'}</td>
      <td style="text-align:center">${s.donem || '-'}</td>
      <td style="text-align:center">${elig(s.staj1Eligible)}</td>
      <td style="text-align:center">${elig(s.staj2Eligible)}</td>
      <td style="text-align:center">${elig(s.bil493Eligible)}</td>
      <td style="text-align:center">${elig(s.bil494Eligible)}</td>
      ${courseKeys.map(c => `<td style="text-align:center">${s.courses[c] || '-'}</td>`).join('')}
    </tr>`).join('');

  const missingRows = missingStudents.map(s => `
    <tr style="background:#fef9c3">
      <td>${s.studentNo}</td>
      <td>${s.studentName || '-'}</td>
      <td>Evet</td>
      <td colspan="${8 + courseKeys.length}" style="color:#92400e">⚠ Transkript bulunamadı</td>
    </tr>`).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body { font-family: Arial, sans-serif; font-size: 10px; margin: 20px; }
  h2 { font-size: 13px; margin-bottom: 6px; }
  p  { font-size: 10px; color: #555; margin: 0 0 10px; }
  table { border-collapse: collapse; width: 100%; }
  th { background: #1e3a5f; color: #fff; padding: 5px 7px; font-size: 9px; text-align: left; }
  td { padding: 4px 7px; border-bottom: 1px solid #e2e8f0; }
  tr:nth-child(even) td { background: #f8fafc; }
</style></head><body>
<h2>Staj / BİL493 / BİL494 Uygunluk Raporu</h2>
<p>Toplam: ${allStudents.length} öğrenci &nbsp;|&nbsp;
   Staj I: ${allStudents.filter(s=>s.staj1Eligible).length} &nbsp;|&nbsp;
   Staj II: ${allStudents.filter(s=>s.staj2Eligible).length} &nbsp;|&nbsp;
   BİL493: ${allStudents.filter(s=>s.bil493Eligible).length} &nbsp;|&nbsp;
   BİL494: ${allStudents.filter(s=>s.bil494Eligible).length} &nbsp;|&nbsp;
   Tarih: ${new Date().toLocaleDateString('tr-TR')}</p>
<table>
  <thead><tr>
    <th>Öğrenci No</th><th>Ad Soyad</th><th>Listede</th>
    <th>GNO</th><th>AGNO</th><th>Sınıf</th><th>Dönem</th>
    <th>Staj I</th><th>Staj II</th><th>BİL493</th><th>BİL494</th>
    ${courseKeys.map(c => `<th>${c}</th>`).join('')}
  </tr></thead>
  <tbody>${studentRows}${missingRows}</tbody>
</table></body></html>`;
}

async function doExport(format) {
  if (allStudents.length === 0) return;
  const date = getExportDate();
  const base = `staj-rapor-${date}-pdfplumber`;
  const map = { csv: `${base}.csv`, word: `${base}.docx`, pdf: `${base}.pdf` };

  let payload;
  if (format === 'word') {
    const courseKeys = allStudents.length > 0 ? Object.keys(allStudents[0].courses) : [];
    payload = {
      format,
      defaultFilename: map[format],
      wordData: {
        courseKeys,
        allStudents,
        missingStudents,
        stats: {
          total: allStudents.length,
          staj1: allStudents.filter(s => s.staj1Eligible).length,
          staj2: allStudents.filter(s => s.staj2Eligible).length,
          bil493: allStudents.filter(s => s.bil493Eligible).length,
          bil494: allStudents.filter(s => s.bil494Eligible).length,
          date: new Date().toLocaleDateString('tr-TR')
        }
      }
    };
  } else {
    const content = format === 'csv' ? buildExportCSV() : buildExportHTML();
    payload = { format, content, defaultFilename: map[format] };
  }

  const result = await window.electronAPI.saveExportFile(payload);
  if (result?.error) alert('Dışa aktarma hatası: ' + result.error);
}

if (exportCsvBtn)  exportCsvBtn.addEventListener('click',  () => doExport('csv'));
if (exportWordBtn) exportWordBtn.addEventListener('click', () => doExport('word'));
if (exportPdfBtn)  exportPdfBtn.addEventListener('click',  () => doExport('pdf'));
