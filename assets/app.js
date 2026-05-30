/* ──────────────────────────────────────────────────────────
   BTC Transformer Dashboard  ·  app.js
   只使用 latest_forecast.json 和 dashboard_history.json
   內實際存在的欄位。
────────────────────────────────────────────────────────── */
"use strict";

const HIST_URL = "./data/dashboard_history.json";
const FC_URL   = "./data/latest_forecast.json";
const PLAY_MS  = 1400;

/* ── 格式工具 ──────────────────────────────────────────── */
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
  try { return new Date(v).toLocaleString("zh-TW", { hour12:false }); } catch { return "—"; }
}

/* ── Plotly 暗色佈局基礎 ───────────────────────────────── */
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

/* ── State ─────────────────────────────────────────────── */
const S = {
  hist: null, fc: null,
  rows: [], years: [], year: null,
  playing: false, timer: null,
  sortCol: "date", sortDir: -1,
};

/* ── 啟動 ──────────────────────────────────────────────── */
window.addEventListener("DOMContentLoaded", async () => {
  const [hist, fc] = await Promise.all([
    fetch(`${HIST_URL}?t=${Date.now()}`, { cache:"no-store" }).then(r => r.json()).catch(() => null),
    fetch(`${FC_URL}?t=${Date.now()}`,   { cache:"no-store" }).then(r => r.json()).catch(() => null),
  ]);
  S.hist  = hist;
  S.fc    = fc;
  S.rows  = Array.isArray(hist?.daily_rows)
    ? hist.daily_rows.map(r => ({ ...r, year: +r.year }))
    : [];
  S.years = (Array.isArray(hist?.years)
    ? hist.years.map(Number)
    : [...new Set(S.rows.map(r => r.year))]
  ).sort((a, b) => a - b);

  // 頂部 meta
  $("updatedAt").textContent = fmtTs(fc?.generated_at ?? hist?.generated_at);

  // data range — 直接取 daily_rows 的真實頭尾日期
  if (S.rows.length >= 2) {
    $("dataRange").textContent = `${S.rows[0].date} → ${S.rows.at(-1).date}`;
  } else if (S.rows.length === 1) {
    $("dataRange").textContent = S.rows[0].date;
  }

  renderSignal(fc);

  if (S.rows.length && S.years.length) {
    $("emptyState").hidden = true;
    $("dashboard").hidden  = false;
    S.year = S.years.at(-1);
    initPlayer();
    refreshYear();
    initTable();
  } else {
    $("emptyState").hidden = false;
    $("dashboard").hidden  = true;
  }
});

/* ────────────────────────────────────────────────────────
   AI 信號區
──────────────────────────────────────────────────────── */
function renderSignal(fc) {
  const wrap = $("signalGrid");
  wrap.innerHTML = "";

  if (!fc?.forecasts?.length) {
    wrap.innerHTML = `<div class="signal-card"><span class="sc-label">信號</span>
      <span class="sc-value" style="font-size:1rem;color:var(--muted)">尚無推論資料</span></div>`;
    return;
  }

  const f    = fc.forecasts[0];
  const dir  = f.direction === "up" ? "up" : "down";
  const cls  = `is-${dir}`;
  const prob = f.prob_up * 100;
  const conf = f.confidence * 100;
  const gate = f.confidence_gate * 100;
  const clr  = dir === "up" ? "#22c55e" : "#ef4444";

  /* --- Card 1: 方向 --- */
  const c1 = el("div", `signal-card ${cls}`);
  c1.innerHTML = `
    <span class="sc-label">32-Bar 方向預測</span>
    <span class="sc-value ${cls}">${dir === "up" ? "看漲 ▲" : "看跌 ▼"}</span>
    <span class="sc-sub">目標：${fmtTs(f.target_time)}</span>
    <span class="badge ${f.is_actionable ? "badge-on" : "badge-off"}">
      ${f.is_actionable ? "✓ 可操作信號" : `信心未達 ${gate.toFixed(0)}%`}</span>`;
  wrap.appendChild(c1);

  /* --- Card 2: 機率量表 --- */
  const c2  = el("div", `signal-card ${cls}`);
  const cx = 70, cy = 60, r = 48;
  // 半圓弧：prob_up=0.5→左端(π)，1.0→右端(0)
  const endAngle = Math.PI * (1 - f.prob_up); // 從左→右
  const arcX = cx + r * Math.cos(endAngle);
  const arcY = cy - r * Math.sin(endAngle);
  const la   = f.prob_up > 0.5 ? 1 : 0;
  c2.innerHTML = `
    <span class="sc-label">看漲機率</span>
    <div class="gauge-wrap">
      <svg width="140" height="72" viewBox="0 0 140 72">
        <path d="M ${cx-r} ${cy} A ${r} ${r} 0 0 1 ${cx+r} ${cy}"
              fill="none" stroke="#242838" stroke-width="9" stroke-linecap="round"/>
        <path d="M ${cx-r} ${cy} A ${r} ${r} 0 ${la} 1 ${arcX} ${arcY}"
              fill="none" stroke="${clr}" stroke-width="9" stroke-linecap="round"/>
        <text x="${cx}" y="${cy - 6}" text-anchor="middle"
              fill="${clr}" font-size="21" font-weight="900">${prob.toFixed(1)}%</text>
        <text x="${cx - r - 2}" y="${cy + 14}" text-anchor="end" fill="#64748b" font-size="9">50%</text>
        <text x="${cx + r + 2}" y="${cy + 14}" fill="#64748b" font-size="9">100%</text>
      </svg>
    </div>
    <span class="sc-sub" style="text-align:center">信心 ${conf.toFixed(1)}% ／ 閾值 ${gate.toFixed(0)}%</span>
    <div class="conf-track"><div class="conf-fill ${cls}" style="width:${Math.min(conf,100).toFixed(1)}%"></div></div>`;
  wrap.appendChild(c2);

  /* --- Card 3: 情境目標價 --- */
  const c3  = el("div", `signal-card ${cls}`);
  const ret = f.scenario_return_pct;
  c3.innerHTML = `
    <span class="sc-label">情境目標價（32h後）</span>
    <span class="sc-value">${fmtUSD(f.scenario_price)}</span>
    <span class="sc-sub">情境報酬&ensp;
      <strong style="color:var(--${dir})">${Number.isFinite(ret) ? (ret >= 0 ? "+" : "") + ret.toFixed(2) + "%" : "—"}</strong>
    </span>
    <span class="sc-sub" style="margin-top:4px">${fc.symbol} · ${fc.market} · ${fc.interval}</span>`;
  wrap.appendChild(c3);
}

