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
let draft = null;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to load state', e);
  }
  return { exercises: [], workouts: [], prs: {}, estimates: {} };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getExercise(id) {
  return state.exercises.find(e => e.id === id);
}

function getWorkoutForDate(iso) {
  return state.workouts.find(w => w.date === iso) || null;
}

// ---------- Streaks ----------

function workoutDateSet() {
  return new Set(state.workouts.map(w => w.date));
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
  if (tab === 'history') renderHistory();
  if (tab === 'exercises') renderExercisesTab();
  if (tab === 'stats') renderStats();
}

// ---------- Log Workout tab ----------

function loadDraftForDate(iso) {
  const existing = getWorkoutForDate(iso);
  if (existing) {
    draft = {
      date: iso,
      entries: existing.entries.map(en => ({
        exerciseId: en.exerciseId,
        sets: en.sets.map(s => ({ ...s })),
      })),
    };
  } else {
    draft = { date: iso, entries: [] };
  }
  renderDayStatus();
  renderDraft();
}

function renderDayStatus() {
  const el = document.getElementById('dayStatus');
  const existing = getWorkoutForDate(draft.date);
  if (existing) {
    el.textContent = 'Logged';
    el.className = 'day-status logged';
  } else {
    el.textContent = 'No workout yet';
    el.className = 'day-status empty';
  }
}

function renderExerciseSelect() {
  const sel = document.getElementById('exerciseSelect');
  const row = document.getElementById('addExerciseRow');
  const emptyPrompt = document.getElementById('noExercisesPrompt');

  if (!state.exercises.length) {
    row.style.display = 'none';
    emptyPrompt.style.display = 'block';
    return;
  }
  row.style.display = 'flex';
  emptyPrompt.style.display = 'none';

  const cats = {};
  state.exercises.forEach(ex => {
    (cats[ex.category] = cats[ex.category] || []).push(ex);
  });
  sel.innerHTML = '';
  Object.keys(cats).sort().forEach(cat => {
    const og = document.createElement('optgroup');
    og.label = cat;
    cats[cat].forEach(ex => {
      const opt = document.createElement('option');
      opt.value = ex.id;
      opt.textContent = ex.name;
      og.appendChild(opt);
    });
    sel.appendChild(og);
  });
}

document.getElementById('btnAddExerciseToLog').addEventListener('click', () => {
  const sel = document.getElementById('exerciseSelect');
  const exerciseId = sel.value;
  if (!exerciseId) return;
  if (draft.entries.some(en => en.exerciseId === exerciseId)) {
    toast('Already in this workout');
    return;
  }
  draft.entries.push({ exerciseId, sets: [{ reps: 8, weight: 0 }] });
  renderDraft();
});

function openNewExerciseModal() {
  openModal({
    title: 'New Exercise',
    bodyHTML: `
      <div class="field" style="margin-bottom:10px">
        <span>Name</span>
        <input type="text" id="modalExName" placeholder="e.g. Incline Dumbbell Press">
      </div>
      <div class="field">
        <span>Category</span>
        <select id="modalExCat">
          <option>Push</option>
          <option>Pull</option>
          <option>Legs</option>
          <option>Core</option>
          <option>Other</option>
        </select>
      </div>
    `,
    buttons: [
      { label: 'Cancel', className: 'btn-ghost' },
      {
        label: 'Add',
        className: 'btn-primary',
        onClick: () => {
          const name = document.getElementById('modalExName').value.trim();
          const category = document.getElementById('modalExCat').value;
          if (!name) { toast('Enter a name'); return; }
          const ex = { id: uid('ex'), name, category };
          state.exercises.push(ex);
          saveState();
          renderExerciseSelect();
          draft.entries.push({ exerciseId: ex.id, sets: [{ reps: 8, weight: 0 }] });
          renderDraft();
          toast(`Added ${name}`);
        },
      },
    ],
  });
}

document.getElementById('btnNewExercise').addEventListener('click', openNewExerciseModal);
document.getElementById('btnNewExerciseEmpty').addEventListener('click', openNewExerciseModal);

