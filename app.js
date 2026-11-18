"use strict";
const fmtMoney = (v) => v == null ? "n/a" : "$" + v.toFixed(2);
const fmtPct = (v) => v == null ? "n/a" : (v > 0 ? "+" : "") + v.toFixed(2) + "%";
const cls = (v) => v == null ? "" : v > 0.0001 ? "pos" : v < -0.0001 ? "neg" : "";
const t = (s) => new Date(s).getTime();
const etFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const etDay = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
const fmtTime = (ms) => etFmt.format(new Date(ms)) + " ET";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const el = (tag, attrs = {}, html = "") => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); e.innerHTML = html; return e; };

let DATA, SERIES, hidden = new Set();

function buildSeries(d) {
  const s = d.portfolios.map((p) => ({
    id: p.id, name: p.name, color: p.color, dashed: p.kind === "benchmark", dots: false, kind: p.kind,
    segments: [p.history.map((h) => ({ x: t(h.time), y: h.value, note: (h.decisions || []).join(" | ") }))],
  }));
  for (const team of d.teams) {
    const byEra = new Map();
    for (const pt of team.points) {
      if (!byEra.has(pt.era)) byEra.set(pt.era, []);
      byEra.get(pt.era).push({ x: t(pt.time), y: pt.value, note: pt.note + (pt.source ? " (" + pt.source + ")" : ""), era: pt.era });
    }
    s.push({ id: team.id, name: team.name, color: team.color, dashed: false, dots: team.id === "team_nicole", kind: "team", segments: [...byEra.values()] });
  }
  return s;
}

function currentWeek(d) {
  const now = t(d.generated_at);
  return d.game_weeks.find((w) => t(w.start) <= now && now < t(w.end)) || d.game_weeks[d.game_weeks.length - 1];
}

function rangeBounds(kind) {
  const end = Math.max(t(DATA.generated_at), ...SERIES.flatMap((s) => s.segments.flat().map((p) => p.x)));
  if (kind === "week") return [t(currentWeek(DATA).start), end];
  if (kind === "lab") return [t(DATA.experiment_start) - 30 * 60e3, end];
  return [Math.min(...SERIES.flatMap((s) => s.segments.flat().map((p) => p.x))), end];
}

function clipSegments(series, x0, x1) {
  return series.segments.map((seg) => {
    const inside = seg.filter((p) => p.x >= x0 && p.x <= x1);
    const before = seg.filter((p) => p.x < x0).pop();
    if (before && inside.length && !series.dots) inside.unshift(before);
    return inside;
  }).filter((seg) => seg.length);
}

function niceTicks(lo, hi, n = 5) {
  const span = hi - lo || 1, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0);
  const ticks = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(+v.toFixed(6));
  return ticks;
}

