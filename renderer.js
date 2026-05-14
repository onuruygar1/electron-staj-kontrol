const analyzeBtn = document.getElementById('analyzeBtn');
const summaryEl  = document.getElementById('summary');
const resultsEl  = document.getElementById('results');
const toolbarEl  = document.getElementById('toolbar');
const searchEl   = document.getElementById('searchInput');

let allStudents  = [];
let activeFilter = 'all'; // 'all' | 'staj1' | 'staj2'

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

/* ── Render one student card ── */
function renderStudent(student) {
  const rows = [
    ...student.staj1Details.map(item => ({ section: 's1',  code: item.code,          grade: item.grade,              passed: item.passed })),
    {                                      section: 'pre', code: 'BİL300 (Staj I)',  grade: student.staj1CourseGrade, passed: student.staj1TakenAndPassed },
    ...student.staj2Details.map(item => ({ section: 's2',  code: item.code,          grade: item.grade,              passed: item.passed }))
  ];

  return `
    <div class="card">
      <div class="card-head">
        <div>
          <div class="s-name">${student.studentName}</div>
          <div class="s-no">${student.studentNo}</div>
        </div>
        <div class="pills">
          <span class="pill ${student.staj1Eligible ? 'ok' : 'bad'}"><span class="pill-dot"></span>${student.staj1Eligible ? 'Staj I Alabilir' : 'Staj I Alamaz'}</span>
          <span class="pill ${student.staj2Eligible ? 'ok' : 'bad'}"><span class="pill-dot"></span>${student.staj2Eligible ? 'Staj II Alabilir' : 'Staj II Alamaz'}</span>
        </div>
      </div>
      <table>
        <thead><tr><th>Kural</th><th>Ders</th><th>Not</th><th>Durum</th></tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td><span class="tag ${r.section}">${r.section === 's1' ? 'Staj I' : r.section === 's2' ? 'Staj II' : 'Ön Koşul'}</span></td>
              <td><strong>${r.code}</strong></td>
              <td>${r.grade ? `<span class="grade">${r.grade}</span>` : '<span class="grade none">Bulunamadı</span>'}</td>
              <td>${r.passed ? '<span class="ok-txt">✓ Geçti</span>' : '<span class="bad-txt">✗ Kaldı / Yok</span>'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

/* ── Filter + search ── */
function applyFilters() {
  const query = searchEl.value.trim().toLowerCase();

  let filtered = allStudents;
  if (activeFilter === 'staj1') filtered = filtered.filter(s => s.staj1Eligible);
  if (activeFilter === 'staj2') filtered = filtered.filter(s => s.staj2Eligible);
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
    ? filtered.map(renderStudent).join('')
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
  analyzeBtn.disabled = true;
  summaryEl.innerHTML = '<div class="msg">⏳ PDF okunuyor, lütfen bekleyin…</div>';
  resultsEl.innerHTML = '';
  toolbarEl.style.display = 'none';

  try {
    const data = await window.electronAPI.pickPdfAndAnalyze();

    if (data.canceled) {
      summaryEl.innerHTML = '<div class="msg">İşlem iptal edildi.</div>';
      return;
    }

    allStudents = data.students;
    const staj1Count = data.students.filter(s => s.staj1Eligible).length;
    const staj2Count = data.students.filter(s => s.staj2Eligible).length;

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
      </div>
      <div class="file-path">📄 ${data.filePath}</div>`;

    // Reset toolbar state
    activeFilter = 'all';
    searchEl.value = '';
    document.querySelectorAll('.fbtn').forEach(b => b.classList.remove('active'));
    toolbarEl.style.display = 'flex';

    applyFilters();
  } catch (error) {
    summaryEl.innerHTML = `<div class="msg err">Hata: ${error.message}</div>`;
  } finally {
    analyzeBtn.disabled = false;
  }
});
