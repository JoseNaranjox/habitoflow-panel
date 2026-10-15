import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js';

// ============================================================================
// 1. CONFIGURACIÓN DE FIREBASE Y CLAVE DE SINCRONIZACIÓN
// ============================================================================
const firebaseConfig = {
  apiKey: 'AIzaSyDTb2m8r_c_kbMROL52i8rNg48yIw7QSys',
  authDomain: 'habitflow-pro-5f8a7.firebaseapp.com',
  projectId: 'habitflow-pro-5f8a7',
  storageBucket: 'habitflow-pro-5f8a7.firebasestorage.app',
  messagingSenderId: '403039279766',
  appId: '1:403039279766:web:bc91ab99fb85cfc9fdc0b7',
  measurementId: 'G-PRGZMM6EN1'
};

// Pide tu clave secreta la primera vez que entras en un dispositivo y la guarda en ese navegador
let USER_SYNC_ID = localStorage.getItem('habitflow_sync_key');
if (!USER_SYNC_ID) {
  const inputKey = prompt(
    'Introduce tu clave personal para sincronizar tus hábitos entre dispositivos:'
  );
  USER_SYNC_ID = inputKey && inputKey.trim() ? inputKey.trim() : 'usuario_principal';
  localStorage.setItem('habitflow_sync_key', USER_SYNC_ID);
}

let db = null;
let cloudDocRef = null;
let isApplyingRemoteUpdate = false;

try {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  cloudDocRef = doc(db, 'habitflow_users', USER_SYNC_ID);
} catch (err) {
  console.error('Error al inicializar Firebase:', err);
}

// ============================================================================
// 2. CONSTANTES Y DATOS POR DEFECTO
// ============================================================================
const STORAGE_KEY = 'habitflow_pro_storage_v1';

const AVAILABLE_ICONS = ['🏋️', '💻', '🎹', '💧', '📚', '🏃', '🧠', '🎯', '⚡', '🛌'];
const AVAILABLE_COLORS = [
  '#14b8a6',
  '#f97316',
  '#06b6d4',
  '#8b5cf6',
  '#10b981',
  '#ec4899',
  '#eab308',
  '#3b82f6'
];

const DEFAULT_HABITS = [
  {
    id: 'h1',
    name: 'Entrenamiento en el gimnasio',
    category: 'Fitness',
    icon: '🏋️',
    color: '#f97316'
  },
  {
    id: 'h2',
    name: 'Desarrollo Web / Programar',
    category: 'Código',
    icon: '💻',
    color: '#14b8a6'
  },
  {
    id: 'h3',
    name: 'Practicar piano',
    category: 'Música',
    icon: '🎹',
    color: '#8b5cf6'
  },
  {
    id: 'h4',
    name: 'Hidratación (2L de agua)',
    category: 'Salud',
    icon: '💧',
    color: '#06b6d4'
  }
];

