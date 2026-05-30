/* ──────────────────────────────────────────────────────────
   BTC Transformer Dashboard  app.js
   只使用 latest_forecast.json 和 dashboard_history.json 內實際存在的欄位。
────────────────────────────────────────────────────────── */
"use strict";

const HIST_URL = "./data/dashboard_history.json";
const FC_URL   = "./data/latest_forecast.json";
const PLAY_MS  = 1400;

const $ = id => document.getElementById(id);

function fmtUSD(v) {
  const n = +v;
  return Number.isFinite(n)
    ? new Intl.NumberFormat("en-US", { style:"currency", currency:"USD", maximumFractionDigits:0 }).format(n)
    : "—";
}
function fmtPct(v, plus = true) {
  const n = +v;
  if (!Number.isFinite(n)) return "—";
  const s = (n * 100).toFixed(2) + "%";
  return plus && n > 0 ? "+" + s : s;
}
function fmtPct1(v) {
  const n = +v;
  return Number.isFinite(n) ? (n * 100).toFixed(3) + "%" : "—";
}
function fmtNum(v, d = 3) {
  const n = +v;
  return Number.isFinite(n) ? n.toFixed(d) : "—";
}
function fmtCompact(v) {
  const n = +v;
  return Number.isFinite(n)
    ? new Intl.NumberFormat("zh-TW", { notation:"compact", maximumFractionDigits:2 }).format(n)
    : "—";
}
function fmtTs(v) {
  try { return new Date(v).toLocaleString("zh-TW", { hour12:false }); } catch(e) { return "—"; }
}

const BASE = {
  paper_bgcolor: "rgba(0,0,0,0)",
  plot_bgcolor:  "rgba(0,0,0,0)",
  font:   { color:"#94a3b8", family:"Microsoft JhengHei,system-ui,sans-serif", size:12 },
  margin: { t:10, r:16, b:40, l:62 },
  hovermode: "x unified",
  legend: { bgcolor:"rgba(0,0,0,0)", font:{ color:"#94a3b8" }, orientation:"h", y:-0.22 },
  xaxis:  { gridcolor:"#242838", linecolor:"#242838", zerolinecolor:"#242838" },
  yaxis:  { gridcolor:"#242838", linecolor:"#242838", zerolinecolor:"#242838" },
};
const CFG = { responsive:true, displaylogo:false, displayModeBar:false };

const S = {
  hist: null, fc: null,
  rows: [], years: [], year: null,
  playing: false, timer: null,
  sortCol: "date", sortDir: -1,
};

window.addEventListener("DOMContentLoaded", async () => {
  const [hist, fc] = await Promise.all([
    fetch(HIST_URL + "?t=" + Date.now(), { cache:"no-store" }).then(r => r.json()).catch(() => null),
    fetch(FC_URL   + "?t=" + Date.now(), { cache:"no-store" }).then(r => r.json()).catch(() => null),
  ]);
  S.hist  = hist;
  S.fc    = fc;
  S.rows  = Array.isArray(hist && hist.daily_rows)
    ? hist.daily_rows.map(r => Object.assign({}, r, { year: +r.year }))
    : [];
  S.years = (Array.isArray(hist && hist.years)
    ? hist.years.map(Number)
    : Array.from(new Set(S.rows.map(r => r.year)))
  ).sort((a, b) => a - b);

  $("updatedAt").textContent = fmtTs((fc && fc.generated_at) || (hist && hist.generated_at));

  if (S.rows.length >= 2) {
    $("dataRange").textContent = S.rows[0].date + " → " + S.rows[S.rows.length - 1].date;
  } else if (S.rows.length === 1) {
    $("dataRange").textContent = S.rows[0].date;
  }

  renderSignal(fc);

  if (S.rows.length && S.years.length) {
    $("emptyState").hidden = true;
    $("dashboard").hidden  = false;
    S.year = S.years[S.years.length - 1];
    initPlayer();
    refreshYear();
    initTable();
  } else {
    $("emptyState").hidden = false;
    $("dashboard").hidden  = true;
  }
});

