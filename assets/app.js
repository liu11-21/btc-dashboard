const DATA_URL = "./data/dashboard_history.json";
const FORECAST_URL = "./data/latest_forecast.json";
const PLAY_INTERVAL_MS = 1200;

const state = {
  payload: null,
  forecastPayload: null,
  rows: [],
  years: [],
  selectedYear: null,
  playing: false,
  timer: null,
};

const el = (id) => document.getElementById(id);

const fmtNumber = (value, digits = 2) => {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString("zh-TW", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }) : "無資料";
};

const fmtMoney = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n) : "無資料";
};

const fmtPercent = (value, digits = 2) => {
  const n = Number(value);
  return Number.isFinite(n) ? `${(n * 100).toFixed(digits)}%` : "無資料";
};

const fmtCompact = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? new Intl.NumberFormat("zh-TW", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(n) : "無資料";
};

const showEmpty = (message) => {
  el("dashboard").hidden = true;
  const empty = el("emptyState");
  empty.hidden = false;
  if (message) empty.querySelector("p").textContent = message;
};

const rowsForYear = (year) => state.rows.filter((row) => Number(row.year) === Number(year));

const annualForYear = (year) => state.payload?.annual_metrics?.[String(year)] ?? {};

const metricCards = (year) => {
  const metrics = annualForYear(year);
  const cards = [
    ["年度最高成交價", fmtMoney(metrics.highest_price), "日高價最高值"],
    ["年度最低成交價", fmtMoney(metrics.lowest_price), "日低價最低值"],
    ["年度總成交量", fmtCompact(metrics.total_volume), "本年度累計量"],
    ["年度最低日成交量", fmtCompact(metrics.lowest_daily_volume), "單日成交量低點"],
    ["年度最高波動率", fmtPercent(metrics.highest_volatility), "日內波動率高點"],
    ["年度最低波動率", fmtPercent(metrics.lowest_volatility), "日內波動率低點"],
  ];

  el("metricGrid").innerHTML = cards.map(([label, value, note]) => `
    <article class="metric-card">
      <span>${label}</span>
      <strong>${value}</strong>
      <small>${note}</small>
    </article>
  `).join("");
};

const layoutBase = {
  paper_bgcolor: "rgba(255,255,255,0)",
  plot_bgcolor: "rgba(255,255,255,0)",
  font: { family: "Microsoft JhengHei, Segoe UI, sans-serif", color: "#17202a" },
  margin: { l: 72, r: 28, t: 12, b: 64 },
  hovermode: "x unified",
  legend: { orientation: "h", y: -0.18 },
};

const plotConfig = { responsive: true, displaylogo: false };

const renderTrendChart = (rows, year) => {
  Plotly.react("trendChart", [
    {
      type: "scatter",
      mode: "lines",
      x: rows.map((row) => row.date),
      y: rows.map((row) => row.close),
      name: "收盤價",
      line: { color: "#f7931a", width: 2.4 },
      hovertemplate: "%{x}<br>收盤價=%{y:$,.2f}<extra></extra>",
    },
    {
      type: "scatter",
      mode: "lines",
      x: rows.map((row) => row.date),
      y: rows.map((row) => row.trend_ma_proxy),
      name: "48-bar 趨勢均線代理",
      line: { color: "#2563eb", width: 2, dash: "dot" },
      hovertemplate: "%{x}<br>趨勢代理=%{y:$,.2f}<extra></extra>",
    },
  ], {
    ...layoutBase,
    title: null,
    xaxis: { title: "日期", gridcolor: "#edf2f7" },
    yaxis: { title: "價格 / 指數", gridcolor: "#edf2f7", tickprefix: "$" },
  }, plotConfig);
};

const renderMvrvChart = (rows, year) => {
  Plotly.react("mvrvChart", [{
    type: "scatter",
    mode: "lines",
    x: rows.map((row) => row.date),
    y: rows.map((row) => row.mvrv_z_proxy),
    name: "MVRV Z-Score 代理",
    line: { color: "#7c3aed", width: 2 },
    hovertemplate: "%{x}<br>MVRV 代理=%{y:.3f}<extra></extra>",
  }], {
    ...layoutBase,
    title: null,
    xaxis: { title: "日期", gridcolor: "#edf2f7" },
    yaxis: { title: "Z-Score", gridcolor: "#edf2f7" },
  }, plotConfig);
};