// ============================================================================
// 3. UTILIDADES DE FECHAS (FORMATO YYYY-MM-DD)
// ============================================================================
function toDateKey(dateObj) {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateKey(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(dateStr, days) {
  const d = parseDateKey(dateStr);
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}

function getMondayOfWeek(dateStr) {
  const d = parseDateKey(dateStr);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toDateKey(d);
}

function getWeekDates(selectedDateStr) {
  const monday = getMondayOfWeek(selectedDateStr);
  const days = [];
  for (let i = 0; i < 7; i++) {
    days.push(addDays(monday, i));
  }
  return days;
}

// ============================================================================
// 4. ESTADO GLOBAL DE LA APLICACIÓN
// ============================================================================
const todayKey = toDateKey(new Date());

let state = {
  habits: [],
  logs: {},
  selectedDate: todayKey,
  calendarYear: new Date().getFullYear(),
  calendarMonth: new Date().getMonth(),
  chartMode: 'bar',
  searchQuery: '',
  categoryFilter: 'all',
  modalIcon: AVAILABLE_ICONS[0],
  modalColor: AVAILABLE_COLORS[0]
};

// ============================================================================
// 5. PERSISTENCIA LOCAL + NUBE (FIREBASE FIRESTORE)
// ============================================================================
async function loadState() {
  // 1. Cargar primero de localStorage para respuesta instantánea
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      state.habits = Array.isArray(parsed.habits) ? parsed.habits : DEFAULT_HABITS;
      state.logs = parsed.logs && typeof parsed.logs === 'object' ? parsed.logs : {};
    } catch (err) {
      console.error('Error al leer localStorage:', err);
      state.habits = DEFAULT_HABITS;
      state.logs = {};
    }
  } else {
    state.habits = DEFAULT_HABITS;
    state.logs = {
      [addDays(todayKey, -2)]: ['h1', 'h2', 'h4'],
      [addDays(todayKey, -1)]: ['h1', 'h2', 'h3', 'h4'],
      [todayKey]: ['h2', 'h4']
    };
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ habits: state.habits, logs: state.logs })
    );
  }

  renderAll();

  if (!cloudDocRef) return;

  // 2. Sincronizar con Firebase Firestore
  try {
    const snap = await getDoc(cloudDocRef);
    if (snap.exists()) {
      const cloudData = snap.data();
      state.habits = Array.isArray(cloudData.habits) ? cloudData.habits : DEFAULT_HABITS;
      state.logs = cloudData.logs && typeof cloudData.logs === 'object' ? cloudData.logs : {};
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ habits: state.habits, logs: state.logs })
      );
      renderAll();
      showToast('☁️ Sincronizado con la nube');
    } else {
      await saveState(false);
    }

    // Escuchar cambios en tiempo real desde otros dispositivos
    onSnapshot(cloudDocRef, (docSnap) => {
      if (isApplyingRemoteUpdate || !docSnap.exists()) return;
      const data = docSnap.data();
      state.habits = Array.isArray(data.habits) ? data.habits : [];
      state.logs = data.logs && typeof data.logs === 'object' ? data.logs : {};
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ habits: state.habits, logs: state.logs })
      );
      renderAll();
    });
  } catch (err) {
    console.error('Error al conectar con Firestore:', err);
    showToast('⚠️ Usando copia local (revisa las Reglas de Firestore si persiste)');
  }
}

async function saveState(notify = true) {
  const payload = {
    habits: state.habits,
    logs: state.logs,
    updatedAt: new Date().toISOString()
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));

  if (!cloudDocRef) {
    if (notify) showToast('✓ Guardado en local');
    return;
  }

  try {
    isApplyingRemoteUpdate = true;
    await setDoc(cloudDocRef, payload);
    if (notify) {
      showToast('☁️ Guardado en la nube');
    }
  } catch (err) {
    console.error('Error al subir a Firebase:', err);
    if (notify) {
      showToast('⚠️ Guardado en local (sin conexión a nube)');
    }
  } finally {
    setTimeout(() => {
      isApplyingRemoteUpdate = false;
    }, 300);
  }
}

function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.classList.add('hidden');
  }, 2200);
}

// ============================================================================
// 6. LÓGICA DE HÁBITOS, FECHAS Y RACHAS
// ============================================================================
function isHabitCompleted(habitId, dateKey) {
  const list = state.logs[dateKey] || [];
  return list.includes(habitId);
}

function toggleHabitOnDate(habitId, dateKey) {
  if (!state.logs[dateKey]) {
    state.logs[dateKey] = [];
  }
  const index = state.logs[dateKey].indexOf(habitId);
  if (index > -1) {
    state.logs[dateKey].splice(index, 1);
    if (state.logs[dateKey].length === 0) {
      delete state.logs[dateKey];
    }
  } else {
    state.logs[dateKey].push(habitId);
  }
  renderAll();
  saveState(true);
}

function calculateHabitStreaks(habitId) {
  let currentStreak = 0;
  let cursor = todayKey;

  if (!isHabitCompleted(habitId, cursor)) {
    cursor = addDays(cursor, -1);
  }

  while (isHabitCompleted(habitId, cursor)) {
    currentStreak++;
    cursor = addDays(cursor, -1);
  }

  const allDatesWithHabit = Object.keys(state.logs)
    .filter((dateKey) => state.logs[dateKey].includes(habitId))
    .sort();

  let bestStreak = 0;
  let tempStreak = 0;
  let prevDate = null;

  allDatesWithHabit.forEach((dateKey) => {
    if (!prevDate || addDays(prevDate, 1) === dateKey) {
      tempStreak++;
    } else {
      tempStreak = 1;
    }
    if (tempStreak > bestStreak) {
      bestStreak = tempStreak;
    }
    prevDate = dateKey;
  });

  return {
    current: currentStreak,
    best: Math.max(bestStreak, currentStreak)
  };
}

