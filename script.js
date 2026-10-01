import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase, ref, onValue, query, orderByChild, limitToLast } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

// =========================================================================
// 1. Firebase Configuration
// =========================================================================
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://iot-110-ca18b-default-rtdb.asia-southeast1.firebasedatabase.app/",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// =========================================================================
// 2. Paths (ตรงกับ ESPHome Level 5)
// =========================================================================
const PATH_LATEST  = 'lab/esp32-01/latest';
const PATH_HISTORY = 'lab/esp32-01/history';
const MAX_HISTORY  = 50;

// =========================================================================
// 3. DOM Elements — 6 sensors
// =========================================================================
const els = {
  temp:     { val: document.getElementById('temp-value'),     bar: document.getElementById('temp-bar') },
  humi:     { val: document.getElementById('hum-value'),      bar: document.getElementById('humi-bar') },
  light:    { val: document.getElementById('light-value'),    bar: document.getElementById('light-bar') },
  pressure: { val: document.getElementById('pressure-value'), bar: document.getElementById('pressure-bar') },
  co2:      { val: document.getElementById('co2-value'),      bar: document.getElementById('co2-bar') },
  soil:     { val: document.getElementById('soil-value'),     bar: document.getElementById('soil-bar') }
};

const badge        = document.getElementById('connection-badge');
const badgeText    = document.getElementById('connection-text');
const updateTimeEl = document.getElementById('last-update-time');
const historyCount = document.getElementById('history-count');
const timeRangeEl  = document.getElementById('time-range-text');
const historyTbody = document.getElementById('history-tbody');

// =========================================================================
// 4. Sensor config — range for bar %
// =========================================================================
const sensorConfig = {
  temp:     { decimals: 1, min: 0,    max: 50   },
  humi:     { decimals: 1, min: 0,    max: 100  },
  light:    { decimals: 0, min: 0,    max: 1000 },
  pressure: { decimals: 1, min: 980,  max: 1040 },
  co2:      { decimals: 0, min: 400,  max: 1000 },
  soil:     { decimals: 1, min: 0,    max: 100  }
};

// =========================================================================
// 5. Utility functions
// =========================================================================
function formatTimestamp(ts) {
  if (!ts) return '--';
  const ms = ts > 1e12 ? ts : ts * 1000;
  const d = new Date(ms);
  const dd  = String(d.getDate()).padStart(2, '0');
  const mm  = String(d.getMonth() + 1).padStart(2, '0');
  const yy  = d.getFullYear();
  const hh  = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const ss  = String(d.getSeconds()).padStart(2, '0');
  return `${dd}/${mm}/${yy} ${hh}:${min}:${ss}`;
}

function formatTime(ts) {
  if (!ts) return '--';
  const ms = ts > 1e12 ? ts : ts * 1000;
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
}

function flashElement(el) {
  el.classList.remove('value-flash');
  void el.offsetWidth;
  el.classList.add('value-flash');
}

function barPercent(value, min, max) {
  return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
}

// =========================================================================
// 6. Listen for LATEST data (realtime card values)
// =========================================================================
const latestRef = ref(db, PATH_LATEST);
let isFirstData = true;

onValue(latestRef, (snapshot) => {
  const data = snapshot.val();
  if (data === null) return;

  if (isFirstData) {
    badge.classList.add('live');
    badgeText.textContent = 'Live';
    isFirstData = false;
  }

  // Update each sensor card
  for (const [key, cfg] of Object.entries(sensorConfig)) {
    if (data[key] !== undefined) {
      const v = Number(data[key]);
      els[key].val.innerText = v.toFixed(cfg.decimals);
      flashElement(els[key].val);
      els[key].bar.style.width = barPercent(v, cfg.min, cfg.max) + '%';
    }
  }

  if (data.timestamp) {
    updateTimeEl.textContent = formatTime(data.timestamp);
  }
});

// =========================================================================
// 7. Listen for HISTORY data (charts + table)
// =========================================================================
const historyQuery = query(
  ref(db, PATH_HISTORY),
  orderByChild('timestamp'),
  limitToLast(MAX_HISTORY)
);

onValue(historyQuery, (snapshot) => {
  const raw = snapshot.val();
  if (!raw) {
    timeRangeEl.textContent = 'No history data yet';
    return;
  }

  const entries = Object.values(raw)
    .filter(e => e.timestamp)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (entries.length === 0) return;

  historyCount.textContent = `${entries.length} records`;

  const firstTs = entries[0].timestamp;
  const lastTs  = entries[entries.length - 1].timestamp;
  timeRangeEl.textContent = `${formatTimestamp(firstTs)}  →  ${formatTimestamp(lastTs)}`;

  updateAllCharts(entries);
  updateHistoryTable(entries);
});

// =========================================================================
// 8. Chart.js — 7 charts (All + 6 individual)
// =========================================================================
function makeGradient(ctx, r, g, b) {
  const grad = ctx.createLinearGradient(0, 0, 0, 320);
  grad.addColorStop(0, `rgba(${r},${g},${b}, 0.3)`);
  grad.addColorStop(1, `rgba(${r},${g},${b}, 0.0)`);
  return grad;
}

const commonOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: 'rgba(15, 23, 42, 0.92)',
      titleColor: '#f1f5f9',
      bodyColor: '#94a3b8',
      borderColor: 'rgba(255,255,255,0.08)',
      borderWidth: 1,
      padding: 12,
      cornerRadius: 10,
      titleFont: { family: 'Inter', weight: '600' },
      bodyFont: { family: 'Inter' },
      displayColors: true,
      boxPadding: 4
    }
  },
  scales: {
    x: {
      ticks: { color: '#475569', font: { family: 'Inter', size: 10 }, maxTicksLimit: 10, maxRotation: 0 },
      grid: { color: 'rgba(255,255,255,0.03)', drawBorder: false }
    },
    y: {
      ticks: { color: '#475569', font: { family: 'Inter', size: 11 }, padding: 8 },
      grid: { color: 'rgba(255,255,255,0.03)', drawBorder: false }
    }
  }
};