function mkEl(tag, cls) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function renderSignal(fc) {
  var wrap = $("signalGrid");
  wrap.innerHTML = "";

  if (!fc || !fc.forecasts || !fc.forecasts.length) {
    wrap.innerHTML = "<div class=\"signal-card\"><span class=\"sc-label\">信號</span><span class=\"sc-value\" style=\"font-size:1rem;color:var(--muted)\">尚無推論資料</span></div>";
    return;
  }

  var f    = fc.forecasts[0];
  var dir  = f.direction === "up" ? "up" : "down";
  var cls  = "is-" + dir;
  var prob = f.prob_up * 100;
  var conf = f.confidence * 100;
  var gate = f.confidence_gate * 100;
  var clr  = dir === "up" ? "#22c55e" : "#ef4444";

  var c1 = mkEl("div", "signal-card " + cls);
  c1.innerHTML =
    "<span class=\"sc-label\">32-Bar 方向預測</span>" +
    "<span class=\"sc-value " + cls + "\">" + (dir === "up" ? "看漲 ▲" : "看跨 ▼") + "</span>" +
    "<span class=\"sc-sub\">目標：" + fmtTs(f.target_time) + "</span>" +
    "<span class=\"badge " + (f.is_actionable ? "badge-on" : "badge-off") + "\">" +
    (f.is_actionable ? "✓ 可操作信號" : "信心未達 " + gate.toFixed(0) + "%") + "</span>";
  wrap.appendChild(c1);

  var c2 = mkEl("div", "signal-card " + cls);
  var cx = 70, cy = 60, rad = 48;
  var endAngle = Math.PI * f.prob_up;
  var arcX = cx - rad * Math.cos(endAngle);
  var arcY = cy - rad * Math.sin(endAngle);
  var la = endAngle > Math.PI / 2 ? 1 : 0;
  c2.innerHTML =
    "<span class=\"sc-label\">看漲機率</span>" +
    "<div class=\"gauge-wrap\">" +
    "<svg width=\"140\" height=\"72\" viewBox=\"0 0 140 72\">" +
    "<path d=\"M " + (cx - rad) + " " + cy + " A " + rad + " " + rad + " 0 0 1 " + (cx + rad) + " " + cy + "\" fill=\"none\" stroke=\"#242838\" stroke-width=\"9\" stroke-linecap=\"round\"/>" +
    "<path d=\"M " + (cx - rad) + " " + cy + " A " + rad + " " + rad + " 0 " + la + " 1 " + arcX.toFixed(2) + " " + arcY.toFixed(2) + "\" fill=\"none\" stroke=\"" + clr + "\" stroke-width=\"9\" stroke-linecap=\"round\"/>" +
    "<text x=\"" + cx + "\" y=\"" + (cy - 6) + "\" text-anchor=\"middle\" fill=\"" + clr + "\" font-size=\"21\" font-weight=\"900\">" + prob.toFixed(1) + "%</text>" +
    "<text x=\"" + (cx - rad - 2) + "\" y=\"" + (cy + 14) + "\" text-anchor=\"end\" fill=\"#64748b\" font-size=\"9\">50%</text>" +
    "<text x=\"" + (cx + rad + 2) + "\" y=\"" + (cy + 14) + "\" fill=\"#64748b\" font-size=\"9\">100%</text>" +
    "</svg></div>" +
    "<span class=\"sc-sub\" style=\"text-align:center\">信心 " + conf.toFixed(1) + "% / 閥値 " + gate.toFixed(0) + "%</span>" +
    "<div class=\"conf-track\"><div class=\"conf-fill " + cls + "\" style=\"width:" + Math.min(conf, 100).toFixed(1) + "%\"></div></div>";
  wrap.appendChild(c2);

  var c3 = mkEl("div", "signal-card " + cls);
  var ret = f.scenario_return_pct;
  var retStr = Number.isFinite(ret) ? ((ret >= 0 ? "+" : "") + ret.toFixed(2) + "%") : "—";
  c3.innerHTML =
    "<span class=\"sc-label\">情境目標價（32h後）</span>" +
    "<span class=\"sc-value\">" + fmtUSD(f.scenario_price) + "</span>" +
    "<span class=\"sc-sub\">情境報酬&ensp;<strong style=\"color:var(--" + dir + ")\">" + retStr + "</strong></span>" +
    "<span class=\"sc-sub\" style=\"margin-top:4px\">" + fc.symbol + " · " + fc.market + " · " + fc.interval + "</span>";
  wrap.appendChild(c3);
}