function drawChart() {
  const range = document.querySelector('input[name="range"]:checked').value;
  const [x0, x1] = rangeBounds(range);
  const box = document.getElementById("chart");
  const W = Math.max(box.clientWidth, 320), H = Math.max(box.clientHeight, 260);
  const m = { l: 52, r: 12, t: 12, b: 34 };
  const vis = SERIES.filter((s) => !hidden.has(s.id)).map((s) => ({ ...s, segs: clipSegments(s, x0, x1) })).filter((s) => s.segs.length);
  const ys = vis.flatMap((s) => s.segs.flat().filter((p) => p.x >= x0).map((p) => p.y)).concat([100]);
  let y0 = Math.min(...ys), y1 = Math.max(...ys); const pad = Math.max((y1 - y0) * 0.12, 0.5); y0 -= pad; y1 += pad;
  // Compressed time axis: gaps longer than 2 hours (nights, weekends, holidays) shrink to 40 minutes.
  const knots = [...new Set([x0, x1, ...vis.flatMap((s) => s.segs.flat().map((p) => p.x)).filter((x) => x >= x0 && x <= x1)])].sort((a, b) => a - b);
  const GAP = 2 * 3600e3, SHOWN = 40 * 60e3; const cum = [0];
  for (let i = 1; i < knots.length; i++) { const d = knots[i] - knots[i - 1]; cum.push(cum[i - 1] + (d > GAP ? SHOWN : d)); }
  const total = cum[cum.length - 1] || 1;
  const comp = (x) => { if (x <= knots[0]) return (x - knots[0]) / (knots[1] - knots[0] || 1) * (cum[1] || 0);
    for (let i = 1; i < knots.length; i++) if (x <= knots[i]) return cum[i - 1] + (x - knots[i - 1]) / (knots[i] - knots[i - 1] || 1) * (cum[i] - cum[i - 1]);
    return total; };
  const uncomp = (c) => { for (let i = 1; i < knots.length; i++) if (c <= cum[i]) return knots[i - 1] + (c - cum[i - 1]) / (cum[i] - cum[i - 1] || 1) * (knots[i] - knots[i - 1]); return knots[knots.length - 1]; };
  const X = (x) => m.l + comp(x) / total * (W - m.l - m.r);
  const Y = (y) => m.t + (1 - (y - y0) / (y1 - y0)) * (H - m.t - m.b);
  const ns = "http://www.w3.org/2000/svg";
  let svg = `<svg xmlns="${ns}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><defs><clipPath id="plot"><rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}"/></clipPath></defs>`;
  for (const v of niceTicks(y0, y1)) svg += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">$${v.toFixed(v % 1 ? 1 : 0)}</text>`;
  svg += `<line class="base" x1="${m.l}" x2="${W - m.r}" y1="${Y(100)}" y2="${Y(100)}"/>`;
  const days = Math.max(1, (x1 - x0) / 864e5), nT = Math.min(7, Math.max(2, Math.floor((W - 80) / 150)));
  let lastPx = -1e9, lastLabel = "";
  for (let i = 0; i <= nT; i++) {
    const x = uncomp(total * i / nT), px = X(x);
    const label = days < 3 ? etFmt.format(new Date(x)) : etDay.format(new Date(x));
    if (label === lastLabel || px - lastPx < (days < 3 ? 175 : 90)) continue;
    if (i === nT && W - m.r - px < 0) continue;
    svg += `<text x="${px}" y="${H - 10}" text-anchor="${i === 0 ? "start" : i === nT ? "end" : "middle"}">${label}</text>`;
    lastPx = px; lastLabel = label;
  }
  svg += `<g clip-path="url(#plot)">`;
  for (const s of vis) {
    for (const seg of s.segs) {
      const d = seg.map((p, i) => (i ? "L" : "M") + X(p.x).toFixed(1) + " " + Y(p.y).toFixed(1)).join(" ");
      svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.kind === "team" ? 3 : 2.2}" ${s.dashed ? 'stroke-dasharray="7 5"' : ""} stroke-linejoin="round" stroke-linecap="round"${s.dots ? ' stroke-opacity=".55"' : ""}/>`;
      if (s.dots || seg.length === 1) for (const p of seg) svg += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${s.dots ? 5 : 3.5}" fill="${s.color}" stroke="var(--card)" stroke-width="1.5"/>`;
    }
  }
  svg += `</g><line id="cursor" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" stroke="var(--muted)" stroke-width="1" visibility="hidden"/></svg>`;
  box.innerHTML = svg;
  const tip = el("div", { class: "tip", hidden: "" }); box.appendChild(tip);
  box.onpointermove = (ev) => {
    const r = box.getBoundingClientRect(); const px = (ev.clientX - r.left) * (W / r.width);
    const xt = uncomp((px - m.l) / (W - m.l - m.r) * total);
    if (xt < x0 || xt > x1) { tip.hidden = true; return; }
    const rows = [];
    for (const s of vis) {
      let best = null; for (const p of s.segs.flat()) if (p.x <= xt + 1 && (!best || p.x > best.x)) best = p;
      if (best && best.x >= x0 - 864e5 * 3) rows.push(`<div><span class="swatch" style="background:${s.color}"></span> ${esc(s.name)}: <strong>${fmtMoney(best.y)}</strong></div>`);
    }
    const c = box.querySelector("#cursor"); c.setAttribute("x1", px); c.setAttribute("x2", px); c.setAttribute("visibility", "visible");
    tip.innerHTML = `<div><strong>${fmtTime(xt)}</strong></div>` + rows.join("");
    tip.hidden = false;
    const left = ev.clientX - r.left + 14; tip.style.left = Math.min(left, r.width - 270) + "px"; tip.style.top = "8px";
  };
  box.onpointerleave = () => { tip.hidden = true; const c = box.querySelector("#cursor"); if (c) c.setAttribute("visibility", "hidden"); };
  box.setAttribute("aria-label", `Line chart, ${vis.length} lines from ${fmtTime(x0)} to ${fmtTime(x1)}. Values from ${fmtMoney(Math.min(...ys))} to ${fmtMoney(Math.max(...ys))}. The data table below the chart has every point.`);
  drawChartTable(vis, x0);
}