function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

/* ────────────────────────────────────────────────────────
   年度播放器
──────────────────────────────────────────────────────── */
function initPlayer() {
  const sl = $("yearSlider");
  sl.min   = "0";
  sl.max   = String(S.years.length - 1);
  sl.value = String(S.years.length - 1);
  $("lblYear").textContent = S.year;

  sl.addEventListener("input", e => {
    stopPlay();
    S.year = S.years[+e.target.value];
    $("lblYear").textContent = S.year;
    refreshYear();
  });
  $("btnPlay").addEventListener("click", () => S.playing ? stopPlay() : startPlay());
}

function startPlay() {
  S.playing = true;
  $("btnPlay").textContent = "暫停";
  S.timer = setInterval(() => {
    const i = S.years.indexOf(S.year);
    S.year  = S.years[(i + 1) % S.years.length];
    $("yearSlider").value    = String(S.years.indexOf(S.year));
    $("lblYear").textContent = S.year;
    refreshYear();
  }, PLAY_MS);
}
function stopPlay() {
  S.playing = false;
  $("btnPlay").textContent = "播放";
  clearInterval(S.timer); S.timer = null;
}

/* ────────────────────────────────────────────────────────
   年度刷新
──────────────────────────────────────────────────────── */
function refreshYear() {
  renderKpi();
  renderCharts();
}

function yearRows() { return S.rows.filter(r => r.year === S.year); }
function meta(y)    { return S.hist?.annual_metrics?.[String(y ?? S.year)] ?? {}; }

/* ── KPI ───────────────────────────────────────────────── */
function renderKpi() {
  const m   = meta();
  const cagr = m.cagr;
  const kpis = [
    { label:"年度最高價",  val: fmtUSD(m.highest_price),    sub: `${S.year} 高點` },
    { label:"年度最低價",  val: fmtUSD(m.lowest_price),     sub: `${S.year} 低點` },
    { label:"年化成長率",  val: fmtPct(cagr),               sub: "CAGR",    cls: cagr >= 0 ? "is-up" : "is-down" },
    { label:"年度成交量",  val: fmtCompact(m.total_volume), sub: "累計" },
    { label:"最高日波動",  val: fmtPct1(m.highest_volatility), sub: "單日最大波動率" },
    { label:"最低日波動",  val: fmtPct1(m.lowest_volatility),  sub: "單日最小波動率" },
  ];
  $("kpiGrid").innerHTML = kpis.map(k =>
    `<div class="kpi-card">
       <span class="kpi-label">${k.label}</span>
       <span class="kpi-value${k.cls ? " " + k.cls : ""}">${k.val}</span>
       <span class="kpi-sub">${k.sub}</span>
     </div>`
  ).join("");
}