function selectDate(dateKey) {
  state.selectedDate = dateKey;
  const dateObj = parseDateKey(dateKey);
  state.calendarYear = dateObj.getFullYear();
  state.calendarMonth = dateObj.getMonth();
  renderAll();
}

// ============================================================================
// 7. RENDERIZADO DE LA INTERFAZ
// ============================================================================
function renderAll() {
  renderDateNavigator();
  renderKPIs();
  renderHabitsTable();
  renderWeeklyChart();
  renderCalendar();
  renderStreaksSidebar();
}

function renderDateNavigator() {
  const dateObj = parseDateKey(state.selectedDate);
  const formatter = new Intl.DateTimeFormat('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
  document.getElementById('selectedDateLabel').textContent = formatter.format(dateObj);

  const badge = document.getElementById('selectedDateBadge');
  if (state.selectedDate === todayKey) {
    badge.textContent = 'HOY';
    badge.className = 'date-badge';
  } else if (state.selectedDate < todayKey) {
    badge.textContent = 'HISTORIAL';
    badge.className = 'date-badge past';
  } else {
    badge.textContent = 'PLANIFICACIÓN';
    badge.className = 'date-badge past';
  }
}

function renderKPIs() {
  const totalHabits = state.habits.length;
  const completedSelected = state.habits.filter((h) =>
    isHabitCompleted(h.id, state.selectedDate)
  ).length;
  const dayPercent = totalHabits > 0 ? Math.round((completedSelected / totalHabits) * 100) : 0;

  document.getElementById('kpiDayCount').textContent = `${completedSelected} / ${totalHabits}`;
  document.getElementById('kpiDayBar').style.width = `${dayPercent}%`;
  document.getElementById('kpiDayPercent').textContent = `${dayPercent}% completado en esta fecha`;

  const weekDates = getWeekDates(state.selectedDate);
  let weekCompleted = 0;
  weekDates.forEach((dKey) => {
    weekCompleted += state.habits.filter((h) => isHabitCompleted(h.id, dKey)).length;
  });
  const weekMax = totalHabits * 7;
  const weekPercent = weekMax > 0 ? Math.round((weekCompleted / weekMax) * 100) : 0;

  document.getElementById('kpiWeekPercent').textContent = `${weekPercent}%`;
  document.getElementById('kpiWeekBar').style.width = `${weekPercent}%`;
  document.getElementById('kpiWeekSummary').textContent = `${weekCompleted} de ${weekMax} objetivos esta semana`;

  let topStreak = 0;
  let topHabitName = 'Sin racha activa aún';
  state.habits.forEach((h) => {
    const st = calculateHabitStreaks(h.id);
    if (st.current > topStreak) {
      topStreak = st.current;
      topHabitName = `${h.icon} ${h.name} (Récord: ${st.best}d)`;
    }
  });
  document.getElementById('kpiBestStreak').textContent = `${topStreak} días`;
  document.getElementById('kpiBestHabitName').textContent = topHabitName;

  const daysInMonth = new Date(state.calendarYear, state.calendarMonth + 1, 0).getDate();
  let perfectDays = 0;
  if (totalHabits > 0) {
    for (let day = 1; day <= daysInMonth; day++) {
      const dKey = toDateKey(new Date(state.calendarYear, state.calendarMonth, day));
      const count = state.habits.filter((h) => isHabitCompleted(h.id, dKey)).length;
      if (count === totalHabits) {
        perfectDays++;
      }
    }
  }
  document.getElementById('kpiPerfectDays').textContent = String(perfectDays);
}

function renderHabitsTable() {
  const weekDates = getWeekDates(state.selectedDate);
  const shortDays = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

  const firstDayObj = parseDateKey(weekDates[0]);
  const lastDayObj = parseDateKey(weekDates[6]);
  const shortFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });
  document.getElementById('weekRangeLabel').textContent =
    `Semana del ${shortFmt.format(firstDayObj)} al ${shortFmt.format(lastDayObj)}`;

  const theadRow = document.getElementById('weekTableHeader');
  let headerHTML = `<th>Hábito</th><th>Día Activo</th>`;
  weekDates.forEach((dKey, idx) => {
    const dayNum = parseDateKey(dKey).getDate();
    const isSel = dKey === state.selectedDate ? 'selected-col' : '';
    headerHTML += `
      <th class="th-day ${isSel}" data-date="${dKey}" title="Ir al ${dKey}">
        ${shortDays[idx]}
        <span class="th-day-num">${dayNum}</span>
      </th>
    `;
  });
  headerHTML += `<th>Acciones</th>`;
  theadRow.innerHTML = headerHTML;

  theadRow.querySelectorAll('.th-day').forEach((th) => {
    th.addEventListener('click', () => selectDate(th.dataset.date));
  });

  const filtered = state.habits.filter((h) => {
    const matchesSearch = h.name.toLowerCase().includes(state.searchQuery.toLowerCase());
    const matchesCat = state.categoryFilter === 'all' || h.category === state.categoryFilter;
    return matchesSearch && matchesCat;
  });

  const tbody = document.getElementById('habitsTableBody');
  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" style="text-align:center; padding: 28px; color: var(--text-muted);">
          No hay hábitos que coincidan con el filtro actual.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered
    .map((habit) => {
      const streaks = calculateHabitStreaks(habit.id);
      const activeDone = isHabitCompleted(habit.id, state.selectedDate);
      const activeStyle = activeDone ? `background:${habit.color};` : '';

      const weekCells = weekDates
        .map((dKey) => {
          const done = isHabitCompleted(habit.id, dKey);
          const bgStyle = done ? `background:${habit.color};` : '';
          const colClass = dKey === state.selectedDate ? 'selected-col-cell' : '';
          return `
            <td class="${colClass}">
              <button
                class="check-btn ${done ? 'completed' : ''}"
                style="${bgStyle}"
                data-habit="${habit.id}"
                data-date="${dKey}"
                title="Marcar ${habit.name} el ${dKey}"
              >✓</button>
            </td>
          `;
        })
        .join('');

      return `
        <tr>
          <td>
            <div class="habit-info">
              <div class="habit-icon" style="background:${habit.color}22; color:${habit.color}">
                ${habit.icon}
              </div>
              <div>
                <div class="habit-name">${habit.name}</div>
                <div class="habit-meta">
                  <span class="habit-cat">${habit.category}</span>
                  <span class="habit-streak-tag">🔥 ${streaks.current}d</span>
                </div>
              </div>
            </div>
          </td>
          <td class="selected-col-cell">
            <button
              class="check-btn ${activeDone ? 'completed' : ''}"
              style="${activeStyle}"
              data-habit="${habit.id}"
              data-date="${state.selectedDate}"
            >✓</button>
          </td>
          ${weekCells}
          <td>
            <div class="row-actions">
              <button class="action-btn edit" data-id="${habit.id}" title="Editar">✏️</button>
              <button class="action-btn delete" data-id="${habit.id}" title="Eliminar">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');

  tbody.querySelectorAll('.check-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      toggleHabitOnDate(btn.dataset.habit, btn.dataset.date);
    });
  });

  tbody.querySelectorAll('.action-btn.edit').forEach((btn) => {
    btn.addEventListener('click', () => openEditModal(btn.dataset.id));
  });

  tbody.querySelectorAll('.action-btn.delete').forEach((btn) => {
    btn.addEventListener('click', () => deleteHabit(btn.dataset.id));
  });
}

function renderWeeklyChart() {
  const container = document.getElementById('weeklyChartContainer');
  const weekDates = getWeekDates(state.selectedDate);
  const dayNames = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const totalHabits = state.habits.length;

  const stats = weekDates.map((dKey, i) => {
    const done = state.habits.filter((h) => isHabitCompleted(h.id, dKey)).length;
    const pct = totalHabits > 0 ? Math.round((done / totalHabits) * 100) : 0;
    return {
      dateKey: dKey,
      label: `${dayNames[i]} ${parseDateKey(dKey).getDate()}`,
      done,
      pct
    };
  });

  if (state.chartMode === 'bar') {
    container.innerHTML = `
      <div class="bars-grid">
        ${stats
          .map(
            (s) => `
          <div class="bar-col ${s.dateKey === state.selectedDate ? 'is-selected' : ''}" data-date="${s.dateKey}">
            <span class="bar-value">${s.pct}%</span>
            <div class="bar-track" title="${s.done}/${totalHabits} completados">
              <div class="bar-fill" style="height: ${Math.max(s.pct, 4)}%"></div>
            </div>
            <span class="bar-label">${s.label}</span>
          </div>
        `
          )
          .join('')}
      </div>
    `;

    container.querySelectorAll('.bar-col').forEach((col) => {
      col.addEventListener('click', () => selectDate(col.dataset.date));
    });
  } else {
    const width = 650;
    const height = 180;
    const padX = 42;
    const padY = 24;
    const usableW = width - padX * 2;
    const usableH = height - padY * 2;

    const points = stats.map((s, idx) => {
      const x = padX + (idx / 6) * usableW;
      const y = padY + usableH - (s.pct / 100) * usableH;
      return { x, y, ...s };
    });

    const polylinePoints = points.map((p) => `${p.x},${p.y}`).join(' ');
    const areaPoints = `${points[0].x},${padY + usableH} ${polylinePoints} ${points[6].x},${padY + usableH}`;

    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" class="svg-chart-wrap">
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#14b8a6" stop-opacity="0.45"/>
            <stop offset="100%" stop-color="#14b8a6" stop-opacity="0.0"/>
          </linearGradient>
        </defs>
        <polygon points="${areaPoints}" fill="url(#areaGrad)" />
        <polyline
          fill="none"
          stroke="#14b8a6"
          stroke-width="3"
          stroke-linecap="round"
          stroke-linejoin="round"
          points="${polylinePoints}"
        />
        ${points
          .map(
            (p) => `
          <g class="svg-point" data-date="${p.dateKey}" style="cursor:pointer">
            <circle
              cx="${p.x}"
              cy="${p.y}"
              r="${p.dateKey === state.selectedDate ? 7 : 5}"
              fill="${p.dateKey === state.selectedDate ? '#f97316' : '#14b8a6'}"
              stroke="#0b0f19"
              stroke-width="2"
            />
            <text x="${p.x}" y="${p.y - 10}" text-anchor="middle" fill="#f1f5f9" font-size="11" font-weight="700">
              ${p.pct}%
            </text>
            <text x="${p.x}" y="${height - 4}" text-anchor="middle" fill="#94a3b8" font-size="11">
              ${p.label}
            </text>
          </g>
        `
          )
          .join('')}
      </svg>
    `;

    container.querySelectorAll('.svg-point').forEach((pt) => {
      pt.addEventListener('click', () => selectDate(pt.dataset.date));
    });
  }
}