function initPlayer() {
  var sl = $("yearSlider");
  sl.min   = "0";
  sl.max   = String(S.years.length - 1);
  sl.value = String(S.years.length - 1);
  $("lblYear").textContent = S.year;
  sl.addEventListener("input", function(e) {
    stopPlay();
    S.year = S.years[+e.target.value];
    $("lblYear").textContent = S.year;
    refreshYear();
  });
  $("btnPlay").addEventListener("click", function() { S.playing ? stopPlay() : startPlay(); });
}

function startPlay() {
  S.playing = true;
  $("btnPlay").textContent = "暫停";
  S.timer = setInterval(function() {
    var i = S.years.indexOf(S.year);
    S.year = S.years[(i + 1) % S.years.length];
    $("yearSlider").value    = String(S.years.indexOf(S.year));
    $("lblYear").textContent = S.year;
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
  renderKpi();
  renderCharts();
}

function yearRows() {
  return S.rows.filter(function(r) { return r.year === S.year; });
}

function meta(y) {
  var key = String(y != null ? y : S.year);
  return (S.hist && S.hist.annual_metrics && S.hist.annual_metrics[key]) || {};
}

function renderKpi() {
  var m    = meta();
  var cagr = m.cagr;
  var kpis = [
    { label:"年度最高價", val:fmtUSD(m.highest_price),       sub:S.year + " 高點" },
    { label:"年度最低價", val:fmtUSD(m.lowest_price),        sub:S.year + " 低點" },
    { label:"年化成長率", val:fmtPct(cagr),                   sub:"CAGR", cls: cagr >= 0 ? "is-up" : "is-down" },
    { label:"年度總量",       val:fmtCompact(m.total_volume),     sub:"累計成交量" },
    { label:"最高日波動", val:fmtPct1(m.highest_volatility), sub:"單日波動高點" },
    { label:"最低日波動", val:fmtPct1(m.lowest_volatility),  sub:"單日波動低點" },
  ];
  $("kpiGrid").innerHTML = kpis.map(function(k) {
    return "<div class=\"kpi-card\"><span class=\"kpi-label\">" + k.label + "</span>" +
      "<span class=\"kpi-value" + (k.cls ? " " + k.cls : "") + "\">" + k.val + "</span>" +
      "<span class=\"kpi-sub\">" + k.sub + "</span></div>";
  }).join("");
}

function renderCharts() {
  var rows  = yearRows();
  var dates = rows.map(function(r) { return r.date; });
  var last  = dates.length ? dates[dates.length - 1] : dates[0];

  if (dates.length >= 2) {
    $("priceDateRange").textContent = dates[0] + " → " + last;
  }

  Plotly.react("chartPrice", [
    { type:"scatter", mode:"lines", x:dates, y:rows.map(function(r){ return r.close; }),
      name:"收盤價", line:{ color:"#f7931a", width:2 },
      fill:"tozeroy", fillcolor:"rgba(247,147,26,.05)",
      hovertemplate:"%{x}<br>收盤 %{y:$,.0f}<extra></extra>" },
    { type:"scatter", mode:"lines", x:dates, y:rows.map(function(r){ return r.trend_ma_proxy; }),
      name:"48-Bar 均線", line:{ color:"#60a5fa", width:1.6, dash:"dot" },
      hovertemplate:"%{x}<br>48MA %{y:$,.0f}<extra></extra>" },
  ], Object.assign({}, BASE, { yaxis: Object.assign({}, BASE.yaxis, { tickprefix:"$", tickformat:",.0f" }) }), CFG);

  Plotly.react("chartMayer", [
    { type:"scatter", mode:"lines", x:dates, y:rows.map(function(r){ return r.mayer_multiple; }),
      name:"Mayer Multiple", line:{ color:"#a78bfa", width:2 },
      hovertemplate:"%{x}<br>Mayer %{y:.3f}<extra></extra>" },
    { type:"scatter", mode:"lines", x:[dates[0], last], y:[1, 1],
      name:"基準 1.0", line:{ color:"#f59e0b", dash:"dash", width:1 }, hoverinfo:"skip" },
  ], BASE, CFG);

  Plotly.react("chartVol", [
    { type:"scatter", mode:"lines", x:dates, y:rows.map(function(r){ return r.daily_volatility; }),
      name:"日波動率", line:{ color:"#f43f5e", width:1.8 },
      hovertemplate:"%{x}<br>日波動 %{y:.3%}<extra></extra>" },
    { type:"scatter", mode:"lines", x:dates, y:rows.map(function(r){ return r.volatility_32bar; }),
      name:"32-Bar 波動率", line:{ color:"#fb923c", dash:"dot", width:1.4 },
      hovertemplate:"%{x}<br>32B波動 %{y:.3%}<extra></extra>" },
  ], Object.assign({}, BASE, { yaxis: Object.assign({}, BASE.yaxis, { tickformat:".1%" }) }), CFG);

  var allCagr   = S.years.map(function(y) { var c = meta(y).cagr; return c != null ? c : null; });
  var barColors = S.years.map(function(y) { return y === S.year ? "#f7931a" : "#334155"; });
  Plotly.react("chartCagr", [
    { type:"bar", x:S.years.map(String), y:allCagr, marker:{ color:barColors },
      text:allCagr.map(function(v){ return v == null ? "" : (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%"; }),
      textposition:"outside", cliponaxis:false,
      hovertemplate:"%{x}<br>CAGR %{y:.1%}<extra></extra>" },
  ], Object.assign({}, BASE, { showlegend:false, margin:Object.assign({}, BASE.margin, { t:24 }),
    yaxis:Object.assign({}, BASE.yaxis, { tickformat:".0%" }) }), CFG);
}

function initTable() {
  document.querySelectorAll("thead th[data-col]").forEach(function(th) {
    th.addEventListener("click", function() {
      var col = th.dataset.col;
      if (S.sortCol === col) S.sortDir *= -1;
      else { S.sortCol = col; S.sortDir = -1; }
      document.querySelectorAll("thead th").forEach(function(t) { t.classList.remove("asc","desc"); });
      th.classList.add(S.sortDir === 1 ? "asc" : "desc");
      drawTable();
    });
  });
  $("btnCsv").addEventListener("click", exportCsv);
  drawTable();
}

function drawTable() {
  var rows = S.rows.slice();
  if (S.sortCol) {
    rows.sort(function(a, b) {
      var av = a[S.sortCol], bv = b[S.sortCol];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av < bv ? -1 : av > bv ? 1 : 0) * S.sortDir;
    });
  }
  $("tblBody").innerHTML = rows.map(function(r) {
    var ret    = r.daily_return;
    var retCls = ret > 0 ? "cu" : ret < 0 ? "cd" : "";
    return "<tr>" +
      "<td>" + r.date + "</td>" +
      "<td style=\"text-align:right\">" + r.year + "</td>" +
      "<td>" + fmtUSD(r.close) + "</td>" +
      "<td>" + fmtCompact(r.volume) + "</td>" +
      "<td>" + fmtNum(r.mayer_multiple) + "</td>" +
      "<td class=\"" + retCls + "\">" + (ret != null ? fmtPct(ret) : "—") + "</td>" +
      "<td>" + fmtPct1(r.daily_volatility) + "</td>" +
      "<td>" + fmtPct1(r.volatility_32bar) + "</td>" +
      "</tr>";
  }).join("");
}

function exportCsv() {
  var cols  = ["date","year","close","volume","mayer_multiple","daily_return","daily_volatility","volatility_32bar"];
  var lines = [cols.join(",")].concat(S.rows.map(function(r) {
    return cols.map(function(k) { return "\"" + String(r[k] != null ? r[k] : "").replace(/"/g, "\"\"") + "\""; }).join(",");
  }));
  var a = document.createElement("a");
  a.href     = URL.createObjectURL(new Blob([lines.join("\n")], { type:"text/csv;charset=utf-8" }));
  a.download = "btc_history_" + new Date().toISOString().slice(0,10) + ".csv";
  a.click();
  URL.revokeObjectURL(a.href);
}