function drawChartTable(vis, x0) {
  const rows = vis.flatMap((s) => s.segs.flat().filter((p) => p.x >= x0).map((p) => ({ s, p }))).sort((a, b) => a.p.x - b.p.x);
  const wrap = document.getElementById("chart-table");
  wrap.innerHTML = `<div tabindex="0" role="region" aria-label="Chart data" class="table-wrapper"><table><thead><tr><th scope="col">Time (ET)</th><th scope="col">Line</th><th scope="col">Value</th></tr></thead><tbody>${
    rows.map(({ s, p }) => `<tr><td class="num">${fmtTime(p.x)}</td><td>${esc(s.name)}</td><td class="num">${fmtMoney(p.y)}</td></tr>`).join("")}</tbody></table></div>`;
}

function drawLegend() {
  const lg = document.getElementById("legend"); lg.innerHTML = "";
  for (const s of SERIES) {
    const b = el("button", { type: "button", "aria-pressed": String(!hidden.has(s.id)) },
      `<span class="swatch${s.dashed ? " dash" : ""}${s.dots ? " dot" : ""}" style="${s.dashed ? "" : "background:" + s.color + ";"}color:${s.color}"></span>${esc(s.name)}`);
    b.onclick = () => { hidden.has(s.id) ? hidden.delete(s.id) : hidden.add(s.id); b.setAttribute("aria-pressed", String(!hidden.has(s.id))); drawChart(); };
    lg.appendChild(b);
  }
}

function weekReturn(history) {
  const ws = t(currentWeek(DATA).start);
  const before = history.filter((h) => t(h.time) <= ws).pop() || history[0];
  const last = history[history.length - 1];
  return (last.value / before.value - 1) * 100;
}

function drawBoard() {
  const tb = document.querySelector("#board tbody"); tb.innerHTML = "";
  const labels = ["Value", "Return", "This week", "Trades", "Win rate", "Max drawdown"];
  const row = (name, src, cells) => {
    const tr = el("tr"); tr.appendChild(el("th", { scope: "row" }, `${esc(name)}<span class="src">${esc(src)}</span>`));
    cells.forEach(([html, c], i) => tr.appendChild(el("td", { class: "num " + (c || ""), "data-label": labels[i] }, html)));
    tb.appendChild(tr);
  };
  const ports = [...DATA.portfolios].sort((a, b) => b.stats.return_pct - a.stats.return_pct);
  for (const p of ports) {
    const s = p.stats, wr = weekReturn(p.history);
    row(p.name, p.short_rule, [[fmtMoney(s.current_value)], [fmtPct(s.return_pct), cls(s.return_pct)], [fmtPct(wr), cls(wr)], [String(s.trades)],
      [s.win_rate == null ? "no closed trades" : `${s.win_rate}% (${s.wins}/${s.closed_sells})`], [fmtPct(s.max_drawdown_pct), cls(s.max_drawdown_pct)]]);
  }
  const ws = t(currentWeek(DATA).start);
  for (const team of DATA.teams) {
    const pts = team.points.filter((p) => t(p.time) >= ws - 60e3);
    const last = pts[pts.length - 1];
    const ret = last ? (last.value / 100 - 1) * 100 : null;
    row(team.name, team.note, [[last ? fmtMoney(last.value) + `<span class="src">${fmtTime(t(last.time))}</span>` : "no report yet"], [fmtPct(ret), cls(ret)], [fmtPct(ret), cls(ret)],
      [team.trades == null ? "n/a" : String(team.trades)], ["n/a"], ["n/a"]]);
  }
}

