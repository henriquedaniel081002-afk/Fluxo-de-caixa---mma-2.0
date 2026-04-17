const DATA_URL = "./consolidado.json";

const monthFormatter = new Intl.DateTimeFormat("pt-BR", { month: "long" });

const dom = {
  yearFilter: document.getElementById("yearFilter"),
  monthFilter: document.getElementById("monthFilter"),
  kpiAdherence: document.getElementById("kpiAdherence"),
  kpiProduced: document.getElementById("kpiProduced"),
  kpiDailyAverage: document.getElementById("kpiDailyAverage"),
  chartCanvas: document.getElementById("productionChart"),
};

const state = {
  today: getTodayLocal(),
  rows: [],
  selectedYear: null,
  selectedMonth: null,
  chart: null,
};

class ProductionDataService {
  static async loadData() {
    const response = await fetch(DATA_URL);
    if (!response.ok) {
      throw new Error(`Falha ao carregar JSON consolidado: ${response.status}`);
    }

    const raw = await response.json();
    if (!Array.isArray(raw)) {
      throw new Error("O JSON consolidado deve ser um array de registros.");
    }

    return raw.map(ProductionDataService.normalizeRecord);
  }

  static normalizeRecord(item) {
    return {
      serie: String(item.serie || "").trim(),
      linha: item.linha || "",
      potencia: item.potencia || "",
      setorProgramado: item.setorProgramado || "",
      setorProduzido: item.setorProduzido || "",
      dataProg: parseDate(item.dataProg),
      dataProduzida: parseDate(item.dataProduzida),
    };
  }
}

class MetricsService {
  static getPeriodDates(year, month, today) {
    const start = new Date(year, month - 1, 1);
    const lastDayOfMonth = new Date(year, month, 0);
    const end = lastDayOfMonth <= today ? lastDayOfMonth : today;
    const hasValidRange = start <= end;

    return { start, end, hasValidRange };
  }

  static filterProgrammedInPeriod(rows, start, end) {
    return rows.filter((row) => row.dataProg && row.dataProg >= start && row.dataProg <= end);
  }

  static filterProducedInPeriod(rows, start, end) {
    return rows.filter(
      (row) => row.dataProduzida && row.dataProduzida >= start && row.dataProduzida <= end
    );
  }

  static calculateKpis(rows, year, month, today) {
    const { start, end, hasValidRange } = MetricsService.getPeriodDates(year, month, today);

    if (!hasValidRange) {
      return {
        adherence: 0,
        producedCount: 0,
        dailyAverage: 0,
        periodDays: 0,
        programmedCount: 0,
      };
    }

    const programmed = MetricsService.filterProgrammedInPeriod(rows, start, end);
    const produced = MetricsService.filterProducedInPeriod(rows, start, end);

    const programmedCount = programmed.length;
    const producedCount = produced.length;

    const adherence = programmedCount > 0 ? (producedCount / programmedCount) * 100 : 0;

    const periodDays = dateDiffInDays(start, end) + 1;
    const dailyAverage = periodDays > 0 ? producedCount / periodDays : 0;

    return {
      adherence,
      producedCount,
      dailyAverage,
      periodDays,
      programmedCount,
    };
  }

  static buildDailySeries(rows, year, month, today) {
    const { start, end, hasValidRange } = MetricsService.getPeriodDates(year, month, today);

    if (!hasValidRange) {
      return { labels: [], programmedData: [], producedData: [] };
    }

    const labels = [];
    const programmedByDate = new Map();
    const producedByDate = new Map();

    for (let current = new Date(start); current <= end; current.setDate(current.getDate() + 1)) {
      const key = toDateKey(current);
      labels.push(key);
      programmedByDate.set(key, 0);
      producedByDate.set(key, 0);
    }

    rows.forEach((row) => {
      if (row.dataProg) {
        const key = toDateKey(row.dataProg);
        if (programmedByDate.has(key)) {
          programmedByDate.set(key, programmedByDate.get(key) + 1);
        }
      }

      if (row.dataProduzida && row.dataProduzida <= today) {
        const key = toDateKey(row.dataProduzida);
        if (producedByDate.has(key)) {
          producedByDate.set(key, producedByDate.get(key) + 1);
        }
      }
    });

    return {
      labels,
      programmedData: labels.map((label) => programmedByDate.get(label) || 0),
      producedData: labels.map((label) => producedByDate.get(label) || 0),
    };
  }
}

