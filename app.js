const STORAGE_KEY = 'ironlog_data_v2';

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseISODate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function todayISO() {
  return toISODate(new Date());
}

function formatPretty(iso) {
  const d = parseISODate(iso);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function addDays(iso, n) {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

function computeE1RM(weight, reps) {
  if (!weight || !reps) return 0;
  if (reps <= 1) return weight;
  return weight * (1 + reps / 30);
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

// ---------- State ----------

let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to load state', e);
  }
  return { exercises: [], workouts: [], prs: {}, estimates: {}, schedule: {}, progress: {} };
}

let lastWrittenRaw = localStorage.getItem(STORAGE_KEY);

function saveState() {
  lastWrittenRaw = JSON.stringify(state);
  localStorage.setItem(STORAGE_KEY, lastWrittenRaw);
}

function getExercise(id) {
  return state.exercises.find(e => e.id === id);
}

function getWorkoutForDate(iso) {
  return state.workouts.find(w => w.date === iso) || null;
}

// ---------- Streaks ----------

function workoutDateSet() {
  const dates = state.workouts.map(w => w.date);
  Object.entries(state.progress || {}).forEach(([date, rec]) => {
    if (rec && rec.marks && Object.values(rec.marks).some(m => m === 'done')) dates.push(date);
  });
  return new Set(dates);
}

function computeCurrentStreak() {
  const set = workoutDateSet();
  let cursor = todayISO();
  if (!set.has(cursor)) {
    cursor = addDays(cursor, -1);
    if (!set.has(cursor)) return 0;
  }
  let count = 0;
  while (set.has(cursor)) {
    count++;
    cursor = addDays(cursor, -1);
  }
  return count;
}

function computeLongestStreak() {
  const dates = [...workoutDateSet()].sort();
  if (!dates.length) return 0;
  let longest = 1, run = 1;
  for (let i = 1; i < dates.length; i++) {
    if (addDays(dates[i - 1], 1) === dates[i]) {
      run++;
    } else {
      run = 1;
    }
    longest = Math.max(longest, run);
  }
  return longest;
}

// ---------- Toast / Modal ----------

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function openModal({ title, bodyHTML, buttons }) {
  document.querySelector('.modal').classList.remove('modal-wide');
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = bodyHTML;
  const actions = document.getElementById('modalActions');
  actions.innerHTML = '';
  buttons.forEach(b => {
    const btn = document.createElement('button');
    btn.className = `btn ${b.className || 'btn-secondary'}`;
    btn.textContent = b.label;
    btn.onclick = () => {
      if (b.onClick) b.onClick();
      if (b.closesModal !== false) closeModal();
    };
    actions.appendChild(btn);
  });
  document.getElementById('modalBackdrop').classList.add('open');
}

function closeModal() {
  document.getElementById('modalBackdrop').classList.remove('open');
}

// ---------- Tabs ----------

document.getElementById('tabs').addEventListener('click', e => {
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  switchTab(btn.dataset.tab);
});

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${tab}`));
  document.body.classList.toggle('wide', tab === 'schedule');
  if (tab === 'home') renderHome();
  if (tab === 'schedule') renderSchedule();
  if (tab === 'history') renderHistory();
  if (tab === 'exercises') renderExercisesTab();
  if (tab === 'stats') renderStats();
}

// ---------- History tab ----------

function renderCalendar() {
  const grid = document.getElementById('calendarGrid');
  grid.innerHTML = '';
  const set = workoutDateSet();
  const start = addDays(todayISO(), -83);
  for (let i = 0; i < 84; i++) {
    const iso = addDays(start, i);
    const cell = document.createElement('div');
    cell.className = 'cal-day' + (set.has(iso) ? ' hit' : '');
    cell.title = iso;
    grid.appendChild(cell);
  }
}

function renderHistory() {
  renderCalendar();
  const list = document.getElementById('historyList');
  list.innerHTML = '';
  ensureProgress();

  const rows = [
    ...state.workouts.map(w => ({ date: w.date, build: () => buildWorkoutHistoryItem(w) })),
    ...Object.entries(state.progress).map(([date, rec]) => ({ date, build: () => buildMarkedHistoryItem(date, rec) })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));

  if (!rows.length) {
    list.innerHTML = '<div class="empty-state">Nothing tracked yet. Mark off today\'s exercises on the Today tab.</div>';
    return;
  }
  rows.forEach(r => list.appendChild(r.build()));
}

// A day you ticked off on the Today tab.
function buildMarkedHistoryItem(date, rec) {
  const marks = rec.marks || {};
  const counts = { done: 0, partial: 0, skipped: 0 };
  Object.values(marks).forEach(m => { if (counts[m] !== undefined) counts[m]++; });

  const item = document.createElement('div');
  item.className = 'history-item';
  const summary = [
    counts.done ? `${counts.done} done` : '',
    counts.partial ? `${counts.partial} partial` : '',
    counts.skipped ? `${counts.skipped} skipped` : '',
  ].filter(Boolean).join(' · ') || 'no marks';

  item.innerHTML = `
    <div class="history-item-header">
      <div>
        <div class="history-date">${formatPretty(date)}${rec.label ? ` — ${escapeHTML(rec.label)}` : ''}</div>
        <div class="history-summary">${summary}</div>
      </div>
    </div>
    <div class="history-detail"></div>
  `;

  const detail = item.querySelector('.history-detail');
  Object.entries(marks).forEach(([exerciseId, status]) => {
    const ex = getExercise(exerciseId);
    const row = document.createElement('div');
    row.className = 'history-status-line';
    row.innerHTML = `${escapeHTML(ex ? ex.name : 'Deleted exercise')} — <span class="st ${status}">${STATUS_LABELS[status] || status}</span>`;
    detail.appendChild(row);
  });

  const actions = document.createElement('div');
  actions.style.marginTop = '10px';
  const delBtn = document.createElement('button');
  delBtn.className = 'btn btn-danger btn-small';
  delBtn.textContent = 'Clear marks';
  delBtn.addEventListener('click', ev => {
    ev.stopPropagation();
    delete state.progress[date];
    saveState();
    renderStreakPill();
    renderHistory();
    renderSchedule();
    renderHome();
    renderStats();
    toast('Marks cleared');
  });
  actions.appendChild(delBtn);
  detail.appendChild(actions);

  item.querySelector('.history-item-header').addEventListener('click', () => {
    item.classList.toggle('expanded');
  });
  return item;
}

// A workout saved by the old set-by-set logger.
function buildWorkoutHistoryItem(w) {
  const totalSets = w.entries.reduce((n, en) => n + en.sets.length, 0);
  const volume = w.entries.reduce((v, en) => v + en.sets.reduce((sv, s) => sv + s.weight * s.reps, 0), 0);
  const item = document.createElement('div');
  item.className = 'history-item';
  item.innerHTML = `
    <div class="history-item-header">
      <div>
        <div class="history-date">${formatPretty(w.date)}${w.title ? ` — ${escapeHTML(w.title)}` : ''}</div>
        <div class="history-summary">${w.entries.length} exercise${w.entries.length !== 1 ? 's' : ''} · ${totalSets} sets · ${Math.round(volume).toLocaleString()} kg volume</div>
      </div>
    </div>
    <div class="history-detail"></div>
  `;
  const detail = item.querySelector('.history-detail');
  w.entries.forEach(en => {
    const ex = getExercise(en.exerciseId);
    const row = document.createElement('div');
    row.className = 'history-exercise-row';
    const setLines = en.sets.map((s, i) => {
      const e1rm = round1(computeE1RM(s.weight, s.reps));
      return `<div class="history-set-line">Set ${i + 1}: ${s.weight} kg × ${s.reps} reps → e1RM ${e1rm} kg</div>`;
    }).join('');
    row.innerHTML = `<div class="history-ex-name">${escapeHTML(ex ? ex.name : 'Deleted exercise')}</div>${setLines}`;
    detail.appendChild(row);
  });
  const editRow = document.createElement('div');
  editRow.style.marginTop = '10px';
  editRow.style.display = 'flex';
  editRow.style.gap = '8px';
  const delBtn = document.createElement('button');
  delBtn.className = 'btn btn-danger btn-small';
  delBtn.textContent = 'Delete';
  delBtn.addEventListener('click', ev => {
    ev.stopPropagation();
    openModal({
      title: 'Delete workout?',
      bodyHTML: `This will permanently remove the workout logged on ${formatPretty(w.date)}.`,
      buttons: [
        { label: 'Cancel', className: 'btn-ghost' },
        {
          label: 'Delete', className: 'btn-danger', onClick: () => {
            state.workouts = state.workouts.filter(x => x.id !== w.id);
            saveState();
            renderStreakPill();
            renderHistory();
            toast('Workout deleted');
          },
        },
      ],
    });
  });
  editRow.appendChild(delBtn);
  detail.appendChild(editRow);

  item.querySelector('.history-item-header').addEventListener('click', () => {
    item.classList.toggle('expanded');
  });
  return item;
}

// ---------- Exercises & PRs tab ----------

function renderExercisesTab() {
  const manageList = document.getElementById('exerciseManageList');
  manageList.innerHTML = '';
  state.exercises.forEach(ex => {
    const row = document.createElement('div');
    row.className = 'exercise-manage-row';
    row.innerHTML = `
      <div>
        <div class="exercise-manage-name">${escapeHTML(ex.name)}</div>
        <div class="exercise-manage-cat">${escapeHTML(ex.category)}</div>
      </div>
    `;
    const delBtn = document.createElement('button');
    delBtn.className = 'icon-btn';
    delBtn.textContent = '🗑';
    delBtn.addEventListener('click', () => {
      openModal({
        title: 'Delete exercise?',
        bodyHTML: `"${escapeHTML(ex.name)}" will be removed from your exercise list. Past workout history stays intact.`,
        buttons: [
          { label: 'Cancel', className: 'btn-ghost' },
          {
            label: 'Delete', className: 'btn-danger', onClick: () => {
              state.exercises = state.exercises.filter(e => e.id !== ex.id);
              saveState();
              renderSchedule();
              renderExercisesTab();
              toast('Exercise deleted');
            },
          },
        ],
      });
    });
    row.appendChild(delBtn);
    manageList.appendChild(row);
  });

  const prList = document.getElementById('prList');
  prList.innerHTML = '';
  if (!state.exercises.length) {
    prList.innerHTML = '<div class="empty-state">Add an exercise to start tracking PRs.</div>';
    return;
  }
  state.exercises.forEach(ex => {
    const pr = state.prs[ex.id];
    const est = state.estimates[ex.id];
    const card = document.createElement('div');
    card.className = 'pr-card';
    card.innerHTML = `
      <div class="pr-card-header">
        <div class="pr-name">${escapeHTML(ex.name)}</div>
        <div class="pr-actual">${pr ? `${pr.weight} kg` : '—'}</div>
      </div>
      <div class="pr-meta">${pr ? `Actual 1RM PR · ${pr.reps === 1 ? 'tested single' : `set to ${pr.weight}×${pr.reps}`} on ${formatPretty(pr.date)}${pr.source === 'manual' ? ' (manual)' : ''}` : 'No actual PR recorded yet'}</div>
      <div class="pr-meta">${est ? `Best estimated 1RM: ${est.value} kg (from ${est.weight}×${est.reps} on ${formatPretty(est.date)})${pr && est.value > pr.weight ? ' — exceeds actual PR, try testing it!' : ''}` : ''}</div>
      <div class="pr-edit-row">
        <input type="number" min="0" step="0.5" placeholder="Weight (kg)" class="pr-input-weight">
        <input type="number" min="1" step="1" placeholder="Reps" class="pr-input-reps" value="1">
        <button class="btn btn-secondary btn-small pr-set-btn">Set PR</button>
      </div>
    `;
    card.querySelector('.pr-set-btn').addEventListener('click', () => {
      const w = parseFloat(card.querySelector('.pr-input-weight').value);
      const r = parseInt(card.querySelector('.pr-input-reps').value) || 1;
      if (!w || w <= 0) { toast('Enter a weight'); return; }
      const effective = r === 1 ? w : computeE1RM(w, r);
      state.prs[ex.id] = { weight: round1(effective), reps: r, date: todayISO(), source: 'manual' };
      saveState();
      renderExercisesTab();
      toast(`PR set for ${ex.name}`);
    });
    prList.appendChild(card);
  });
}

document.getElementById('btnCreateExercise').addEventListener('click', () => {
  const nameInput = document.getElementById('newExerciseInput');
  const catInput = document.getElementById('newExerciseCategory');
  const name = nameInput.value.trim();
  if (!name) { toast('Enter an exercise name'); return; }
  state.exercises.push({ id: uid('ex'), name, category: catInput.value });
  saveState();
  nameInput.value = '';
  renderExercisesTab();
  toast(`Added ${name}`);
});

// ---------- Stats tab ----------

function renderStats() {
  const grid = document.getElementById('statsGrid');
  const totalWorkouts = workoutDateSet().size;
  const totalPRs = Object.keys(state.prs).length;
  grid.innerHTML = `
    <div class="stat-tile"><div class="stat-value">${computeCurrentStreak()}</div><div class="stat-label">Current streak (days)</div></div>
    <div class="stat-tile"><div class="stat-value">${computeLongestStreak()}</div><div class="stat-label">Longest streak (days)</div></div>
    <div class="stat-tile"><div class="stat-value">${totalWorkouts}</div><div class="stat-label">Days trained</div></div>
    <div class="stat-tile"><div class="stat-value">${totalPRs}</div><div class="stat-label">PRs recorded</div></div>
  `;

  const sel = document.getElementById('progressExerciseSelect');
  const prevValue = sel.value;
  sel.innerHTML = '';
  state.exercises.forEach(ex => {
    const opt = document.createElement('option');
    opt.value = ex.id;
    opt.textContent = ex.name;
    sel.appendChild(opt);
  });
  if (prevValue) sel.value = prevValue;
  sel.onchange = renderProgressChart;
  renderProgressChart();
}

function renderProgressChart() {
  const sel = document.getElementById('progressExerciseSelect');
  const exerciseId = sel.value;
  const container = document.getElementById('progressChart');
  container.innerHTML = '';
  if (!exerciseId) {
    container.innerHTML = '<div class="empty-state">No exercises yet.</div>';
    return;
  }
  const points = [];
  [...state.workouts].sort((a, b) => (a.date < b.date ? -1 : 1)).forEach(w => {
    const entry = w.entries.find(en => en.exerciseId === exerciseId);
    if (!entry) return;
    const best = Math.max(...entry.sets.map(s => computeE1RM(s.weight, s.reps)));
    points.push({ date: w.date, value: round1(best) });
  });
  if (!points.length) {
    container.innerHTML = '<div class="empty-state">No sets logged for this exercise yet.</div>';
    return;
  }
  const max = Math.max(...points.map(p => p.value), state.prs[exerciseId]?.weight || 0);
  points.forEach(p => {
    const row = document.createElement('div');
    row.className = 'progress-row';
    row.innerHTML = `
      <div class="progress-date">${formatPretty(p.date)}</div>
      <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${(p.value / max) * 100}%"></div></div>
      <div class="progress-value">${p.value} kg</div>
    `;
    container.appendChild(row);
  });
}

// ---------- Import a session or a whole week from text ----------

// Ordered: the first list that matches wins, so "leg press" lands in Legs, not Push.
const CATEGORY_HINTS = [
  { cat: 'Legs', words: ['squat', 'deadlift', 'lunge', 'leg', 'calf', 'hamstring', 'quad', 'glute', 'hip thrust', 'rdl'] },
  { cat: 'Core', words: ['plank', 'crunch', 'sit up', 'situp', ' ab ', 'abs', 'core', 'russian twist'] },
  { cat: 'Pull', words: ['row', 'pull', 'chin', 'lat pull', 'pulldown', 'curl', 'shrug', 'face pull', 'rear delt'] },
  { cat: 'Push', words: ['bench', 'press', 'push', 'dip', 'tricep', 'shoulder', 'fly', 'overhead', 'ohp', 'lateral', 'delt'] },
];

const DAY_LOOKUP = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5, sat: 6, saturday: 6,
};

function guessCategory(name) {
  const n = ` ${name.toLowerCase()} `;
  for (const { cat, words } of CATEGORY_HINTS) {
    if (words.some(w => n.includes(w))) return cat;
  }
  return 'Other';
}

function clampInt(n, min, max, fallback) {
  if (!isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

// Exercise lines look like:
//   Bench Press/3/8/60      Bench Press | 3 | 8 | 60kg      Bench Press, 3, 8, 60
//   Bench Press 3x8 @ 60    Bench Press 3x8x60              Bench Press/3x8/60
// A line naming a weekday ("Monday", "Tue - Pull Day") starts a new day block.
function parseWorkoutText(text) {
  const blocks = [];
  const errors = [];
  let current = null;

  const ensureBlock = () => {
    if (!current) {
      current = { dayIdx: null, title: '', entries: [], rest: false };
      blocks.push(current);
    }
    return current;
  };

  String(text).split(/\r?\n/).forEach(raw => {
    const line = raw.trim();
    if (!line) return;

    const stripped = line.replace(/^[-–—*•#>\s]+/, '').trim();
    if (!stripped) return;

    // Day header: "Monday", "Mon:", "Tuesday - Pull Day", "Wed — Rest"
    const header = stripped.match(/^([A-Za-z]+)\s*[:\-–—]*\s*(.*)$/);
    if (header && DAY_LOOKUP[header[1].toLowerCase()] !== undefined && !/\d/.test(header[2])) {
      const title = header[2].trim();
      current = {
        dayIdx: DAY_LOOKUP[header[1].toLowerCase()],
        title: /^(rest|off)\b/i.test(title) ? '' : title,
        entries: [],
        rest: /^(rest|off)\b/i.test(title),
      };
      blocks.push(current);
      return;
    }

    const parts = stripped.split(/[\/|;\t]+|,/).map(p => p.trim()).filter(Boolean);
    let name = parts[0] || '';
    const nums = [];
    parts.slice(1).forEach(p => {
      (p.match(/\d+(?:[.,]\d+)?/g) || []).forEach(n => nums.push(Number(n.replace(',', '.'))));
    });

    // "Bench Press 3x8 @ 60" — numbers live inside the name itself
    if (!nums.length) {
      const inline = name.match(/^(.*?)[\s:]+(\d+)\s*[x×]\s*(\d+)(?:\s*(?:[x×@]|\s)\s*(\d+(?:[.,]\d+)?))?\s*(?:kg|kgs|lb|lbs)?$/i);
      if (inline) {
        name = inline[1].trim();
        nums.push(Number(inline[2]), Number(inline[3]));
        if (inline[4]) nums.push(Number(inline[4].replace(',', '.')));
      }
    }

    name = name.replace(/^["'`]+|["'`:]+$/g, '').trim();

    if (!nums.length) {
      // No numbers: names the session, or marks the day as rest.
      const block = ensureBlock();
      if (/^(rest|off|rest day)\b/i.test(name)) block.rest = true;
      else if (!block.title) block.title = name;
      return;
    }
    if (!name) {
      errors.push(line);
      return;
    }

    const block = ensureBlock();
    block.rest = false;
    block.entries.push({
      name,
      sets: clampInt(nums[0], 1, 30, 1),
      reps: clampInt(nums[1] !== undefined ? nums[1] : 8, 1, 200, 8),
      weight: nums[2] !== undefined ? Math.max(0, nums[2]) : 0,
    });
  });

  return { blocks: blocks.filter(b => b.entries.length || b.rest || b.title), errors };
}