function drawWorking() {
  const s = DATA.summary;
  document.getElementById("working").innerHTML = s.lines.map((l) => `<li>${esc(l)}</li>`).join("");
  document.getElementById("verdict").textContent = s.verdict;
}

function md(text) {
  return esc(text).split(/\n{2,}/).map((block) => {
    if (/^#{1,3} /.test(block)) return `<h3>${block.replace(/^#+ /, "")}</h3>`;
    if (/^(- |\d+\. )/m.test(block)) {
      const head = block.split("\n").filter((l) => !/^(- |\d+\. )/.test(l));
      const items = block.split("\n").filter((l) => /^(- |\d+\. )/.test(l)).map((l) => `<li>${l.replace(/^(- |\d+\. )/, "")}</li>`).join("");
      return (head.length ? `<p>${head.join(" ")}</p>` : "") + `<ul>${items}</ul>`;
    }
    return `<p>${block}</p>`;
  }).join("").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>");
}

function drawLogs() {
  const box = document.getElementById("logs"); box.innerHTML = "";
  for (const p of DATA.portfolios) {
    const items = [...p.trades.map((tr) => ({ time: tr.time, what: `${tr.side.toUpperCase()} ${tr.symbol}`, amt: tr.amount, price: tr.price, pnl: tr.realized_pnl, reason: tr.reason, ev: tr.evidence, src: tr.quote_source })),
      ...p.decisions.filter((d) => d.action === "hold").map((d) => ({ time: d.time, what: "HOLD", reason: d.reason, ev: d.evidence }))].sort((a, b) => t(b.time) - t(a.time));
    const det = el("details", {}, `<summary><span class="swatch" style="background:${p.color}"></span>${esc(p.name)} <span class="src">${items.length} entries</span></summary>`);
    const evText = (ev) => (ev || []).map((e) => typeof e === "string" ? esc(e) : e.file ? "file: " + esc(e.file.split("/").pop()) : "").join("; ");
    det.insertAdjacentHTML("beforeend", items.length ? `<div tabindex="0" role="region" aria-label="${esc(p.name)} trades" class="table-wrapper"><table class="log-table"><thead><tr><th scope="col">Time (ET)</th><th scope="col">Move</th><th scope="col">Amount</th><th scope="col">Why</th></tr></thead><tbody>${
      items.map((i) => `<tr><td class="num">${fmtTime(t(i.time))}</td><td>${esc(i.what)}${i.price ? `<span class="src">@ $${i.price.toFixed(2)}</span>` : ""}</td><td class="num">${i.amt != null ? fmtMoney(i.amt) : ""}${i.pnl != null ? `<span class="src ${cls(i.pnl)}">P&amp;L ${fmtMoney(i.pnl)}</span>` : ""}</td><td>${esc(i.reason)}${i.ev && i.ev.length ? `<div class="ev">Evidence: ${evText(i.ev)}</div>` : ""}</td></tr>`).join("")}</tbody></table></div>` : "<p>No moves yet.</p>");
    box.appendChild(det);
  }
}

function drawRules() {
  const box = document.getElementById("rules"); box.innerHTML = "";
  for (const p of DATA.portfolios) {
    box.appendChild(el("details", {}, `<summary><span class="swatch" style="background:${p.color}"></span>${esc(p.name)}</summary><div class="rules-md">${md(p.rules_md)}</div>`));
  }
}

async function main() {
  try {
    const res = await fetch("data/lab.json", { cache: "no-cache" });
    DATA = await res.json();
  } catch (e) {
    document.getElementById("updated").textContent = "Could not load data. Try reloading.";
    return;
  }
  SERIES = buildSeries(DATA);
  document.getElementById("updated").textContent = `Updated ${fmtTime(t(DATA.generated_at))}. Experiments started ${fmtTime(t(DATA.experiment_start))}.`;
  drawLegend(); drawChart(); drawBoard(); drawWorking(); drawLogs(); drawRules();
  document.querySelectorAll('input[name="range"]').forEach((r) => r.addEventListener("change", drawChart));
  new ResizeObserver(() => drawChart()).observe(document.getElementById("chart"));
}
main();
