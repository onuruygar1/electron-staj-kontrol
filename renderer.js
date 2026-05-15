const analyzeBtn   = document.getElementById('analyzeBtn');
const listBtn      = document.getElementById('listBtn');
const listStatusEl = document.getElementById('listStatus');
const listStatusTx = document.getElementById('listStatusText');
const listClearBtn = document.getElementById('listClearBtn');
const summaryEl    = document.getElementById('summary');
const resultsEl    = document.getElementById('results');
const toolbarEl    = document.getElementById('toolbar');
const searchEl     = document.getElementById('searchInput');
const geminiKeyEl  = document.getElementById('geminiApiKey');
const saveKeyBtn   = document.getElementById('saveKeyBtn');

// Load saved API key
if (geminiKeyEl) geminiKeyEl.value = localStorage.getItem('geminiApiKey') || '';
if (saveKeyBtn) {
  saveKeyBtn.addEventListener('click', () => {
    const key = geminiKeyEl.value.trim();
    localStorage.setItem('geminiApiKey', key);
    saveKeyBtn.textContent = 'Kaydedildi ✓';
    setTimeout(() => { saveKeyBtn.textContent = 'Kaydet'; }, 1500);
  });
}

let allStudents      = [];
let missingStudents  = [];
let activeFilter     = 'all'; // 'all'|'staj1'|'staj2'|'bil493'|'bil494'|'unlisted'
let studentListData  = null;

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
    analyzeBtn.disabled = false;
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
  analyzeBtn.disabled = true;
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

  const bil493Summary = student.bil493Eligible
    ? `${student.bil493BolumPassedCount}/6 bölüm geçildi, tüm ortak dersler ✔`
    : [
        `${student.bil493BolumPassedCount}/6 bölüm geçildi (min. ${4})`,
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
        <div class="pills">
          <span class="pill ${student.staj1Eligible ? 'ok' : 'bad'}"><span class="pill-dot"></span>${student.staj1Eligible ? 'Staj I Alabilir' : 'Staj I Alamaz'}</span>
          <span class="pill ${student.staj2Eligible ? 'ok' : 'bad'}"><span class="pill-dot"></span>${student.staj2Eligible ? 'Staj II Alabilir' : 'Staj II Alamaz'}</span>
          <span class="pill ${student.bil493Eligible ? 'ok' : 'bad'}"><span class="pill-dot"></span>${student.bil493Eligible ? 'BİL493 Alabilir' : 'BİL493 Alamaz'}</span>
          <span class="pill ${student.bil494Eligible ? 'ok' : 'bad'}"><span class="pill-dot"></span>${student.bil494Eligible ? 'BİL494 Alabilir' : 'BİL494 Alamaz'}</span>
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
  const query = searchEl.value.trim().toLowerCase();

  let filtered = allStudents;
  if (activeFilter === 'staj1')   filtered = filtered.filter(s => s.staj1Eligible);
  if (activeFilter === 'staj2')   filtered = filtered.filter(s => s.staj2Eligible);
  if (activeFilter === 'bil493')  filtered = filtered.filter(s => s.bil493Eligible);
  if (activeFilter === 'bil494')  filtered = filtered.filter(s => s.bil494Eligible);
  if (activeFilter === 'unlisted') filtered = filtered.filter(s => !s.inList);
  if (query) {
    filtered = filtered.filter(s =>
      s.studentName.toLowerCase().includes(query) ||
      s.studentNo.includes(query)
    );
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
  if (!studentListData) return;
  analyzeBtn.disabled = true;
  summaryEl.innerHTML = '<div class="msg">⏳ PDF okunuyor, lütfen bekleyin…</div>';
  resultsEl.innerHTML = '';
  toolbarEl.style.display = 'none';

  let _pollTimer = null;
  function startPolling() {
    _pollTimer = setInterval(async () => {
      try {
        const p = await window.electronAPI.getProgress();
        if (!p) return;
        if (p.phase === 'gemini-start') {
          const rlMsg = p.rateLimited ? ' ⚠ Rate limit bekleniyor…' : '';
          summaryEl.innerHTML = `<div class="msg">⏳ Gemini analizi başlıyor… (${p.total} öğrenci)${rlMsg}</div>`;
        } else if (p.phase === 'gemini') {
          const pct = Math.round((p.done / p.total) * 100);
          const rlMsg = p.rateLimited ? ' ⚠ Rate limit bekleniyor…' : '';
          summaryEl.innerHTML = `<div class="msg">⏳ Gemini ile analiz ediliyor… ${p.done}/${p.total} öğrenci (${pct}%)${rlMsg}</div>`;
        }
      } catch (_) {}
    }, 300);
  }
  function stopPolling() { if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; } }

  startPolling();
  try {
    const apiKey = (geminiKeyEl?.value || localStorage.getItem('geminiApiKey') || '').trim();
    const analyzeOptions = { ...(apiKey ? { apiKey } : {}) };
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
    const geminiUsed = Boolean(data.geminiUsed);

    const totalEntries = parseSummary.totalCourseEntries || 0;
    const missingEntries = parseSummary.missingCourseEntries || 0;
    const parseCoverage = totalEntries > 0
      ? Math.round(((totalEntries - missingEntries) / totalEntries) * 100)
      : 0;

    const parserInfo = geminiUsed
      ? (() => {
          const ts = data.tokenStats;
          const tokenLine = ts
            ? ` · ${ts.totalPromptTokens.toLocaleString('tr-TR')} prompt + ${ts.totalOutputTokens.toLocaleString('tr-TR')} output token · ~$${ts.estimatedCostUSD.toFixed(4)}`
            : '';
          return `<span class="gemini-badge">Gemini 2.5 Flash</span>${tokenLine}`;
        })()
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
    analyzeBtn.disabled = false;
  }
});
