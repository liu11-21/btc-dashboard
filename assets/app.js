/* ──────────────────────────────────────────────────────────
   BTC Transformer Dashboard · app.js
   資料：./data/latest_forecast.json
         ./data/dashboard_history.json
────────────────────────────────────────────────────────── */

const DATA_URL     = "./data/dashboard_history.json";
const FORECAST_URL = "./data/latest_forecast.json";
const PLAY_MS      = 1200;

/* ── 格式工具 ──────────────────────────────────────────── */
const fmt = {
  money:   v => Number.isFinite(+v) ? new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(+v) : "—",
  pct:     v => Number.isFinite(+v) ? ((+v*100)>=0?"+":"")+(+v*100).toFixed(2)+"%" : "—",
  pct2:    v => Number.isFinite(+v) ? (+v*100).toFixed(2)+"%" : "—",
  num3:    v => Number.isFinite(+v) ? (+v).toFixed(3) : "—",
  compact: v => Number.isFinite(+v) ? new Intl.NumberFormat("zh-TW",{notation:"compact",maximumFractionDigits:2}).format(+v) : "—",
  ts:      v => { try{ return new Date(v).toLocaleString("zh-TW",{hour12:false}); }catch(e){ return "—"; } },
  dtShort: v => { try{ const d=new Date(v); return `${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:00`; }catch(e){ return "—"; } },
};

/* ── Plotly 暗色主題 ───────────────────────────────────── */
const LAYOUT = {
  paper_bgcolor: "rgba(0,0,0,0)",
  plot_bgcolor:  "rgba(0,0,0,0)",
  font:   { color: "#94a3b8", family: "Microsoft JhengHei,system-ui,sans-serif", size: 12 },
  margin: { t: 12, r: 18, b: 44, l: 60 },
  hovermode: "x unified",
  legend: { bgcolor:"rgba(0,0,0,0)", font:{ color:"#94a3b8" }, orientation:"h", y:-0.2 },
  xaxis:  { gridcolor:"#232839", linecolor:"#232839", zerolinecolor:"#232839" },
  yaxis:  { gridcolor:"#232839", linecolor:"#232839", zerolinecolor:"#232839" },
};
const CFG = { responsive: true, displaylogo: false, displayModeBar: false };

/* ── State ─────────────────────────────────────────────── */
const state = {
  hist: null, fc: null,
  rows: [], years: [], year: null,
  playing: false, timer: null,
  sortCol: null, sortDir: -1,
};

const el = id => document.getElementById(id);

/* ── Boot ──────────────────────────────────────────────── */
window.addEventListener("DOMContentLoaded", async () => {
  const [hist, fc] = await Promise.all([
    fetch(`${DATA_URL}?v=${Date.now()}`, { cache:"no-store" }).then(r=>r.json()).catch(()=>null),
    fetch(`${FORECAST_URL}?v=${Date.now()}`, { cache:"no-store" }).then(r=>r.json()).catch(()=>null),
  ]);
  state.hist = hist;
  state.fc   = fc;
  state.rows  = Array.isArray(hist?.daily_rows) ? hist.daily_rows.map(r=>({...r,year:+r.year})) : [];
  state.years = (Array.isArray(hist?.years) ? hist.years.map(Number) : [...new Set(state.rows.map(r=>r.year))]).sort((a,b)=>a-b);

  renderSignal(fc);

  if (state.rows.length && state.years.length) {
    el("emptyState").hidden = true;
    el("dashboard").hidden  = false;
    state.year = state.years.at(-1);
    initSlider();
    refreshYear();
    renderTable();
  } else {
    el("emptyState").hidden = false;
    el("dashboard").hidden  = true;
  }

  el("updatedAt").textContent = fmt.ts(fc?.generated_at || hist?.generated_at);
  el("dataRange").textContent = buildRangeLabel(state.rows, fc);
});