function renderCalendar() {
  const monthNames = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];
  document.getElementById('calendarMonthTitle').textContent =
    `${monthNames[state.calendarMonth]} ${state.calendarYear}`;

  const firstDayOfMonth = new Date(state.calendarYear, state.calendarMonth, 1);
  const daysInMonth = new Date(state.calendarYear, state.calendarMonth + 1, 0).getDate();

  const startOffset = (firstDayOfMonth.getDay() + 6) % 7;
  const totalHabits = state.habits.length;

  const grid = document.getElementById('calendarGrid');
  let cellsHTML = '';

  for (let i = 0; i < startOffset; i++) {
    cellsHTML += `<div class="cal-day empty"></div>`;
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dKey = toDateKey(new Date(state.calendarYear, state.calendarMonth, day));
    const completedCount = state.habits.filter((h) => isHabitCompleted(h.id, dKey)).length;

    let statusClass = '';
    if (totalHabits > 0 && completedCount > 0) {
      statusClass = completedCount === totalHabits ? 'has-complete' : 'has-partial';
    }
    const todayClass = dKey === todayKey ? 'is-today' : '';
    const selectedClass = dKey === state.selectedDate ? 'is-selected' : '';

    cellsHTML += `
      <div
        class="cal-day ${statusClass} ${todayClass} ${selectedClass}"
        data-date="${dKey}"
        title="${dKey}: ${completedCount}/${totalHabits} completados"
      >
        <span>${day}</span>
        ${
          completedCount > 0
            ? `<span class="cal-dot-count">${completedCount}/${totalHabits}</span>`
            : ''
        }
      </div>
    `;
  }

  grid.innerHTML = cellsHTML;

  grid.querySelectorAll('.cal-day:not(.empty)').forEach((cell) => {
    cell.addEventListener('click', () => selectDate(cell.dataset.date));
  });
}