/* ── Charts ────────────────────────────────────────────── */
function renderCharts() {
  const rows  = yearRows();
  const dates = rows.map(r => r.date);

  // 日期範圍副標題
  if (dates.length >= 2) {
    $("priceDateRange").textContent = `${dates[0]} → ${dates.at(-1)}`;
  }

  /* 1. 收盤價 + 48-Bar 均線 */
  Plotly.react("chartPrice", [
    {
      type:"scatter", mode:"lines",
      x: dates, y: rows.map(r => r.close),
      name: "收盤價",
      line: { color:"#f7931a", width:2 },
      fill: "tozeroy", fillcolor: "rgba(247,147,26,.05)",
      hovertemplate: "%{x}<br>收盤 %{y:$,.0f}<extra></extra>",
    },
    {
      type:"scatter", mode:"lines",
      x: dates, y: rows.map(r => r.trend_ma_proxy),
      name: "48-Bar 均線",
      line: { color:"#60a5fa", width:1.6, dash:"dot" },
      hovertemplate: "%{x}<br>48MA %{y:$,.0f}<extra></extra>",
    },
  ], {
    ...BASE,
    yaxis: { ...BASE.yaxis, tickprefix:"$", tickformat:",.0f" },
  }, CFG);

  /* 2. Mayer Multiple */
  Plotly.react("chartMayer", [
    {
      type:"scatter", mode:"lines",
      x: dates, y: rows.map(r => r.mayer_multiple),
      name: "Mayer Multiple",
      line: { color:"#a78bfa", width:2 },
      hovertemplate: "%{x}<br>Mayer %{y:.3f}<extra></extra>",
    },
    {
      type:"scatter", mode:"lines",
      x: [dates[0], dates.at(-1)], y: [1, 1],
      name: "基準 1.0",
      line: { color:"#f59e0b", dash:"dash", width:1 },
      hoverinfo: "skip",
    },
  ], BASE, CFG);

  /* 3. 日波動率 + 32-Bar 波動率 */
  Plotly.react("chartVol", [
    {
      type:"scatter", mode:"lines",
      x: dates, y: rows.map(r => r.daily_volatility),
      name: "日波動率",
      line: { color:"#f43f5e", width:1.8 },
      hovertemplate: "%{x}<br>日波動 %{y:.3%}<extra></extra>",
    },
    {
      type:"scatter", mode:"lines",
      x: dates, y: rows.map(r => r.volatility_32bar),
      name: "32-Bar 波動率",
      line: { color:"#fb923c", dash:"dot", width:1.4 },
      hovertemplate: "%{x}<br>32B波動 %{y:.3%}<extra></extra>",
    },
  ], {
    ...BASE,
    yaxis: { ...BASE.yaxis, tickformat:".1%" },
  }, CFG);

  /* 4. 各年度 CAGR 長條圖 */
  const allCagr   = S.years.map(y => meta(y).cagr ?? null);
  const barColors = S.years.map(y => y === S.year ? "#f7931a" : "#334155");
  Plotly.react("chartCagr", [
    {
      type:"bar",
      x: S.years.map(String),
      y: allCagr,
      marker: { color: barColors },
      text: allCagr.map(v =>
        v == null ? "" : (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%"
      ),
      textposition: "outside",
      cliponaxis:   false,
      hovertemplate: "%{x}<br>CAGR %{y:.1%}<extra></extra>",
    },
  ], {
    ...BASE,
    showlegend: false,
    margin: { ...BASE.margin, t:24 },
    yaxis: { ...BASE.yaxis, tickformat:".0%" },
  }, CFG);
}

/* ────────────────────────────────────────────────────────
   資料表
──────────────────────────────────────────────────────── */
function initTable() {
  document.querySelectorAll("thead th[data-col]").forEach(th => {
    th.addEventListener("click", () => {
      const col = th.dataset.col;
      if (S.sortCol === col) S.sortDir *= -1;
      else { S.sortCol = col; S.sortDir = -1; }
      document.querySelectorAll("thead th").forEach(t => t.classList.remove("asc","desc"));
      th.classList.add(S.sortDir === 1 ? "asc" : "desc");
      drawTable();
    });
  });
  $("btnCsv").addEventListener("click", exportCsv);
  drawTable();
}

function drawTable() {
  let rows = [...S.rows];
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
    return `<tr>
      <td>${r.date}</td>
      <td style="text-align:right">${r.year}</td>
      <td>${fmtUSD(r.close)}</td>
      <td>${fmtCompact(r.volume)}</td>
      <td>${fmtNum(r.mayer_multiple)}</td>
      <td class="${retCls}">${ret != null ? fmtPct(ret) : "—"}</td>
      <td>${fmtPct1(r.daily_volatility)}</td>
      <td>${fmtPct1(r.volatility_32bar)}</td>
    </tr>`;
  }).join("");
}

function exportCsv() {
  const cols = ["date","year","close","volume","mayer_multiple","daily_return","daily_volatility","volatility_32bar"];
  const lines = [
    cols.join(","),
    ...S.rows.map(r => cols.map(k => `"${String(r[k] ?? "").replaceAll('"','""')}"`).join(",")),
  ];
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([lines.join("\n")], { type:"text/csv;charset=utf-8" })),
    download: `btc_history_${new Date().toISOString().slice(0,10)}.csv`,
  });
  a.click(); URL.revokeObjectURL(a.href);
}
