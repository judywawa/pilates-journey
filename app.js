/* =========================================================
   皮拉提斯日誌 — Local-first PWA
   資料完全存於 localStorage，離線可用
   ========================================================= */

const STORAGE_KEY = 'pilatesJournal.v1';
const ONBOARD_KEY = 'pilatesJournal.onboarded';

const GEAR_LIST = [
  { id: 'reformer', name: '核心床', icon: 'icons/reformer.svg' },
  { id: 'cadillac', name: '凱迪拉克床', icon: 'icons/cadillac.svg' },
  { id: 'chair', name: '穩踏椅', icon: 'icons/chair.svg' },
  { id: 'ring', name: 'Pilates 圈', icon: 'icons/ring.svg' },
  { id: 'ball', name: '大球（抗力球）', icon: 'icons/ball.svg' },
  { id: 'mat', name: '瑜伽墊', icon: 'icons/mat.svg' },
  { id: 'band', name: '彈力帶', icon: 'icons/band.svg' },
];

const STATUS_LABEL = { upcoming: '待上課', pending: '待補打卡', done: '已完成' };

/* ---------------- State ---------------- */
let state = {
  courses: [],   // {id, name, teacher, totalLessons, amount, startDate, endDate, studioName, location, archived}
  sessions: [],  // {id, courseId, date(YYYY-MM-DD), time, status}
  entries: [],   // {id, title, courseId, date, gear:[ids], note}
};

let calCursor = new Date(); // current month being viewed
let editingCourseId = null;
let editingSessionId = null;
let editingEntryId = null;
let sessionSheetStatus = 'upcoming';
let dayContextDate = null;
let courseTabMode = 'active';