const renderMayerChart = (rows, year) => {
  Plotly.react("mayerChart", [{
    type: "scatter",
    mode: "lines",
    x: rows.map((row) => row.date),
    y: rows.map((row) => row.mayer_multiple),
    name: "梅耶指數",
    line: { color: "#0f766e", width: 2 },
    hovertemplate: "%{x}<br>梅耶指數=%{y:.3f}<extra></extra>",
  }], {
    ...layoutBase,
    title: null,
    shapes: [{
      type: "line",
      xref: "paper",
      x0: 0,
      x1: 1,
      y0: 1,
      y1: 1,
      line: { color: "#111827", width: 1, dash: "dash" },
    }],
    xaxis: { title: "日期", gridcolor: "#edf2f7" },
    yaxis: { title: "倍數", gridcolor: "#edf2f7" },
  }, plotConfig);
};

const renderVolatilityChart = (rows, year) => {
  Plotly.react("volatilityChart", [{
    type: "bar",
    x: rows.map((row) => row.date),
    y: rows.map((row) => row.daily_volatility),
    name: "日波動率",
    marker: { color: "#d94b4b" },
    hovertemplate: "%{x}<br>日波動率=%{y:.3%}<extra></extra>",
  }], {
    ...layoutBase,
    title: null,
    xaxis: { title: "日期", gridcolor: "#edf2f7" },
    yaxis: { title: "波動率", tickformat: ".1%", gridcolor: "#edf2f7" },
  }, plotConfig);
};

const renderCagrChart = (year) => {
  const selectedIndex = state.years.indexOf(Number(year));
  const colors = state.years.map((item, index) => index === selectedIndex ? "#f7931a" : "#94a3b8");
  Plotly.react("cagrChart", [{
    type: "bar",
    x: state.years,
    y: state.years.map((item) => annualForYear(item).cagr),
    name: "CAGR",
    marker: { color: colors },
    hovertemplate: "%{x}<br>CAGR=%{y:.2%}<extra></extra>",
  }], {
    ...layoutBase,
    title: null,
    xaxis: { title: "年度", gridcolor: "#edf2f7", type: "category" },
    yaxis: { title: "CAGR", tickformat: ".1%", gridcolor: "#edf2f7" },
  }, plotConfig);
};

const renderCharts = (year) => {
  const rows = rowsForYear(year);
  renderTrendChart(rows, year);
  renderMvrvChart(rows, year);
  renderMayerChart(rows, year);
  renderVolatilityChart(rows, year);
  renderCagrChart(year);
};

const tableCell = (value, type) => {
  if (type === "money") return fmtMoney(value);
  if (type === "percent") return fmtPercent(value);
  if (type === "number") return fmtNumber(value, 3);
  return value ?? "無資料";
};

const renderTable = () => {
  const rows = state.rows;
  const maxRows = 1200;
  el("historyRows").innerHTML = rows.slice(-maxRows).map((row) => {
    const cagr = annualForYear(row.year).cagr;
    return `
      <tr>
        <td>${row.date}</td>
        <td>${row.year}</td>
        <td>${tableCell(row.open, "money")}</td>
        <td>${tableCell(row.high, "money")}</td>
        <td>${tableCell(row.low, "money")}</td>
        <td>${tableCell(row.close, "money")}</td>
        <td>${fmtCompact(row.volume)}</td>
        <td>${tableCell(row.mvrv_z_proxy, "number")}</td>
        <td>${tableCell(row.mayer_multiple, "number")}</td>
        <td>${tableCell(row.daily_volatility, "percent")}</td>
        <td>${tableCell(cagr, "percent")}</td>
      </tr>
    `;
  }).join("");
};

const updateYear = (year) => {
  state.selectedYear = Number(year);
  const index = state.years.indexOf(state.selectedYear);
  el("yearSlider").value = String(index);
  el("currentYear").textContent = String(state.selectedYear);
  metricCards(state.selectedYear);
  renderCharts(state.selectedYear);
};

const stopPlayback = () => {
  state.playing = false;
  el("playPauseButton").textContent = "播放";
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
};

