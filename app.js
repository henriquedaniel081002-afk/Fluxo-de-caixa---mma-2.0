// ===== CONFIG =====
const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSPxmvS4jgdO1ik60I4wxlYSNIDx7LTeAkLUcJe6r105xYLixIhhADN7LmzSG0YfxOWR4zB1BKpfO1Z/pub?gid=0&single=true&output=csv";

// ===== DOM =====
const connectionStatus = document.getElementById("connection-status");
const connectionText = document.getElementById("connection-text");

const totalEntradasEl = document.getElementById("total-entradas");
const totalSaidasEl = document.getElementById("total-saidas");

const startInput = document.getElementById("filter-start");
const endInput = document.getElementById("filter-end");

const dailySummaryBody = document.getElementById("daily-summary");

const clearDayBtn = document.getElementById("clear-day-filter");
const monthSelect = document.getElementById("month-select");

const chips = Array.from(document.querySelectorAll(".chip[data-filter]"));
const chipQ1 = document.querySelector('.chip[data-filter="quinzena-1"]');
const chipQ2 = document.querySelector('.chip[data-filter="quinzena-2"]');

// Modal DOM
const modal = document.getElementById("day-modal");
const modalOverlay = document.getElementById("modal-overlay");
const modalClose = document.getElementById("modal-close");
const modalTitle = document.getElementById("modal-title");
const modalSubtitle = document.getElementById("modal-subtitle");
const modalTotalEntradas = document.getElementById("modal-total-entradas");
const modalTotalSaidas = document.getElementById("modal-total-saidas");
const modalRepasseWrap = document.getElementById("modal-repasse-wrap");
const modalRepasse = document.getElementById("modal-repasse");
const modalEntries = document.getElementById("modal-entries");
const modalExpenses = document.getElementById("modal-expenses");

// ===== STATE =====
let rawRows = [];
let daySeries = [];
let anchorDate = null;
let activeFilter = "today";
let selectedDayKey = null;

let monthKeys = [];
let selectedMonthKey = null;

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

// ===== HELPERS =====
function setConnection(state, text) {
  connectionStatus.classList.remove("connection--ok", "connection--err");
  if (state === "ok") connectionStatus.classList.add("connection--ok");
  if (state === "err") connectionStatus.classList.add("connection--err");
  connectionText.textContent = text;
}

function parseBRL(value) {
  if (value == null) return 0;
  const s = String(value).trim();
  if (!s) return 0;
  const cleaned = s.replace(/\s/g, "").replace("R$", "").replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function parseDateBR(value) {
  const s = String(value || "").trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]) - 1;
  const yyyy = Number(m[3]);
  const d = new Date(yyyy, mm, dd);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function toKey(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function toMonthKey(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}

function formatDateBR(d) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function todayLocal() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function csvSplitLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') {
      cur += '"';
      i++;
      continue;
    }
    if (ch === '"') {
      inQ = !inQ;
      continue;
    }
    if (ch === "," && !inQ) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = csvSplitLine(lines[0]).map((h) => h.toLowerCase());
  const idxData = headers.findIndex((h) => h.includes("data"));
  const idxDesc = headers.findIndex((h) => h.includes("descr"));
  const idxValor = headers.findIndex((h) => h.includes("valor"));
  const idxTipo = headers.findIndex((h) => h.includes("tipo"));

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = csvSplitLine(lines[i]);
    const d = parseDateBR(cols[idxData]);
    if (!d) continue;

    rows.push({
      date: d,
      dateKey: toKey(d),
      monthKey: toMonthKey(d),
      descricao: (cols[idxDesc] || "").trim(),
      valor: parseBRL(cols[idxValor]),
      tipo: (cols[idxTipo] || "").trim(),
    });
  }
  return rows;
}

