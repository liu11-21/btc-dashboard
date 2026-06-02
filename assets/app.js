"use strict";

const HIST_URL = "./data/dashboard_history.json";
const FC_URL = "./data/latest_forecast.json";
const PLAY_MS = 1400;

const $ = id => document.getElementById(id);

function fmtUSD(v) {
  const n = Number(v);
  return Number.isFinite(n)
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n)
    : "--";
}

function fmtPct(v, plus = true) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "--";
  const s = (n * 100).toFixed(2) + "%";
  return plus && n > 0 ? "+" + s : s;
}

function fmtPctRaw(v, digits = 2) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "--";
  return (n >= 0 ? "+" : "") + n.toFixed(digits) + "%";
}

function fmtPct1(v) {
  const n = Number(v);
  return Number.isFinite(n) ? (n * 100).toFixed(3) + "%" : "--";
}

function fmtNum(v, d = 3) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(d) : "--";
}

function fmtCompact(v) {
  const n = Number(v);
  return Number.isFinite(n)
    ? new Intl.NumberFormat("zh-TW", { notation: "compact", maximumFractionDigits: 2 }).format(n)
    : "--";
}

function fmtTs(v) {
  if (!v) return "--";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "--" : d.toLocaleString("zh-TW", { hour12: false });
}

function dateOnly(v) {
  if (!v) return "--";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toISOString().slice(0, 10);
}

function plotTs(v) {
  if (!v) return "--";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  const pad = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" +
    pad(d.getMonth() + 1) + "-" +
    pad(d.getDate()) + " " +
    pad(d.getHours()) + ":" +
    pad(d.getMinutes()) + ":00";
}

function plotTickLabel(v) {
  const x = plotTs(v);
  return x === "--" ? "--" : x.slice(5, 16);
}

const BASE = {
  paper_bgcolor: "rgba(0,0,0,0)",
  plot_bgcolor: "rgba(0,0,0,0)",
  font: { color: "#94a3b8", family: "Microsoft JhengHei,system-ui,sans-serif", size: 12 },
  margin: { t: 10, r: 16, b: 40, l: 62 },
  hovermode: "x unified",
  legend: { bgcolor: "rgba(0,0,0,0)", font: { color: "#94a3b8" }, orientation: "h", y: -0.22 },
  xaxis: { gridcolor: "#242838", linecolor: "#242838", zerolinecolor: "#242838" },
  yaxis: { gridcolor: "#242838", linecolor: "#242838", zerolinecolor: "#242838" },
};
const CFG = { responsive: true, displaylogo: false, displayModeBar: false };

const S = {
  hist: null,
  fc: null,
  rows: [],
  years: [],
  yearOptions: [],
  year: null,
  playing: false,
  timer: null,
  sortCol: "date",
  sortDir: -1,
};

window.addEventListener("DOMContentLoaded", async () => {
  const [hist, fc] = await Promise.all([
    fetch(HIST_URL + "?t=" + Date.now(), { cache: "no-store" }).then(r => r.json()).catch(() => null),
    fetch(FC_URL + "?t=" + Date.now(), { cache: "no-store" }).then(r => r.json()).catch(() => null),
  ]);

  S.hist = hist;
  S.fc = fc;
  const histRows = hist && (Array.isArray(hist.daily_rows) ? hist.daily_rows : hist.rows);
  S.rows = Array.isArray(histRows)
    ? histRows.map(r => Object.assign({}, r, { year: Number(r.year) }))
    : [];
  S.years = (Array.isArray(hist && hist.years)
    ? hist.years.map(Number)
    : Array.from(new Set(S.rows.map(r => r.year)))
  ).sort((a, b) => a - b);
  S.yearOptions = ["overview"].concat(S.years);

  updateHeader();
  renderSignal(fc);

  if (S.rows.length && S.years.length) {
    $("emptyState").hidden = true;
    $("dashboard").hidden = false;
    S.year = "overview";
    initPlayer();
    refreshYear();
    initTable();
  } else {
    $("emptyState").hidden = false;
    $("dashboard").hidden = true;
  }
});