function findExerciseByName(name) {
  const key = name.trim().toLowerCase();
  return state.exercises.find(ex => ex.name.trim().toLowerCase() === key) || null;
}

const IMPORT_SAMPLE = `-Push Day
Bench Press/4/8/60
Overhead Press/3/10/35
Tricep Pushdown/3/12/25`;

const WEEK_SAMPLE = `Monday - Push Day
Bench Press/4/8/60
Overhead Press/3/10/35

Tuesday - Pull Day
Barbell Row/4/8/60
Lat Pulldown/3/10/45

Wednesday - Rest

Thursday - Leg Day
Back Squat/5/5/100
Romanian Deadlift/3/10/70`;

function openImportModal(preselectDay) {
  ensureSchedule();
  const defaultDay = preselectDay !== undefined ? preselectDay : new Date().getDay();

  const dayOptions = WEEK_ORDER.map(idx => {
    const date = dateForDayIndex(idx);
    const label = `${DAY_FULL[idx]} · ${parseISODate(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
    return `<option value="${idx}"${idx === defaultDay ? ' selected' : ''}>${label}</option>`;
  }).join('');

  openModal({
    title: 'Import a session or week',
    bodyHTML: `
      <div class="add-exercise-row" style="margin-bottom:12px">
        <label class="field field-grow">
          <span>Day (when no day is named)</span>
          <select id="importDay">${dayOptions}</select>
        </label>
        <label class="field field-grow">
          <span>Mode</span>
          <select id="importMode">
            <option value="replace">Replace those days</option>
            <option value="append">Add to those days</option>
          </select>
        </label>
      </div>
      <div class="import-hint-row">
        <div class="import-hint" style="margin:0">One exercise per line as <code>Name/sets/reps/weight</code>. Name a weekday to start a day.</div>
        <button class="info-btn" id="btnFormatInfo" type="button" aria-expanded="false" aria-controls="formatInfo" title="Show format example">i</button>
      </div>
      <div class="format-info" id="formatInfo" hidden>
        <div class="format-info-label">One day</div>
        <pre class="format-example">${escapeHTML(IMPORT_SAMPLE)}</pre>
        <div class="format-info-label">A whole week</div>
        <pre class="format-example">${escapeHTML(WEEK_SAMPLE)}</pre>
        <ul class="format-rules">
          <li>A line naming a weekday (<code>Monday</code>, <code>Tue - Pull Day</code>) starts that day; the rest of the line becomes the session name.</li>
          <li><code>Wednesday - Rest</code> clears that day.</li>
          <li>Without any weekday lines, everything goes to the day picked above.</li>
          <li><code>/</code>, <code>|</code>, <code>,</code> and tabs all work as separators.</li>
          <li>Weight is optional — <code>Lateral Raise/3/15</code> plans 3 × 15 bodyweight.</li>
          <li>Units are ignored, so <code>60kg</code> and <code>135 lbs</code> both read as numbers.</li>
          <li><code>Bench Press 3x8 @ 60</code> and <code>Bench Press 3x8x60</code> are understood too.</li>
          <li>Exercises you don't have yet are created automatically.</li>
        </ul>
        <div class="import-file-row" style="margin:0">
          <button class="btn btn-secondary btn-small" id="btnImportSample" type="button">Paste day example</button>
          <button class="btn btn-secondary btn-small" id="btnImportWeekSample" type="button">Paste week example</button>
        </div>
      </div>
      <textarea class="import-textarea" id="importText" placeholder="${escapeHTML(WEEK_SAMPLE)}"></textarea>
      <div class="import-file-row">
        <label class="import-file-label" for="importFile">Choose a .txt file</label>
        <input type="file" id="importFile" accept=".txt,.md,.csv,text/plain" style="display:none">
        <span class="import-file-name" id="importFileName"></span>
      </div>
      <div class="import-preview" id="importPreview"></div>
    `,
    buttons: [
      { label: 'Cancel', className: 'btn-ghost' },
      { label: 'Import', className: 'btn-primary', closesModal: false, onClick: runImport },
    ],
  });

  document.querySelector('.modal').classList.add('modal-wide');

  const textarea = document.getElementById('importText');
  textarea.addEventListener('input', renderImportPreview);
  document.getElementById('importDay').addEventListener('change', renderImportPreview);
  document.getElementById('importMode').addEventListener('change', renderImportPreview);

  const infoBtn = document.getElementById('btnFormatInfo');
  const infoPanel = document.getElementById('formatInfo');
  infoBtn.addEventListener('click', () => {
    infoPanel.hidden = !infoPanel.hidden;
    infoBtn.setAttribute('aria-expanded', String(!infoPanel.hidden));
    infoBtn.classList.toggle('open', !infoPanel.hidden);
  });

  const paste = sample => () => {
    textarea.value = sample;
    renderImportPreview();
    textarea.focus();
  };
  document.getElementById('btnImportSample').addEventListener('click', paste(IMPORT_SAMPLE));
  document.getElementById('btnImportWeekSample').addEventListener('click', paste(WEEK_SAMPLE));

  document.getElementById('importFile').addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      textarea.value = String(reader.result);
      document.getElementById('importFileName').textContent = file.name;
      renderImportPreview();
    };
    reader.onerror = () => toast("Couldn't read that file");
    reader.readAsText(file);
  });

  renderImportPreview();
  textarea.focus();
  document.getElementById('modalBody').scrollTop = 0; // focus() would otherwise scroll the day picker out of view
}

function renderImportPreview() {
  const wrap = document.getElementById('importPreview');
  const text = document.getElementById('importText').value;
  if (!text.trim()) {
    wrap.innerHTML = '<div class="import-hint" style="margin:0">Paste or upload a session to see a preview here.</div>';
    return;
  }

  const { blocks, errors } = parseWorkoutText(text);
  if (!blocks.length) {
    wrap.innerHTML = '<div class="import-line bad">Nothing readable yet — each exercise line needs a name and at least one number.</div>';
    return;
  }

  const fallbackDay = Number(document.getElementById('importDay').value);
  const mode = document.getElementById('importMode').value;
  let totalSets = 0;

  const html = blocks.map(block => {
    const dayIdx = block.dayIdx !== null ? block.dayIdx : fallbackDay;
    const head = `<div class="import-preview-title">${DAY_FULL[dayIdx]}${block.title ? ` · ${escapeHTML(block.title)}` : ''}</div>`;
    if (block.rest && !block.entries.length) {
      return head + '<div class="import-line"><span>Rest day — clears anything planned</span></div>';
    }
    const lines = block.entries.map(en => {
      totalSets += en.sets;
      const isNew = !findExerciseByName(en.name);
      const tag = isNew ? `<span class="import-tag">new · ${guessCategory(en.name)}</span>` : '';
      const target = `${en.sets} × ${en.reps}${en.weight ? ` @ ${round1(en.weight)} kg` : ''}`;
      return `<div class="import-line"><span>${escapeHTML(en.name)}${tag}</span><span class="import-line-target">${target}</span></div>`;
    }).join('');
    return head + lines;
  }).join('');

  const bad = errors.map(l => `<div class="import-line bad">Skipped: ${escapeHTML(l)}</div>`).join('');
  const dayCount = blocks.length;

  wrap.innerHTML = html + bad +
    `<div class="import-hint" style="margin:8px 0 0">${dayCount} day${dayCount !== 1 ? 's' : ''} · ${totalSets} sets → ` +
    `${mode === 'replace' ? 'replaces' : 'adds to'} the days above</div>`;
}

function runImport() {
  const { blocks } = parseWorkoutText(document.getElementById('importText').value);
  if (!blocks.length) {
    toast('Nothing to import yet');
    return;
  }

  const fallbackDay = Number(document.getElementById('importDay').value);
  const mode = document.getElementById('importMode').value;
  ensureSchedule();

  const touched = new Set();
  let created = 0;

  blocks.forEach(block => {
    const dayIdx = block.dayIdx !== null ? block.dayIdx : fallbackDay;
    const day = state.schedule[dayIdx];

    if (block.rest && !block.entries.length) {
      state.schedule[dayIdx] = { label: '', time: '', items: [] };
      touched.add(dayIdx);
      return;
    }

    // A day repeated later in the same paste always appends to what we just wrote.
    const keepExisting = mode === 'append' || touched.has(dayIdx);
    const items = keepExisting ? state.schedule[dayIdx].items.slice() : [];

    block.entries.forEach(en => {
      let ex = findExerciseByName(en.name);
      if (!ex) {
        ex = { id: uid('ex'), name: en.name, category: guessCategory(en.name) };
        state.exercises.push(ex);
        created++;
      }
      const existing = items.find(it => it.exerciseId === ex.id);
      if (existing) {
        existing.sets = en.sets;
        existing.reps = en.reps;
        existing.weight = en.weight;
      } else {
        items.push({ exerciseId: ex.id, sets: en.sets, reps: en.reps, weight: en.weight });
      }
    });

    state.schedule[dayIdx] = {
      label: block.title || day.label || 'Workout',
      time: day.time || '',
      items,
    };
    touched.add(dayIdx);
  });

  saveState();
  closeModal();
  renderExercisesTab();
  renderSchedule();
  renderHome();
  const dayNames = [...touched].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(i => DAY_ABBR[i]).join(', ');
  toast(`Imported ${dayNames}${created ? ` · ${created} new exercises` : ''}`);
}

document.getElementById('btnImportWorkout').addEventListener('click', () => openImportModal());

// ---------- Schedule tab ----------

const DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

const SCHEDULE_PRESETS = {
  ppl6: {
    1: { label: 'Push', cats: ['Push'] },
    2: { label: 'Pull', cats: ['Pull'] },
    3: { label: 'Legs', cats: ['Legs', 'Core'] },
    4: { label: 'Push', cats: ['Push'] },
    5: { label: 'Pull', cats: ['Pull'] },
    6: { label: 'Legs', cats: ['Legs', 'Core'] },
  },
  ppl3: {
    1: { label: 'Push', cats: ['Push'] },
    3: { label: 'Pull', cats: ['Pull'] },
    5: { label: 'Legs', cats: ['Legs', 'Core'] },
  },
  ul4: {
    1: { label: 'Upper', cats: ['Push', 'Pull'] },
    2: { label: 'Lower', cats: ['Legs', 'Core'] },
    4: { label: 'Upper', cats: ['Push', 'Pull'] },
    5: { label: 'Lower', cats: ['Legs', 'Core'] },
  },
  full3: {
    1: { label: 'Full Body', cats: ['Push', 'Pull', 'Legs'] },
    3: { label: 'Full Body', cats: ['Push', 'Pull', 'Legs'] },
    5: { label: 'Full Body', cats: ['Push', 'Pull', 'Legs'] },
  },
};

let schedEditDraft = null;

function ensureSchedule() {
  if (!state.schedule || typeof state.schedule !== 'object') state.schedule = {};
  WEEK_ORDER.forEach(idx => {
    const day = state.schedule[idx];
    if (!day || typeof day !== 'object') {
      state.schedule[idx] = { label: '', time: '', items: [] };
    } else if (!Array.isArray(day.items)) {
      day.items = [];
    }
  });
}

function weekStartISO() {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // back to Monday
  return toISODate(d);
}

function dateForDayIndex(dayIdx) {
  return addDays(weekStartISO(), (dayIdx + 6) % 7);
}

function isPlannedDay(day) {
  return !!(day && ((day.label && day.label.trim()) || day.items.length));
}

function renderSchedule() {
  ensureSchedule();
  const monday = weekStartISO();
  document.getElementById('weekRange').textContent =
    `${formatPretty(monday)} — ${formatPretty(addDays(monday, 6))}`;

  const grid = document.getElementById('weekGrid');
  const today = todayISO();
  let planned = 0;
  let done = 0;

  grid.innerHTML = WEEK_ORDER.map(idx => {
    const day = state.schedule[idx];
    const date = dateForDayIndex(idx);
    const isToday = date === today;
    const isPast = date < today;
    const st = dayStatus(date, day.items.filter(it => getExercise(it.exerciseId)));
    const active = isPlannedDay(day);
    if (active) {
      planned++;
      if (st.status === 'done') done++;
    }

    const classes = ['day-card'];
    if (!active) classes.push('rest');
    if (isToday) classes.push('today');
    if (isPast) classes.push('past');

    let flag = '';
    if (st.status === 'done') flag = '<span class="day-flag done">✓ Done</span>';
    else if (st.status === 'partial') flag = `<span class="day-flag partial">${st.done}/${st.total}</span>`;
    else if (st.status === 'skipped') flag = '<span class="day-flag skipped">Skipped</span>';
    else if (isToday) flag = '<span class="day-flag today">Today</span>';

    const shown = day.items.slice(0, 4);
    const itemsHTML = shown.map(it => {
      const ex = getExercise(it.exerciseId);
      if (!ex) return '';
      const target = `${it.sets}×${it.reps}${it.weight ? ` · ${round1(it.weight)}kg` : ''}`;
      return `<li class="day-item"><span>${escapeHTML(ex.name)}</span>` +
        `<span class="day-item-target">${target}</span></li>`;
    }).join('') + (day.items.length > shown.length
      ? `<li class="day-item-more">+${day.items.length - shown.length} more</li>` : '');

    const labelHTML = active
      ? `<div class="day-label">${escapeHTML(day.label || 'Workout')}</div>`
      : '<div class="day-label rest">Rest day</div>';

    const timeHTML = active && day.time ? `<div class="day-time">${escapeHTML(day.time)}</div>` : '';


    return `
      <div class="${classes.join(' ')}">
        <div class="day-card-head">
          <div>
            <div class="day-name">${DAY_ABBR[idx]}</div>
            <div class="day-date">${parseISODate(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>
          </div>
          ${flag}
        </div>
        ${labelHTML}
        ${timeHTML}
        <ul class="day-items">${itemsHTML}</ul>
        <div class="day-actions">
          <button class="btn btn-ghost btn-small" data-edit="${idx}">${active ? 'Edit' : 'Plan'}</button>
          <button class="btn btn-secondary btn-small" data-import="${idx}">Import</button>
        </div>
      </div>`;
  }).join('');

  const prog = document.getElementById('weekProgress');
  if (!planned) {
    prog.textContent = 'Nothing planned yet';
    prog.className = 'day-status empty';
  } else {
    prog.textContent = `${done} of ${planned} sessions done`;
    prog.className = done === planned ? 'day-status logged' : 'day-status empty';
  }
}

document.getElementById('weekGrid').addEventListener('click', e => {
  const editBtn = e.target.closest('[data-edit]');
  if (editBtn) return openScheduleEditor(Number(editBtn.dataset.edit));
  const importBtn = e.target.closest('[data-import]');
  if (importBtn) return openImportModal(Number(importBtn.dataset.import));
});

function openScheduleEditor(dayIdx) {
  const day = state.schedule[dayIdx];
  schedEditDraft = {
    label: day.label || '',
    time: day.time || '',
    items: day.items.map(it => ({ ...it })),
  };

  openModal({
    title: DAY_FULL[dayIdx],
    bodyHTML: `
      <div class="field" style="margin-bottom:10px">
        <span>Session name</span>
        <input type="text" id="schedLabel" placeholder="e.g. Push Day" value="${escapeHTML(schedEditDraft.label)}">
      </div>
      <div class="field" style="margin-bottom:14px">
        <span>Time (optional)</span>
        <input type="time" id="schedTime" value="${escapeHTML(schedEditDraft.time)}">
      </div>
      <div id="schedItems"></div>
      <div class="add-exercise-row" style="margin-top:10px">
        <select id="schedAddSelect"></select>
        <button class="btn btn-secondary" id="schedAddBtn">+ Add</button>
      </div>
    `,
    buttons: [
      { label: 'Clear day', className: 'btn-danger', onClick: () => {
        state.schedule[dayIdx] = { label: '', time: '', items: [] };
        saveState();
        renderSchedule();
        toast(`${DAY_FULL[dayIdx]} set to rest`);
      } },
      { label: 'Cancel', className: 'btn-ghost' },
      { label: 'Save', className: 'btn-primary', onClick: () => {
        state.schedule[dayIdx] = {
          label: document.getElementById('schedLabel').value.trim(),
          time: document.getElementById('schedTime').value,
          items: schedEditDraft.items,
        };
        saveState();
        renderSchedule();
        toast(`${DAY_FULL[dayIdx]} saved`);
      } },
    ],
  });

  document.querySelector('.modal').classList.add('modal-wide');
  renderScheduleEditorItems();

  document.getElementById('schedAddBtn').addEventListener('click', () => {
    const sel = document.getElementById('schedAddSelect');
    if (!sel.value) return;
    schedEditDraft.items.push({ exerciseId: sel.value, sets: 3, reps: 8, weight: 0 });
    renderScheduleEditorItems();
  });
}

function renderScheduleEditorItems() {
  const wrap = document.getElementById('schedItems');
  if (!state.exercises.length) {
    wrap.innerHTML = '<div class="empty-state" style="padding:12px">Add exercises in the Exercises &amp; PRs tab, or import a session from text.</div>';
  } else if (!schedEditDraft.items.length) {
    wrap.innerHTML = '<div class="empty-state" style="padding:12px">No exercises planned for this day yet.</div>';
  } else {
    wrap.innerHTML = '<div class="sched-head-row"><span>Exercise</span><span>Sets</span><span>Reps</span><span>Kg</span><span></span></div>' +
      schedEditDraft.items.map((it, i) => {
        const ex = getExercise(it.exerciseId);
        return `
          <div class="sched-item-row">
            <div class="sched-item-name">${escapeHTML(ex ? ex.name : 'Removed exercise')}</div>
            <input type="number" min="1" inputmode="numeric" value="${it.sets}" data-field="sets" data-i="${i}">
            <input type="number" min="1" inputmode="numeric" value="${it.reps}" data-field="reps" data-i="${i}">
            <input type="number" min="0" step="0.5" inputmode="decimal" value="${it.weight || 0}" data-field="weight" data-i="${i}">
            <button class="icon-btn" data-remove="${i}" aria-label="Remove">✕</button>
          </div>`;
      }).join('');

    wrap.querySelectorAll('input[data-field]').forEach(inp => {
      inp.addEventListener('input', () => {
        const field = inp.dataset.field;
        const item = schedEditDraft.items[Number(inp.dataset.i)];
        if (field === 'weight') {
          const w = parseFloat(inp.value);
          item.weight = isNaN(w) || w < 0 ? 0 : w;
        } else {
          const n = parseInt(inp.value, 10);
          item[field] = isNaN(n) || n < 1 ? 1 : n;
        }
      });
    });
    wrap.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        schedEditDraft.items.splice(Number(btn.dataset.remove), 1);
        renderScheduleEditorItems();
      });
    });
  }

  const sel = document.getElementById('schedAddSelect');
  const chosen = new Set(schedEditDraft.items.map(it => it.exerciseId));
  const available = state.exercises.filter(ex => !chosen.has(ex.id));
  sel.innerHTML = available.length
    ? available.map(ex => `<option value="${ex.id}">${escapeHTML(ex.name)} · ${escapeHTML(ex.category)}</option>`).join('')
    : '<option value="">No exercises left to add</option>';
  document.getElementById('schedAddBtn').disabled = !available.length;
}

document.getElementById('btnApplyPreset').addEventListener('click', () => {
  const key = document.getElementById('presetSelect').value;
  if (!key) { toast('Pick a template first'); return; }
  const preset = SCHEDULE_PRESETS[key];
  ensureSchedule();
  WEEK_ORDER.forEach(idx => {
    const plan = preset[idx];
    if (!plan) {
      state.schedule[idx] = { label: '', time: '', items: [] };
      return;
    }
    const items = [];
    plan.cats.forEach(cat => {
      state.exercises
        .filter(ex => ex.category === cat)
        .slice(0, 3)
        .forEach(ex => items.push({ exerciseId: ex.id, sets: 3, reps: 8, weight: 0 }));
    });
    state.schedule[idx] = { label: plan.label, time: state.schedule[idx].time || '', items };
  });
  saveState();
  renderSchedule();
  toast('Template applied');
});

document.getElementById('btnClearSchedule').addEventListener('click', () => {
  openModal({
    title: 'Clear the week?',
    bodyHTML: 'This removes every planned session. Logged workouts are not affected.',
    buttons: [
      { label: 'Cancel', className: 'btn-ghost' },
      { label: 'Clear', className: 'btn-danger', onClick: () => {
        state.schedule = {};
        ensureSchedule();
        saveState();
        renderSchedule();
        toast('Week cleared');
      } },
    ],
  });
});

// ---------- Today (home) ----------

const STATUS_LABELS = { done: 'Done', partial: 'Partial', skipped: 'Skipped' };

function ensureProgress() {
  if (!state.progress || typeof state.progress !== 'object') state.progress = {};
}

function getMarks(dateISO) {
  ensureProgress();
  const rec = state.progress[dateISO];
  return rec && rec.marks ? rec.marks : {};
}

function setMark(dateISO, exerciseId, status) {
  ensureProgress();
  const dayIdx = parseISODate(dateISO).getDay();
  const rec = state.progress[dateISO] || { label: (state.schedule[dayIdx] || {}).label || '', marks: {} };
  if (!rec.marks) rec.marks = {};
  if (status) rec.marks[exerciseId] = status;
  else delete rec.marks[exerciseId];
  rec.label = (state.schedule[dayIdx] || {}).label || rec.label || '';
  if (Object.keys(rec.marks).length) state.progress[dateISO] = rec;
  else delete state.progress[dateISO];
  saveState();
}

// Rolls a day's per-exercise marks up into one status.
function dayStatus(dateISO, items) {
  const marks = getMarks(dateISO);
  const counts = { done: 0, partial: 0, skipped: 0 };
  items.forEach(it => {
    const m = marks[it.exerciseId];
    if (m) counts[m]++;
  });
  const marked = counts.done + counts.partial + counts.skipped;
  let status = 'none';
  if (items.length && counts.done === items.length) status = 'done';
  else if (items.length && counts.skipped === items.length) status = 'skipped';
  else if (marked) status = 'partial';
  return { ...counts, marked, total: items.length, status };
}

function renderHome() {
  ensureSchedule();
  ensureProgress();

  const date = todayISO();
  const dayIdx = new Date().getDay();
  const day = state.schedule[dayIdx];
  const hero = document.getElementById('homeHero');
  const body = document.getElementById('homeBody');
  const planned = isPlannedDay(day);
  const items = day.items.filter(it => getExercise(it.exerciseId));
  const eyebrow = parseISODate(date).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  if (!planned || !items.length) {
    hero.innerHTML = `
      <div class="home-eyebrow">${eyebrow}</div>
      <div class="home-session rest">${planned ? escapeHTML(day.label || 'Workout') : 'Rest day'}</div>
      <div class="home-meta">${planned ? 'Nothing planned for this session yet.' : 'Nothing scheduled — enjoy the recovery.'}</div>
      <div class="home-hero-actions">
        <button class="btn btn-secondary btn-small" id="homeEdit">Plan today</button>
        <button class="btn btn-ghost btn-small" id="homeImport">Import</button>
      </div>`;
    const next = nextPlannedDay(dayIdx);
    body.innerHTML = next === null
      ? '<div class="card empty-state">No sessions planned this week. Import a week or build one on the Schedule tab.</div>'
      : `<div class="card"><div class="card-title">Up next</div>
           <div class="home-meta">${DAY_FULL[next]} · ${escapeHTML(state.schedule[next].label || 'Workout')} — ${state.schedule[next].items.length} exercises</div>
         </div>`;
  } else {
    const st = dayStatus(date, items);
    const totalSets = items.reduce((n, it) => n + it.sets, 0);
    const pct = n => (st.total ? (n / st.total) * 100 : 0);

    hero.innerHTML = `
      <div class="home-eyebrow">${eyebrow}</div>
      <div class="home-session">${escapeHTML(day.label || 'Workout')}</div>
      <div class="home-meta">${items.length} exercises · ${totalSets} sets${day.time ? ` · ${escapeHTML(day.time)}` : ''}</div>
      <div class="home-bar-track">
        <div class="home-bar-done" style="width:${pct(st.done)}%"></div>
        <div class="home-bar-partial" style="width:${pct(st.partial)}%"></div>
        <div class="home-bar-skipped" style="width:${pct(st.skipped)}%"></div>
      </div>
      <div class="home-day-flag ${st.status}">${st.marked ? `${st.done} of ${st.total} done${st.partial ? ` · ${st.partial} partial` : ''}${st.skipped ? ` · ${st.skipped} skipped` : ''}` : 'Nothing marked yet'}</div>
      <div class="home-hero-actions">
        <button class="btn btn-secondary btn-small" id="homeMarkAll">Mark all done</button>
        ${st.marked ? '<button class="btn btn-ghost btn-small" id="homeClearMarks">Clear marks</button>' : ''}
        <button class="btn btn-ghost btn-small" id="homeEdit">Edit</button>
      </div>`;

    const marks = getMarks(date);
    body.innerHTML = items.map(it => {
      const ex = getExercise(it.exerciseId);
      const mark = marks[it.exerciseId] || '';
      const target = `${it.sets} × ${it.reps}${it.weight ? ` · ${round1(it.weight)} kg` : ''}`;
      const buttons = ['done', 'partial', 'skipped'].map(sv =>
        `<button class="mark-btn${mark === sv ? ' on' : ''}" data-status="${sv}" data-ex="${it.exerciseId}">${STATUS_LABELS[sv]}</button>`
      ).join('');
      return `
        <div class="home-item ${mark}">
          <div class="home-item-head">
            <div class="home-item-name">${escapeHTML(ex.name)}</div>
            <div class="home-item-target">${target}</div>
          </div>
          <div class="mark-group">${buttons}</div>
        </div>`;
    }).join('');
  }

  const editBtn = document.getElementById('homeEdit');
  if (editBtn) editBtn.addEventListener('click', () => openScheduleEditor(dayIdx));
  const importBtn = document.getElementById('homeImport');
  if (importBtn) importBtn.addEventListener('click', () => openImportModal(dayIdx));

  const markAll = document.getElementById('homeMarkAll');
  if (markAll) markAll.addEventListener('click', () => {
    items.forEach(it => setMark(date, it.exerciseId, 'done'));
    afterMarkChange();
    toast('Session complete 💪');
  });

  const clearMarks = document.getElementById('homeClearMarks');
  if (clearMarks) clearMarks.addEventListener('click', () => {
    items.forEach(it => setMark(date, it.exerciseId, null));
    afterMarkChange();
  });
}

function afterMarkChange() {
  renderHome();
  renderSchedule();
  renderStreakPill();
  renderHistory();
  renderStats();
}

document.getElementById('homeBody').addEventListener('click', e => {
  const btn = e.target.closest('.mark-btn');
  if (!btn) return;
  const date = todayISO();
  const current = getMarks(date)[btn.dataset.ex];
  setMark(date, btn.dataset.ex, current === btn.dataset.status ? null : btn.dataset.status);
  afterMarkChange();
});

function nextPlannedDay(fromDayIdx) {
  for (let i = 1; i <= 7; i++) {
    const idx = (fromDayIdx + i) % 7;
    const day = state.schedule[idx];
    if (isPlannedDay(day) && day.items.length) return idx;
  }
  return null;
}

// ---------- Misc ----------

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderStreakPill() {
  document.getElementById('streakCount').textContent = computeCurrentStreak();
}

document.getElementById('modalBackdrop').addEventListener('click', e => {
  if (e.target.id === 'modalBackdrop') closeModal();
});

// ---------- Cross-tab sync ----------

// Another tab of this browser wrote to localStorage, or this tab came back to the
// foreground after one did. Re-read and repaint rather than keeping a stale copy.
function reloadStateFromStorage() {
  if (document.getElementById('modalBackdrop').classList.contains('open')) return;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === lastWrittenRaw) return;
  state = loadState();
  ensureSchedule();
  ensureProgress();
  renderAll();
}

function renderAll() {
  renderHome();
  renderSchedule();
  renderStreakPill();
  renderHistory();
  renderExercisesTab();
  renderStats();
}

window.addEventListener('storage', e => {
  if (e.key === STORAGE_KEY) reloadStateFromStorage();
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) reloadStateFromStorage();
});

window.addEventListener('focus', reloadStateFromStorage);

// ---------- Init ----------

function init() {
  // The repo-sync experiment is gone; make sure no token it saved lingers here.
  localStorage.removeItem('ironlog_sync_v1');
  ensureSchedule();
  ensureProgress();
  saveState();
  renderAll();
}

init();