const startPlayback = () => {
  state.playing = true;
  el("playPauseButton").textContent = "暫停";
  state.timer = setInterval(() => {
    const currentIndex = state.years.indexOf(state.selectedYear);
    const nextIndex = (currentIndex + 1) % state.years.length;
    updateYear(state.years[nextIndex]);
  }, PLAY_INTERVAL_MS);
};

const togglePlayback = () => {
  if (state.playing) stopPlayback();
  else startPlayback();
};

const exportCsv = () => {
  const columns = [
    "date", "year", "open", "high", "low", "close", "volume",
    "mvrv_z_proxy", "mayer_multiple", "daily_volatility", "cagr",
  ];
  const lines = [columns.join(",")];
  state.rows.forEach((row) => {
    const enriched = { ...row, cagr: annualForYear(row.year).cagr };
    lines.push(columns.map((key) => {
      const value = enriched[key] ?? "";
      return `"${String(value).replaceAll('"', '""')}"`;
    }).join(","));
  });
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "btc_annual_dashboard_data.csv";
  link.click();
  URL.revokeObjectURL(url);
};

const wireControls = () => {
  el("playPauseButton").addEventListener("click", togglePlayback);
  el("yearSlider").addEventListener("input", (event) => {
    stopPlayback();
    const index = Number(event.target.value);
    updateYear(state.years[index]);
  });
  el("exportCsvButton").addEventListener("click", exportCsv);
};

const normalizePayload = (payload) => {
  const rows = Array.isArray(payload?.daily_rows) ? payload.daily_rows : [];
  const years = Array.isArray(payload?.years)
    ? payload.years.map(Number).filter(Number.isFinite)
    : [...new Set(rows.map((row) => Number(row.year)).filter(Number.isFinite))];
  return {
    payload,
    rows: rows.map((row) => ({ ...row, year: Number(row.year) })),
    years: years.sort((a, b) => a - b),
  };
};

const formatTimestamp = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString("zh-TW", { hour12: false });
};

const formatDateHour = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).replace("時", ":00");
};

const dataRangeLabel = (rows, latestForecast) => {
  const start = rows.length ? `${rows[0].date} 00:00` : null;
  const forecastTargets = Array.isArray(latestForecast?.forecasts)
    ? latestForecast.forecasts.map((item) => formatDateHour(item.target_time)).filter(Boolean)
    : [];
  const end = forecastTargets.length
    ? forecastTargets.sort().at(-1)
    : (rows.length ? `${rows.at(-1).date} 23:00` : null);
  return start && end ? `${start} - ${end}` : "無資料";
};

const loadLatestForecast = async () => {
  const response = await fetch(`${FORECAST_URL}?v=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
};

const loadDashboard = async () => {
  try {
    const [response, latestForecast] = await Promise.all([
      fetch(`${DATA_URL}?v=${Date.now()}`, { cache: "no-store" }),
      loadLatestForecast().catch(() => null),
    ]);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const rawPayload = await response.json();
    const normalized = normalizePayload(rawPayload);
    if (!normalized.rows.length || !normalized.years.length) {
      throw new Error("dashboard_history.json 沒有年度資料");
    }

    state.payload = normalized.payload;
    state.forecastPayload = latestForecast;
    state.rows = normalized.rows;
    state.years = normalized.years;
    state.selectedYear = state.years[state.years.length - 1];

    el("emptyState").hidden = true;
    el("dashboard").hidden = false;
    el("updatedAt").textContent = rawPayload.generated_at
      ? new Date(rawPayload.generated_at).toLocaleString("zh-TW", { hour12: false })
      : "無資料";
    el("updatedAt").textContent =
      formatTimestamp(latestForecast?.generated_at) ||
      formatTimestamp(rawPayload.generated_at) ||
      el("updatedAt").textContent;
    el("dataRange").textContent = dataRangeLabel(state.rows, latestForecast);
    el("yearSlider").min = "0";
    el("yearSlider").max = String(state.years.length - 1);
    el("yearSlider").step = "1";

    renderTable();
    updateYear(state.selectedYear);
  } catch (error) {
    showEmpty(`無法載入年度資料：${error.message}`);
  }
};

wireControls();
loadDashboard();