function updateHeader() {
  const fc = S.fc || {};
  const runtime = fc.runtime || {};
  const horizon = fc.max_horizon_bars || (fc.forecasts && fc.forecasts[0] && fc.forecasts[0].horizon_bars) || "--";
  const path = Array.isArray(fc.predicted_price_path) ? fc.predicted_price_path : [];
  $("updatedAt").textContent = fmtTs(fc.generated_at || (S.hist && S.hist.generated_at));
  $("modelLine").textContent = [
    fc.symbol || "BTCUSDT",
    fc.interval || "1h",
    fc.model_version || "v9.4a",
    horizon + "-bar horizon",
    runtime.samples ? runtime.samples + " samples" : null,
  ].filter(Boolean).join(" · ");

  if ($("forecastRange")) {
    const futurePath = path.filter(p => !p.is_anchor);
    $("forecastRange").textContent = futurePath.length
      ? fmtTs(futurePath[0].timestamp) + " → " + fmtTs(futurePath[futurePath.length - 1].timestamp)
      : "--";
  }

  if (runtime.fetched_start_time && runtime.fetched_end_time) {
    $("dataRange").textContent = fmtTs(runtime.fetched_start_time) + " → " + fmtTs(runtime.fetched_end_time);
    return;
  }
  if (runtime.source_data_start_time && runtime.source_data_end_time) {
    $("dataRange").textContent = fmtTs(runtime.source_data_start_time) + " → " + fmtTs(runtime.source_data_end_time);
    return;
  }
  $("dataRange").textContent = "--";
}

