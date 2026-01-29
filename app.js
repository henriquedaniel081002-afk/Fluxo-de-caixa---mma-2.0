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
const modalRepasseToggle = document.getElementById("modal-repasse-toggle");
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

// Repasse (simulação)
const REPASSE_STORAGE_KEY = "repasse_flags_v1";
let repasseFlags = new Map();

function loadRepasseFlags() {
  try {
    const raw = localStorage.getItem(REPASSE_STORAGE_KEY);
    if (!raw) return new Map();
    const obj = JSON.parse(raw);
    const m = new Map();
    if (obj && typeof obj === "object") {
      Object.keys(obj).forEach((k) => m.set(k, !!obj[k]));
    }
    return m;
  } catch {
    return new Map();
  }
}

function saveRepasseFlags() {
  try {
    const obj = {};
    repasseFlags.forEach((v, k) => {
      if (v) obj[k] = true;
    });
    localStorage.setItem(REPASSE_STORAGE_KEY, JSON.stringify(obj));
  } catch {
    // ignore
  }
}

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
function buildDaySeries(rows, flagsMap) {
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

    const entradasOrig = dayRows
      .filter((x) => (x.tipo || "").toLowerCase() === "entrada" && (x.descricao || "").toUpperCase() !== "SALDO")
      .reduce((acc, x) => acc + x.valor, 0);

    const saidasDia = dayRows
      .filter((x) => (x.tipo || "").toLowerCase() === "saída" || (x.tipo || "").toLowerCase() === "saida")
      .reduce((acc, x) => acc + x.valor, 0);

    // Repasse necessário (sugestão): aparece quando o caixa disponível no dia não cobre as saídas.
    // Condição: (saldoInicial + entradasOrig) < saidasDia
    // Cálculo:
    //   base = saidasDia - (saldoInicial + entradasOrig)
    //   comMargem = base * 1.10
    //   exibido = arredonda para cima ao milhar (ceil)
    const caixaDisponivel = saldoInicial + entradasOrig;
    let repasseSuggested = 0;
    if (caixaDisponivel < saidasDia) {
      const base = Math.max(0, saidasDia - caixaDisponivel);
      const comMargem = base * 1.10;
      repasseSuggested = Math.ceil(comMargem / 1000) * 1000;
    }

    const apply = !!(flagsMap && flagsMap.get(key)) && repasseSuggested > 0;
    const repasseApplied = apply ? repasseSuggested : 0;

    const entradasDia = entradasOrig + repasseApplied;
    const saldoFinal = saldoInicial + entradasDia - saidasDia;
    prevSaldoFinalForNext = saldoFinal;

    series.push({
      date: dayDate,
      dateKey: key,
      monthKey: toMonthKey(dayDate),
      saldoInicial,
      entradasDia,
      entradasOrig,
      saidasDia,
      entradasResumo: saldoInicial + entradasDia,
      saldoFinal,
      repasseSuggested,
      repasseApplied,
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
    ...(day.repasseApplied > 0 ? [{ descricao: "REPASSE (SIMULADO)", valor: day.repasseApplied, strong: true, simulated: true }] : []),
    ...day.rows
      .filter((x) => (x.tipo || "").toLowerCase() === "entrada" && (x.descricao || "").toUpperCase() !== "SALDO")
      .map((x) => ({ descricao: x.descricao, valor: x.valor, strong: false })),
  ];

  const saidaRows = day.rows
    .filter((x) => (x.tipo || "").toLowerCase() === "saída" || (x.tipo || "").toLowerCase() === "saida")
    .map((x) => ({ descricao: x.descricao, valor: x.valor }));

  modalTotalEntradas.textContent = brl.format(day.entradasResumo);
  modalTotalSaidas.textContent = brl.format(day.saidasDia);

  // Repasse necessário (sugestão) + simulação:
// - Sugestão aparece quando (saldoInicial + entradasOrig) < saidasDia
// - Se o toggle estiver ativo, o repasse é aplicado como entrada adicional do dia e o fluxo é recalculado a partir dele.
  if (day.repasseSuggested > 0) {
    modalRepasse.textContent = brl.format(day.repasseSuggested);
    modalRepasseWrap.style.display = "flex";

    if (modalRepasseToggle) {
      modalRepasseToggle.checked = !!repasseFlags.get(day.dateKey);
      modalRepasseToggle.onchange = () => {
        repasseFlags.set(day.dateKey, !!modalRepasseToggle.checked);
        saveRepasseFlags();

        daySeries = buildDaySeries(rawRows, repasseFlags);
        monthKeys = buildMonthKeys();

        // mantém o mês selecionado, se ainda existir
        if (selectedMonthKey && !monthKeys.includes(selectedMonthKey)) {
          selectedMonthKey = pickDefaultMonthKey();
        }

        populateMonthSelect();
        updateQuinzenaChipLabels();
        render();

        const filtered = getFilteredDaySeries();
        const selected = getSelectedDayIfAny(filtered);
        if (selected) renderModalForDay(selected);
      };
    }
  } else {
    modalRepasseWrap.style.display = "none";
    if (modalRepasseToggle) {
      modalRepasseToggle.checked = false;
      modalRepasseToggle.onchange = null;
    }
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


init();

// ===== Modal: Repasses simulados (central de controle) =====
const repassesOpenBtn = document.getElementById("repasses-open");
const repassesModal = document.getElementById("repasses-modal");
const repassesOverlay = document.getElementById("repasses-overlay");
const repassesCloseBtn = document.getElementById("repasses-close");
const repassesList = document.getElementById("repasses-list");
const repassesEmpty = document.getElementById("repasses-empty");
const repassesCount = document.getElementById("repasses-count");
const repassesTotal = document.getElementById("repasses-total");
const repassesSummary = document.getElementById("repasses-summary");
const repassesClearAllBtn = document.getElementById("repasses-clear-all");

function fmtBRL(n) {
  try {
    return (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  } catch {
    return `R$ ${(n || 0).toFixed(2)}`;
  }
}

function fmtDateFromKey(key) {
  // key: YYYY-MM-DD
  const [y, m, d] = String(key).split("-");
  if (!y || !m || !d) return key;
  return `${d}/${m}/${y}`;
}

function openRepassesModal() {
  if (!repassesModal) return;
  renderRepassesModal();
  repassesModal.classList.add("modal--open");
  repassesModal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeRepassesModal() {
  if (!repassesModal) return;
  repassesModal.classList.remove("modal--open");
  repassesModal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function rebuildAfterRepasseChange() {
  daySeries = buildDaySeries(rawRows, repasseFlags);
  monthKeys = buildMonthKeys();
  // mantém selectedMonthKey válido
  if (selectedMonthKey && monthKeys.length && !monthKeys.includes(selectedMonthKey)) {
    selectedMonthKey = monthKeys[monthKeys.length - 1];
  }
  render();
}

function renderRepassesModal() {
  if (!repassesList || !repassesEmpty || !repassesCount || !repassesTotal || !repassesSummary) return;

  repassesList.innerHTML = "";

  const activeKeys = [];
  if (repasseFlags && typeof repasseFlags.forEach === "function") {
    repasseFlags.forEach((v, k) => {
      if (v) activeKeys.push(k);
    });
  }

  activeKeys.sort();

  // Constrói lista baseada na daySeries atual (que já considera repasses aplicados)
  let total = 0;
  const rows = [];

  for (const key of activeKeys) {
    const day = daySeries.find((d) => d.dateKey === key);
    const value = day ? (day.repasseApplied || 0) : 0;

    // Se por algum motivo não houver valor aplicado, ainda assim lista o dia para auditoria
    total += value;

    rows.push({ key, value });
  }

  repassesCount.textContent = String(rows.length);
  repassesTotal.textContent = fmtBRL(total);
  repassesSummary.textContent = rows.length ? "Dias com repasse simulado ativo." : "—";

  if (!rows.length) {
    repassesEmpty.style.display = "block";
    repassesClearAllBtn && (repassesClearAllBtn.disabled = true);
    return;
  }

  repassesEmpty.style.display = "none";
  if (repassesClearAllBtn) repassesClearAllBtn.disabled = false;

  for (const item of rows) {
    const el = document.createElement("div");
    el.className = "repasses__row";
    el.innerHTML = `
      <div class="repasses__rowLeft">
        <strong>${fmtDateFromKey(item.key)}</strong>
        <span>${fmtBRL(item.value)}</span>
      </div>
      <div class="repasses__rowRight">
        <button class="chip chip--ghost repasses__btn" type="button" data-action="goto" data-key="${item.key}">Ir para o dia</button>
        <button class="chip chip--ghost repasses__btn" type="button" data-action="clear" data-key="${item.key}">Limpar</button>
      </div>
    `;
    repassesList.appendChild(el);
  }
}

if (repassesOpenBtn) repassesOpenBtn.addEventListener("click", openRepassesModal);
if (repassesCloseBtn) repassesCloseBtn.addEventListener("click", closeRepassesModal);
if (repassesOverlay) repassesOverlay.addEventListener("click", closeRepassesModal);

if (repassesClearAllBtn) {
  repassesClearAllBtn.addEventListener("click", () => {
    const hasAny = repasseFlags && typeof repasseFlags.size === "number" ? repasseFlags.size > 0 : false;
    if (!hasAny) return;

    if (!confirm("Deseja remover TODOS os repasses simulados?")) return;

    repasseFlags = new Map();
    localStorage.removeItem(REPASSE_STORAGE_KEY);
    rebuildAfterRepasseChange();
    renderRepassesModal();
  });
}

if (repassesList) {
  repassesList.addEventListener("click", (e) => {
    const btn = e.target && e.target.closest ? e.target.closest("button[data-action]") : null;
    if (!btn) return;

    const action = btn.getAttribute("data-action");
    const key = btn.getAttribute("data-key");
    if (!key) return;

    if (action === "clear") {
      repasseFlags.delete(key);
      saveRepasseFlags();
      rebuildAfterRepasseChange();
      renderRepassesModal();
      return;
    }

    if (action === "goto") {
      const day = daySeries.find((d) => d.dateKey === key);
      if (!day) {
        alert("Dia não encontrado no período atual.");
        return;
      }
      closeRepassesModal();
      selectedDayKey = key;
      render();
      renderModalForDay(day);
      openModal();
    }
  });
}