/* ── Signal hero ───────────────────────────────────────── */
function renderSignal(fc) {
  const wrap = el("signalRow");
  if (!fc?.forecasts?.length) {
    wrap.innerHTML = `<div class="signal-card neutral"><span class="sc-label">信號</span><span class="sc-value" style="font-size:1rem;color:var(--muted)">尚無推論資料</span></div>`;
    return;
  }
  const f   = fc.forecasts[0];
  const dir = f.direction === "up" ? "up" : "down";
  const conf = f.confidence * 100;
  const prob = f.prob_up   * 100;
  const gate = f.confidence_gate * 100;
  const arcClr = dir === "up" ? "#22c55e" : "#ef4444";

  // Card 1: Direction
  const c1 = document.createElement("div");
  c1.className = `signal-card ${dir}`;
  c1.innerHTML = `
    <span class="sc-label">方向預測（32-Bar）</span>
    <span class="sc-value ${dir}">${dir === "up" ? "看漲 ▲" : "看跌 ▼"}</span>
    <span class="sc-sub">目標：${fmt.dtShort(f.target_time)}</span>
    <span class="badge ${f.is_actionable ? "badge-act" : "badge-idle"}">${f.is_actionable ? "✓ 可操作信號" : `信心未達 ${gate.toFixed(0)}%`}</span>`;
  wrap.appendChild(c1);

  // Card 2: Probability gauge (SVG semicircle)
  const c2 = document.createElement("div");
  c2.className = `signal-card ${dir}`;
  const cx = 72, cy = 64, r = 52;
  const endA = Math.PI * f.prob_up;
  const x2 = cx + r * Math.cos(Math.PI - endA);
  const y2 = cy - r * Math.sin(Math.PI - endA);
  const lArc = endA > Math.PI / 2 ? 1 : 0;
  c2.innerHTML = `
    <span class="sc-label">看漲機率</span>
    <div class="gauge-wrap">
      <svg width="144" height="78" viewBox="0 0 144 78">
        <path d="M ${cx-r} ${cy} A ${r} ${r} 0 0 1 ${cx+r} ${cy}"
              fill="none" stroke="#232839" stroke-width="10" stroke-linecap="round"/>
        <path d="M ${cx-r} ${cy} A ${r} ${r} 0 ${lArc} 1 ${x2} ${y2}"
              fill="none" stroke="${arcClr}" stroke-width="10" stroke-linecap="round"/>
        <text x="${cx}" y="${cy-8}" text-anchor="middle" fill="${arcClr}" font-size="22" font-weight="900">${prob.toFixed(1)}%</text>
        <text x="${cx-r}" y="${cy+15}" text-anchor="middle" fill="#64748b" font-size="9">50%</text>
        <text x="${cx+r}" y="${cy+15}" text-anchor="middle" fill="#64748b" font-size="9">100%</text>
      </svg>
    </div>
    <span class="sc-sub" style="text-align:center">信心 ${conf.toFixed(1)}% ／閾值 ${gate.toFixed(0)}%</span>
    <div class="conf-track"><div class="conf-fill ${dir}" style="width:${Math.min(conf,100)}%"></div></div>`;
  wrap.appendChild(c2);

  // Card 3: Scenario price
  const ret = f.scenario_return_pct;
  const c3 = document.createElement("div");
  c3.className = `signal-card ${dir}`;
  c3.innerHTML = `
    <span class="sc-label">情境目標價</span>
    <span class="sc-value">${fmt.money(f.scenario_price)}</span>
    <span class="sc-sub">情境報酬 <strong style="color:var(--${dir})">${Number.isFinite(ret) ? (ret >= 0 ? "+" : "") + ret.toFixed(2) + "%" : "—"}</strong></span>
    <span class="sc-sub" style="margin-top:4px">${fc.symbol} · ${fc.market} · ${fc.interval}</span>`;
  wrap.appendChild(c3);
}

/* ── Year slider ───────────────────────────────────────── */
function initSlider() {
  const slider = el("yearSlider");
  slider.min = "0"; slider.max = String(state.years.length - 1);
  slider.value = String(state.years.length - 1);
  el("currentYear").textContent = state.year;
  slider.addEventListener("input", e => {
    stopPlay();
    state.year = state.years[+e.target.value];
    el("currentYear").textContent = state.year;
    refreshYear();
  });
  el("playPauseButton").addEventListener("click", () => state.playing ? stopPlay() : startPlay());
  el("exportCsvButton").addEventListener("click", exportCsv);
}