function setBadgeInfo(exerciseId, weight, reps) {
  const pr = state.prs[exerciseId];
  const e1rm = computeE1RM(weight, reps);
  if (!weight || !reps) return { e1rm: 0, badge: '' };
  if (!pr) {
    return { e1rm, badge: '<span class="set-badge pr">First record</span>' };
  }
  if (reps === 1 && weight > pr.weight) {
    return { e1rm, badge: '<span class="set-badge pr">New PR!</span>' };
  }
  if (e1rm > pr.weight) {
    return { e1rm, badge: '<span class="set-badge pr">Est. PR!</span>' };
  }
  if (e1rm >= pr.weight * 0.9) {
    return { e1rm, badge: '<span class="set-badge close">Near PR</span>' };
  }
  return { e1rm, badge: '' };
}

function renderDraft() {
  const container = document.getElementById('loggedExercises');
  container.innerHTML = '';
  if (!draft.entries.length) {
    container.innerHTML = '<div class="empty-state">No exercises added yet. Pick one above to get started.</div>';
    return;
  }
  draft.entries.forEach((entry, ei) => {
    const ex = getExercise(entry.exerciseId);
    if (!ex) return;
    const pr = state.prs[entry.exerciseId];
    const block = document.createElement('div');
    block.className = 'exercise-block';

    const header = document.createElement('div');
    header.className = 'exercise-block-header';
    header.innerHTML = `
      <div>
        <div class="exercise-name">${escapeHTML(ex.name)}</div>
        <div class="exercise-pr-hint">${pr ? `Actual PR: ${pr.weight} kg × ${pr.reps}` : 'No PR set yet'}</div>
      </div>
      <button class="icon-btn" title="Remove exercise">✕</button>
    `;
    header.querySelector('.icon-btn').addEventListener('click', () => {
      draft.entries.splice(ei, 1);
      renderDraft();
    });
    block.appendChild(header);

    const table = document.createElement('table');
    table.className = 'sets-table';
    table.innerHTML = `
      <thead><tr>
        <th style="width:32px">#</th>
        <th>Weight (kg)</th>
        <th>Reps</th>
        <th>Est. 1RM</th>
        <th></th>
        <th></th>
      </tr></thead>
    `;
    const tbody = document.createElement('tbody');
    entry.sets.forEach((set, si) => {
      const { e1rm, badge } = setBadgeInfo(entry.exerciseId, Number(set.weight), Number(set.reps));
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${si + 1}</td>
        <td><input type="number" min="0" step="0.5" value="${set.weight || ''}" class="set-weight" inputmode="decimal"></td>
        <td><input type="number" min="1" step="1" value="${set.reps || ''}" class="set-reps" inputmode="numeric"></td>
        <td class="set-e1rm">${e1rm ? round1(e1rm) : '—'}</td>
        <td>${badge}</td>
        <td><button class="icon-btn" title="Remove set">✕</button></td>
      `;
      tr.querySelector('.set-weight').addEventListener('input', e => {
        set.weight = parseFloat(e.target.value) || 0;
        updateRowLive(tr, entry.exerciseId, set);
      });
      tr.querySelector('.set-reps').addEventListener('input', e => {
        set.reps = parseInt(e.target.value) || 0;
        updateRowLive(tr, entry.exerciseId, set);
      });
      tr.querySelector('.icon-btn').addEventListener('click', () => {
        entry.sets.splice(si, 1);
        if (!entry.sets.length) draft.entries.splice(ei, 1);
        renderDraft();
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    block.appendChild(table);

    const addSetBtn = document.createElement('button');
    addSetBtn.className = 'add-set-btn';
    addSetBtn.textContent = '+ Add Set';
    addSetBtn.addEventListener('click', () => {
      const last = entry.sets[entry.sets.length - 1];
      entry.sets.push({ weight: last ? last.weight : 0, reps: last ? last.reps : 8 });
      renderDraft();
    });
    block.appendChild(addSetBtn);

    container.appendChild(block);
  });
}

function updateRowLive(tr, exerciseId, set) {
  const { e1rm, badge } = setBadgeInfo(exerciseId, Number(set.weight), Number(set.reps));
  tr.querySelector('.set-e1rm').textContent = e1rm ? round1(e1rm) : '—';
  tr.querySelectorAll('td')[4].innerHTML = badge;
}

document.getElementById('workoutDate').addEventListener('change', e => {
  loadDraftForDate(e.target.value);
});

document.getElementById('btnSaveWorkout').addEventListener('click', () => {
  const cleanEntries = draft.entries
    .map(en => ({
      exerciseId: en.exerciseId,
      sets: en.sets.filter(s => Number(s.weight) > 0 && Number(s.reps) > 0).map(s => ({ weight: Number(s.weight), reps: Number(s.reps) })),
    }))
    .filter(en => en.sets.length > 0);

  if (!cleanEntries.length) {
    toast('Add at least one set before saving');
    return;
  }

  state.workouts = state.workouts.filter(w => w.date !== draft.date);
  state.workouts.push({ id: uid('wo'), date: draft.date, entries: cleanEntries });

  const newPRs = [];
  cleanEntries.forEach(en => {
    const exName = getExercise(en.exerciseId)?.name || 'Exercise';
    en.sets.forEach(s => {
      const e1rm = computeE1RM(s.weight, s.reps);
      const currentEstimate = state.estimates[en.exerciseId];
      if (!currentEstimate || e1rm > currentEstimate.value) {
        state.estimates[en.exerciseId] = { value: round1(e1rm), weight: s.weight, reps: s.reps, date: draft.date };
      }
      const pr = state.prs[en.exerciseId];
      if (s.reps === 1 && (!pr || s.weight > pr.weight)) {
        state.prs[en.exerciseId] = { weight: s.weight, reps: 1, date: draft.date, source: 'actual' };
        newPRs.push(exName);
      }
    });
  });

  saveState();
  renderDayStatus();
  renderStreakPill();
  loadDraftForDate(draft.date);

  if (newPRs.length) {
    toast(`🎉 New PR: ${[...new Set(newPRs)].join(', ')}`);
  } else {
    toast('Workout saved');
  }
});

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
  const workouts = [...state.workouts].sort((a, b) => (a.date < b.date ? 1 : -1));
  if (!workouts.length) {
    list.innerHTML = '<div class="empty-state">No workouts logged yet.</div>';
    return;
  }
  workouts.forEach(w => {
    const totalSets = w.entries.reduce((n, en) => n + en.sets.length, 0);
    const volume = w.entries.reduce((v, en) => v + en.sets.reduce((sv, s) => sv + s.weight * s.reps, 0), 0);
    const item = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML = `
      <div class="history-item-header">
        <div>
          <div class="history-date">${formatPretty(w.date)}</div>
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
    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-secondary btn-small';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', ev => {
      ev.stopPropagation();
      document.getElementById('workoutDate').value = w.date;
      loadDraftForDate(w.date);
      switchTab('today');
    });
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
              if (draft.date === w.date) loadDraftForDate(draft.date);
              toast('Workout deleted');
            },
          },
        ],
      });
    });
    editRow.appendChild(editBtn);
    editRow.appendChild(delBtn);
    detail.appendChild(editRow);

    item.querySelector('.history-item-header').addEventListener('click', () => {
      item.classList.toggle('expanded');
    });
    list.appendChild(item);
  });
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
              renderExerciseSelect();
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
      renderDraft();
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
  renderExerciseSelect();
  renderExercisesTab();
  toast(`Added ${name}`);
});

// ---------- Stats tab ----------

function renderStats() {
  const grid = document.getElementById('statsGrid');
  const totalWorkouts = state.workouts.length;
  const totalPRs = Object.keys(state.prs).length;
  grid.innerHTML = `
    <div class="stat-tile"><div class="stat-value">${computeCurrentStreak()}</div><div class="stat-label">Current streak (days)</div></div>
    <div class="stat-tile"><div class="stat-value">${computeLongestStreak()}</div><div class="stat-label">Longest streak (days)</div></div>
    <div class="stat-tile"><div class="stat-value">${totalWorkouts}</div><div class="stat-label">Workouts logged</div></div>
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

// ---------- Init ----------

function init() {
  const dateInput = document.getElementById('workoutDate');
  dateInput.value = todayISO();
  dateInput.max = todayISO();
  renderExerciseSelect();
  loadDraftForDate(todayISO());
  renderStreakPill();
  renderHistory();
  renderExercisesTab();
  renderStats();
}

init();