/* ---------------- Persistence ---------------- */
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state = Object.assign(state, parsed);
    }
  } catch (e) { console.warn('load failed', e); }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) { console.warn('save failed', e); }
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ---------------- Utilities ---------------- */
function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function toISODate(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function fmtMonthLabel(d) { return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`; }
function fmtMDLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${m}月${d}日`;
}
function fmtDateShort(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${y}/${pad2(m)}/${pad2(d)}`;
}
function todayISO() { return toISODate(new Date()); }

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.remove('show'), 1800);
}

function gearById(id) { return GEAR_LIST.find(g => g.id === id); }
function courseById(id) { return state.courses.find(c => c.id === id); }

/* ---------------- Navigation ---------------- */
function switchView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.view === name);
  });
  window.scrollTo(0, 0);
  if (name === 'home') renderHome();
  if (name === 'journal') renderJournal();
  if (name === 'courses') renderCourses();
}

/* ---------------- HOME: stats + calendar ---------------- */
function computeHomeStats() {
  const upcoming = state.sessions
    .filter(s => s.status === 'upcoming')
    .sort((a, b) => (a.date + (a.time || '')) < (b.date + (b.time || '')) ? -1 : 1);
  const nextSession = upcoming[0] || null;

  const doneCount = state.sessions.filter(s => s.status === 'done').length;

  return { nextSession, doneCount };
}

function renderHome() {
  const { nextSession, doneCount } = computeHomeStats();
  const statsEl = document.getElementById('homeStats');

  let nextHtml;
  if (nextSession) {
    const c = courseById(nextSession.courseId);
    nextHtml = `
      <div class="stat-value big">${fmtDateShort(nextSession.date).slice(5)}</div>
      <div class="stat-hint">${nextSession.time ? nextSession.time : '時間未定'}${c ? ' · ' + c.name : ''}</div>`;
  } else {
    nextHtml = `<div class="stat-value" style="font-size:16px;color:var(--ink-soft);">尚無安排</div>
      <div class="stat-hint">點右下角新增課程日期</div>`;
  }

  statsEl.innerHTML = `
    <div class="stat-card">
      <div class="stat-label">下次上課</div>
      ${nextHtml}
    </div>
    <div class="stat-card">
      <div class="stat-label">累計上課</div>
      <div class="stat-value big">${doneCount}<span class="unit">堂</span></div>
      <div class="stat-hint">每一堂都算數</div>
    </div>
  `;

  renderCalendar();
}

function sessionsOnDate(iso) {
  return state.sessions.filter(s => s.date === iso);
}

function renderCalendar() {
  document.getElementById('calMonthLabel').textContent = fmtMonthLabel(calCursor);

  const year = calCursor.getFullYear();
  const month = calCursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const cells = [];
  // leading (prev month)
  for (let i = startOffset - 1; i >= 0; i--) {
    cells.push({ day: daysInPrevMonth - i, other: true, iso: null });
  }
  // this month
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, other: false, iso: `${year}-${pad2(month + 1)}-${pad2(d)}` });
  }
  // trailing to fill full weeks (multiple of 7)
  let trailDay = 1;
  while (cells.length % 7 !== 0) {
    cells.push({ day: trailDay, other: true, iso: null });
    trailDay++;
  }

  const dows = ['日', '一', '二', '三', '四', '五', '六'];
  let html = dows.map(d => `<div class="cal-dow">${d}</div>`).join('');
  const today = todayISO();

  cells.forEach(cell => {
    if (cell.other) {
      html += `<div class="cal-cell other-month">${cell.day}</div>`;
      return;
    }
    const daySessions = sessionsOnDate(cell.iso);
    let statusClass = '';
    let badge = '';
    if (daySessions.length) {
      // priority: pending > upcoming > done for visual attention
      const priority = ['pending', 'upcoming', 'done'];
      let chosen = daySessions[0];
      for (const p of priority) {
        const found = daySessions.find(s => s.status === p);
        if (found) { chosen = found; break; }
      }
      statusClass = 'status-' + chosen.status;
      badge = `<span class="badge">${chosen.time ? chosen.time : STATUS_LABEL[chosen.status]}</span>`;
    }
    const isToday = cell.iso === today ? ' today' : '';
    html += `<div class="cal-cell ${statusClass}${isToday}" data-iso="${cell.iso}">
      <span>${cell.day}</span>${badge}
    </div>`;
  });

  document.getElementById('calGrid').innerHTML = html;

  document.querySelectorAll('.cal-cell[data-iso]').forEach(cell => {
    cell.addEventListener('click', () => openDaySheet(cell.dataset.iso));
  });
}

document.getElementById('calPrev').addEventListener('click', () => {
  calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() - 1, 1);
  renderCalendar();
});
document.getElementById('calNext').addEventListener('click', () => {
  calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + 1, 1);
  renderCalendar();
});

/* ---------------- Day detail sheet ---------------- */
function openDaySheet(iso) {
  dayContextDate = iso;
  document.getElementById('dayTitle').textContent = fmtMDLabel(iso);
  const list = sessionsOnDate(iso);
  const listEl = document.getElementById('dayList');

  if (!list.length) {
    listEl.innerHTML = `<div class="empty-state" style="padding:24px 10px;">
      <div class="emoji">🗓️</div>
      <p>這天還沒有安排課程</p>
    </div>`;
  } else {
    listEl.innerHTML = list.map(s => {
      const c = courseById(s.courseId);
      return `<div class="day-course-item" data-sid="${s.id}">
        <div class="left">
          <span class="status-dot ${s.status}"></span>
          <div>
            <div class="name">${c ? escapeHtml(c.name) : '未命名課程'}</div>
            <div class="time">${s.time ? s.time : '時間未定'} · ${STATUS_LABEL[s.status]}</div>
          </div>
        </div>
        <span class="chev">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 18l6-6-6-6"/></svg>
        </span>
      </div>`;
    }).join('');

    listEl.querySelectorAll('.day-course-item').forEach(el => {
      el.addEventListener('click', () => {
        closeSheet('sheetDayBackdrop');
        openSessionSheet(el.dataset.sid);
      });
    });
  }

  openSheet('sheetDayBackdrop');
}

document.getElementById('dayAddBtn').addEventListener('click', () => {
  closeSheet('sheetDayBackdrop');
  openSessionSheet(null, dayContextDate);
});

/* ---------------- Sheets: generic open/close ---------------- */
function openSheet(id) {
  document.getElementById(id).classList.add('active');
}
function closeSheet(id) {
  document.getElementById(id).classList.remove('active');
}
document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => closeSheet(btn.dataset.close));
});
document.querySelectorAll('.sheet-backdrop').forEach(bd => {
  bd.addEventListener('click', (e) => { if (e.target === bd) bd.classList.remove('active'); });
});

/* ---------------- Course sheet ---------------- */
function populateCourseSelect(selectEl, includeEmpty) {
  const opts = state.courses.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  selectEl.innerHTML = (includeEmpty ? '<option value="">不指定</option>' : '') + opts;
}

function openCourseSheet(courseId) {
  editingCourseId = courseId;
  const form = document.getElementById('courseForm');
  form.reset();
  document.getElementById('courseDeleteLink').style.display = courseId ? 'block' : 'none';

  if (courseId) {
    const c = courseById(courseId);
    document.getElementById('courseSheetTitle').textContent = '編輯課程';
    document.getElementById('cName').value = c.name || '';
    document.getElementById('cTeacher').value = c.teacher || '';
    document.getElementById('cTotalLessons').value = c.totalLessons || '';
    document.getElementById('cAmount').value = c.amount || '';
    document.getElementById('cStartDate').value = c.startDate || '';
    document.getElementById('cEndDate').value = c.endDate || '';
    document.getElementById('cStudioName').value = c.studioName || '';
    document.getElementById('cLocation').value = c.location || '';
  } else {
    document.getElementById('courseSheetTitle').textContent = '新增課程';
  }
  openSheet('sheetCourseBackdrop');
}

document.getElementById('courseForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const data = {
    name: document.getElementById('cName').value.trim() || '未命名課程',
    teacher: document.getElementById('cTeacher').value.trim(),
    totalLessons: parseInt(document.getElementById('cTotalLessons').value) || 0,
    amount: parseInt(document.getElementById('cAmount').value) || 0,
    startDate: document.getElementById('cStartDate').value,
    endDate: document.getElementById('cEndDate').value,
    studioName: document.getElementById('cStudioName').value.trim(),
    location: document.getElementById('cLocation').value.trim(),
  };

  if (editingCourseId) {
    const c = courseById(editingCourseId);
    Object.assign(c, data);
    showToast('課程已更新');
  } else {
    state.courses.push(Object.assign({ id: uid(), archived: false }, data));
    showToast('課程已新增');
  }
  saveState();
  closeSheet('sheetCourseBackdrop');
  renderCourses();
  renderHome();
});

document.getElementById('courseDeleteLink').addEventListener('click', () => {
  if (!editingCourseId) return;
  if (!confirm('確定要刪除這個課程嗎？相關的排課紀錄也會一併刪除。')) return;
  state.courses = state.courses.filter(c => c.id !== editingCourseId);
  state.sessions = state.sessions.filter(s => s.courseId !== editingCourseId);
  saveState();
  closeSheet('sheetCourseBackdrop');
  renderCourses();
  renderHome();
  showToast('課程已刪除');
});

/* ---------------- Courses view ---------------- */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    courseTabMode = btn.dataset.coursetab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
    renderCourses();
  });
});

function lessonsDoneForCourse(courseId) {
  return state.sessions.filter(s => s.courseId === courseId && s.status === 'done').length;
}

function renderCourses() {
  const totalAmount = state.courses.reduce((sum, c) => sum + (c.amount || 0), 0);
  const remainingLessons = state.courses.reduce((sum, c) => {
    const done = lessonsDoneForCourse(c.id);
    return sum + Math.max((c.totalLessons || 0) - done, 0);
  }, 0);

  document.getElementById('sumTotalAmount').textContent = totalAmount.toLocaleString();
  document.getElementById('sumRemainingLessons').textContent = remainingLessons;

  const list = state.courses.filter(c => {
    const done = lessonsDoneForCourse(c.id);
    const isComplete = c.totalLessons > 0 && done >= c.totalLessons;
    return courseTabMode === 'done' ? isComplete : !isComplete;
  });

  const listEl = document.getElementById('courseList');

  if (!list.length) {
    listEl.innerHTML = `<div class="empty-state">
      <div class="emoji">🩰</div>
      <p>${courseTabMode === 'done' ? '還沒有已完成的課程' : '還沒有進行中的課程<br>新增課程開始追蹤堂數與花費'}</p>
      <div class="cta-link" id="emptyAddCourse">＋ 新增課程</div>
    </div>`;
    const btn = document.getElementById('emptyAddCourse');
    if (btn) btn.addEventListener('click', () => openCourseSheet(null));
    return;
  }

  listEl.innerHTML = list.map(c => {
    const done = lessonsDoneForCourse(c.id);
    const pct = c.totalLessons ? Math.min(100, Math.round((done / c.totalLessons) * 100)) : 0;
    return `
    <div class="course-card" data-cid="${c.id}">
      <div class="course-top">
        <div>
          <div class="course-title">${escapeHtml(c.name)}</div>
        </div>
        <button class="expand-toggle" data-toggle="${c.id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>
        </button>
      </div>
      <div class="course-progress-label">${done}/${c.totalLessons || 0} 堂</div>
      <div class="chip-row">
        ${c.studioName ? `<span class="chip">${escapeHtml(c.studioName)}</span>` : ''}
        ${c.teacher ? `<span class="chip">${escapeHtml(c.teacher)} 老師</span>` : ''}
        ${c.amount ? `<span class="chip">NT$ ${c.amount.toLocaleString()}</span>` : ''}
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>

      <div class="course-detail" id="detail-${c.id}" style="display:none;">
        <div>
          <div class="detail-block-label">開始日期</div>
          <div class="detail-block-value">${c.startDate || '未設定'}</div>
        </div>
        <div>
          <div class="detail-block-label">結束日期</div>
          <div class="detail-block-value">${c.endDate || '未設定'}</div>
        </div>
        <div>
          <div class="detail-block-label">總堂數</div>
          <div class="detail-block-value">${c.totalLessons || 0} 堂</div>
        </div>
        <div>
          <div class="detail-block-label">課程金額</div>
          <div class="detail-block-value">NT$ ${(c.amount || 0).toLocaleString()}</div>
        </div>
        <div style="grid-column:1/-1;">
          <div class="detail-block-label">教室地點</div>
          <div class="detail-block-value">${c.location ? escapeHtml(c.location) : '未設定'}</div>
        </div>
        <div class="course-actions" style="grid-column:1/-1;">
          <button class="btn-ghost" data-edit="${c.id}">編輯課程</button>
          <button class="btn-danger-ghost" data-del="${c.id}">刪除</button>
        </div>
      </div>
    </div>`;
  }).join('');

  listEl.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.toggle;
      const detail = document.getElementById('detail-' + id);
      const isOpen = detail.style.display !== 'none';
      detail.style.display = isOpen ? 'none' : 'grid';
      btn.classList.toggle('open', !isOpen);
    });
  });
  listEl.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openCourseSheet(btn.dataset.edit); });
  });
  listEl.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm('確定要刪除這個課程嗎？')) return;
      state.courses = state.courses.filter(c => c.id !== btn.dataset.del);
      state.sessions = state.sessions.filter(s => s.courseId !== btn.dataset.del);
      saveState();
      renderCourses();
      renderHome();
      showToast('課程已刪除');
    });
  });
}

/* ---------------- Session sheet ---------------- */
function openSessionSheet(sessionId, presetDate) {
  editingSessionId = sessionId;
  const form = document.getElementById('sessionForm');
  form.reset();
  document.getElementById('sessionDeleteLink').style.display = sessionId ? 'block' : 'none';

  populateCourseSelect(document.getElementById('sCourseId'), false);

  if (!state.courses.length) {
    showToast('請先新增一個課程');
    openCourseSheet(null);
    return;
  }

  if (sessionId) {
    const s = state.sessions.find(x => x.id === sessionId);
    document.getElementById('sessionSheetTitle').textContent = '編輯安排';
    document.getElementById('sCourseId').value = s.courseId;
    document.getElementById('sDate').value = s.date;
    document.getElementById('sTime').value = s.time || '';
    sessionSheetStatus = s.status;
  } else {
    document.getElementById('sessionSheetTitle').textContent = '安排課程';
    document.getElementById('sDate').value = presetDate || todayISO();
    sessionSheetStatus = 'upcoming';
  }
  updateStatusPickerUI();
  openSheet('sheetSessionBackdrop');
}

function updateStatusPickerUI() {
  document.querySelectorAll('#sStatusPicker .status-opt').forEach(opt => {
    opt.classList.toggle('selected', opt.dataset.status === sessionSheetStatus);
  });
}
document.querySelectorAll('#sStatusPicker .status-opt').forEach(opt => {
  opt.addEventListener('click', () => {
    sessionSheetStatus = opt.dataset.status;
    updateStatusPickerUI();
  });
});

document.getElementById('sessionForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const data = {
    courseId: document.getElementById('sCourseId').value,
    date: document.getElementById('sDate').value,
    time: document.getElementById('sTime').value,
    status: sessionSheetStatus,
  };
  if (editingSessionId) {
    const s = state.sessions.find(x => x.id === editingSessionId);
    Object.assign(s, data);
    showToast('安排已更新');
  } else {
    state.sessions.push(Object.assign({ id: uid() }, data));
    showToast('已加入行事曆');
  }
  saveState();
  closeSheet('sheetSessionBackdrop');
  renderHome();
  renderCourses();
});

document.getElementById('sessionDeleteLink').addEventListener('click', () => {
  if (!editingSessionId) return;
  state.sessions = state.sessions.filter(s => s.id !== editingSessionId);
  saveState();
  closeSheet('sheetSessionBackdrop');
  renderHome();
  renderCourses();
  showToast('安排已刪除');
});

/* ---------------- Journal (entries) ---------------- */
function renderJournal() {
  const listEl = document.getElementById('journalList');
  const countEl = document.getElementById('journalCount');
  const sorted = [...state.entries].sort((a, b) => (a.date < b.date ? 1 : -1));

  countEl.textContent = sorted.length ? `共 ${sorted.length} 篇紀錄` : '還沒有任何紀錄';

  if (!sorted.length) {
    listEl.innerHTML = `<div class="empty-state">
      <div class="emoji">📝</div>
      <p>還沒有練習紀錄<br>上完課後記得寫下今天的感受</p>
      <div class="cta-link" id="emptyAddEntry">＋ 新增第一篇日誌</div>
    </div>`;
    document.getElementById('emptyAddEntry').addEventListener('click', () => openEntrySheet(null));
    return;
  }

  listEl.innerHTML = sorted.map(en => {
    const c = courseById(en.courseId);
    const gearHtml = (en.gear || []).map(gid => {
      const g = gearById(gid);
      if (!g) return '';
      return `<span class="gear-chip"><img src="${g.icon}" alt="">${g.name}</span>`;
    }).join('');
    return `<div class="entry-card" data-eid="${en.id}">
      <div class="entry-top">
        <div>
          <div class="entry-title">${escapeHtml(en.title)}</div>
          <div class="entry-date">${fmtDateShort(en.date)}${c ? ' · ' + escapeHtml(c.name) : ''}</div>
        </div>
        ${c ? `<span class="entry-tag">${escapeHtml(c.teacher || c.name)}</span>` : ''}
      </div>
      ${gearHtml ? `<div class="entry-gear">${gearHtml}</div>` : ''}
      ${en.note ? `<div class="entry-note">${escapeHtml(en.note)}</div>` : `<div class="entry-empty-note">尚未填寫感受</div>`}
    </div>`;
  }).join('');

  listEl.querySelectorAll('.entry-card').forEach(el => {
    el.addEventListener('click', () => openEntrySheet(el.dataset.eid));
  });
}

function renderGearPicker(selectedIds) {
  const wrap = document.getElementById('gearPicker');
  wrap.innerHTML = GEAR_LIST.map(g => `
    <div class="gear-option ${selectedIds.includes(g.id) ? 'selected' : ''}" data-gid="${g.id}">
      <img src="${g.icon}" alt="">
      <span>${g.name}</span>
    </div>`).join('');

  wrap.querySelectorAll('.gear-option').forEach(opt => {
    opt.addEventListener('click', () => opt.classList.toggle('selected'));
  });
}

function getSelectedGear() {
  return [...document.querySelectorAll('#gearPicker .gear-option.selected')].map(el => el.dataset.gid);
}

function openEntrySheet(entryId) {
  editingEntryId = entryId;
  const form = document.getElementById('entryForm');
  form.reset();
  document.getElementById('entryDeleteLink').style.display = entryId ? 'block' : 'none';

  populateCourseSelect(document.getElementById('eCourseId'), true);

  if (entryId) {
    const en = state.entries.find(x => x.id === entryId);
    document.getElementById('entrySheetTitle').textContent = '編輯日誌';
    document.getElementById('eTitle').value = en.title || '';
    document.getElementById('eCourseId').value = en.courseId || '';
    document.getElementById('eDate').value = en.date || todayISO();
    document.getElementById('eNote').value = en.note || '';
    renderGearPicker(en.gear || []);
  } else {
    document.getElementById('entrySheetTitle').textContent = '新增日誌';
    document.getElementById('eDate').value = todayISO();
    const nextIndex = state.entries.length + 1;
    document.getElementById('eTitle').value = `上課 - D${nextIndex}`;
    renderGearPicker([]);
  }
  openSheet('sheetEntryBackdrop');
}

document.getElementById('entryForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const data = {
    title: document.getElementById('eTitle').value.trim() || '上課紀錄',
    courseId: document.getElementById('eCourseId').value,
    date: document.getElementById('eDate').value,
    gear: getSelectedGear(),
    note: document.getElementById('eNote').value.trim(),
  };
  if (editingEntryId) {
    const en = state.entries.find(x => x.id === editingEntryId);
    Object.assign(en, data);
    showToast('日誌已更新');
  } else {
    state.entries.push(Object.assign({ id: uid() }, data));
    showToast('日誌已儲存');
  }
  saveState();
  closeSheet('sheetEntryBackdrop');
  renderJournal();
});

document.getElementById('entryDeleteLink').addEventListener('click', () => {
  if (!editingEntryId) return;
  state.entries = state.entries.filter(x => x.id !== editingEntryId);
  saveState();
  closeSheet('sheetEntryBackdrop');
  renderJournal();
  showToast('日誌已刪除');
});

/* ---------------- FAB: context-aware add ---------------- */
document.getElementById('fabBtn').addEventListener('click', () => {
  const activeView = document.querySelector('.view.active').id;
  if (activeView === 'view-journal') {
    openEntrySheet(null);
  } else if (activeView === 'view-courses') {
    openCourseSheet(null);
  } else {
    openSessionSheet(null, todayISO());
  }
});

/* ---------------- Bottom nav ---------------- */
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

/* ---------------- Helpers ---------------- */
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

/* ---------------- Seed demo data (first run only) ---------------- */
function seedDemoData() {
  const courseId = uid();
  state.courses.push({
    id: courseId,
    name: '一對一私教課',
    teacher: '',
    totalLessons: 10,
    amount: 18000,
    startDate: todayISO(),
    endDate: '',
    studioName: '',
    location: '',
    archived: false,
  });
  saveState();
}

/* ---------------- Boot ---------------- */
function init() {
  loadState();

  const onboarded = localStorage.getItem(ONBOARD_KEY);
  if (!onboarded) {
    document.getElementById('onboard').style.display = 'flex';
  } else {
    startApp();
  }

  document.getElementById('onboardStart').addEventListener('click', () => {
    localStorage.setItem(ONBOARD_KEY, '1');
    document.getElementById('onboard').style.display = 'none';
    startApp();
  });

  // register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

function startApp() {
  document.getElementById('shell').style.display = 'block';
  document.getElementById('bottomNav').style.display = 'flex';
  document.getElementById('fabBtn').style.display = 'flex';
  renderHome();
}

init();