function startPlay() {
  state.playing = true;
  el("playPauseButton").textContent = "暫停";
  state.timer = setInterval(() => {
    const i = state.years.indexOf(state.year);
    state.year = state.years[(i + 1) % state.years.length];
    el("yearSlider").value = String(state.years.indexOf(state.year));
    el("currentYear").textContent = state.year;
    refreshYear();
  }, PLAY_MS);
}
function stopPlay() {
  state.playing = false;
  el("playPauseButton").textContent = "播放";
  clearInterval(state.timer); state.timer = null;
}

/* ── Refresh year ──────────────────────────────────────── */
function refreshYear() {
  renderMetrics();
  renderCharts();
}

function yearRows() { return state.rows.filter(r => r.year === state.year); }
function yearMeta(y) { return state.hist?.annual_metrics?.[String(y ?? state.year)] ?? {}; }

/* ── Metric cards ──────────────────────────────────────── */
function renderMetrics() {
  const m = yearMeta();
  const defs = [
    ["年度最高價",  fmt.money(m.highest_price),       "日高價最高值"],
    ["年度最低價",  fmt.money(m.lowest_price),        "日低價最低值"],
    ["年化成長率",  fmt.pct(m.cagr),                  "CAGR"],
    ["年度總量",    fmt.compact(m.total_volume),      "累計成交量"],
    ["最高波動率",  fmt.pct2(m.highest_volatility),   "單日內波動高點"],
    ["最低波動率",  fmt.pct2(m.lowest_volatility),    "單日內波動低點"],
  ];
  el("metricGrid").innerHTML = defs.map(([l, v, s]) =>
    `<div class="metric-card"><span>${l}</span><strong>${v}</strong><small>${s}</small></div>`
  ).join("");
}