function renderStreaksSidebar() {
  const container = document.getElementById('streaksList');
  if (state.habits.length === 0) {
    container.innerHTML = `<p class="panel-subtitle">Añade hábitos para ver tus estadísticas.</p>`;
    return;
  }

  container.innerHTML = state.habits
    .map((h) => {
      const st = calculateHabitStreaks(h.id);
      const ratio = st.best > 0 ? Math.round((st.current / st.best) * 100) : 0;
      return `
        <div class="streak-item">
          <div class="streak-item-top">
            <span>${h.icon} ${h.name}</span>
            <div class="streak-badges">
              <span class="badge-current">🔥 ${st.current}d</span>
              <span class="badge-best">Récord: ${st.best}d</span>
            </div>
          </div>
          <div class="kpi-progress-bar">
            <div class="kpi-progress-fill" style="width:${ratio}%; background:${h.color}"></div>
          </div>
        </div>
      `;
    })
    .join('');
}

// ============================================================================
// 8. MODAL DE CREACIÓN / EDICIÓN Y COPIAS DE SEGURIDAD
// ============================================================================
function renderPickers() {
  const iconContainer = document.getElementById('iconPicker');
  iconContainer.innerHTML = AVAILABLE_ICONS.map(
    (ic) => `
      <div class="picker-option ${ic === state.modalIcon ? 'selected' : ''}" data-icon="${ic}">
        ${ic}
      </div>
    `
  ).join('');

  iconContainer.querySelectorAll('.picker-option').forEach((el) => {
    el.addEventListener('click', () => {
      state.modalIcon = el.dataset.icon;
      renderPickers();
    });
  });

  const colorContainer = document.getElementById('colorPicker');
  colorContainer.innerHTML = AVAILABLE_COLORS.map(
    (col) => `
      <div
        class="picker-option ${col === state.modalColor ? 'selected' : ''}"
        style="background:${col}"
        data-color="${col}"
      ></div>
    `
  ).join('');

  colorContainer.querySelectorAll('.picker-option').forEach((el) => {
    el.addEventListener('click', () => {
      state.modalColor = el.dataset.color;
      renderPickers();
    });
  });
}