// ===== build day series =====
function buildDaySeries(rows) {
  const byDay = new Map();
  for (const r of rows) {
    if (!byDay.has(r.dateKey)) byDay.set(r.dateKey, []);
    byDay.get(r.dateKey).push(r);
  }

  const keys = Array.from(byDay.keys()).sort();
  const series = [];
  let prevSaldoFinalForNext = 0;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const dayRows = byDay.get(key).slice().sort((a, b) => a.descricao.localeCompare(b.descricao));
    const dayDate = dayRows[0].date;

    let saldoInicial = 0;
    if (i === 0) {
      const saldoRow = dayRows.find((x) => (x.descricao || "").toUpperCase() === "SALDO");
      saldoInicial = saldoRow ? saldoRow.valor : 0;
    } else {
      // Carrega o saldo final do dia anterior, mesmo se for negativo.
      saldoInicial = prevSaldoFinalForNext;
    }

    const entradasDia = dayRows
      .filter((x) => (x.tipo || "").toLowerCase() === "entrada" && (x.descricao || "").toUpperCase() !== "SALDO")
      .reduce((acc, x) => acc + x.valor, 0);

    const saidasDia = dayRows
      .filter((x) => (x.tipo || "").toLowerCase() === "saída" || (x.tipo || "").toLowerCase() === "saida")
      .reduce((acc, x) => acc + x.valor, 0);

    const saldoFinal = saldoInicial + entradasDia - saidasDia;
    prevSaldoFinalForNext = saldoFinal;

    series.push({
      date: dayDate,
      dateKey: key,
      monthKey: toMonthKey(dayDate),
      saldoInicial,
      entradasDia,
      saidasDia,
      entradasResumo: saldoInicial + entradasDia,
      saldoFinal,
      rows: dayRows,
    });
  }

  return series;
}

// ===== Month select + quinzena =====
function monthLabelPT(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y, (m || 1) - 1, 1);
  let label = d.toLocaleString("pt-BR", { month: "long" });
  label = label.charAt(0).toUpperCase() + label.slice(1);
  return label;
}

function buildMonthKeys() {
  const set = new Set(daySeries.map((d) => d.monthKey));
  return Array.from(set).sort();
}

function pickDefaultMonthKey() {
  if (!daySeries.length) return null;
  return daySeries[daySeries.length - 1].monthKey;
}

function populateMonthSelect() {
  monthSelect.innerHTML = "";
  for (const mk of monthKeys) {
    const opt = document.createElement("option");
    opt.value = mk;
    opt.textContent = monthLabelPT(mk);
    monthSelect.appendChild(opt);
  }
  if (!selectedMonthKey && monthKeys.length) selectedMonthKey = monthKeys[monthKeys.length - 1];
  monthSelect.value = selectedMonthKey || "";
}