function mkEl(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function renderSignal(fc) {
  const wrap = $("signalGrid");
  wrap.innerHTML = "";
  if (!fc || !Array.isArray(fc.forecasts) || !fc.forecasts.length) {
    wrap.innerHTML = "<div class=\"signal-card\"><span class=\"sc-label\">最新訊號</span><span class=\"sc-value\" style=\"font-size:1rem;color:var(--muted)\">尚無預測資料</span></div>";
    return;
  }

  const f = fc.forecasts[0];
  const runtime = fc.runtime || {};
  const h1Eval = fc.evaluation && fc.evaluation.h1 ? fc.evaluation.h1 : null;
  const dir = f.direction === "up" ? "up" : "down";
  const cls = "is-" + dir;
  const probRaw = h1Eval ? Number(h1Eval.direction_accuracy) : Number(f.prob_up);
  const prob = Number.isFinite(probRaw) ? probRaw * 100 : NaN;
  const conf = Number(f.confidence) * 100;
  const gate = Number(f.confidence_gate) * 100;
  const clr = dir === "up" ? "#22c55e" : "#ef4444";
  const dirText = dir === "up" ? "偏多" : "偏空";
  const probLabel = h1Eval ? "H1 方向準確率" : (f.prob_up_source === "sample_path_ratio" ? "樣本上漲比例" : "上漲機率");
  const horizonBars = f.horizon_bars || fc.max_horizon_bars || "--";
  const horizon = horizonBars + " 根 1h K 線";

  const c1 = mkEl("div", "signal-card " + cls);
  c1.innerHTML =
    "<span class=\"sc-label\">" + horizon + " 方向</span>" +
    "<span class=\"sc-value " + cls + "\">" + dirText + "</span>" +
    "<span class=\"sc-sub\">目標時間：" + fmtTs(f.target_time) + "</span>" +
    "<span class=\"badge " + (f.is_actionable ? "badge-on" : "badge-off") + "\">" +
    (f.is_actionable ? "達到訊號門檻" : "低於門檻 " + gate.toFixed(0) + "%") + "</span>";
  wrap.appendChild(c1);

  const c2 = mkEl("div", "signal-card " + cls);
  const cx = 70, cy = 60, rad = 48;
  const arcProb = Math.max(0.001, Math.min(0.999, h1Eval ? probRaw : Number(f.prob_up)));
  const endAngle = Math.PI * (1 - arcProb);
  const arcX = cx + rad * Math.cos(endAngle);
  const arcY = cy - rad * Math.sin(endAngle);
  c2.innerHTML =
    "<span class=\"sc-label\">" + probLabel + "</span>" +
    "<div class=\"gauge-wrap\">" +
    "<svg width=\"140\" height=\"72\" viewBox=\"0 0 140 72\">" +
    "<path d=\"M " + (cx - rad) + " " + cy + " A " + rad + " " + rad + " 0 0 1 " + (cx + rad) + " " + cy + "\" fill=\"none\" stroke=\"#242838\" stroke-width=\"9\" stroke-linecap=\"round\"/>" +
    "<path d=\"M " + (cx - rad) + " " + cy + " A " + rad + " " + rad + " 0 0 1 " + arcX.toFixed(2) + " " + arcY.toFixed(2) + "\" fill=\"none\" stroke=\"" + clr + "\" stroke-width=\"9\" stroke-linecap=\"round\"/>" +
    "<text x=\"" + cx + "\" y=\"" + (cy - 6) + "\" text-anchor=\"middle\" fill=\"" + clr + "\" font-size=\"21\" font-weight=\"900\">" + prob.toFixed(1) + "%</text>" +
    "<text x=\"" + (cx - rad - 2) + "\" y=\"" + (cy + 14) + "\" text-anchor=\"end\" fill=\"#64748b\" font-size=\"9\">0%</text>" +
    "<text x=\"" + (cx + rad + 2) + "\" y=\"" + (cy + 14) + "\" fill=\"#64748b\" font-size=\"9\">100%</text>" +
    "</svg></div>" +
    (h1Eval ? "" : "<span class=\"sc-sub\" style=\"text-align:center\">分歧度 " + conf.toFixed(1) + "%</span>") +
    "<div class=\"conf-track\"><div class=\"conf-fill " + cls + "\" style=\"width:" + Math.min(prob, 100).toFixed(1) + "%\"></div></div>";
  wrap.appendChild(c2);

  const c3 = mkEl("div", "signal-card " + cls);
  c3.innerHTML =
    "<span class=\"sc-label\">情境價格</span>" +
    "<span class=\"sc-value\">" + fmtUSD(f.scenario_price) + "</span>" +
    "<span class=\"sc-sub\">預估報酬 <strong style=\"color:var(--" + dir + ")\">" + fmtPctRaw(f.scenario_return_pct) + "</strong></span>" +
    "<span class=\"sc-sub\">" + (fc.market || "USD-M Futures") + " · " + (fc.interval || "1h") + " · " + (fc.model_version || "v9.4a") + "</span>" +
    "<span class=\"sc-sub\">Sampling: " + (runtime.samples || "--") + " · Temperature: " + fmtNum(runtime.temperature, 2) + "</span>";
  wrap.appendChild(c3);
}

function initPlayer() {
  const sl = $("yearSlider");
  sl.min = "0";
  sl.max = String(S.yearOptions.length - 1);
  sl.value = "0";
  $("lblYear").textContent = yearLabel();
  sl.addEventListener("input", e => {
    stopPlay();
    S.year = S.yearOptions[Number(e.target.value)];
    $("lblYear").textContent = yearLabel();
    refreshYear();
  });
  $("btnPlay").addEventListener("click", () => { S.playing ? stopPlay() : startPlay(); });
}

function startPlay() {
  S.playing = true;
  $("btnPlay").textContent = "暫停";
  S.timer = setInterval(() => {
    const i = S.yearOptions.indexOf(S.year);
    S.year = S.yearOptions[(i + 1) % S.yearOptions.length];
    $("yearSlider").value = String(S.yearOptions.indexOf(S.year));
    $("lblYear").textContent = yearLabel();
    refreshYear();
  }, PLAY_MS);
}

function stopPlay() {
  S.playing = false;
  $("btnPlay").textContent = "播放";
  clearInterval(S.timer);
  S.timer = null;
}

function refreshYear() {
  updateSelectedRange();
  renderKpi();
  renderCharts();
  if ($("tblBody")) drawTable();
}

function yearRows() {
  if (isOverview()) return S.rows.slice();
  return S.rows.filter(r => r.year === S.year);
}

function updateSelectedRange() {
  if (!$("selectedRange")) return;
  const rows = yearRows();
  $("selectedRange").textContent = rows.length
    ? rows[0].date + " → " + rows[rows.length - 1].date
    : "--";
}

function meta(y) {
  if (y === "overview" || (y == null && isOverview())) return overviewMeta();
  const key = String(y != null ? y : S.year);
  return (S.hist && S.hist.annual_metrics && S.hist.annual_metrics[key]) || {};
}

function isOverview() {
  return S.year === "overview";
}

function yearLabel() {
  return isOverview() ? "總覽" : String(S.year);
}

function latestYear() {
  return S.years[S.years.length - 1];
}

function shouldShowForecastOverlay() {
  return isOverview() || S.year === latestYear();
}

function overviewMeta() {
  const rows = S.rows;
  if (!rows.length) return {};
  const vols = rows.map(r => Number(r.daily_volatility)).filter(Number.isFinite);
  const startClose = Number(rows[0].close);
  const endClose = Number(rows[rows.length - 1].close);
  return {
    year: "overview",
    highest_price: Math.max(...rows.map(r => Number(r.high)).filter(Number.isFinite)),
    lowest_price: Math.min(...rows.map(r => Number(r.low)).filter(Number.isFinite)),
    total_volume: rows.reduce((sum, r) => sum + (Number(r.volume) || 0), 0),
    highest_volatility: vols.length ? Math.max(...vols) : null,
    lowest_volatility: vols.length ? Math.min(...vols) : null,
    cagr: Number.isFinite(startClose) && startClose > 0 && Number.isFinite(endClose) ? endClose / startClose - 1 : null,
    start_close: startClose,
    end_close: endClose,
    rows: rows.length,
  };
}

function renderKpi() {
  const m = meta();
  const cagr = m.cagr;
  const period = yearLabel();
  const kpis = [
    { label: isOverview() ? "六年最高價" : "年度最高價", val: fmtUSD(m.highest_price), sub: period + " 高點" },
    { label: isOverview() ? "六年最低價" : "年度最低價", val: fmtUSD(m.lowest_price), sub: period + " 低點" },
    { label: isOverview() ? "六年總報酬" : "年度 CAGR", val: fmtPct(cagr), sub: isOverview() ? "完整期間報酬" : "複合年化報酬", cls: cagr >= 0 ? "is-up" : "is-down" },
    { label: isOverview() ? "六年成交量" : "年度成交量", val: fmtCompact(m.total_volume), sub: "合計成交量" },
    { label: "最高日波動", val: fmtPct1(m.highest_volatility), sub: period + " 最大值" },
    { label: "最低日波動", val: fmtPct1(m.lowest_volatility), sub: period + " 最小值" },
  ];
  $("kpiGrid").innerHTML = kpis.map(k =>
    "<div class=\"kpi-card\"><span class=\"kpi-label\">" + k.label + "</span>" +
    "<span class=\"kpi-value" + (k.cls ? " " + k.cls : "") + "\">" + k.val + "</span>" +
    "<span class=\"kpi-sub\">" + k.sub + "</span></div>"
  ).join("");
}

function forecastPath() {
  return (S.fc && Array.isArray(S.fc.predicted_price_path))
    ? S.fc.predicted_price_path.filter(p => p && Number.isFinite(Number(p.price)) && p.timestamp)
    : [];
}

function renderCharts() {
  const rows = yearRows();
  const dates = rows.map(r => r.date);
  const last = dates.length ? dates[dates.length - 1] : undefined;
  const path = shouldShowForecastOverlay() ? forecastPath() : [];
  const candlePath = forecastPath();
  const pathX = path.map(p => plotTs(p.timestamp));
  const fcColor = S.fc && S.fc.forecasts && S.fc.forecasts[0] && S.fc.forecasts[0].direction === "down" ? "#ef4444" : "#22c55e";

  const priceTraces = [
    { type: "scatter", mode: "lines", x: dates, y: rows.map(r => r.close),
      name: "歷史收盤價", line: { color: "#f7931a", width: 2 },
      fill: "tozeroy", fillcolor: "rgba(247,147,26,.05)",
      hovertemplate: "%{x}<br>收盤價 %{y:$,.0f}<extra></extra>" },
    { type: "scatter", mode: "lines", x: dates, y: rows.map(r => r.trend_ma_proxy),
      name: "48-Bar 均線", line: { color: "#60a5fa", width: 1.6, dash: "dot" },
      hovertemplate: "%{x}<br>48MA %{y:$,.0f}<extra></extra>" },
  ];

  if (path.length >= 2) {
    priceTraces.push(
      { type: "scatter", mode: "lines", x: pathX, y: path.map(p => Number(p.atr_2x_upper)),
        name: "外側區間上緣", line: { color: "rgba(148,163,184,.2)", width: 0 }, hoverinfo: "skip", showlegend: false },
      { type: "scatter", mode: "lines", x: pathX, y: path.map(p => Number(p.atr_2x_lower)),
        name: "外側區間", line: { color: "rgba(148,163,184,.2)", width: 0 }, fill: "tonexty",
        fillcolor: "rgba(148,163,184,.09)", hoverinfo: "skip" },
      { type: "scatter", mode: "lines", x: pathX, y: path.map(p => Number(p.atr_1x_upper)),
        name: "抽樣 IQR 上緣", line: { color: "rgba(96,165,250,.25)", width: 0 }, hoverinfo: "skip", showlegend: false },
      { type: "scatter", mode: "lines", x: pathX, y: path.map(p => Number(p.atr_1x_lower)),
        name: "抽樣 IQR", line: { color: "rgba(96,165,250,.25)", width: 0 }, fill: "tonexty",
        fillcolor: "rgba(96,165,250,.14)", hoverinfo: "skip" },
      { type: "scatter", mode: "lines+markers", x: pathX, y: path.map(p => Number(p.price)),
        name: "v9.4A 預測 close", line: { color: fcColor, width: 2.4, dash: "dash" },
        marker: { size: 4, color: fcColor }, hovertemplate: "%{x}<br>預測 close %{y:$,.0f}<extra></extra>" }
    );
  }

  if (dates.length >= 2) {
    const forecastEnd = path.length ? fmtTs(path[path.length - 1].timestamp) : last;
    $("priceDateRange").textContent = isOverview()
      ? dates[0] + " → " + forecastEnd
      : dates[0] + " → " + last;
  }

  Plotly.react("chartPrice", priceTraces, Object.assign({}, BASE, {
    yaxis: Object.assign({}, BASE.yaxis, { tickprefix: "$", tickformat: ",.0f" })
  }), CFG);

  renderCandles(candlePath);

  Plotly.react("chartMayer", [
    { type: "scatter", mode: "lines", x: dates, y: rows.map(r => r.mayer_multiple),
      name: "Mayer Multiple", line: { color: "#a78bfa", width: 2 },
      hovertemplate: "%{x}<br>Mayer %{y:.3f}<extra></extra>" },
    { type: "scatter", mode: "lines", x: [dates[0], last], y: [1, 1],
      name: "基準 1.0", line: { color: "#f59e0b", dash: "dash", width: 1 }, hoverinfo: "skip" },
  ], BASE, CFG);

  Plotly.react("chartVol", [
    { type: "scatter", mode: "lines", x: dates, y: rows.map(r => r.daily_volatility),
      name: "日波動", line: { color: "#f43f5e", width: 1.8 },
      hovertemplate: "%{x}<br>日波動 %{y:.3%}<extra></extra>" },
    { type: "scatter", mode: "lines", x: dates, y: rows.map(r => r.volatility_32bar),
      name: "32-Bar 波動", line: { color: "#fb923c", dash: "dot", width: 1.4 },
      hovertemplate: "%{x}<br>32B 波動 %{y:.3%}<extra></extra>" },
  ], Object.assign({}, BASE, { yaxis: Object.assign({}, BASE.yaxis, { tickformat: ".1%" }) }), CFG);

  const allCagr = S.years.map(y => {
    const c = meta(y).cagr;
    return c != null ? c : null;
  });
  const cagrValues = allCagr.filter(v => Number.isFinite(Number(v))).map(Number);
  const cagrMax = cagrValues.length ? Math.max(0, ...cagrValues) : 1;
  const cagrMin = cagrValues.length ? Math.min(0, ...cagrValues) : 0;
  const cagrPad = Math.max(0.12, (cagrMax - cagrMin) * 0.16);
  const barColors = S.years.map(y => isOverview() || y === S.year ? "#f7931a" : "#334155");
  const cagrLabelY = allCagr.map(v => {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return n >= 0 ? n + cagrPad * 0.18 : cagrPad * 0.18;
  });
  Plotly.react("chartCagr", [
    { type: "bar", x: S.years.map(String), y: allCagr, marker: { color: barColors },
      hovertemplate: "%{x}<br>CAGR %{y:.1%}<extra></extra>" },
    { type: "scatter", mode: "text", x: S.years.map(String), y: cagrLabelY,
      text: allCagr.map(v => v == null ? "" : (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%"),
      textfont: { size: 11, color: "#94a3b8" },
      hoverinfo: "skip",
      cliponaxis: false,
      showlegend: false },
  ], Object.assign({}, BASE, {
    showlegend: false,
    margin: Object.assign({}, BASE.margin, { t: 42, b: 54 }),
    yaxis: Object.assign({}, BASE.yaxis, {
      tickformat: ".0%",
      range: [cagrMin - cagrPad, cagrMax + cagrPad],
      zeroline: true,
      zerolinecolor: "#334155"
    }),
    uniformtext: { minsize: 10, mode: "show" }
  }), CFG);
}

function renderCandles(path) {
  const candles = path.filter(p => !p.is_anchor && Number.isFinite(Number(p.open)) && Number.isFinite(Number(p.high)) && Number.isFinite(Number(p.low)));
  if (!candles.length) {
    Plotly.react("chartCandles", [], BASE, CFG);
    return;
  }
  const candleRows = candles.map(p => {
    const open = Number(p.open);
    const close = Number(p.price);
    const highRaw = Number(p.high);
    const lowRaw = Number(p.low);
    return {
      x: plotTs(p.timestamp),
      open,
      close,
      high: Math.max(highRaw, open, close),
      low: Math.min(lowRaw, open, close),
    };
  });
  Plotly.react("chartCandles", [
    {
      type: "candlestick",
      x: candleRows.map(p => p.x),
      open: candleRows.map(p => p.open),
      high: candleRows.map(p => p.high),
      low: candleRows.map(p => p.low),
      close: candleRows.map(p => p.close),
      increasing: { line: { color: "#22c55e" }, fillcolor: "rgba(34,197,94,.55)" },
      decreasing: { line: { color: "#ef4444" }, fillcolor: "rgba(239,68,68,.55)" },
      name: "預測 K 線",
      hovertemplate: "%{x}<br>O %{open:$,.0f}<br>H %{high:$,.0f}<br>L %{low:$,.0f}<br>C %{close:$,.0f}<extra></extra>",
    }
  ], Object.assign({}, BASE, {
    xaxis: Object.assign({}, BASE.xaxis, {
      rangeslider: { visible: false },
      showticklabels: false,
      ticks: "",
    }),
    yaxis: Object.assign({}, BASE.yaxis, { tickprefix: "$", tickformat: ",.0f" }),
    showlegend: false,
  }), CFG);
}

function initTable() {
  document.querySelectorAll("thead th[data-col]").forEach(th => {
    th.addEventListener("click", () => {
      const col = th.dataset.col;
      if (S.sortCol === col) S.sortDir *= -1;
      else { S.sortCol = col; S.sortDir = -1; }
      document.querySelectorAll("thead th").forEach(t => t.classList.remove("asc", "desc"));
      th.classList.add(S.sortDir === 1 ? "asc" : "desc");
      drawTable();
    });
  });
  $("btnCsv").addEventListener("click", exportCsv);
  drawTable();
}

function drawTable() {
  const rows = yearRows();
  if (S.sortCol) {
    rows.sort((a, b) => {
      const av = a[S.sortCol], bv = b[S.sortCol];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av < bv ? -1 : av > bv ? 1 : 0) * S.sortDir;
    });
  }
  $("tblBody").innerHTML = rows.map(r => {
    const ret = r.daily_return;
    const retCls = ret > 0 ? "cu" : ret < 0 ? "cd" : "";
    return "<tr>" +
      "<td>" + r.date + "</td>" +
      "<td style=\"text-align:right\">" + r.year + "</td>" +
      "<td>" + fmtUSD(r.close) + "</td>" +
      "<td>" + fmtCompact(r.volume) + "</td>" +
      "<td>" + fmtNum(r.mayer_multiple) + "</td>" +
      "<td class=\"" + retCls + "\">" + (ret != null ? fmtPct(ret) : "--") + "</td>" +
      "<td>" + fmtPct1(r.daily_volatility) + "</td>" +
      "<td>" + fmtPct1(r.volatility_32bar) + "</td>" +
      "</tr>";
  }).join("");
}

function exportCsv() {
  const cols = ["date", "year", "close", "volume", "mayer_multiple", "daily_return", "daily_volatility", "volatility_32bar"];
  const lines = [cols.join(",")].concat(yearRows().map(r =>
    cols.map(k => "\"" + String(r[k] != null ? r[k] : "").replace(/"/g, "\"\"") + "\"").join(",")
  ));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }));
  a.download = "btc_history_" + yearLabel() + "_" + new Date().toISOString().slice(0, 10) + ".csv";
  a.click();
  URL.revokeObjectURL(a.href);
}