function openCreateModal() {
  document.getElementById('modalTitle').textContent = 'Nuevo Hábito';
  document.getElementById('habitIdInput').value = '';
  document.getElementById('habitNameInput').value = '';
  document.getElementById('habitCategoryInput').value = 'Fitness';
  state.modalIcon = AVAILABLE_ICONS[0];
  state.modalColor = AVAILABLE_COLORS[0];
  renderPickers();
  document.getElementById('habitModal').classList.remove('hidden');
  document.getElementById('habitNameInput').focus();
}

function openEditModal(habitId) {
  const habit = state.habits.find((h) => h.id === habitId);
  if (!habit) return;

  document.getElementById('modalTitle').textContent = 'Editar Hábito';
  document.getElementById('habitIdInput').value = habit.id;
  document.getElementById('habitNameInput').value = habit.name;
  document.getElementById('habitCategoryInput').value = habit.category;
  state.modalIcon = habit.icon;
  state.modalColor = habit.color;
  renderPickers();
  document.getElementById('habitModal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('habitModal').classList.add('hidden');
}

function deleteHabit(habitId) {
  const habit = state.habits.find((h) => h.id === habitId);
  if (!habit) return;
  if (!confirm(`¿Seguro que quieres eliminar el hábito "${habit.name}"?`)) return;

  state.habits = state.habits.filter((h) => h.id !== habitId);
  Object.keys(state.logs).forEach((dKey) => {
    state.logs[dKey] = state.logs[dKey].filter((id) => id !== habitId);
    if (state.logs[dKey].length === 0) {
      delete state.logs[dKey];
    }
  });
  renderAll();
  saveState(true);
}

function exportBackup() {
  const dataStr = JSON.stringify({ habits: state.habits, logs: state.logs }, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `habitflow-backup-${todayKey}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('⬇ Copia de seguridad descargada');
}

function importBackup(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (Array.isArray(parsed.habits) && typeof parsed.logs === 'object') {
        state.habits = parsed.habits;
        state.logs = parsed.logs;
        renderAll();
        await saveState(false);
        showToast('⬆ Copia restaurada y sincronizada');
      } else {
        alert('El archivo JSON no tiene el formato válido de HabitFlow.');
      }
    } catch (err) {
      alert('Error al leer el archivo JSON.');
    }
  };
  reader.readAsText(file);
}

// ============================================================================
// 9. INICIALIZACIÓN DE EVENTOS
// ============================================================================
function initApp() {
  loadState();

  document.getElementById('prevDayBtn').addEventListener('click', () => {
    selectDate(addDays(state.selectedDate, -1));

  const headerActions = document.querySelector('.header-actions');
  if (headerActions) {
    const keyBtn = document.createElement('button');
    keyBtn.className = 'btn-secondary';
    keyBtn.title = `Clave activa: ${USER_SYNC_ID}`;
    keyBtn.textContent = '🔑 Clave';
    keyBtn.addEventListener('click', () => {
      const newKey = prompt(
        'Introduce tu clave personal de sincronización:',
        USER_SYNC_ID
      );
      if (newKey && newKey.trim()) {
        localStorage.setItem('habitflow_sync_key', newKey.trim());
        location.reload();
      }
    });
    headerActions.prepend(keyBtn);
  });

  document.getElementById('nextDayBtn').addEventListener('click', () => {
    selectDate(addDays(state.selectedDate, 1));
  });

  document.getElementById('todayBtn').addEventListener('click', () => {
    selectDate(todayKey);
  });

  document.getElementById('prevMonthBtn').addEventListener('click', () => {
    state.calendarMonth--;
    if (state.calendarMonth < 0) {
      state.calendarMonth = 11;
      state.calendarYear--;
    }
    renderCalendar();
    renderKPIs();
  });

  document.getElementById('nextMonthBtn').addEventListener('click', () => {
    state.calendarMonth++;
    if (state.calendarMonth > 11) {
      state.calendarMonth = 0;
      state.calendarYear++;
    }
    renderCalendar();
    renderKPIs();
  });

  document.getElementById('searchInput').addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    renderHabitsTable();
  });

  document.getElementById('categoryFilter').addEventListener('change', (e) => {
    state.categoryFilter = e.target.value;
    renderHabitsTable();
  });

  document.getElementById('chartBarBtn').addEventListener('click', () => {
    state.chartMode = 'bar';
    document.getElementById('chartBarBtn').classList.add('active');
    document.getElementById('chartLineBtn').classList.remove('active');
    renderWeeklyChart();
  });

  document.getElementById('chartLineBtn').addEventListener('click', () => {
    state.chartMode = 'line';
    document.getElementById('chartLineBtn').classList.add('active');
    document.getElementById('chartBarBtn').classList.remove('active');
    renderWeeklyChart();
  });

  document.getElementById('openModalBtn').addEventListener('click', openCreateModal);
  document.getElementById('closeModalBtn').addEventListener('click', closeModal);
  document.getElementById('cancelModalBtn').addEventListener('click', closeModal);

  document.getElementById('habitForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('habitIdInput').value;
    const name = document.getElementById('habitNameInput').value.trim();
    const category = document.getElementById('habitCategoryInput').value;
    if (!name) return;

    if (id) {
      const target = state.habits.find((h) => h.id === id);
      if (target) {
        target.name = name;
        target.category = category;
        target.icon = state.modalIcon;
        target.color = state.modalColor;
      }
    } else {
      state.habits.push({
        id: 'h_' + Date.now(),
        name,
        category,
        icon: state.modalIcon,
        color: state.modalColor
      });
    }

    closeModal();
    renderAll();
    saveState(true);
  });

  document.getElementById('exportBtn').addEventListener('click', exportBackup);
  document.getElementById('importInput').addEventListener('change', (e) => {
    importBackup(e.target.files[0]);
    e.target.value = '';
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