function getMonthDays(monthKey) {
  return daySeries
    .filter((d) => d.monthKey === monthKey)
    .slice()
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

function getQuinzenaSlices(monthKey) {
  const days = getMonthDays(monthKey);
  const n = days.length;
  if (n <= 1) return { q1: days, q2: [] };
  const half = Math.floor(n / 2);
  return { q1: days.slice(0, half), q2: days.slice(half) };
}

function updateQuinzenaChipLabels() {
  const mk = selectedMonthKey || pickDefaultMonthKey();
  if (!mk) {
    chipQ1.textContent = "Quinzena 1";
    chipQ2.textContent = "Quinzena 2";
    return;
  }
  const { q1, q2 } = getQuinzenaSlices(mk);
  chipQ1.textContent = `Quinzena 1 (${q1.length} dias)`;
  chipQ2.textContent = `Quinzena 2 (${q2.length} dias)`;
}

// ===== Filters =====
function setActiveChip(filterKey) {
  chips.forEach((b) => b.classList.toggle("chip--active", b.dataset.filter === filterKey));
}

function pickAnchorDate() {
  if (daySeries.length === 0) return null;
  return daySeries[daySeries.length - 1].date;
}

function getFilteredDaySeries() {
  if (!daySeries.length) return [];
  let resultKeys = null;

  if (activeFilter === "quinzena-1" || activeFilter === "quinzena-2") {
    const mk = selectedMonthKey || pickDefaultMonthKey();
    const { q1, q2 } = getQuinzenaSlices(mk);
    const list = activeFilter === "quinzena-1" ? q1 : q2;
    resultKeys = list.map((d) => d.dateKey);
  }

  if (activeFilter === "today") {
    const t = todayLocal();
    const match = daySeries.find((d) => sameDay(d.date, t));
    const use = match ? match.dateKey : daySeries[daySeries.length - 1].dateKey;
    resultKeys = [use];
  }

  if (activeFilter === "next7") {
    const t = todayLocal();
    const idxToday = daySeries.findIndex((d) => sameDay(d.date, t));
    const startIdx = idxToday >= 0 ? idxToday : daySeries.length - 1;
    const slice = daySeries.slice(startIdx, startIdx + 7);
    resultKeys = slice.map((d) => d.dateKey);
  }

  if (activeFilter === "custom") {
    const s = startInput.value ? new Date(startInput.value + "T00:00:00") : null;
    const e = endInput.value ? new Date(endInput.value + "T00:00:00") : null;

    const filtered = daySeries.filter((d) => {
      if (s && d.date < s) return false;
      if (e && d.date > e) return false;
      return true;
    });

    resultKeys = filtered.map((d) => d.dateKey);
  }

  if (!resultKeys) {
    const base = anchorDate || pickAnchorDate();
    const mk = toMonthKey(base);
    resultKeys = getMonthDays(mk).map((d) => d.dateKey);
  }

  return daySeries.filter((d) => resultKeys.includes(d.dateKey));
}

function getSelectedDayIfAny(filteredDays) {
  if (!selectedDayKey) return null;
  return filteredDays.find((d) => d.dateKey === selectedDayKey) || null;
}

function applyFilter(filterKey) {
  activeFilter = filterKey;
  setActiveChip(filterKey);

  const result = getFilteredDaySeries();
  if (selectedDayKey && !result.some((d) => d.dateKey === selectedDayKey)) {
    selectedDayKey = null;
    closeModal(true);
  }

  render();
}

// ===== Modal =====
function openModal() {
  modal.classList.add("modal--open");
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeModal(forceUnlock = false) {
  modal.classList.remove("modal--open");
  modal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function renderModalForDay(day) {
  if (!day) return;

  modalTitle.textContent = "Detalhes do dia";
  modalSubtitle.textContent = formatDateBR(day.date);

  const entradaRows = [
    { descricao: "SALDO INICIAL", valor: day.saldoInicial, strong: true },
    ...day.rows
      .filter((x) => (x.tipo || "").toLowerCase() === "entrada" && (x.descricao || "").toUpperCase() !== "SALDO")
      .map((x) => ({ descricao: x.descricao, valor: x.valor, strong: false })),
  ];

  const saidaRows = day.rows
    .filter((x) => (x.tipo || "").toLowerCase() === "saída" || (x.tipo || "").toLowerCase() === "saida")
    .map((x) => ({ descricao: x.descricao, valor: x.valor }));

  modalTotalEntradas.textContent = brl.format(day.entradasResumo);
  modalTotalSaidas.textContent = brl.format(day.saidasDia);

  // Repasse necessário: aparece somente quando o saldo inicial do dia é negativo.
  // Cálculo: quanto precisa entrar a mais para que o saldo final do dia seja >= 0.
  if (day.saldoInicial < 0) {
    const repasseNecessario = Math.max(0, day.saidasDia - (day.saldoInicial + day.entradasDia));
    modalRepasse.textContent = brl.format(repasseNecessario);
    modalRepasseWrap.style.display = "flex";
  } else {
    modalRepasseWrap.style.display = "none";
  }

  modalEntries.innerHTML =
    entradaRows.length === 0
      ? `<div class="list__empty">Sem entradas neste dia.</div>`
      : entradaRows
          .map(
            (r) => `
              <div class="list__row">
                <div class="list__desc">${r.strong ? `<strong>${r.descricao}</strong>` : r.descricao}</div>
                <div class="list__amt list__amt--pos">${brl.format(r.valor)}</div>
              </div>
            `
          )
          .join("");

  modalExpenses.innerHTML =
    saidaRows.length === 0
      ? `<div class="list__empty">Sem saídas neste dia.</div>`
      : saidaRows
          .map(
            (r) => `
              <div class="list__row">
                <div class="list__desc">${r.descricao}</div>
                <div class="list__amt list__amt--neg">${brl.format(r.valor)}</div>
              </div>
            `
          )
          .join("");

  openModal();
}

// ===== Render =====
function renderCards(daysForCards) {
  if (!daysForCards || daysForCards.length === 0) {
    totalEntradasEl.textContent = brl.format(0);
    totalSaidasEl.textContent = brl.format(0);
    return;
  }

  const first = daysForCards[0];
  const saldoInicialPeriodo = first.saldoInicial;

  const entradasPeriodo = daysForCards.reduce((acc, d) => acc + d.entradasDia, 0);
  const recebimentos = saldoInicialPeriodo + entradasPeriodo;

  const pagamentos = daysForCards.reduce((acc, d) => acc + d.saidasDia, 0);

  totalEntradasEl.textContent = brl.format(recebimentos);
  totalSaidasEl.textContent = brl.format(pagamentos);
}

function renderDailySummary(filteredDays) {
  dailySummaryBody.innerHTML = filteredDays
    .map((d) => {
      const saldoClass = d.saldoFinal < 0 ? "amount--neg" : "amount--pos";
      const rowClass = d.dateKey === selectedDayKey ? "row--selected" : "";
      return `
        <tr class="${rowClass}" data-day="${d.dateKey}">
          <td>${formatDateBR(d.date)}</td>
          <td class="amount--pos">${brl.format(d.entradasResumo)}</td>
          <td class="amount--muted">${brl.format(d.saidasDia)}</td>
          <td class="${saldoClass}">${brl.format(d.saldoFinal)}</td>
        </tr>
      `;
    })
    .join("");

  Array.from(dailySummaryBody.querySelectorAll("tr[data-day]")).forEach((tr) => {
    tr.addEventListener("click", () => {
      const key = tr.getAttribute("data-day");

      if (selectedDayKey === key) {
        selectedDayKey = null;
        closeModal(true);
        render();
        return;
      }

      selectedDayKey = key;
      render();

      const filtered = getFilteredDaySeries();
      const selected = getSelectedDayIfAny(filtered);
      if (selected) renderModalForDay(selected);
    });
  });
}

function render() {
  const filteredDays = getFilteredDaySeries();
  const selected = getSelectedDayIfAny(filteredDays);
  const daysForCards = selected ? [selected] : filteredDays;

  renderCards(daysForCards);
  renderDailySummary(filteredDays);

  if (selectedDayKey && !selected) {
    selectedDayKey = null;
    closeModal(true);
  }
}

// ===== Events =====
chips.forEach((b) => b.addEventListener("click", () => applyFilter(b.dataset.filter)));

document.querySelector('.chip[data-filter="custom"]').addEventListener("click", () => applyFilter("custom"));

clearDayBtn.addEventListener("click", () => {
  selectedDayKey = null;
  closeModal(true);
  render();
});

startInput.addEventListener("change", () => {
  setActiveChip("custom");
  activeFilter = "custom";
  render();
});

endInput.addEventListener("change", () => {
  setActiveChip("custom");
  activeFilter = "custom";
  render();
});

monthSelect.addEventListener("change", () => {
  selectedMonthKey = monthSelect.value || selectedMonthKey;
  updateQuinzenaChipLabels();

  if (activeFilter === "quinzena-1" || activeFilter === "quinzena-2") {
    selectedDayKey = null;
    closeModal(true);
    render();
  }
});

// Modal controls
modalOverlay.addEventListener("click", () => closeModal(true));
modalClose.addEventListener("click", () => closeModal(true));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal(true);
});

// ===== INIT =====
async function init() {
  try {
    setConnection(null, "Conectando à planilha...");
    const res = await fetch(CSV_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const text = await res.text();
    rawRows = parseCSV(text);

    daySeries = buildDaySeries(rawRows);
    anchorDate = pickAnchorDate();

    monthKeys = buildMonthKeys();
    selectedMonthKey = pickDefaultMonthKey();
    populateMonthSelect();
    updateQuinzenaChipLabels();

    setActiveChip("today");
    activeFilter = "today";

    setConnection("ok", "Dados sincronizados com a planilha");
    render();
  } catch (err) {
    console.error(err);
    setConnection("err", "Erro ao carregar dados da planilha");
  }
}

init();