/* ── Charts ────────────────────────────────────────────── */
function renderCharts() {
  const rows  = yearRows();
  const dates = rows.map(r => r.date);

  // 1. Price + trend MA
  Plotly.react("trendChart", [
    { type:"scatter", mode:"lines", x:dates, y:rows.map(r=>r.close),
      name:"收盤價", line:{color:"#f7931a",width:2.5},
      fill:"tozeroy", fillcolor:"rgba(247,147,26,.06)",
      hovertemplate:"%{x}<br>收盤 %{y:$,.0f}<extra></extra>" },
    { type:"scatter", mode:"lines", x:dates, y:rows.map(r=>r.trend_ma_proxy),
      name:"趨勢均線", line:{color:"#3b82f6",width:1.8,dash:"dot"},
      hovertemplate:"%{x}<br>均線 %{y:$,.0f}<extra></extra>" },
  ], {
    ...LAYOUT,
    yaxis: {...LAYOUT.yaxis, tickprefix:"$", tickformat:",.0f"},
  }, CFG);

  // 2. MVRV Z proxy
  Plotly.react("mvrvChart", [
    { type:"scatter", mode:"lines", x:dates, y:rows.map(r=>r.mvrv_z_proxy),
      name:"MVRV Z 代理", line:{color:"#a78bfa",width:2},
      hovertemplate:"%{x}<br>%{y:.3f}<extra></extra>" },
    { type:"scatter", mode:"lines", x:[dates[0],dates.at(-1)], y:[0,0],
      showlegend:false, line:{color:"#64748b",dash:"dot",width:1} },
  ], LAYOUT, CFG);

  // 3. Mayer multiple
  Plotly.react("mayerChart", [
    { type:"scatter", mode:"lines", x:dates, y:rows.map(r=>r.mayer_multiple),
      name:"梅耶指數", line:{color:"#2dd4bf",width:2},
      hovertemplate:"%{x}<br>%{y:.3f}<extra></extra>" },
    { type:"scatter", mode:"lines", x:[dates[0],dates.at(-1)], y:[1,1],
      name:"基準線=1", line:{color:"#f59e0b",dash:"dash",width:1} },
  ], LAYOUT, CFG);

  // 4. Volatility
  Plotly.react("volatilityChart", [
    { type:"bar", x:dates, y:rows.map(r=>r.daily_volatility),
      name:"日波動率", marker:{color:"#f43f5e"},
      hovertemplate:"%{x}<br>%{y:.3%}<extra></extra>" },
  ], {
    ...LAYOUT,
    yaxis: {...LAYOUT.yaxis, tickformat:".1%"},
  }, CFG);

  // 5. CAGR all years (highlight current)
  const cagrs  = state.years.map(y => yearMeta(y).cagr ?? null);
  const colors = state.years.map(y => y === state.year ? "#f7931a" : "#334155");
  Plotly.react("cagrChart", [
    { type:"bar", x:state.years.map(String), y:cagrs,
      marker:{color:colors},
      text: cagrs.map(v => v == null ? "" : (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%"),
      textposition:"outside", cliponaxis:false,
      hovertemplate:"%{x}<br>CAGR %{y:.2%}<extra></extra>" },
  ], {
    ...LAYOUT,
    showlegend: false,
    yaxis: {...LAYOUT.yaxis, tickformat:".0%"},
  }, CFG);
}

/* ── Table ─────────────────────────────────────────────── */
function renderTable() {
  bindSort();
  drawTable();
}

function bindSort() {
  document.querySelectorAll("thead th[data-col]").forEach(th => {
    th.addEventListener("click", () => {
      const col = th.dataset.col;
      if (state.sortCol === col) state.sortDir *= -1;
      else { state.sortCol = col; state.sortDir = -1; }
      document.querySelectorAll("thead th").forEach(t => t.classList.remove("sort-asc","sort-desc"));
      th.classList.add(state.sortDir === 1 ? "sort-asc" : "sort-desc");
      drawTable();
    });
  });
}

function drawTable() {
  let rows = [...state.rows];
  if (state.sortCol) {
    rows.sort((a, b) => {
      const av = a[state.sortCol], bv = b[state.sortCol];
      if (av == null && bv == null) return 0;
      if (av == null) return 1; if (bv == null) return -1;
      return (av < bv ? -1 : av > bv ? 1 : 0) * state.sortDir;
    });
  }
  el("historyRows").innerHTML = rows.slice(-1500).map(r => {
    const cagr   = yearMeta(r.year).cagr;
    const retCls = r.daily_return > 0 ? "cell-up" : r.daily_return < 0 ? "cell-down" : "";
    const mvCls  = r.mvrv_z_proxy > 0 ? "cell-up" : r.mvrv_z_proxy < 0 ? "cell-down" : "cell-na";
    return `<tr>
      <td>${r.date}</td>
      <td>${r.year}</td>
      <td>${fmt.money(r.open)}</td>
      <td>${fmt.money(r.high)}</td>
      <td>${fmt.money(r.low)}</td>
      <td>${fmt.money(r.close)}</td>
      <td>${fmt.compact(r.volume)}</td>
      <td class="${mvCls}">${fmt.num3(r.mvrv_z_proxy)}</td>
      <td>${fmt.num3(r.mayer_multiple)}</td>
      <td class="${retCls}">${r.daily_return != null ? fmt.pct(r.daily_return) : "—"}</td>
      <td>${fmt.pct2(r.daily_volatility)}</td>
      <td class="${(cagr ?? 0) >= 0 ? "cell-up" : "cell-down"}">${fmt.pct(cagr)}</td>
    </tr>`;
  }).join("");
}

function exportCsv() {
  const cols = ["date","year","open","high","low","close","volume","mvrv_z_proxy","mayer_multiple","daily_return","daily_volatility","cagr"];
  const lines = [cols.join(","), ...state.rows.map(r => {
    const e = {...r, cagr: yearMeta(r.year).cagr};
    return cols.map(k => `"${String(e[k] ?? "").replaceAll('"','""')}"`).join(",");
  })];
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([lines.join("\n")], {type:"text/csv;charset=utf-8"})),
    download: `btc_history_${new Date().toISOString().slice(0,10)}.csv`,
  });
  a.click(); URL.revokeObjectURL(a.href);
}

/* ── Helpers ───────────────────────────────────────────── */
function buildRangeLabel(rows, fc) {
  const start   = rows.length ? rows[0].date : null;
  const targets = (fc?.forecasts || []).map(f => f.target_time).filter(Boolean).sort();
  const end     = targets.length ? fmt.dtShort(targets.at(-1)) : (rows.at(-1)?.date ?? null);
  return start && end ? `${start} → ${end}` : "—";
}