function getTodayLocal() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function dateDiffInDays(start, end) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((end - start) / msPerDay);
}

function formatLabelDate(isoDate) {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}`;
}

function setupFilters(rows) {
  const years = Array.from(new Set(rows.filter((r) => r.dataProg).map((r) => r.dataProg.getFullYear()))).sort(
    (a, b) => a - b
  );

  if (!years.length) {
    years.push(state.today.getFullYear());
  }

  state.selectedYear = state.today.getFullYear();
  if (!years.includes(state.selectedYear)) {
    state.selectedYear = years[years.length - 1];
  }

  dom.yearFilter.innerHTML = years
    .map((year) => `<option value="${year}">${year}</option>`)
    .join("");
  dom.yearFilter.value = String(state.selectedYear);

  populateMonthFilter(state.selectedYear);

  dom.yearFilter.addEventListener("change", (event) => {
    state.selectedYear = Number(event.target.value);
    populateMonthFilter(state.selectedYear);
    renderDashboard();
  });

  dom.monthFilter.addEventListener("change", (event) => {
    state.selectedMonth = Number(event.target.value);
    renderDashboard();
  });
}

function populateMonthFilter(year) {
  const hasCurrentYear = year === state.today.getFullYear();
  const maxMonth = hasCurrentYear ? state.today.getMonth() + 1 : 12;

  dom.monthFilter.innerHTML = Array.from({ length: maxMonth }, (_, i) => i + 1)
    .map(
      (month) =>
        `<option value="${month}">${monthFormatter.format(new Date(year, month - 1, 1)).replace(/^\w/, (c) =>
          c.toUpperCase()
        )}</option>`
    )
    .join("");

  state.selectedMonth = hasCurrentYear ? state.today.getMonth() + 1 : 1;
  dom.monthFilter.value = String(state.selectedMonth);
}

function renderKpis() {
  const { adherence, producedCount, dailyAverage } = MetricsService.calculateKpis(
    state.rows,
    state.selectedYear,
    state.selectedMonth,
    state.today
  );

  dom.kpiAdherence.textContent = `${adherence.toFixed(1)}%`;
  dom.kpiProduced.textContent = String(producedCount);
  dom.kpiDailyAverage.textContent = dailyAverage.toFixed(2).replace(".", ",");
}

function renderChart() {
  const { labels, programmedData, producedData } = MetricsService.buildDailySeries(
    state.rows,
    state.selectedYear,
    state.selectedMonth,
    state.today
  );

  const chartData = {
    labels: labels.map(formatLabelDate),
    datasets: [
      {
        label: "Programado",
        data: programmedData,
        borderColor: "#c6d1ca",
        backgroundColor: "rgba(198, 209, 202, 0.18)",
        borderWidth: 2,
        fill: false,
        tension: 0.25,
        pointRadius: 2,
      },
      {
        label: "Produzido",
        data: producedData,
        borderColor: "#2e8b57",
        backgroundColor: "rgba(46, 139, 87, 0.18)",
        borderWidth: 2,
        fill: false,
        tension: 0.25,
        pointRadius: 2,
      },
    ],
  };

  if (state.chart) {
    state.chart.data = chartData;
    state.chart.update();
    return;
  }

  state.chart = new Chart(dom.chartCanvas, {
    type: "line",
    data: chartData,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      plugins: {
        legend: {
          labels: { color: "#f3f6f4" },
        },
      },
      scales: {
        x: {
          ticks: { color: "#a8b2ad" },
          grid: { color: "rgba(255,255,255,0.05)" },
        },
        y: {
          beginAtZero: true,
          ticks: {
            color: "#a8b2ad",
            precision: 0,
          },
          grid: { color: "rgba(255,255,255,0.05)" },
        },
      },
    },
  });
}

function renderDashboard() {
  renderKpis();
  renderChart();
}

async function init() {
  try {
    state.rows = await ProductionDataService.loadData();
    setupFilters(state.rows);
    renderDashboard();
  } catch (error) {
    console.error(error);
    alert("Não foi possível carregar o JSON consolidado. Verifique o arquivo consolidado.json.");
  }
}

init();