// Dataset template
function makeDataset(label, color, rgb, ctx) {
  return {
    label, borderColor: color,
    backgroundColor: makeGradient(ctx, ...rgb),
    pointBackgroundColor: color,
    pointBorderColor: 'transparent',
    pointRadius: 2, pointHoverRadius: 5,
    data: [], tension: 0.4, fill: true, borderWidth: 2.5
  };
}

// --- Chart: ALL (6 datasets) ---
const ctxAll = document.getElementById('chartAll').getContext('2d');
const chartAll = new Chart(ctxAll, {
  type: 'line',
  data: {
    labels: [],
    datasets: [
      makeDataset('Temp (°C)',     '#f87171', [248,113,113], ctxAll),
      makeDataset('Humi (%)',      '#38bdf8', [56,189,248],  ctxAll),
      makeDataset('Light (lx)',    '#fbbf24', [251,191,36],  ctxAll),
      makeDataset('Press (hPa)',   '#a78bfa', [167,139,250], ctxAll),
      makeDataset('CO₂ (ppm)',     '#34d399', [52,211,153],  ctxAll),
      makeDataset('Soil (%)',      '#fb923c', [251,146,60],  ctxAll)
    ]
  },
  options: {
    ...commonOptions,
    plugins: {
      ...commonOptions.plugins,
      legend: {
        display: true,
        labels: { color: '#94a3b8', font: { family: 'Inter', size: 11 }, boxWidth: 10, boxHeight: 10, borderRadius: 5, useBorderRadius: true, padding: 14 }
      }
    }
  }
});

// --- Individual charts ---
function makeSingleChart(canvasId, label, color, rgb) {
  const ctx = document.getElementById(canvasId).getContext('2d');
  return new Chart(ctx, {
    type: 'line',
    data: { labels: [], datasets: [makeDataset(label, color, rgb, ctx)] },
    options: commonOptions
  });
}

const chartTemp     = makeSingleChart('chartTemp',     'Temperature (°C)', '#f87171', [248,113,113]);
const chartHumi     = makeSingleChart('chartHumi',     'Humidity (%)',     '#38bdf8', [56,189,248]);
const chartLight    = makeSingleChart('chartLight',    'Light (lx)',       '#fbbf24', [251,191,36]);
const chartPressure = makeSingleChart('chartPressure', 'Pressure (hPa)',  '#a78bfa', [167,139,250]);
const chartCo2      = makeSingleChart('chartCo2',      'CO₂ (ppm)',       '#34d399', [52,211,153]);
const chartSoil     = makeSingleChart('chartSoil',     'Soil (%)',        '#fb923c', [251,146,60]);

// =========================================================================
// 9. Update all charts from history
// =========================================================================
function updateAllCharts(entries) {
  const labels    = entries.map(e => formatTime(e.timestamp));
  const temps     = entries.map(e => e.temp     != null ? Number(e.temp)     : null);
  const humis     = entries.map(e => e.humi     != null ? Number(e.humi)     : null);
  const lights    = entries.map(e => e.light    != null ? Number(e.light)    : null);
  const pressures = entries.map(e => e.pressure != null ? Number(e.pressure) : null);
  const co2s      = entries.map(e => e.co2      != null ? Number(e.co2)      : null);
  const soils     = entries.map(e => e.soil     != null ? Number(e.soil)     : null);

  // All chart
  chartAll.data.labels = labels;
  chartAll.data.datasets[0].data = temps;
  chartAll.data.datasets[1].data = humis;
  chartAll.data.datasets[2].data = lights;
  chartAll.data.datasets[3].data = pressures;
  chartAll.data.datasets[4].data = co2s;
  chartAll.data.datasets[5].data = soils;
  chartAll.update('none');

  // Individual charts
  const singles = [
    [chartTemp, temps], [chartHumi, humis], [chartLight, lights],
    [chartPressure, pressures], [chartCo2, co2s], [chartSoil, soils]
  ];
  singles.forEach(([chart, data]) => {
    chart.data.labels = labels;
    chart.data.datasets[0].data = data;
    chart.update('none');
  });
}

// =========================================================================
// 10. Update history table (6 columns)
// =========================================================================
function updateHistoryTable(entries) {
  const reversed = [...entries].reverse();
  let html = '';
  reversed.forEach((e, i) => {
    html += `<tr>
      <td>${i + 1}</td>
      <td>${formatTimestamp(e.timestamp)}</td>
      <td>${e.temp     != null ? Number(e.temp).toFixed(1)     : '--'}</td>
      <td>${e.humi     != null ? Number(e.humi).toFixed(1)     : '--'}</td>
      <td>${e.light    != null ? Number(e.light).toFixed(0)    : '--'}</td>
      <td>${e.pressure != null ? Number(e.pressure).toFixed(1) : '--'}</td>
      <td>${e.co2      != null ? Number(e.co2).toFixed(0)      : '--'}</td>
      <td>${e.soil     != null ? Number(e.soil).toFixed(1)     : '--'}</td>
    </tr>`;
  });
  historyTbody.innerHTML = html;
}

// =========================================================================
// 11. Tab switching
// =========================================================================
const tabBtns = document.querySelectorAll('.tab-btn');
const panels  = document.querySelectorAll('.chart-panel');

tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tab;
    tabBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    panels.forEach(p => p.classList.remove('active'));
    document.getElementById(`panel-${target}`).classList.add('active');
  });
});
