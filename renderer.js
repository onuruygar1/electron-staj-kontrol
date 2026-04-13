const analyzeBtn = document.getElementById('analyzeBtn');
const summaryEl = document.getElementById('summary');
const resultsEl = document.getElementById('results');

function badge(ok, yesText, noText) {
  return `<span class="${ok ? 'ok' : 'bad'}">${ok ? yesText : noText}</span>`;
}

function gradeText(grade) {
  return grade ?? 'Bulunamadı';
}

function renderStudent(student) {
  return `
    <div class="student-card">
      <h3>${student.studentName}</h3>
      <div>Öğrenci No: <strong>${student.studentNo}</strong></div>
      <div style="margin-top:8px;">Staj I: ${badge(student.staj1Eligible, 'Alabilir', 'Alamaz')}</div>
      <div>Staj II: ${badge(student.staj2Eligible, 'Alabilir', 'Alamaz')}</div>

      <table>
        <thead>
          <tr>
            <th>Kural</th>
            <th>Ders</th>
            <th>Not</th>
            <th>Durum</th>
          </tr>
        </thead>
        <tbody>
          ${student.staj1Details.map(item => `
            <tr>
              <td>Staj I</td>
              <td>${item.code}</td>
              <td>${gradeText(item.grade)}</td>
              <td>${badge(item.passed, 'Geçti', 'Kaldı / Yok')}</td>
            </tr>
          `).join('')}

          <tr>
            <td>Staj II ön koşul</td>
            <td>BİL300 (Staj I)</td>
            <td>${gradeText(student.staj1CourseGrade)}</td>
            <td>${badge(student.staj1TakenAndPassed, 'Geçti', 'Kaldı / Yok')}</td>
          </tr>

          ${student.staj2Details.map(item => `
            <tr>
              <td>Staj II</td>
              <td>${item.code}</td>
              <td>${gradeText(item.grade)}</td>
              <td>${badge(item.passed, 'Geçti', 'Kaldı / Yok')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

analyzeBtn.addEventListener('click', async () => {
  summaryEl.innerHTML = '<div class="summary">PDF okunuyor...</div>';
  resultsEl.innerHTML = '';

  try {
    const data = await window.electronAPI.pickPdfAndAnalyze();

    if (data.canceled) {
      summaryEl.innerHTML = '<div class="summary">İşlem iptal edildi.</div>';
      return;
    }

    const staj1Count = data.students.filter(s => s.staj1Eligible).length;
    const staj2Count = data.students.filter(s => s.staj2Eligible).length;

    summaryEl.innerHTML = `
      <div class="summary">
        <div><strong>Dosya:</strong> ${data.filePath}</div>
        <div><strong>Toplam öğrenci:</strong> ${data.totalStudents}</div>
        <div><strong>Staj I alabilen:</strong> ${staj1Count}</div>
        <div><strong>Staj II alabilen:</strong> ${staj2Count}</div>
      </div>
    `;

    resultsEl.innerHTML = data.students.map(renderStudent).join('');
  } catch (error) {
    summaryEl.innerHTML = `<div class="summary bad">Hata: ${error.message}</div>`;
  }
});
