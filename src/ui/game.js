/**
 * game.js — Full game charting screen for SnapChart Pro.
 *
 * Ported from SnapChart (index.html) with localStorage replaced by
 * Firestore. Real-time play list comes from subscribePlays(); form
 * state lives in a per-render closure so multiple navigations don't bleed.
 */

import {
  addPlay as dbAddPlay,
  updatePlay as dbUpdatePlay,
  deletePlay as dbDeletePlay,
  subscribePlays,
  updateGame,
} from "../db.js";

// Formation defaults (same as free app)
const DEFAULT_FORMS = [
  "Shotgun","Singleback","I-Form","Pistol","Empty",
  "Trips Right","Trips Left","Goal Line","Wildcat",
];

// ---------- pure helpers (no DOM) -------------------------------------------

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]
  );
}

function titleCase(s) {
  return String(s || "").replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1));
}

function pct(n, d) { return d ? Math.round(100 * n / d) + "%" : "0%"; }

function uniqCI(arr) {
  const seen = {}, out = [];
  arr.forEach((v) => {
    v = (v || "").trim();
    if (!v) return;
    const k = v.toLowerCase();
    if (!seen[k]) { seen[k] = 1; out.push(v); }
  });
  return out;
}

function dnDist(p) {
  if (p.mode === "scrimmage") return p.playNum ? "Play " + esc(p.playNum) : "&mdash;";
  const ds = (p.dist === "" || p.dist == null) ? "" : esc(p.dist);
  return ds ? esc(p.down) + " &amp; " + ds : esc(p.down);
}

function autoEffective(mode, down, dist, yards, settings) {
  if (mode === "7v7")       return autoEff7v7(down, dist, yards, settings.eff7v7Mode);
  if (mode === "scrimmage") return (Number(yards) || 0) >= (settings.effScrim || 5);
  dist  = Number(dist)  || 0;
  yards = Number(yards) || 0;
  down  = Number(down)  || 1;
  if (dist > 0 && yards >= dist) return true;
  if (down === 1) return yards >= (settings.effStd1 || 5);
  if (down === 2) return yards >= ((settings.effStd2 || 50) / 100) * dist;
  if (down === 3) return yards >= ((settings.effStd3 || 100) / 100) * dist;
  if (down === 4) return yards >= ((settings.effStd4 || 100) / 100) * dist;
  return false;
}

function autoEff7v7(down, toGo, yards, eff7v7Mode) {
  toGo  = Number(toGo)  || 0;
  yards = Number(yards) || 0;
  down  = Number(down)  || 1;
  if (toGo <= 0) return yards >= 0;
  if (yards >= toGo) return true;
  // "pace" mode: any positive gain is effective; "strict" mode: must advance past current line marker
  if ((eff7v7Mode || "pace") === "pace") return yards > 0;
  const remaining = Math.max(1, 5 - down);
  return yards >= toGo / remaining;
}

function target7v7(ballOn, line1, line2) {
  ballOn = Number(ballOn);
  line1  = Number(line1 ?? 20);
  line2  = Number(line2 ?? 5);
  if (isNaN(ballOn)) return null;
  if (ballOn > line1) return line1;
  if (ballOn > line2) return line2;
  return 0;
}

function advance7v7(ballOn, down, yards, start, line1, line2) {
  start = Number(start ?? 40);
  const nb = Number(ballOn) - Number(yards);
  if (nb <= 0) return { ball: start, down: 1 };
  const prevTarget = target7v7(ballOn, line1, line2);
  if (nb <= prevTarget) return { ball: nb, down: 1 };
  if (Number(down) >= 4) return { ball: start, down: 1 };
  return { ball: nb, down: Number(down) + 1 };
}

function advanceBallOn(ylStr, yards) {
  if (ylStr === "" || ylStr == null) return null;
  const yl = Number(ylStr);
  if (isNaN(yl)) return null;
  const pos = yl <= 0 ? -yl : 100 - yl;
  const newPos = pos + Number(yards);
  if (newPos <= 0 || newPos >= 100) return null;
  const newSign = newPos < 50 ? -1 : 1;
  const newYl   = newPos < 50 ? newPos : 100 - newPos;
  return { yl: String(Math.round(newYl) || 50), sign: newSign };
}

// ---------- red zone analysis ------------------------------------------------

export function buildRedZone(playsArr) {
  function posFromYl(yl) {
    const n = Number(yl);
    if (yl === "" || yl == null || isNaN(n)) return null;
    return n >= 0 ? n : 100 + n;
  }
  function row(label, n, succ, yards) {
    const ep = n ? Math.round(100 * succ / n) : 0;
    const color = ep >= 50 ? "#15803d" : "#b91c1c";
    const avg = n ? (yards / n).toFixed(1) : "0.0";
    return `<div class="rpt-row">
      <div class="rpt-label">${label}</div>
      <div class="rpt-stats">
        <span class="rpt-n">${n} play${n !== 1 ? "s" : ""}</span>
        <span class="rpt-avg">${n && yards / n > 0 ? "+" : ""}${avg} yds/play</span>
        <span class="rpt-eff" style="color:${color}">${ep}% effective</span>
      </div>
      <div class="rpt-bar-wrap"><div class="rpt-bar" style="width:${ep}%"></div></div>
    </div>`;
  }
  function secHead(title) {
    return `<div style="font-family:var(--num);text-transform:uppercase;letter-spacing:.06em;font-size:11px;font-weight:700;color:var(--royal);padding:4px 0 5px;border-bottom:2px solid var(--chalk);margin:18px 0 10px">${title}</div>`;
  }
  function statCard(val, lbl) {
    return `<div style="background:var(--chalk);border-radius:10px;padding:12px 8px;text-align:center">
      <div style="font-family:var(--num);font-size:22px;font-weight:700;color:var(--royal);line-height:1.1">${val}</div>
      <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--slate);margin-top:4px">${lbl}</div>
    </div>`;
  }

  const rzPlays = playsArr.filter((p) => {
    const pos = posFromYl(p.yl);
    return pos !== null && pos >= 80 && p.type !== "punt";
  });

  if (!rzPlays.length) {
    return `<div style="padding:28px 16px;text-align:center;color:var(--slate)">
      <div style="font-size:15px;font-weight:700;margin-bottom:6px">No red zone plays yet</div>
      <div style="font-size:13px">Red zone = inside the opponent's 20 yard line.<br>Log plays with the ball-on field set inside their 20.</div>
    </div>`;
  }

  const total = rzPlays.length;
  const successes = rzPlays.filter((p) => p.success).length;
  const effPct = Math.round(100 * successes / total);
  const totalYds = rzPlays.reduce((a, p) => a + (Number(p.yards) || 0), 0);
  const avgYds = total ? (totalYds / total).toFixed(1) : "0.0";

  const runs = rzPlays.filter((p) => p.type === "run");
  const passes = rzPlays.filter((p) => p.type === "pass");
  const runSucc = runs.filter((p) => p.success).length;
  const passSucc = passes.filter((p) => p.success).length;
  const runYds = runs.reduce((a, p) => a + (Number(p.yards) || 0), 0);
  const passYds = passes.reduce((a, p) => a + (Number(p.yards) || 0), 0);

  const szPlays = rzPlays.filter((p) => { const pos = posFromYl(p.yl); return pos >= 80 && pos <= 89; });
  const drPlays = rzPlays.filter((p) => { const pos = posFromYl(p.yl); return pos >= 90; });
  const szSucc = szPlays.filter((p) => p.success).length;
  const drSucc = drPlays.filter((p) => p.success).length;
  const szYds = szPlays.reduce((a, p) => a + (Number(p.yards) || 0), 0);
  const drYds = drPlays.reduce((a, p) => a + (Number(p.yards) || 0), 0);

  const downMap = {};
  rzPlays.forEach((p) => {
    const d = String(p.down || "");
    if (!d) return;
    if (!downMap[d]) downMap[d] = { count: 0, succ: 0, yards: 0 };
    downMap[d].count++; if (p.success) downMap[d].succ++; downMap[d].yards += Number(p.yards) || 0;
  });

  const hashData = { L: { count: 0, succ: 0, yards: 0 }, M: { count: 0, succ: 0, yards: 0 }, R: { count: 0, succ: 0, yards: 0 } };
  const hashLabels = { L: "Left Hash", M: "Middle", R: "Right Hash" };
  rzPlays.forEach((p) => {
    const h = p.hash;
    if (hashData[h]) { hashData[h].count++; if (p.success) hashData[h].succ++; hashData[h].yards += Number(p.yards) || 0; }
  });

  const callMap = {};
  rzPlays.forEach((p) => {
    const k = (p.call || "(no call)").trim();
    if (!callMap[k]) callMap[k] = { count: 0, succ: 0, yards: 0 };
    callMap[k].count++; if (p.success) callMap[k].succ++; callMap[k].yards += Number(p.yards) || 0;
  });
  const topCalls = Object.values(callMap)
    .map((c, i) => ({ name: Object.keys(callMap)[i], ...c }))
    .filter((c) => c.count >= 2)
    .sort((a, b) => (b.count ? b.succ / b.count : 0) - (a.count ? a.succ / a.count : 0))
    .slice(0, 8);

  // Fix topCalls — Object.values doesn't preserve key mapping
  const topCallsFixed = Object.entries(callMap)
    .map(([name, c]) => ({ name, ...c }))
    .filter((c) => c.count >= 2)
    .sort((a, b) => (b.count ? b.succ / b.count : 0) - (a.count ? a.succ / a.count : 0))
    .slice(0, 8);

  const runPct = total ? Math.round(100 * runs.length / total) : 0;
  const ordinals = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th" };

  let html = "";

  html += secHead("Overview");
  html += `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:8px">
    ${statCard(total, "RZ Plays")}
    ${statCard(effPct + "%", "Success Rate")}
    ${statCard((Number(avgYds) > 0 ? "+" : "") + avgYds, "Yds / Play")}
    ${statCard(runs.length + " / " + passes.length, "Run / Pass")}
  </div>`;

  html += secHead("By Zone");
  html += row('Scoring Zone <span style="font-weight:400;font-size:12px">(Opp 20–11)</span>', szPlays.length, szSucc, szYds);
  if (drPlays.length) html += row('Deep Red Zone <span style="font-weight:400;font-size:12px">(Opp 10–1)</span>', drPlays.length, drSucc, drYds);

  html += secHead("Run vs Pass");
  if (runs.length) html += row("Run", runs.length, runSucc, runYds);
  if (passes.length) html += row("Pass", passes.length, passSucc, passYds);
  html += `<div style="margin:4px 0 6px;background:#F3F4F6;border-radius:6px;height:8px;overflow:hidden;display:flex">
    <div style="width:${runPct}%;background:var(--royal)"></div>
    <div style="flex:1;background:var(--royal-2)"></div>
  </div>
  <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--slate);margin-bottom:16px">
    <span>&#9632; Run ${runPct}%</span><span>Pass ${100 - runPct}% &#9632;</span>
  </div>`;

  if (Object.keys(downMap).length) {
    html += secHead("By Down");
    [1, 2, 3, 4].forEach((d) => {
      const bd = downMap[String(d)];
      if (!bd || !bd.count) return;
      html += row(ordinals[d] + " Down", bd.count, bd.succ, bd.yards);
    });
  }

  html += secHead("By Hash");
  ["L", "M", "R"].forEach((h) => {
    const hd = hashData[h];
    if (!hd || !hd.count) return;
    html += row(hashLabels[h], hd.count, hd.succ, hd.yards);
  });

  if (topCallsFixed.length) {
    html += secHead('Best Plays in Red Zone <span style="font-weight:400;font-size:11px;text-transform:none;letter-spacing:0">(2+ snaps)</span>');
    topCallsFixed.forEach((c) => html += row(esc(c.name), c.count, c.succ, c.yards));
  }

  return html;
}

// ---------- heat map ----------------------------------------------------------

export function buildHeatMap(playsArr, filterType) {
  const ZONES = [
    { label: "Own 1–20",  min: 1,  max: 20 },
    { label: "Own 21–40", min: 21, max: 40 },
    { label: "Midfield",  min: 41, max: 60 },
    { label: "Opp 40–21", min: 61, max: 80 },
    { label: "Opp 20–11", min: 81, max: 89 },
    { label: "Red Zone",  min: 90, max: 99 },
  ];
  const HASHES = ["L", "M", "R"];
  const HASH_LBL = { L: "Left Hash", M: "Middle", R: "Right Hash" };

  function posFromYl(yl) {
    const n = Number(yl);
    if (yl === "" || yl == null || isNaN(n)) return null;
    return n >= 0 ? n : 100 + n;
  }

  function hmColor(rate, count) {
    if (!count) return "#E8EBF0";
    const h = Math.round(rate * 120);
    const l = count < 3 ? 52 : 43;
    return `hsl(${h},65%,${l}%)`;
  }

  let src = filterType ? playsArr.filter((p) => p.type === filterType) : [...playsArr];
  src = src.filter((p) => p.type !== "punt");

  const grid = {};
  src.forEach((p) => {
    const pos = posFromYl(p.yl);
    if (pos === null) return;
    const zi = ZONES.findIndex((z) => pos >= z.min && pos <= z.max);
    if (zi === -1) return;
    if (!["L", "M", "R"].includes(p.hash)) return;
    const key = `${zi}_${p.hash}`;
    if (!grid[key]) grid[key] = { count: 0, success: 0, yards: 0 };
    grid[key].count++;
    if (p.success) grid[key].success++;
    grid[key].yards += Number(p.yards) || 0;
  });

  const totalPlays = src.filter((p) => {
    const pos = posFromYl(p.yl);
    return pos !== null && ["L", "M", "R"].includes(p.hash);
  }).length;

  const zoneHdrs = ZONES.map((z) => `<div class="hm-zh">${esc(z.label)}</div>`).join("");

  const rows = HASHES.map((h) => {
    const cells = ZONES.map((z, zi) => {
      const d = grid[`${zi}_${h}`] || { count: 0, success: 0, yards: 0 };
      const rate = d.count ? d.success / d.count : 0;
      const pct = d.count ? Math.round(100 * rate) : 0;
      const avg = d.count ? (d.yards / d.count).toFixed(1) : null;
      const bg = hmColor(rate, d.count);
      const inner = d.count
        ? `<div class="hm-cnt">${d.count}</div><div class="hm-pct">${pct}% eff</div>${avg !== null ? `<div class="hm-avg">${Number(avg) > 0 ? "+" : ""}${avg} yds</div>` : ""}`
        : `<div class="hm-empty">—</div>`;
      return `<div class="hm-cell" style="background:${bg}">${inner}</div>`;
    }).join("");
    return `<div class="hm-row"><div class="hm-hlbl">${HASH_LBL[h]}</div>${cells}</div>`;
  }).join("");

  const noData = totalPlays === 0
    ? `<div class="report-empty">No plays with ball-on position data yet.</div>`
    : "";

  return `<div class="hm-wrap">
    <div class="hm-filter-bar">
      <button class="hm-f${!filterType ? " hm-f-on" : ""}" data-hmf="">All Plays</button>
      <button class="hm-f${filterType === "run" ? " hm-f-on" : ""}" data-hmf="run">Run</button>
      <button class="hm-f${filterType === "pass" ? " hm-f-on" : ""}" data-hmf="pass">Pass</button>
      <span class="hm-total">${totalPlays} play${totalPlays !== 1 ? "s" : ""} charted</span>
    </div>
    <div class="hm-zone-header"><div class="hm-zh-spc"></div>${zoneHdrs}</div>
    <div class="hm-field">
      <div class="hm-grid-wrap">
        ${rows}
      </div>
    </div>
    <div class="hm-legend">
      <span class="hm-leg-item"><span class="hm-swatch" style="background:#E8EBF0"></span>No plays</span>
      <span class="hm-leg-item"><span class="hm-swatch" style="background:hsl(0,65%,43%)"></span>0% eff</span>
      <span class="hm-leg-item"><span class="hm-swatch" style="background:hsl(60,65%,43%)"></span>50% eff</span>
      <span class="hm-leg-item"><span class="hm-swatch" style="background:hsl(120,65%,43%)"></span>100% eff</span>
    </div>
    ${noData}
  </div>`;
}

// ---------- file export helpers -----------------------------------------------

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

function csvRow(vals) {
  return vals.map((v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`).join(",");
}

function exportCSV(plays, game, teamSettings) {
  const rosterMap = {};
  ((teamSettings && teamSettings.roster) || []).forEach(p => rosterMap[p.id] = `#${p.jersey} ${p.name}`);
  const head = csvRow(["#","Qtr","Down","Dist","Ball On","Hash","Type","Formation","Play Call","Motion","Front","Coverage","Yards","Effective","Tags","Note","Passer","Receiver","Rusher"]);
  const rows = plays.map((p, i) => csvRow([
    i + 1, p.qtr, p.down, p.dist, p.yl, p.hash, p.type,
    p.form, p.call, p.motion, p.front, p.coverage, p.yards,
    p.success ? "Y" : "N", (p.tags || []).join("|"), p.note || "",
    rosterMap[p.passer] || "", rosterMap[p.receiver] || "", rosterMap[p.rusher] || "",
  ]));
  const title = (game.opponent ? "vs_" + game.opponent : "Game").replace(/\s+/g, "_");
  downloadFile(`${title}_${game.date || "chart"}.csv`, [head, ...rows].join("\n"), "text/csv");
}

function exportHudl(plays, game, teamSettings) {
  const rosterMap = {};
  ((teamSettings && teamSettings.roster) || []).forEach(p => rosterMap[p.id] = `#${p.jersey} ${p.name}`);
  const head = csvRow(["Play #","Down","Distance","Yardline","Hash","Play Type","Formation","Play Call","Motion","Defensive Front","Coverage","Yards Gained","Effective","Tags","Notes","Passer","Receiver","Rusher"]);
  const rows = plays.map((p, i) => csvRow([
    i + 1, p.down || "", p.dist || "", p.yl || "", p.hash, p.type,
    p.form || "", p.call || "", p.motion || "", p.front || "", p.coverage || "",
    p.yards, p.success ? "Y" : "N", (p.tags || []).join("|"), p.note || "",
    rosterMap[p.passer] || "", rosterMap[p.receiver] || "", rosterMap[p.rusher] || "",
  ]));
  const title = (game.opponent ? "vs_" + game.opponent : "Game").replace(/\s+/g, "_");
  downloadFile(`${title}_${game.date || "chart"}_hudl.csv`, [head, ...rows].join("\n"), "text/csv");
}

// ---------- public entry point -----------------------------------------------

export function renderGame(container, user, teamId, game, userRole, teamSettings, onBack) {
  // Per-render state
  let plays = [];
  let editingId = null;
  let unsub = null;
  let penaltyPendingPlay = null;
  let lastPasser = '', lastReceiver = '', lastRusher = '';
  // Change 3 — scrimmage ball tracking (fixed/simulated modes)
  let scrimmStartYl   = null;
  let scrimmStartSign = -1;
  let timedSeries     = 1;
  let timedIntervalId = null;
  let timedRunning    = false;
  let timedRemaining  = 0;
  // Change 4 — TD re-spot state
  let isTouchdown = false;
  let hmFilter = "";

  // Role gates
  const canChart  = userRole !== "readonly";   // add & edit plays
  const canDelete = userRole !== "readonly";   // delete individual plays
  // (deleting games is admin-only, enforced in dashboard)

  const mode = game.mode || "standard";
  const is7   = mode === "7v7";
  const isScrim = mode === "scrimmage";

  // Change 1 — Apply team accent color
  const accentColor = teamSettings.settings?.accentColor || "#16317F";
  document.documentElement.style.setProperty("--royal", accentColor);
  // Derive a lighter tint for backgrounds (approx 15% opacity on white)
  document.documentElement.style.setProperty("--royal-bg", accentColor + "26");

  const settings = {
    effStd1:     teamSettings?.effStd1     ?? 5,
    effStd2:     teamSettings?.effStd2     ?? 50,
    effStd3:     teamSettings?.effStd3     ?? 100,
    effStd4:     teamSettings?.effStd4     ?? 100,
    effScrim:    teamSettings?.effScrim    ?? 5,
    defaultDist: teamSettings?.defaultDist ?? 10,
    scrimmPlays: teamSettings?.scrimmPlays ?? 10,
    // Change 2 — 7v7 knobs from teamSettings
    start7v7:       teamSettings.settings?.start7v7       ?? 40,
    line1_7v7:      teamSettings.settings?.line1_7v7      ?? 20,
    line2_7v7:      teamSettings.settings?.line2_7v7      ?? 5,
    playsPerSeries7v7: teamSettings.settings?.playsPerSeries7v7 ?? 4,
    eff7v7Mode:     teamSettings.settings?.eff7v7Mode     ?? "pace",
    // Change 3 — scrimmage ball-movement mode and series type
    scrimmageMode:  teamSettings.settings?.scrimmageMode  ?? "advance",
    effScrimPlays:  teamSettings.settings?.effScrimPlays  ?? 10,
    seriesType:     teamSettings.settings?.scrimmageSeriesType ?? "fixed",
  };

  // Draft holds the in-progress form values that are NOT simple text inputs.
  const isSimScrimInit = isScrim && (teamSettings.settings?.scrimmageMode ?? "advance") === "simulated";
  const draft = {
    qtr:       is7 || isScrim ? "" : "1",
    down:      isSimScrimInit ? "1" : isScrim ? "" : "1",
    hash:      "M",
    type:      is7 ? "pass" : "run",
    ylSign:    is7 ? 1 : -1,
    yardSign:  1,
    effective: true,
    effTouched: false,
    fdAuto:    false,
    fdTouched: false,
    motionOn:  false,
    tags:      [],
    note:      "",
  };

  container.innerHTML = buildHTML(game, mode);

  // Readonly users: hide entry form, mark table as non-interactive
  if (!canChart) {
    const entrySection = container.querySelector(".entry");
    if (entrySection) entrySection.style.display = "none";
    const tbl = container.querySelector("table");
    if (tbl) tbl.classList.add("readonly-rows");
  }

  // ---- back button ----
  document.getElementById("gameBackBtn").addEventListener("click", () => {
    if (unsub) unsub();
    onBack();
  });

  // ---- segmented controls ----
  function wireSeg(id, key, after) {
    const box = document.getElementById(id);
    if (!box) return;
    box.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      Array.from(box.children).forEach((c) => c.classList.remove("on"));
      b.classList.add("on");
      draft[key] = b.getAttribute("data-v");
      if (after) after();
    });
  }
  wireSeg("qtr",   "qtr");
  wireSeg("hash",  "hash");
  wireSeg("ptype", "type", () => { updatePlayerFieldVisibility(draft.type); });
  wireSeg("down",  "down", () => { refreshAutoEff(); update7v7Hint(); });

  // ---- effective checkbox ----
  const effBtn = document.getElementById("effBtn");
  function paintEff() {
    effBtn.classList.toggle("on", !!draft.effective);
    effBtn.setAttribute("aria-pressed", draft.effective ? "true" : "false");
  }
  effBtn.addEventListener("click", () => {
    draft.effective = !draft.effective;
    draft.effTouched = true;
    paintEff();
    document.getElementById("effHint").textContent = "Set by you for this play";
  });

  // Change 4 — TD toggle button
  const tdBtn = document.getElementById("tdBtn");
  function paintTdBtn() {
    tdBtn.style.background = isTouchdown ? "#15803d" : "#fff";
    tdBtn.style.color      = isTouchdown ? "#fff"    : "var(--ink)";
    tdBtn.style.border     = isTouchdown ? "1.5px solid #15803d" : "1.5px solid #E2E8F0";
    tdBtn.setAttribute("aria-pressed", isTouchdown ? "true" : "false");
  }
  tdBtn.addEventListener("click", () => {
    isTouchdown = !isTouchdown;
    paintTdBtn();
  });
  paintTdBtn();
  function refreshAutoEff() {
    if (draft.effTouched) return;
    draft.effective = autoEffective(
      mode, draft.down, document.getElementById("dist").value, getYards(), settings
    );
    paintEff();
  }

  // ---- yards sign ----
  function getYards() {
    const m = Number(document.getElementById("yards").value);
    return draft.yardSign * Math.abs(isNaN(m) ? 0 : m);
  }
  function paintYardSign() {
    const b = document.getElementById("yardSignBtn");
    const hint = document.getElementById("yardsHint");
    if (draft.yardSign < 0) {
      b.textContent = "−"; b.className = "signbtn loss";
      hint.innerHTML = "Loss &mdash; tap to switch back to a gain";
    } else {
      b.textContent = "+"; b.className = "signbtn gain";
      hint.innerHTML = "Gain &mdash; tap +/&minus; for a loss";
    }
  }
  document.getElementById("yardSignBtn").addEventListener("click", () => {
    draft.yardSign = draft.yardSign < 0 ? 1 : -1;
    paintYardSign(); onPlayInput();
  });
  paintYardSign();

  // ---- ball-on sign ----
  function getYL() {
    const v = Math.abs(parseInt(document.getElementById("yl").value, 10));
    if (!v || isNaN(v)) return "";
    return String(draft.ylSign < 0 ? -v : v);
  }
  function paintYlSign() {
    const b = document.getElementById("ylSignBtn");
    const hint = document.getElementById("ylHint");
    if (!b) return;
    const atMid = (parseInt(document.getElementById("yl").value, 10) === 50);
    if (atMid) {
      b.textContent = "50"; b.className = "signbtn mid";
      if (hint) hint.innerHTML = "Midfield &mdash; tap &plusmn; to flip side";
    } else if (draft.ylSign < 0) {
      b.textContent = "−"; b.className = "signbtn loss";
      if (hint) hint.innerHTML = "Your side &mdash; tap &plusmn; to flip";
    } else {
      b.textContent = "+"; b.className = "signbtn gain";
      if (hint) hint.innerHTML = "Opp's side &mdash; tap &plusmn; to flip";
    }
  }
  const ylSignBtn = document.getElementById("ylSignBtn");
  if (ylSignBtn) {
    ylSignBtn.addEventListener("click", () => {
      draft.ylSign = draft.ylSign < 0 ? 1 : -1;
      paintYlSign();
    });
  }
  paintYlSign();

  // ---- motion checkbox ----
  const motionBtn = document.getElementById("motionBtn");
  function paintMotion() {
    motionBtn.classList.toggle("on", !!draft.motionOn);
    motionBtn.setAttribute("aria-pressed", draft.motionOn ? "true" : "false");
    document.getElementById("motionNameWrap").hidden = !draft.motionOn;
  }
  motionBtn.addEventListener("click", () => {
    draft.motionOn = !draft.motionOn;
    if (!draft.motionOn) document.getElementById("motion").value = "";
    paintMotion();
    if (draft.motionOn) document.getElementById("motion").focus();
  });
  paintMotion();

  // ---- result chips ----
  document.getElementById("tags").addEventListener("click", (e) => {
    const b = e.target.closest(".chip");
    if (!b) return;
    b.classList.toggle("on");
    const v = b.getAttribute("data-v");
    const i = draft.tags.indexOf(v);
    if (i > -1) draft.tags.splice(i, 1); else draft.tags.push(v);
    if (v === "1st Down") draft.fdTouched = true;
    if (v === "TD" && draft.tags.indexOf("TD") > -1) {
      const ylStr = getYL();
      const ylNum = Number(ylStr);
      if (!isNaN(ylNum) && ylNum !== 0) {
        const pos = ylNum <= 0 ? -ylNum : 100 - ylNum;
        const ydsToEnd = 100 - pos;
        if (ydsToEnd > 0 && ydsToEnd <= 100) {
          draft.yardSign = 1; paintYardSign();
          document.getElementById("yards").value = String(ydsToEnd);
          refreshAutoEff();
        }
      }
    }
  });

  // ---- auto first-down chip ----
  function setChip(value, on) {
    Array.from(document.querySelectorAll("#tags .chip")).forEach((b) => {
      if (b.getAttribute("data-v") === value) b.classList.toggle("on", on);
    });
    const i = draft.tags.indexOf(value);
    if (on  && i < 0) draft.tags.push(value);
    if (!on && i > -1) draft.tags.splice(i, 1);
  }
  function refreshAutoFirstDown() {
    if (draft.fdTouched) return;
    const dist  = Number(document.getElementById("dist").value) || 0;
    const yards = getYards();
    const gotIt = dist > 0 && yards >= dist;
    if (gotIt) { setChip("1st Down", true);  draft.fdAuto = true; }
    else if (draft.fdAuto) { setChip("1st Down", false); draft.fdAuto = false; }
  }
  function onPlayInput() { refreshAutoEff(); refreshAutoFirstDown(); }
  document.getElementById("dist").addEventListener("input", onPlayInput);
  document.getElementById("yards").addEventListener("input", onPlayInput);
  document.getElementById("yl").addEventListener("input", () => { update7v7Hint(); paintYlSign(); });

  // ---- mode-specific helpers ----
  function update7v7Hint() {
    if (mode !== "7v7") return;
    const hint   = document.getElementById("seriesHint");
    const ballOn = document.getElementById("yl").value;
    if (ballOn === "" || isNaN(Number(ballOn))) {
      hint.innerHTML = "Enter where the ball is (yards from the goal) — start at the 40";
      return;
    }
    const t    = target7v7(ballOn, settings.line1_7v7, settings.line2_7v7);
    const toGo = Number(ballOn) - t;
    document.getElementById("dist").value = toGo;
    const targetLabel = t === 0 ? "the end zone" : "the " + t;
    hint.innerHTML = `Play <b>${esc(draft.down)} of 4</b> · reach <b>${targetLabel}</b> · <b>${toGo}</b> to go`;
    refreshAutoEff();
  }
  function fmtTime(sec) {
    const m = Math.floor(sec / 60), s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  function stopTimer() {
    if (timedIntervalId) { clearInterval(timedIntervalId); timedIntervalId = null; }
    timedRunning = false;
  }
  function tickTimer() {
    if (timedRemaining > 0) {
      timedRemaining--;
      document.getElementById("timerDisplay").textContent = fmtTime(timedRemaining);
    }
    if (timedRemaining <= 0) expirePeriod();
  }
  function startTicking() {
    timedRunning = true;
    timedIntervalId = setInterval(tickTimer, 1000);
  }
  function expirePeriod() {
    stopTimer();
    timedSeries++;
    timedRemaining = 0;
    document.getElementById("timedActive").style.display = "none";
    document.getElementById("timedIdle").style.display   = "flex";
    document.getElementById("timerPauseBtn").innerHTML   = "&#9646;&#9646; Pause";
    updateScrimHint();
  }
  function updateScrimHint() {
    if (mode !== "scrimmage") return;
    const ctrl = document.getElementById("timedControls");
    if (settings.seriesType === "timed") {
      const n = plays.filter(p => String(p.series) === String(timedSeries)).length;
      document.getElementById("seriesHint").innerHTML =
        `Period <b>${timedSeries}</b> · <b>${n}</b> play${n !== 1 ? "s" : ""} logged`;
      if (ctrl) ctrl.style.display = "flex";
      return;
    }
    if (ctrl) ctrl.style.display = "none";
    const sp = settings.effScrimPlays || 10;
    const playNum = (plays.length % sp) + 1;
    const series  = Math.floor(plays.length / sp) + 1;
    document.getElementById("seriesHint").innerHTML =
      `Play <b>${playNum} of ${sp}</b> · series <b>${series}</b> · effective at ${settings.effScrim || 5}+ yards`;
  }

  // Apply mode visibility once on initial render
  applyModeVisibility();
  populatePlayerDropdowns();
  updatePlayerFieldVisibility(draft.type);
  if (is7) {
    document.getElementById("yl").value = settings.start7v7;
    update7v7Hint();
  } else if (isScrim) {
    updateScrimHint();
  }

  // Timed period controls
  document.getElementById("timerStartBtn").addEventListener("click", () => {
    const mins = Math.max(1, parseInt(document.getElementById("timedMinsInput").value, 10) || 5);
    timedRemaining = mins * 60;
    document.getElementById("timerDisplay").textContent = fmtTime(timedRemaining);
    document.getElementById("timedIdle").style.display   = "none";
    document.getElementById("timedActive").style.display = "flex";
    startTicking();
  });
  document.getElementById("timerPauseBtn").addEventListener("click", () => {
    if (timedRunning) {
      stopTimer();
      document.getElementById("timerPauseBtn").innerHTML = "&#9654; Resume";
    } else {
      document.getElementById("timerPauseBtn").innerHTML = "&#9646;&#9646; Pause";
      startTicking();
    }
  });
  document.getElementById("timeExpiredBtn").addEventListener("click", expirePeriod);

  function applyModeVisibility() {
    const isSimScrim = isScrim && settings.scrimmageMode === "simulated";
    document.getElementById("qtrFld").style.display   = is7 || isScrim ? "none" : "";
    document.getElementById("downFld").style.display  = (isScrim && !isSimScrim) ? "none" : "";
    document.getElementById("ptypeFld").style.display = is7 ? "none" : "";
    document.getElementById("distFld").style.display  = is7 || (isScrim && !isSimScrim) ? "none" : "";
    document.getElementById("seriesRow").style.display = is7 || isScrim ? "" : "none";
    document.getElementById("frontFld").style.display = is7 ? "none" : "";
    const modeBadge = document.getElementById("modeBadge");
    if (modeBadge) {
      modeBadge.style.display = is7 || isScrim ? "" : "none";
      modeBadge.textContent = is7 ? "7v7 · pass-only" : isScrim ? (settings.seriesType === "timed" ? "Scrimmage · Timed periods" : `Scrimmage · ${settings.effScrimPlays || 10}-play series`) : "";
    }
    const ylSignBtnEl = document.getElementById("ylSignBtn");
    const ylHintEl    = document.getElementById("ylHint");
    if (ylSignBtnEl) ylSignBtnEl.style.display = is7 ? "none" : "";
    if (ylHintEl)    ylHintEl.style.display    = is7 ? "none" : "";
  }

  // ---- player tracking helpers ----
  function populatePlayerDropdowns() {
    const byName = (teamSettings.rosterSort === "name");
    const sorted = [...(teamSettings.roster || [])].sort((a, b) =>
      byName
        ? a.name.toLowerCase().localeCompare(b.name.toLowerCase())
        : (Number(a.jersey) || 0) - (Number(b.jersey) || 0)
    );
    ["fPasser", "fReceiver", "fRusher"].forEach(selId => {
      const el = document.getElementById(selId);
      if (!el) return;
      const prev = el.value;
      el.innerHTML = '<option value="">— select —</option>' +
        sorted.map(p => `<option value="${esc(p.id)}">#${esc(p.jersey)} ${esc(p.name)} (${esc(p.pos)})</option>`).join("");
      el.value = prev;
    });
  }

  function updatePlayerFieldVisibility(typeVal) {
    const track = teamSettings.trackPlayers && (teamSettings.roster || []).length > 0;
    const showPass = track && typeVal === "pass";
    const showRun  = track && typeVal === "run";
    const pr = document.getElementById("passerRow");
    const rc = document.getElementById("receiverRow");
    const ru = document.getElementById("rusherRow");
    if (pr) pr.style.display = showPass ? "" : "none";
    if (rc) rc.style.display = showPass ? "" : "none";
    if (ru) ru.style.display = showRun  ? "" : "none";
  }

  function buildPlayersReport(plays, teamSettings) {
    if (!teamSettings.trackPlayers || !(teamSettings.roster || []).length) {
      return '<div class="report-empty">Enable "Track players" in Settings and add a roster to see player stats.</div>';
    }
    const rosterMap = {};
    (teamSettings.roster || []).forEach(p => rosterMap[p.id] = p);

    const passerStats = {}, receiverStats = {}, rusherStats = {};
    plays.forEach(p => {
      if (p.passer && rosterMap[p.passer]) {
        if (!passerStats[p.passer]) passerStats[p.passer] = {id: p.passer, att: 0, yds: 0, eff: 0};
        passerStats[p.passer].att++;
        passerStats[p.passer].yds += Number(p.yards) || 0;
        if (p.success) passerStats[p.passer].eff++;
      }
      if (p.receiver && rosterMap[p.receiver]) {
        if (!receiverStats[p.receiver]) receiverStats[p.receiver] = {id: p.receiver, tgts: 0, yds: 0, eff: 0};
        receiverStats[p.receiver].tgts++;
        receiverStats[p.receiver].yds += Number(p.yards) || 0;
        if (p.success) receiverStats[p.receiver].eff++;
      }
      if (p.rusher && rosterMap[p.rusher]) {
        if (!rusherStats[p.rusher]) rusherStats[p.rusher] = {id: p.rusher, car: 0, yds: 0, eff: 0};
        rusherStats[p.rusher].car++;
        rusherStats[p.rusher].yds += Number(p.yards) || 0;
        if (p.success) rusherStats[p.rusher].eff++;
      }
    });

    function playerRow(stat, countKey, countLabel) {
      const pl = rosterMap[stat.id];
      const n = stat[countKey] || 1;
      const rate = Math.round(100 * stat.eff / n);
      const avg = (stat.yds / n).toFixed(1);
      return `<div class="rpt-row">
        <div class="rpt-label"><b>#${esc(pl.jersey)}</b> ${esc(pl.name)} <span style="font-size:11px;color:var(--slate)">${esc(pl.pos)}</span></div>
        <div class="rpt-stats">
          <span class="rpt-n">${n} ${countLabel}</span>
          <span class="rpt-avg">${avg} yds</span>
          <span class="rpt-eff" style="color:${rate>=50?"#15803d":"#b91c1c"}">${rate}% eff</span>
        </div>
        <div class="rpt-bar-wrap"><div class="rpt-bar" style="width:${rate}%"></div></div>
      </div>`;
    }

    let html = "";
    const passers = Object.values(passerStats).sort((a,b) => (b.eff/b.att)-(a.eff/a.att));
    if (passers.length) {
      html += '<div class="report-section-head">Passers</div>';
      html += passers.map(s => playerRow(s, "att", "att")).join("");
    }
    const receivers = Object.values(receiverStats).sort((a,b) => (b.eff/b.tgts)-(a.eff/a.tgts));
    if (receivers.length) {
      html += '<div class="report-section-head">Receivers</div>';
      html += receivers.map(s => playerRow(s, "tgts", "tgts")).join("");
    }
    const rushers = Object.values(rusherStats).sort((a,b) => (b.eff/b.car)-(a.eff/a.car));
    if (rushers.length) {
      html += '<div class="report-section-head">Rushers</div>';
      html += rushers.map(s => playerRow(s, "car", "carries")).join("");
    }

    // By play call
    const callPlayer = {};
    plays.forEach(p => {
      const callKey = (p.call || "").trim();
      if (!callKey) return;
      const pid = p.passer || p.rusher || p.receiver;
      if (!pid || !rosterMap[pid]) return;
      const k = callKey + "|||" + pid;
      if (!callPlayer[k]) callPlayer[k] = {call: callKey, id: pid, n: 0, yds: 0, eff: 0};
      callPlayer[k].n++;
      callPlayer[k].yds += Number(p.yards) || 0;
      if (p.success) callPlayer[k].eff++;
    });
    const byCal = {};
    Object.values(callPlayer).forEach(item => {
      if (!byCal[item.call]) byCal[item.call] = [];
      byCal[item.call].push(item);
    });
    const callKeys = Object.keys(byCal).filter(k => byCal[k].reduce((a,b)=>a+b.n,0) >= 2);
    if (callKeys.length) {
      html += '<div class="report-section-head">By play call</div>';
      callKeys.sort().forEach(callKey => {
        const items = byCal[callKey].sort((a,b)=>(b.eff/b.n)-(a.eff/a.n));
        html += `<div class="rpt-group-label">${esc(callKey)}</div>` +
          items.map(s => {
            const pl = rosterMap[s.id];
            const rate = Math.round(100*s.eff/s.n);
            const avg = (s.yds/s.n).toFixed(1);
            return `<div class="rpt-row" style="padding-left:14px">
              <div class="rpt-label"><b>#${esc(pl.jersey)}</b> ${esc(pl.name)} <span style="font-size:11px;color:var(--slate)">${esc(pl.pos)}</span></div>
              <div class="rpt-stats">
                <span class="rpt-n">${s.n} plays</span>
                <span class="rpt-avg">${avg} yds</span>
                <span class="rpt-eff" style="color:${rate>=50?"#15803d":"#b91c1c"}">${rate}% eff</span>
              </div>
              <div class="rpt-bar-wrap"><div class="rpt-bar" style="width:${rate}%"></div></div>
            </div>`;
          }).join("");
      });
    }

    return html || '<div class="report-empty">No player data logged yet this game.</div>';
  }

  function buildGameStats() {
    if (!plays.length) return '<div class="report-empty">No plays logged yet.</div>';

    const pct = (n, d) => d ? Math.round(100 * n / d) + "%" : "—";
    const yavg = (total, count) => count ? (total / count).toFixed(1) : "—";
    const signYds = (n) => n > 0 ? "+" + n : String(n);
    const esc2 = (s) => esc(s || "");

    const card = (val, lbl, sub) =>
      `<div style="background:var(--chalk,#F1F5F9);border-radius:10px;padding:12px 8px;text-align:center">
        <div style="font-family:var(--num,Oswald);font-size:22px;font-weight:700;color:var(--royal,#16317F);line-height:1.1">${val}</div>
        <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--slate,#6B7280);margin-top:4px">${lbl}</div>
        ${sub ? `<div style="font-size:10px;color:var(--slate);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${sub}</div>` : ""}
      </div>`;

    const grid = (cards, cols = 3) =>
      `<div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:8px;margin-bottom:8px">${cards.join("")}</div>`;

    const secHead = (title) =>
      `<div style="font-family:var(--num,Oswald);text-transform:uppercase;letter-spacing:.06em;font-size:11px;font-weight:700;color:var(--royal,#16317F);padding:4px 0 5px;border-bottom:2px solid var(--chalk,#E8EEF9);margin:18px 0 10px">${title}</div>`;

    const runs     = plays.filter(p => p.type === "run");
    const passes   = plays.filter(p => p.type === "pass");
    const punts    = plays.filter(p => p.type === "punt");
    const scrimmage = plays.filter(p => p.type !== "punt");

    const totalYards = plays.reduce((s, p) => s + (Number(p.yards) || 0), 0);
    const rushYards  = runs.reduce((s, p) => s + (Number(p.yards) || 0), 0);
    const passYards  = passes.reduce((s, p) => s + (Number(p.yards) || 0), 0);

    const effAll    = plays.filter(p => p.success).length;
    const effRuns   = runs.filter(p => p.success).length;
    const effPasses = passes.filter(p => p.success).length;

    const firstDowns = scrimmage.filter(p => (Number(p.yards) || 0) >= (Number(p.dist) || 10));

    const longestOf = arr => arr.length ? arr.reduce((best, p) =>
      (Number(p.yards) || 0) > (Number(best.yards) || 0) ? p : best, arr[0]) : null;
    const longestPlay = longestOf(scrimmage);
    const longestRun  = longestOf(runs);
    const longestPass = longestOf(passes);

    const negRuns   = runs.filter(p => (Number(p.yards) || 0) < 0);
    const negPasses = passes.filter(p => (Number(p.yards) || 0) < 0);
    const allNeg    = scrimmage.filter(p => (Number(p.yards) || 0) < 0);
    const negYards  = allNeg.reduce((s, p) => s + (Number(p.yards) || 0), 0);
    const biggestLossPlay = allNeg.length ? allNeg.reduce((worst, p) =>
      (Number(p.yards) || 0) < (Number(worst.yards) || 0) ? p : worst, allNeg[0]) : null;

    const downStats = (d) => {
      const sub = plays.filter(p => Number(p.down) === d);
      const yds = sub.reduce((s, p) => s + (Number(p.yards) || 0), 0);
      const convs = sub.filter(p => (Number(p.yards) || 0) >= (Number(p.dist) || 10)).length;
      const eff = sub.filter(p => p.success).length;
      return { n: sub.length, yds, convs, eff, ypp: sub.length ? (yds / sub.length).toFixed(1) : "0.0" };
    };
    const [d1, d2, d3, d4] = [1, 2, 3, 4].map(downStats);

    const s2short = plays.filter(p => Number(p.down) === 2 && (Number(p.dist) || 10) <= 3);
    const s2long  = plays.filter(p => Number(p.down) === 2 && (Number(p.dist) || 10) >= 8);
    const s3short = plays.filter(p => Number(p.down) === 3 && (Number(p.dist) || 10) <= 3);
    const s3long  = plays.filter(p => Number(p.down) === 3 && (Number(p.dist) || 10) >= 8);

    const drives = [];
    let curDr = [];
    for (const pl of plays) {
      curDr.push(pl);
      if (pl.type === "punt" || (Number(pl.down) === 4 && !pl.success)) {
        drives.push([...curDr]); curDr = [];
      }
    }
    if (curDr.length) drives.push(curDr);

    const totalDriveYards = drives.reduce((s, d) => s + d.reduce((sy, p) => sy + (Number(p.yards) || 0), 0), 0);
    const threeAndOuts = drives.filter(d => {
      const last = d[d.length - 1];
      const nonPunt = d.filter(p => p.type !== "punt").length;
      return last.type === "punt" && nonPunt <= 3;
    }).length;
    const turnoverOnDowns = drives.filter(d => {
      const last = d[d.length - 1];
      return Number(last.down) === 4 && !last.success;
    }).length;

    const exp10 = scrimmage.filter(p => (Number(p.yards) || 0) >= 10).length;
    const exp15 = scrimmage.filter(p => (Number(p.yards) || 0) >= 15).length;
    const exp20 = scrimmage.filter(p => (Number(p.yards) || 0) >= 20).length;

    const hasDowns  = plays.some(p => p.down);
    const hasQtrs   = plays.some(p => p.qtr);
    const hasSeries = plays.some(p => p.series);

    let html = `<div style="padding:4px 0 24px">`;

    // Overview
    html += secHead("Offense Overview");
    html += grid([
      card(plays.length, "Total Plays"),
      card(signYds(totalYards), "Net Yards"),
      card(yavg(totalYards, plays.length), "Yards / Play"),
      card(firstDowns.length, "1st Downs"),
      card(pct(effAll, plays.length), "Overall Eff."),
      card(punts.length, "Punts"),
    ]);
    if (longestPlay) {
      html += `<div style="font-size:12px;color:var(--slate);text-align:center;margin-bottom:6px">Longest play: <b style="font-family:var(--num)">${Number(longestPlay.yards) || 0} yds</b>${longestPlay.call ? " &middot; " + esc2(longestPlay.call) : ""}</div>`;
    }

    // Run game
    if (runs.length) {
      html += secHead("Run Game");
      html += grid([
        card(runs.length, "Carries"),
        card(rushYards, "Rush Yards"),
        card(yavg(rushYards, runs.length), "Yards / Carry"),
        card(pct(effRuns, runs.length), "Rush Eff."),
        card(longestRun ? (Number(longestRun.yards) || 0) + " yds" : "—", "Longest Run", longestRun?.call ? esc2(longestRun.call) : ""),
        card(negRuns.length, "Neg. Runs"),
      ]);
    }

    // Pass game
    if (passes.length) {
      html += secHead("Pass Game");
      html += grid([
        card(passes.length, "Attempts"),
        card(passYards, "Pass Yards"),
        card(yavg(passYards, passes.length), "Yards / Att."),
        card(pct(effPasses, passes.length), "Pass Eff."),
        card(longestPass ? (Number(longestPass.yards) || 0) + " yds" : "—", "Longest Pass", longestPass?.call ? esc2(longestPass.call) : ""),
        card(negPasses.length, "Sacks / Losses"),
      ]);
    }

    // Down & distance
    if (hasDowns) {
      html += secHead("Down &amp; Distance");
      html += `<div class="table-scroll"><table style="font-size:13px"><thead><tr>
        <th style="text-align:left">Down</th><th>Plays</th><th>Conv.</th><th>Conv %</th><th>Avg Yds</th><th>Eff %</th>
        </tr></thead><tbody>`;
      [[1,"1st",d1],[2,"2nd",d2],[3,"3rd",d3],[4,"4th",d4]].forEach(([, lbl, ds]) => {
        if (!ds.n) return;
        const yppColor = Number(ds.ypp) >= 0 ? "#15803d" : "#b91c1c";
        html += `<tr>
          <td><b>${lbl} Down</b></td>
          <td style="font-family:var(--num);text-align:center">${ds.n}</td>
          <td style="font-family:var(--num);text-align:center">${ds.convs}/${ds.n}</td>
          <td style="font-family:var(--num);text-align:center"><b>${pct(ds.convs, ds.n)}</b></td>
          <td style="font-family:var(--num);text-align:center;color:${yppColor}">${Number(ds.ypp) >= 0 ? "+" : ""}${ds.ypp}</td>
          <td style="font-family:var(--num);text-align:center">${pct(ds.eff, ds.n)}</td>
        </tr>`;
      });
      html += `</tbody></table></div>`;

      const sitCards = [];
      if (s2short.length) { const c = s2short.filter(p => (Number(p.yards)||0) >= (Number(p.dist)||3)).length; sitCards.push(card(pct(c,s2short.length), "2nd &amp; Short (≤3)", s2short.length + " plays")); }
      if (s2long.length)  { const c = s2long.filter(p => (Number(p.yards)||0) >= (Number(p.dist)||8)).length;  sitCards.push(card(pct(c,s2long.length),  "2nd &amp; Long (8+)",  s2long.length  + " plays")); }
      if (s3short.length) { const c = s3short.filter(p => (Number(p.yards)||0) >= (Number(p.dist)||3)).length; sitCards.push(card(pct(c,s3short.length), "3rd &amp; Short (≤3)", s3short.length + " plays")); }
      if (s3long.length)  { const c = s3long.filter(p => (Number(p.yards)||0) >= (Number(p.dist)||8)).length;  sitCards.push(card(pct(c,s3long.length),  "3rd &amp; Long (8+)",  s3long.length  + " plays")); }
      if (sitCards.length) {
        html += `<div style="margin-top:10px"><div style="display:grid;grid-template-columns:repeat(${Math.min(sitCards.length,2)},1fr);gap:8px">${sitCards.join("")}</div></div>`;
      }
    }

    // Series / Drives
    html += secHead("Series / Drives");
    html += grid([
      card(drives.length, "Total Drives"),
      card(yavg(plays.length, drives.length), "Plays / Drive"),
      card(yavg(totalDriveYards, drives.length), "Yards / Drive"),
      card(threeAndOuts, "3-and-Outs"),
      card(turnoverOnDowns, "TOD"),
      card(punts.length, "Punts"),
    ]);

    // Explosive plays
    if (exp10 > 0 || exp15 > 0 || exp20 > 0) {
      html += secHead("Explosive Plays");
      html += grid([
        card(exp10, "10+ Yard Gains"),
        card(exp15, "15+ Yard Gains"),
        card(exp20, "20+ Yard Gains"),
      ]);
    }

    // Negative plays
    if (allNeg.length > 0) {
      html += secHead("Negative Plays");
      html += grid([
        card(allNeg.length, "Neg. Plays"),
        card(negYards + " yds", "Yards Lost"),
        card(biggestLossPlay ? (Number(biggestLossPlay.yards) || 0) + " yds" : "—", "Biggest Loss", biggestLossPlay?.call ? esc2(biggestLossPlay.call) : ""),
      ]);
    }

    // Run / pass split
    if (runs.length && passes.length) {
      const total  = runs.length + passes.length;
      const runPct = Math.round(100 * runs.length / total);
      const pasPct = 100 - runPct;
      html += secHead("Run / Pass Split");
      html += `<div style="margin-bottom:10px">
        <div style="display:flex;height:30px;border-radius:8px;overflow:hidden;margin-bottom:8px">
          <div style="flex:${runPct};background:var(--royal,#16317F);display:flex;align-items:center;justify-content:center">
            <span style="font-family:var(--num);font-size:12px;color:#fff;font-weight:700">${runPct >= 12 ? runPct + "% RUN" : ""}</span>
          </div>
          <div style="flex:${pasPct};background:#2ECC71;display:flex;align-items:center;justify-content:center">
            <span style="font-family:var(--num);font-size:12px;color:#fff;font-weight:700">${pasPct >= 12 ? pasPct + "% PASS" : ""}</span>
          </div>
        </div>
        <div style="display:flex;justify-content:space-around;font-size:12px;color:var(--slate)">
          <span>${runs.length} car &middot; ${rushYards} yds &middot; ${yavg(rushYards, runs.length)} ypc</span>
          <span>${passes.length} att &middot; ${passYards} yds &middot; ${yavg(passYards, passes.length)} ypa</span>
        </div>
      </div>`;
    }

    // By quarter
    if (hasQtrs) {
      const qtrRowsHtml = ["Q1","Q2","Q3","Q4"].map(q => {
        const sub = plays.filter(p => p.qtr === q);
        if (!sub.length) return "";
        const yds = sub.reduce((s, p) => s + (Number(p.yards) || 0), 0);
        const eff = sub.filter(p => p.success).length;
        return `<tr>
          <td><b>${q}</b></td>
          <td style="font-family:var(--num);text-align:center">${sub.length}</td>
          <td style="font-family:var(--num);text-align:center">${signYds(yds)}</td>
          <td style="font-family:var(--num);text-align:center">${yavg(yds, sub.length)}</td>
          <td style="font-family:var(--num);text-align:center">${pct(eff, sub.length)}</td>
        </tr>`;
      }).filter(Boolean).join("");
      if (qtrRowsHtml) {
        html += secHead("By Quarter");
        html += `<div class="table-scroll"><table style="font-size:13px"><thead><tr>
          <th style="text-align:left">Qtr</th><th>Plays</th><th>Yards</th><th>Avg</th><th>Eff %</th>
          </tr></thead><tbody>${qtrRowsHtml}</tbody></table></div>`;
      }
    }

    // By series (scrimmage mode)
    if (hasSeries) {
      const serNums = [...new Set(plays.map(p => p.series).filter(Boolean))].sort((a, b) => Number(a) - Number(b));
      const serRowsHtml = serNums.slice(0, 16).map(s => {
        const sub = plays.filter(p => p.series === s);
        const yds = sub.reduce((sy, p) => sy + (Number(p.yards) || 0), 0);
        const eff = sub.filter(p => p.success).length;
        return `<tr>
          <td><b>Series ${s}</b></td>
          <td style="font-family:var(--num);text-align:center">${sub.length}</td>
          <td style="font-family:var(--num);text-align:center">${signYds(yds)}</td>
          <td style="font-family:var(--num);text-align:center">${yavg(yds, sub.length)}</td>
          <td style="font-family:var(--num);text-align:center">${pct(eff, sub.length)}</td>
        </tr>`;
      }).join("");
      if (serRowsHtml) {
        html += secHead("By Series");
        html += `<div class="table-scroll"><table style="font-size:13px"><thead><tr>
          <th style="text-align:left">Series</th><th>Plays</th><th>Yards</th><th>Avg</th><th>Eff %</th>
          </tr></thead><tbody>${serRowsHtml}</tbody></table></div>`;
      }
    }

    // Player stats (only when tracking enabled)
    if (teamSettings.trackPlayers && (teamSettings.roster || []).length) {
      const rosterMap = {};
      (teamSettings.roster || []).forEach(r => rosterMap[r.id] = r);

      const passerStats = {}, receiverStats = {}, rusherStats = {};
      plays.forEach(p => {
        const addStat = (pid, bucket) => {
          if (!pid || !rosterMap[pid]) return;
          if (!bucket[pid]) bucket[pid] = {id: pid, n: 0, yds: 0, eff: 0};
          bucket[pid].n++;
          bucket[pid].yds += Number(p.yards) || 0;
          if (p.success) bucket[pid].eff++;
        };
        addStat(p.passer, passerStats);
        addStat(p.receiver, receiverStats);
        addStat(p.rusher, rusherStats);
      });

      const playerRow = (stat, countLabel) => {
        const pl = rosterMap[stat.id];
        const rate = stat.n ? Math.round(100 * stat.eff / stat.n) : 0;
        const avgY = stat.n ? (stat.yds / stat.n).toFixed(1) : "0.0";
        return `<div class="rpt-row">
          <div class="rpt-label"><b>#${esc(pl.jersey)}</b> ${esc(pl.name)}${pl.pos ? ` <span style="font-size:11px;color:var(--slate)">${esc(pl.pos)}</span>` : ""}</div>
          <div class="rpt-stats">
            <span class="rpt-n">${stat.n} ${countLabel}</span>
            <span class="rpt-avg">${stat.yds} yds &middot; ${avgY} avg</span>
            <span class="rpt-eff" style="color:${rate >= 50 ? "#15803d" : "#b91c1c"}">${rate}% eff</span>
          </div>
          <div class="rpt-bar-wrap"><div class="rpt-bar" style="width:${rate}%"></div></div>
        </div>`;
      };

      const subHead = (label) =>
        `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--slate);margin:8px 0 6px">${label}</div>`;

      const hasPStats = Object.keys(passerStats).length || Object.keys(receiverStats).length || Object.keys(rusherStats).length;
      if (hasPStats) {
        html += secHead("Player Stats");
        if (Object.keys(passerStats).length) {
          html += subHead("Passers");
          html += Object.values(passerStats).sort((a,b) => b.yds - a.yds).map(s => playerRow(s, "att")).join("");
        }
        if (Object.keys(receiverStats).length) {
          html += subHead("Receivers");
          html += Object.values(receiverStats).sort((a,b) => b.yds - a.yds).map(s => playerRow(s, "rec")).join("");
        }
        if (Object.keys(rusherStats).length) {
          html += subHead("Rushers");
          html += Object.values(rusherStats).sort((a,b) => b.yds - a.yds).map(s => playerRow(s, "car")).join("");
        }
      }
    }

    return html + "</div>";
  }

  // ---- autocomplete dropdowns ----
  const AC_IDS = ["formDrop","callDrop","motionDrop","frontDrop","coverageDrop"];
  function closeAllAC() {
    AC_IDS.forEach((id) => {
      const d = document.getElementById(id);
      if (d) { d.hidden = true; d.innerHTML = ""; }
    });
  }
  const LIB_FIELD_MAP = { form:"forms", call:"calls", motion:"motions", front:"fronts", coverage:"coverages" };
  function getACList(key) {
    const fromPlays = plays.map((p) => p[key] || "");
    const defaults  = key === "form" ? DEFAULT_FORMS : [];
    const fromLib   = (teamSettings.library && LIB_FIELD_MAP[key]) ? (teamSettings.library[LIB_FIELD_MAP[key]] || []) : [];
    return uniqCI(defaults.concat(fromLib).concat(fromPlays)).sort();
  }
  function bindAC(inputId, dropId, listKey) {
    const inp  = document.getElementById(inputId);
    const drop = document.getElementById(dropId);
    if (!inp || !drop) return;
    function showDrop() {
      const q = inp.value.trim().toLowerCase();
      if (!q) { drop.hidden = true; return; }
      let matches = getACList(listKey).filter((v) => v && v.toLowerCase().includes(q));
      matches.sort((a, b) => {
        const al = a.toLowerCase(), bl = b.toLowerCase();
        const as = al.startsWith(q), bs = bl.startsWith(q);
        if (as && !bs) return -1; if (!as && bs) return 1;
        return al < bl ? -1 : al > bl ? 1 : 0;
      });
      matches = matches.slice(0, 10);
      if (!matches.length) { drop.hidden = true; return; }
      drop.innerHTML = matches.map((v) => {
        const lo = v.toLowerCase(), idx = lo.indexOf(q);
        return `<div class="ac-opt" data-v="${esc(v)}">${
          esc(v.slice(0, idx))}<mark>${esc(v.slice(idx, idx + q.length))}</mark>${esc(v.slice(idx + q.length))
        }</div>`;
      }).join("");
      drop.hidden = false;
    }
    function pick(val) { inp.value = val; drop.hidden = true; drop.innerHTML = ""; }
    inp.addEventListener("input", showDrop);
    drop.addEventListener("mousedown", (e) => {
      const o = e.target.closest(".ac-opt"); if (!o) return;
      e.preventDefault(); pick(o.getAttribute("data-v"));
    });
    drop.addEventListener("touchstart", (e) => {
      const o = e.target.closest(".ac-opt"); if (!o) return;
      e.preventDefault(); pick(o.getAttribute("data-v"));
    }, { passive: false });
    inp.addEventListener("blur", () => setTimeout(() => { drop.hidden = true; }, 200));
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { drop.hidden = true; return; }
      if ((e.key === "Enter" || e.key === "Tab") && !drop.hidden) {
        const first = drop.querySelector(".ac-opt");
        if (first) { e.preventDefault(); pick(first.getAttribute("data-v")); }
      }
    });
  }
  bindAC("form",     "formDrop",     "form");
  bindAC("call",     "callDrop",     "call");
  bindAC("motion",   "motionDrop",   "motion");
  bindAC("front",    "frontDrop",    "front");
  bindAC("coverage", "coverageDrop", "coverage");

  // ---- setSeg helper ----
  function setSeg(id, value) {
    const box = document.getElementById(id);
    if (!box) return;
    Array.from(box.children).forEach((c) =>
      c.classList.toggle("on", c.getAttribute("data-v") === String(value))
    );
  }

  // ---- reset form after a play ----
  function finishEntry(focus) {
    closeAllAC();
    editingId = null;
    document.getElementById("addBtn").textContent = "+ Add Play";
    document.getElementById("cancelEdit").hidden = true;
    document.querySelector(".entry").classList.remove("editing");
    document.querySelector(".entry h2").textContent = "Log a play";
    document.getElementById("yards").value = "";
    document.getElementById("call").value = "";
    document.getElementById("form").value = "";
    document.getElementById("front").value = "";
    document.getElementById("coverage").value = "";
    draft.tags = [];
    Array.from(document.querySelectorAll("#tags .chip")).forEach((c) => c.classList.remove("on"));
    draft.effTouched = false;
    draft.fdAuto     = false;
    draft.fdTouched  = false;
    draft.motionOn   = false;
    document.getElementById("motion").value = "";
    paintMotion();
    draft.yardSign = 1;
    paintYardSign();
    draft.note = "";
    paintNote();
    isTouchdown = false;
    paintTdBtn();
    if (document.getElementById("fPasser"))   document.getElementById("fPasser").value   = lastPasser;
    if (document.getElementById("fReceiver")) document.getElementById("fReceiver").value = lastReceiver;
    if (document.getElementById("fRusher"))   document.getElementById("fRusher").value   = lastRusher;
    document.getElementById("effHint").textContent = "Auto-checked when the play gains enough";
    refreshAutoEff();
    refreshAutoFirstDown();
    if (focus) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      document.getElementById("form").focus();
    }
  }

  // ---- add / save a play ----
  async function handleAddPlay() {
    const dist  = document.getElementById("dist").value;
    const yards = getYards();
    const form     = titleCase(document.getElementById("form").value.trim());
    const call     = titleCase(document.getElementById("call").value.trim());
    const motion   = draft.motionOn ? titleCase(document.getElementById("motion").value.trim()) : "";
    const front    = is7 ? "" : titleCase(document.getElementById("front").value.trim());
    const coverage = titleCase(document.getElementById("coverage").value.trim());
    const sp = settings.effScrimPlays || 10;

    const playData = {
      mode,
      qtr:      draft.qtr,
      down:     isScrim ? "" : draft.down,
      dist:     isScrim ? "" : dist,
      yl:       getYL(),
      hash:     draft.hash,
      type:     draft.type,
      form, call, motion, front, coverage, yards,
      tags:     draft.tags.slice(),
      success:  draft.effective,
      auto:     !draft.effTouched,
      note:     draft.note,
      passer:   (teamSettings.trackPlayers && draft.type === "pass") ? (document.getElementById("fPasser")?.value  || "") : "",
      receiver: (teamSettings.trackPlayers && draft.type === "pass") ? (document.getElementById("fReceiver")?.value || "") : "",
      rusher:   (teamSettings.trackPlayers && draft.type === "run")  ? (document.getElementById("fRusher")?.value  || "") : "",
    };
    if (playData.passer)   lastPasser   = playData.passer;
    if (playData.receiver) lastReceiver = playData.receiver;
    if (playData.rusher)   lastRusher   = playData.rusher;
    if (isScrim) {
      if (settings.seriesType === "timed") {
        const playsInPeriod = plays.filter(p => String(p.series) === String(timedSeries)).length;
        playData.playNum = playsInPeriod + 1;
        playData.series  = timedSeries;
      } else {
        playData.playNum = (plays.length % sp) + 1;
        playData.series  = Math.floor(plays.length / sp) + 1;
      }
    }

    // Auto-tag Turnover on failed 4th down
    if (mode === "standard" && parseInt(playData.down, 10) === 4 && yards < parseInt(playData.dist, 10)) {
      if (playData.tags.indexOf("Turnover") < 0) playData.tags.push("Turnover");
      playData.success = false;
    }

    const addBtn = document.getElementById("addBtn");
    addBtn.disabled = true;

    try {
      if (editingId) {
        await dbUpdatePlay(teamId, game.id, editingId, playData);
        finishEntry(false);
        restoreFromLastPlay();
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        const preDown = draft.down;
        const preDist = parseInt(dist, 10);

        // Penalty interception — ask if the down is replayed
        if (playData.tags.indexOf("Penalty") > -1 && mode === "standard") {
          const newId = await dbAddPlay(teamId, game.id, playData);
          finishEntry(false);
          penaltyPendingPlay = { playId: newId, p: playData, preDown, preDist, yards };
          document.getElementById("penaltyModal").hidden = false;
          addBtn.disabled = false;
          return;
        }

        const wasTouchdown = isTouchdown; // capture before finishEntry resets it
        await dbAddPlay(teamId, game.id, playData);
        finishEntry(true);

        // Auto-advance form state
        if (mode === "7v7") {
          const res = advance7v7(playData.yl, playData.down, yards, settings.start7v7, settings.line1_7v7, settings.line2_7v7);
          draft.down = String(res.down);
          setSeg("down", String(res.down));
          document.getElementById("yl").value = res.ball;
          update7v7Hint();
        } else if (mode === "standard" && !isNaN(preDist)) {
          const d = parseInt(preDown, 10);
          if (playData.tags.indexOf("Turnover") > -1 || yards >= preDist || d >= 4) {
            draft.down = "1"; setSeg("down", "1");
            document.getElementById("dist").value = settings.defaultDist;
          } else {
            draft.down = String(d + 1); setSeg("down", String(d + 1));
            document.getElementById("dist").value = Math.max(preDist - yards, 1);
          }
        }
        if (mode !== "7v7") {
          // Change 3 — scrimmage ball-movement modes
          if (isScrim && settings.scrimmageMode === "fixed") {
            // Capture start on first play of each series, then reset ball each play
            if (!scrimmStartYl || playData.playNum === 1) {
              const _ylNum = Number(playData.yl);
              scrimmStartYl   = String(Math.abs(_ylNum) || "");
              scrimmStartSign = _ylNum <= 0 ? -1 : 1;
            }
            if (scrimmStartYl) {
              document.getElementById("yl").value = scrimmStartYl;
              draft.ylSign = scrimmStartSign; paintYlSign();
            }
          } else if (isScrim && settings.scrimmageMode === "simulated") {
            // Simulated: track down & distance like a real game
            const _d = parseInt(preDown, 10), _pd = parseInt(preDist, 10);
            if (!isNaN(_d) && !isNaN(_pd)) {
              if (yards >= _pd || playData.tags.indexOf("1st Down") > -1) {
                draft.down = "1"; setSeg("down", "1");
                document.getElementById("dist").value = settings.defaultDist;
              } else if (_d < 4) {
                draft.down = String(_d + 1); setSeg("down", String(_d + 1));
                document.getElementById("dist").value = Math.max(_pd - yards, 1);
              } else {
                draft.down = "1"; setSeg("down", "1");
                document.getElementById("dist").value = settings.defaultDist;
              }
            }
            const adv = advanceBallOn(playData.yl, yards);
            if (adv) { document.getElementById("yl").value = adv.yl; draft.ylSign = adv.sign; paintYlSign(); }
          } else {
            // "advance" (default): ball advances each play
            const adv = advanceBallOn(playData.yl, yards);
            if (adv) { document.getElementById("yl").value = adv.yl; draft.ylSign = adv.sign; paintYlSign(); }
          }
        }
        if (isScrim) updateScrimHint();

        // Change 4 — TD re-spot modal
        if (wasTouchdown) {
          document.getElementById("respotInput").value = "";
          document.getElementById("respotModal").hidden = false;
        }
      }
    } catch (err) {
      alert("Could not save play: " + err.message);
    }
    addBtn.disabled = false;
  }

  function startEdit(id) {
    if (!canChart) return;
    const p = plays.find((x) => x.id === id);
    if (!p) return;
    editingId = id;
    draft.qtr  = p.qtr;  draft.down = p.down; draft.hash = p.hash; draft.type = p.type;
    setSeg("qtr", p.qtr); setSeg("down", p.down); setSeg("hash", p.hash); setSeg("ptype", p.type);
    document.getElementById("dist").value = p.dist;
    const ylNum = Number(p.yl); draft.ylSign = ylNum < 0 ? -1 : 1; paintYlSign();
    document.getElementById("yl").value = Math.abs(ylNum) || "";
    document.getElementById("form").value = p.form || "";
    document.getElementById("call").value = p.call || "";
    document.getElementById("yards").value = Math.abs(p.yards);
    draft.yardSign = Number(p.yards) < 0 ? -1 : 1; paintYardSign();
    draft.motionOn = !!p.motion;
    document.getElementById("motion").value = p.motion || "";
    paintMotion();
    document.getElementById("front").value    = p.front    || "";
    document.getElementById("coverage").value = p.coverage || "";
    draft.tags = (p.tags || []).slice();
    Array.from(document.querySelectorAll("#tags .chip")).forEach((b) =>
      b.classList.toggle("on", draft.tags.indexOf(b.getAttribute("data-v")) > -1)
    );
    draft.effective  = p.success;
    draft.effTouched = true; paintEff();
    draft.fdTouched  = true;
    draft.note = p.note || "";
    paintNote();
    updatePlayerFieldVisibility(p.type);
    if (document.getElementById("fPasser"))   document.getElementById("fPasser").value   = p.passer   || "";
    if (document.getElementById("fReceiver")) document.getElementById("fReceiver").value = p.receiver || "";
    if (document.getElementById("fRusher"))   document.getElementById("fRusher").value   = p.rusher   || "";
    document.getElementById("addBtn").textContent = "Save changes";
    document.getElementById("cancelEdit").hidden = false;
    document.querySelector(".entry").classList.add("editing");
    document.querySelector(".entry h2").textContent = "Edit play";
    document.querySelector(".entry").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function handleDelete(id) {
    if (!confirm("Delete this play? This can't be undone.")) return;
    try {
      await dbDeletePlay(teamId, game.id, id);
    } catch (err) {
      alert("Could not delete play: " + err.message);
    }
  }

  async function handleToggleSuccess(id) {
    const p = plays.find((x) => x.id === id);
    if (!p) return;
    try {
      await dbUpdatePlay(teamId, game.id, id, { success: !p.success, auto: false });
    } catch (err) {
      alert("Could not update play: " + err.message);
    }
  }

  // ---- restore form to last-play's post-advance state ----
  function restoreFromLastPlay() {
    const last = plays.length ? plays[plays.length - 1] : null;
    if (!last) {
      draft.qtr = mode === "standard" ? "1" : ""; setSeg("qtr", draft.qtr);
      draft.down = isScrim ? "" : "1"; setSeg("down", draft.down);
      document.getElementById("dist").value = settings.defaultDist;
      return;
    }
    draft.qtr = last.qtr || ""; setSeg("qtr", draft.qtr);
    if (mode === "7v7") {
      const res = advance7v7(last.yl, last.down, last.yards, settings.start7v7, settings.line1_7v7, settings.line2_7v7);
      draft.down = String(res.down); setSeg("down", String(res.down));
      document.getElementById("yl").value = res.ball;
      update7v7Hint();
    } else if (mode === "scrimmage") {
      // Change 3 — scrimmage ball-movement modes in restore
      if (settings.scrimmageMode === "fixed" && scrimmStartYl) {
        draft.down = ""; setSeg("down", "");
        document.getElementById("yl").value = scrimmStartYl;
        draft.ylSign = scrimmStartSign; paintYlSign();
      } else if (settings.scrimmageMode === "simulated") {
        // Restore down/dist tracking
        const _preDist = parseInt(last.dist, 10);
        const _preDown = parseInt(last.down, 10);
        const _yds = last.yards;
        if (!isNaN(_preDown) && !isNaN(_preDist)) {
          if (_yds >= _preDist || (last.tags && last.tags.indexOf("1st Down") > -1)) {
            draft.down = "1"; setSeg("down", "1");
            document.getElementById("dist").value = settings.defaultDist;
          } else if (_preDown < 4) {
            draft.down = String(_preDown + 1); setSeg("down", String(_preDown + 1));
            document.getElementById("dist").value = Math.max(_preDist - _yds, 1);
          } else {
            draft.down = "1"; setSeg("down", "1");
            document.getElementById("dist").value = settings.defaultDist;
          }
        } else {
          draft.down = "1"; setSeg("down", "1");
          document.getElementById("dist").value = settings.defaultDist;
        }
        const advSim = advanceBallOn(last.yl, last.yards);
        if (advSim) { document.getElementById("yl").value = advSim.yl; draft.ylSign = advSim.sign; paintYlSign(); }
      } else {
        // "advance" (default)
        draft.down = ""; setSeg("down", "");
        const advS = advanceBallOn(last.yl, last.yards);
        if (advS) { document.getElementById("yl").value = advS.yl; draft.ylSign = advS.sign; paintYlSign(); }
      }
      updateScrimHint();
    } else {
      const preDist = parseInt(last.dist, 10);
      const preDown = parseInt(last.down, 10);
      const yds = last.yards;
      const hasPenaltyReplay = last.tags && last.tags.indexOf("Penalty") > -1 && last.penaltyReplay === true;
      if (hasPenaltyReplay) {
        draft.down = last.down; setSeg("down", last.down);
        document.getElementById("dist").value = Math.max(1, (parseInt(last.dist, 10) || 0) - (last.yards || 0));
        const advP = advanceBallOn(last.yl, last.yards);
        if (advP) { document.getElementById("yl").value = advP.yl; draft.ylSign = advP.sign; paintYlSign(); }
      } else {
        if (last.tags && last.tags.indexOf("Turnover") > -1) {
          draft.down = "1"; setSeg("down", "1");
          document.getElementById("dist").value = settings.defaultDist;
        } else if (!isNaN(preDist) && !isNaN(preDown)) {
          if (yds >= preDist || preDown >= 4) {
            draft.down = "1"; setSeg("down", "1");
            document.getElementById("dist").value = settings.defaultDist;
          } else {
            draft.down = String(preDown + 1); setSeg("down", String(preDown + 1));
            document.getElementById("dist").value = Math.max(preDist - yds, 1);
          }
        }
        const advN = advanceBallOn(last.yl, last.yards);
        if (advN) { document.getElementById("yl").value = advN.yl; draft.ylSign = advN.sign; paintYlSign(); }
      }
    }
  }

  // ---- penalty modal handlers ----
  document.getElementById("penaltyYes").addEventListener("click", async () => {
    const pd = penaltyPendingPlay; penaltyPendingPlay = null;
    document.getElementById("penaltyModal").hidden = true;
    if (!pd) return;
    try {
      await dbUpdatePlay(teamId, game.id, pd.playId, { penaltyReplay: true });
    } catch (_) {}
    draft.down = pd.p.down; setSeg("down", pd.p.down);
    const newDist = Math.max(1, (parseInt(pd.p.dist, 10) || 0) - (pd.p.yards || 0));
    document.getElementById("dist").value = newDist;
    const adv = advanceBallOn(pd.p.yl, pd.p.yards);
    if (adv) { document.getElementById("yl").value = adv.yl; draft.ylSign = adv.sign; paintYlSign(); }
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  document.getElementById("penaltyNo").addEventListener("click", async () => {
    const pd = penaltyPendingPlay; penaltyPendingPlay = null;
    document.getElementById("penaltyModal").hidden = true;
    if (!pd) return;
    try {
      await dbUpdatePlay(teamId, game.id, pd.playId, { penaltyReplay: false });
    } catch (_) {}
    const d = parseInt(pd.preDown, 10), pr = pd.preDist, yds = pd.yards;
    if (pd.p.tags.indexOf("Turnover") > -1 || yds >= pr || d >= 4) {
      draft.down = "1"; setSeg("down", "1");
      document.getElementById("dist").value = settings.defaultDist;
    } else {
      draft.down = String(d + 1); setSeg("down", String(d + 1));
      document.getElementById("dist").value = Math.max(pr - yds, 1);
    }
    const adv = advanceBallOn(pd.p.yl, pd.p.yards);
    if (adv) { document.getElementById("yl").value = adv.yl; draft.ylSign = adv.sign; paintYlSign(); }
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  // ---- TD re-spot modal handlers (Change 4) ----
  document.getElementById("respotSet").addEventListener("click", () => {
    const val = document.getElementById("respotInput").value.trim();
    const num = parseInt(val, 10);
    if (!isNaN(num) && num >= 1 && num <= 99) {
      // Pre-fill ball-on: treat as opponent's side (positive sign) for typical kickoff return spot
      document.getElementById("yl").value = Math.min(num, 50);
      draft.ylSign = num <= 50 ? -1 : 1;
      paintYlSign();
    }
    document.getElementById("respotModal").hidden = true;
  });
  document.getElementById("respotSkip").addEventListener("click", () => {
    document.getElementById("respotModal").hidden = true;
  });

  // ---- note modal ----
  function paintNote() {
    const btn = document.getElementById("noteBtn");
    const lbl = document.getElementById("noteBtnLabel");
    if (!btn || !lbl) return;
    lbl.textContent = draft.note ? "Note set" : "Add Note";
    btn.classList.toggle("has-note", !!draft.note);
  }

  document.getElementById("noteBtn").addEventListener("click", () => {
    document.getElementById("noteText").value = draft.note;
    document.getElementById("noteModal").hidden = false;
    setTimeout(() => document.getElementById("noteText").focus(), 50);
  });
  document.getElementById("noteSave").addEventListener("click", () => {
    draft.note = document.getElementById("noteText").value.trim();
    document.getElementById("noteModal").hidden = true;
    paintNote();
  });
  document.getElementById("noteCancel").addEventListener("click", () => {
    document.getElementById("noteModal").hidden = true;
  });

  // ---- Suggest a Play ----
  document.getElementById("suggestBtn").addEventListener("click", () => {
    // Pre-fill situation from current form values if any
    const curDown = draft.down;
    const curHash = draft.hash;
    if (curDown) document.getElementById("suggestDown").value = curDown;
    if (curHash) document.getElementById("suggestHash").value = curHash;
    document.getElementById("suggestResults").innerHTML = buildSuggestResults();
    document.getElementById("suggestModal").hidden = false;
  });

  document.getElementById("suggestClose").addEventListener("click", () => {
    document.getElementById("suggestModal").hidden = true;
  });
  document.getElementById("suggestModal").addEventListener("click", (e) => {
    if (e.target === document.getElementById("suggestModal"))
      document.getElementById("suggestModal").hidden = true;
  });

  // Live update as situation changes
  ["suggestDown", "suggestDist", "suggestHash"].forEach((id) => {
    document.getElementById(id).addEventListener("change", () => {
      document.getElementById("suggestResults").innerHTML = buildSuggestResults();
    });
  });

  // Tap a suggestion → pre-fill form
  document.getElementById("suggestResults").addEventListener("click", (e) => {
    const row = e.target.closest(".suggest-pick");
    if (!row) return;
    const call = row.getAttribute("data-call");
    const type = row.getAttribute("data-type");
    // Pre-fill play call
    const inpCall = document.getElementById("call");
    if (inpCall) inpCall.value = call;
    // Pre-fill play type via segmented control (ptype buttons)
    const ptypeBox = document.getElementById("ptype");
    if (ptypeBox) {
      const btn = ptypeBox.querySelector(`button[data-v="${type}"]`);
      if (btn) {
        Array.from(ptypeBox.children).forEach((c) => c.classList.remove("on"));
        btn.classList.add("on");
        draft.type = type;
        updatePlayerFieldVisibility(type);
      }
    }
    document.getElementById("suggestModal").hidden = true;
  });

  // ---- toolbar ----
  document.getElementById("exportCsvBtn").addEventListener("click", () => exportCSV(plays, game, teamSettings));
  document.getElementById("exportHudlBtn").addEventListener("click", () => exportHudl(plays, game, teamSettings));
  document.getElementById("printBtn").addEventListener("click", () => window.print());
  document.getElementById("quickReportBtn").addEventListener("click", () => {
    document.getElementById("reportOverlay").hidden = false;
    document.querySelectorAll(".rtab").forEach((b, i) => b.classList.toggle("active", i === 0));
    renderReportTab("eff");
  });
  document.getElementById("reportClose").addEventListener("click", () => {
    document.getElementById("reportOverlay").hidden = true;
  });
  document.getElementById("reportBody").addEventListener("click", (e) => {
    const hmBtn = e.target.closest("[data-hmf]");
    if (hmBtn) {
      hmFilter = hmBtn.getAttribute("data-hmf");
      document.getElementById("reportBody").innerHTML = buildHeatMap(plays, hmFilter);
      return;
    }
    const row = e.target.closest("[data-drill]");
    if (!row) return;
    const callName = row.getAttribute("data-drill");
    document.getElementById("drillTitle").textContent = callName;
    document.getElementById("drillBody").innerHTML = buildDrillDown(callName);
    document.getElementById("drillModal").hidden = false;
  });
  document.getElementById("drillClose").addEventListener("click", () => {
    document.getElementById("drillModal").hidden = true;
  });
  document.getElementById("drillModal").addEventListener("click", (e) => {
    if (e.target === document.getElementById("drillModal"))
      document.getElementById("drillModal").hidden = true;
  });
  document.querySelectorAll(".rtab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".rtab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.getAttribute("data-tab");
      if (tab !== "heatmap") hmFilter = "";
      renderReportTab(tab);
    });
  });

  // Show "By Series" tab only in scrimmage mode
  const rtabSeriesBtn = document.getElementById("rtabSeries");
  if (rtabSeriesBtn) rtabSeriesBtn.style.display = isScrim ? "" : "none";

  // ---- quick report renderer ----
  function renderReportTab(tab) {
    const body = document.getElementById("reportBody");
    if (!plays.length) {
      body.innerHTML = '<div class="report-empty">No plays logged yet.</div>';
      return;
    }

    function groupBy(field) {
      const map = {};
      plays.forEach((p) => {
        const k = p[field] || "(none)";
        if (!map[k]) map[k] = { key: k, n: 0, succ: 0, yards: 0 };
        map[k].n++;
        if (p.success) map[k].succ++;
        map[k].yards += Number(p.yards) || 0;
      });
      return Object.values(map);
    }

    function rptRow(label, n, succ, yards, drillKey) {
      const effPct = n ? Math.round(100 * succ / n) : 0;
      const avg    = n ? (yards / n).toFixed(1) : "0.0";
      const color  = effPct >= 50 ? "#15803d" : "#b91c1c";
      const drillAttr = drillKey ? ` data-drill="${esc(drillKey)}" style="cursor:pointer"` : "";
      return `<div class="rpt-row"${drillAttr}>
        <div class="rpt-label">${esc(label)}</div>
        <div class="rpt-stats">
          <span class="rpt-n">${n} play${n !== 1 ? "s" : ""}</span>
          <span class="rpt-avg">${avg} yds/play</span>
          <span class="rpt-eff" style="color:${color}">${effPct}% effective</span>
        </div>
        <div class="rpt-bar-wrap"><div class="rpt-bar" style="width:${effPct}%"></div></div>
      </div>`;
    }

    let html = "";

    if (tab === "eff" || tab === "ineff") {
      const groups = groupBy("call").filter((g) => g.n >= 2);
      groups.sort((a, b) => {
        const ae = a.n ? a.succ / a.n : 0, be = b.n ? b.succ / b.n : 0;
        return tab === "eff" ? be - ae : ae - be;
      });
      const top = groups.slice(0, 10);
      html = top.length
        ? top.map((g) => rptRow(g.key, g.n, g.succ, g.yards, g.key)).join("")
        : '<div class="report-empty">Need at least 2 plays per call to rank.</div>';
    }

    if (tab === "call") {
      function typeSection(label, subset) {
        if (!subset.length) return "";
        const map = {};
        subset.forEach((p) => {
          const k = p.call || "(no call)";
          if (!map[k]) map[k] = { key: k, n: 0, succ: 0, yards: 0 };
          map[k].n++; if (p.success) map[k].succ++; map[k].yards += Number(p.yards) || 0;
        });
        const arr = Object.values(map).sort((a, b) => b.n - a.n);
        return `<div class="rpt-group-head">${label}</div>` +
          arr.map((g) => rptRow(g.key, g.n, g.succ, g.yards)).join("");
      }
      html = typeSection("Run Plays", plays.filter((p) => p.type === "run")) +
             typeSection("Pass Plays", plays.filter((p) => p.type === "pass")) +
             typeSection("Punts",      plays.filter((p) => p.type === "punt"));
      if (!html) html = '<div class="report-empty">No plays logged yet.</div>';
    }

    if (tab === "down") {
      html = [1, 2, 3, 4].map((d) => {
        const sub = plays.filter((p) => String(p.down) === String(d));
        if (!sub.length) return "";
        const succ  = sub.filter((p) => p.success).length;
        const yards = sub.reduce((s, p) => s + (Number(p.yards) || 0), 0);
        const suf   = d === 1 ? "st" : d === 2 ? "nd" : d === 3 ? "rd" : "th";
        return rptRow(`${d}${suf} Down`, sub.length, succ, yards);
      }).filter(Boolean).join("");
      if (!html) html = '<div class="report-empty">No plays with down data.</div>';
    }

    if (tab === "hash") {
      const labels = { L: "Left Hash", M: "Middle", R: "Right Hash" };
      html = ["L", "M", "R"].map((h) => {
        const sub = plays.filter((p) => p.hash === h);
        if (!sub.length) return "";
        const succ  = sub.filter((p) => p.success).length;
        const yards = sub.reduce((s, p) => s + (Number(p.yards) || 0), 0);
        return rptRow(labels[h], sub.length, succ, yards);
      }).filter(Boolean).join("");
      if (!html) html = '<div class="report-empty">No plays with hash data.</div>';
    }

    if (tab === "players") {
      html = buildPlayersReport(plays, teamSettings);
    }

    if (tab === "stats") {
      html = buildGameStats();
    }

    if (tab === "series") {
      const hasSeries = plays.some(p => p.series != null && p.series !== "");
      if (!hasSeries) {
        html = '<div class="report-empty">By Series is only available in Scrimmage mode.</div>';
      } else {
        const serNums = [...new Set(plays.map(p => p.series).filter(v => v != null && v !== ""))].sort((a, b) => Number(a) - Number(b));
        html = serNums.map(s => {
          const sub   = plays.filter(p => p.series === s);
          const succ  = sub.filter(p => p.success).length;
          const yards = sub.reduce((sum, p) => sum + (Number(p.yards) || 0), 0);
          return rptRow("Series " + s, sub.length, succ, yards);
        }).join("");
        if (!html) html = '<div class="report-empty">No series data found.</div>';
      }
    }

    if (tab === "heatmap") {
      body.innerHTML = buildHeatMap(plays, hmFilter);
      return;
    }

    if (tab === "redzone") {
      body.innerHTML = buildRedZone(plays);
      return;
    }

    if (tab === "notes") {
      const noted = plays.filter(p => p.note && String(p.note).trim() !== "");
      if (!noted.length) {
        html = '<div class="report-empty">No notes added this game.</div>';
      } else {
        html = noted.map(p => {
          const ctx = p.qtr ? ("Q" + esc(p.qtr)) : (p.series != null ? "Series " + esc(String(p.series)) : "");
          const dnDistStr = (p.down && p.dist != null && p.dist !== "")
            ? esc(p.down) + (["1","2","3","4"].includes(String(p.down))
                ? (p.down === "1" ? "st" : p.down === "2" ? "nd" : p.down === "3" ? "rd" : "th")
                : "") + " &amp; " + esc(p.dist)
            : "";
          const meta = [ctx, dnDistStr, esc(p.type || ""), esc(p.call || "")].filter(Boolean).join(" · ");
          return `<div style="background:#fff;border:1px solid #E2E8F0;border-radius:8px;padding:12px 14px;margin-bottom:8px">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--slate,#6B7280);margin-bottom:4px">${meta}</div>
            <div style="font-size:14px;color:var(--ink,#0F1830)">${esc(p.note)}</div>
          </div>`;
        }).join("");
      }
    }

    body.innerHTML = html || '<div class="report-empty">No data for this view.</div>';
  }

  // ---- quick-report drill-down ----
  function buildDrillDown(callName) {
    const nameKey = callName.toLowerCase();
    const matching = plays.filter((p) => (p.call || "").trim().toLowerCase() === nameKey);
    if (!matching.length) return '<div class="report-empty">No matching plays found.</div>';
    const total = matching.length;
    const effCount = matching.filter((p) => p.success).length;
    const totalYds = matching.reduce((a, p) => a + (Number(p.yards) || 0), 0);
    const rate = Math.round(100 * effCount / total);
    const avgYds = (totalYds / total).toFixed(1);
    const statsHtml = `<div class="drill-stats">
      <span><b>${total}</b>times run</span>
      <span><b>${effCount}/${total}</b>effective</span>
      <span><b>${rate}%</b>success rate</span>
      <span><b>${totalYds >= 0 ? "+" : ""}${avgYds}</b>avg yards</span>
    </div>`;
    const rows = matching.map((p, i) => {
      const dir = p.yards > 0 ? "up" : p.yards < 0 ? "down" : "flat";
      const sign = p.yards > 0 ? "+" : "";
      const ctx = p.mode === "scrimmage" ? `Ser ${esc(p.series || "")}` : `Q${esc(p.qtr || "")}`;
      const tags = (p.tags || []).length
        ? `<span style="font-size:11px;color:var(--slate)">${p.tags.map(esc).join(", ")}</span>`
        : "";
      return `<tr>
        <td><b style="font-family:var(--num)">${i + 1}</b></td>
        <td>${ctx}</td>
        <td><b style="font-family:var(--num)">${dnDist(p)}</b></td>
        <td>${p.yl != null && p.yl !== "" ? esc(String(p.yl)) : "&ndash;"}<span style="color:var(--slate);font-size:11px"> ${esc(p.hash || "")}</span></td>
        <td>${esc(p.form || "—")}</td>
        <td>${tags}</td>
        <td><span class="res ${dir}">${sign}${p.yards}</span></td>
        <td><span class="succ ${p.success ? "y" : "n"} static">${p.success ? "✓" : "✗"}</span></td>
      </tr>`;
    }).join("");
    // By Player breakdown
    let playerSection = "";
    if (teamSettings.trackPlayers && (teamSettings.roster || []).length) {
      const rMap = {};
      (teamSettings.roster || []).forEach(r => rMap[r.id] = r);
      const byPlayer = {};
      matching.forEach(p => {
        const addStat = (pid, role) => {
          if (!pid || !rMap[pid]) return;
          const k = `${pid}|${role}`;
          if (!byPlayer[k]) byPlayer[k] = {id: pid, role, n: 0, yds: 0, eff: 0};
          byPlayer[k].n++;
          byPlayer[k].yds += Number(p.yards) || 0;
          if (p.success) byPlayer[k].eff++;
        };
        addStat(p.passer, "Passer");
        addStat(p.receiver, "Receiver");
        addStat(p.rusher, "Rusher");
      });
      const playerRows = Object.values(byPlayer).sort((a, b) => {
        const ae = a.n ? a.eff/a.n : 0, be = b.n ? b.eff/b.n : 0; return be - ae;
      });
      if (playerRows.length) {
        playerSection = `<div style="margin-bottom:16px">
          <div style="font-family:var(--num,Oswald);text-transform:uppercase;letter-spacing:.06em;font-size:11px;font-weight:700;color:var(--royal,#16317F);padding:4px 0 5px;border-bottom:2px solid var(--chalk,#E8EEF9);margin-bottom:10px">By Player</div>` +
          playerRows.map(s => {
            const pl = rMap[s.id];
            const rate = s.n ? Math.round(100 * s.eff / s.n) : 0;
            const avgY = s.n ? (s.yds / s.n).toFixed(1) : "0.0";
            return `<div class="rpt-row">
              <div class="rpt-label"><b>#${esc(pl.jersey)}</b> ${esc(pl.name)} <span style="font-size:11px;color:var(--slate)">${s.role}</span></div>
              <div class="rpt-stats">
                <span class="rpt-n">${s.n} plays</span>
                <span class="rpt-avg">${s.yds} yds &middot; ${avgY} avg</span>
                <span class="rpt-eff" style="color:${rate >= 50 ? "#15803d" : "#b91c1c"}">${rate}% eff</span>
              </div>
              <div class="rpt-bar-wrap"><div class="rpt-bar" style="width:${rate}%"></div></div>
            </div>`;
          }).join("") +
        `</div>`;
      }
    }

    return statsHtml + playerSection + `<div class="table-scroll"><table><thead><tr>
      <th>#</th><th>Qtr/Ser</th><th>Dn &amp; Dist</th><th>Ball On</th><th>Formation</th><th>Tags</th><th>Yds</th><th>Eff</th>
    </tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  // ---- suggest a play ----
  function buildSuggestResults() {
    const selDown = document.getElementById("suggestDown").value;
    const selDist = document.getElementById("suggestDist").value;
    const selHash = document.getElementById("suggestHash").value;

    const filtered = plays.filter((p) => {
      const callVal = (p.call || "").trim();
      if (!callVal) return false;
      if (selDown && String(p.down) !== selDown) return false;
      if (selDist) {
        const d = Number(p.dist);
        if (selDist === "short"  && !(d <= 3))           return false;
        if (selDist === "medium" && !(d >= 4 && d <= 7)) return false;
        if (selDist === "long"   && !(d >= 8))           return false;
      }
      if (selHash && p.hash !== selHash) return false;
      return true;
    });

    if (!filtered.length) {
      return '<div class="report-empty">No plays match this situation yet.</div>';
    }

    // Group by call name
    const groups = {};
    filtered.forEach((p) => {
      const key = (p.call || "").trim();
      if (!key) return;
      if (!groups[key]) groups[key] = { call: key, plays: [] };
      groups[key].plays.push(p);
    });

    // Compute stats per group
    const results = Object.values(groups).map((g) => {
      const n     = g.plays.length;
      const succ  = g.plays.filter((p) => p.success === true).length;
      const yards = g.plays.reduce((s, p) => s + (Number(p.yards) || 0), 0);
      const effPct = Math.round(100 * succ / n);
      const avg   = (yards / n).toFixed(1);
      // Most common type
      const typeCounts = {};
      g.plays.forEach((p) => { const t = p.type || "run"; typeCounts[t] = (typeCounts[t] || 0) + 1; });
      const type = Object.keys(typeCounts).sort((a, b) => typeCounts[b] - typeCounts[a])[0] || "run";
      return { call: g.call, n, succ, yards, effPct, avg, type };
    });

    // Sort by effPct desc, then n desc
    results.sort((a, b) => b.effPct - a.effPct || b.n - a.n);

    const top = results.slice(0, 10);
    const summaryHtml = `<div style="font-size:12px;color:var(--slate);margin-bottom:10px">${filtered.length} plays match &middot; ranked by success rate &middot; tap to use</div>`;

    const rowsHtml = top.map((r) => {
      const color = r.effPct >= 50 ? "#15803d" : "#b91c1c";
      return `<div class="rpt-row suggest-pick" data-call="${esc(r.call)}" data-type="${esc(r.type)}" style="cursor:pointer">
        <div class="rpt-label">${esc(r.call)} <span style="font-size:11px;color:var(--slate)">&middot; ${esc(r.type)} &middot; ${r.n} play${r.n !== 1 ? "s" : ""}</span></div>
        <div class="rpt-stats">
          <span class="rpt-avg">${r.avg} yds/play</span>
          <span class="rpt-eff" style="color:${color}">${r.effPct}% effective</span>
        </div>
        <div class="rpt-bar-wrap"><div class="rpt-bar" style="width:${r.effPct}%"></div></div>
      </div>`;
    }).join("");

    return summaryHtml + rowsHtml;
  }

  // ---- stepper buttons ----
  function stepYl(delta) {
    const v = parseInt(document.getElementById("yl").value, 10) || 1;
    const abs = draft.ylSign < 0 ? v : (100 - v);
    const newAbs = Math.max(1, Math.min(99, abs + delta));
    draft.ylSign = newAbs <= 50 ? -1 : 1;
    document.getElementById("yl").value = newAbs <= 50 ? newAbs : (100 - newAbs);
    paintYlSign(); update7v7Hint();
  }
  document.getElementById("ylUp").addEventListener("click", () => stepYl(1));
  document.getElementById("ylDown").addEventListener("click", () => stepYl(-1));

  document.getElementById("distUp").addEventListener("click", () => {
    const el = document.getElementById("dist");
    el.value = Math.max(0, (parseInt(el.value, 10) || 0) + 1);
    onPlayInput();
  });
  document.getElementById("distDown").addEventListener("click", () => {
    const el = document.getElementById("dist");
    el.value = Math.max(0, (parseInt(el.value, 10) || 0) - 1);
    onPlayInput();
  });

  document.getElementById("yardsUp").addEventListener("click", () => {
    const next = getYards() + 1;
    draft.yardSign = next < 0 ? -1 : 1;
    document.getElementById("yards").value = Math.abs(next);
    paintYardSign(); onPlayInput();
  });
  document.getElementById("yardsDown").addEventListener("click", () => {
    const next = getYards() - 1;
    draft.yardSign = next < 0 ? -1 : 1;
    document.getElementById("yards").value = Math.abs(next);
    paintYardSign(); onPlayInput();
  });

  // ---- event wiring ----
  document.getElementById("addBtn").addEventListener("click", handleAddPlay);
  document.getElementById("cancelEdit").addEventListener("click", () => finishEntry(false));
  document.getElementById("call").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const d = document.getElementById("callDrop");
      if (d && !d.hidden) return;
      handleAddPlay();
    }
  });
  document.getElementById("yards").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleAddPlay();
  });

  document.getElementById("logBody").addEventListener("click", (e) => {
    if (e.target.closest(".del") || e.target.closest(".succ")) return;
    if (!canChart) return;
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;
    startEdit(tr.getAttribute("data-id"));
  });

  // ---- render play log ----
  function renderLog() {
    const body = document.getElementById("logBody");
    if (!plays.length) {
      body.innerHTML = `<tr><td colspan="12"><div class="empty"><div class="big">No plays yet</div>Log your first snap above and the chart fills in.</div></td></tr>`;
    } else {
      const rosterMap = {};
      (teamSettings.roster || []).forEach(p => rosterMap[p.id] = p);
      body.innerHTML = plays.map((p, i) => {
        const dir  = p.yards > 0 ? "up" : p.yards < 0 ? "down" : "flat";
        const sign = p.yards > 0 ? "+" : "";
        const tags = (p.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("");
        const pInfo = [];
        if (p.passer   && rosterMap[p.passer])   pInfo.push(`#${esc(rosterMap[p.passer].jersey)} ${esc(rosterMap[p.passer].name)}`);
        if (p.receiver && rosterMap[p.receiver]) pInfo.push(`&rarr; #${esc(rosterMap[p.receiver].jersey)} ${esc(rosterMap[p.receiver].name)}`);
        if (p.rusher   && rosterMap[p.rusher])   pInfo.push(`#${esc(rosterMap[p.rusher].jersey)} ${esc(rosterMap[p.rusher].name)}`);
        const playerNote = pInfo.length ? `<div style="font-size:11px;color:var(--slate);margin-top:2px">${pInfo.join(" ")}</div>` : "";
        return `<tr class="${esc(p.type)}" data-id="${esc(p.id)}">` +
          `<td><b style="font-family:var(--num)">${i + 1}</b></td>` +
          `<td>${esc(p.qtr)}</td>` +
          `<td><b style="font-family:var(--num)">${dnDist(p)}</b></td>` +
          `<td>${p.yl !== "" ? esc(p.yl) : "&ndash;"}<span style="color:var(--muted);font-size:11px"> ${esc(p.hash)}</span></td>` +
          `<td><span class="pill ${esc(p.type)}">${p.type === "run" ? "RUN" : p.type === "punt" ? "PUNT" : "PASS"}</span></td>` +
          `<td>${esc(p.form || "—")}` +
            (p.motion   ? `<div class="mtag">+ ${esc(p.motion)} motion</div>` : "") +
            (p.front    ? `<div class="mtag" style="color:var(--muted)">front: ${esc(p.front)}</div>` : "") +
            (p.coverage ? `<div class="mtag" style="color:var(--muted)">cov: ${esc(p.coverage)}</div>` : "") +
          `</td>` +
          `<td>${esc(p.call || "—")}${playerNote}</td>` +
          `<td><span class="res ${dir}">${sign}${p.yards}</span></td>` +
          (canChart
            ? `<td><button class="succ ${p.success ? "y" : "n"}" data-id="${esc(p.id)}">${p.success ? "✓" : "✗"}</button></td>`
            : `<td><span class="${p.success ? "succ y static" : "succ n static"}">${p.success ? "✓" : "✗"}</span></td>`) +
          `<td><div class="tagrow">${tags || '<span style="color:var(--muted)">—</span>'}</div></td>` +
          `<td>${p.note ? `<span title="${esc(p.note)}" style="cursor:help">📝</span>` : '<span style="color:var(--muted)">—</span>'}</td>` +
          (canDelete ? `<td><button class="del" data-del="${esc(p.id)}" title="Delete">&times;</button></td>` : "<td></td>") +
        `</tr>`;
      }).join("");
    }

    // Wire .succ and .del buttons
    if (canChart) {
      Array.from(body.querySelectorAll(".succ")).forEach((b) => {
        b.onclick = () => handleToggleSuccess(b.getAttribute("data-id"));
      });
    }
    if (canDelete) {
      Array.from(body.querySelectorAll(".del")).forEach((b) => {
        b.onclick = () => handleDelete(b.getAttribute("data-del"));
      });
    }
  }

  function renderStats() {
    const n       = plays.length;
    const runs    = plays.filter((p) => p.type === "run");
    const passes  = plays.filter((p) => p.type === "pass");
    const totYds  = plays.reduce((a, p) => a + (Number(p.yards) || 0), 0);
    const succ    = plays.filter((p) => p.success).length;
    document.getElementById("s-total").textContent = n;
    document.getElementById("s-run").textContent   = runs.length;
    document.getElementById("s-pass").textContent  = passes.length;
    document.getElementById("s-ypp").textContent   = n ? (totYds / n).toFixed(1) : "0.0";
    document.getElementById("s-succ").textContent  = pct(succ, n);
    document.getElementById("s-rp").textContent    = n
      ? Math.round(100 * runs.length / n) + "/" + Math.round(100 * passes.length / n)
      : "—";
    renderSplits(runs, passes);
  }

  function avg(arr) {
    if (!arr.length) return "0.0";
    return (arr.reduce((a, p) => a + (Number(p.yards) || 0), 0) / arr.length).toFixed(1);
  }
  function sRate(arr) {
    if (!arr.length) return "0%";
    return pct(arr.filter((p) => p.success).length, arr.length);
  }
  function byDown(d) { return plays.filter((p) => Number(p.down) === d); }

  function renderSplits(runs, passes) {
    document.getElementById("splits").innerHTML =
      `<div class="split"><h3>Run vs Pass</h3>` +
        `<div class="line"><span>Run — yards/play</span><b>${avg(runs)}</b></div>` +
        `<div class="line"><span>Run — effective</span><b>${sRate(runs)}</b></div>` +
        `<div class="line"><span>Pass — yards/play</span><b>${avg(passes)}</b></div>` +
        `<div class="line"><span>Pass — effective</span><b>${sRate(passes)}</b></div>` +
      `</div>` +
      `<div class="split"><h3>Effective by down</h3>` +
        `<div class="line"><span>1st down</span><b>${sRate(byDown(1))}</b></div>` +
        `<div class="line"><span>2nd down</span><b>${sRate(byDown(2))}</b></div>` +
        `<div class="line"><span>3rd down</span><b>${sRate(byDown(3))}</b></div>` +
        `<div class="line"><span>4th down</span><b>${sRate(byDown(4))}</b></div>` +
      `</div>`;
  }

  function render(newPlays) {
    plays = newPlays;
    renderLog();
    renderStats();
    if (isScrim) updateScrimHint();
  }

  // ---- start real-time subscription ----
  unsub = subscribePlays(teamId, game.id, render);

  // ---- initial effective state ----
  document.getElementById("dist").value = is7 || isScrim ? "" : String(settings.defaultDist);
  refreshAutoEff();
}

// ---------- HTML template ----------------------------------------------------

function buildHTML(game, mode) {
  const is7    = mode === "7v7";
  const isScrim = mode === "scrimmage";
  const title  = game.opponent ? "vs " + esc(game.opponent) : "Untitled game";
  const sub    = game.date ? game.date : "";

  return `
<div class="game-wrap">
  <header class="board">
    <div class="board-top">
      <div style="display:flex;align-items:center;gap:12px">
        <button id="gameBackBtn" class="back" aria-label="Back to dashboard">&larr;</button>
        <div>
          <h1>${esc(title)}</h1>
          <div class="sub">${esc(sub)}${sub ? " · " : ""}${esc(mode)} mode</div>
          <span id="modeBadge" class="modebadge" style="display:none"></span>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span id="liveChip" class="live-chip">● LIVE</span>
      </div>
    </div>
  </header>

  <div class="wrap">
    <div class="stats" id="stats">
      <div class="stat"><div class="v" id="s-total">0</div><div class="k">Plays</div></div>
      <div class="stat"><div class="v" id="s-run">0</div><div class="k">Runs</div></div>
      <div class="stat"><div class="v" id="s-pass">0</div><div class="k">Passes</div></div>
      <div class="stat"><div class="v" id="s-ypp">0.0</div><div class="k">Yds / Play</div></div>
      <div class="stat good"><div class="v" id="s-succ">0%</div><div class="k">Effective</div></div>
      <div class="stat"><div class="v" id="s-rp">&mdash;</div><div class="k">Run / Pass</div></div>
    </div>

    <section class="entry">
      <h2>Log a play</h2>
      <div class="row" id="topRow" style="flex-wrap:nowrap;align-items:flex-start">
        <div class="fld" id="qtrFld"><label>Quarter</label>
          <div class="seg" id="qtr">
            <button data-v="1" class="on">1</button>
            <button data-v="2">2</button>
            <button data-v="3">3</button>
            <button data-v="4">4</button>
            <button data-v="OT">OT</button>
          </div>
        </div>
        <div class="fld" id="downFld"><label>Down</label>
          <div class="seg" id="down">
            <button data-v="1" class="on">1</button>
            <button data-v="2">2</button>
            <button data-v="3">3</button>
            <button data-v="4">4</button>
          </div>
        </div>
        <div class="fld" id="distFld"><label>To go</label>
          <div class="yards-row">
            <input id="dist" class="num-w" type="number" inputmode="numeric" value="10" min="0">
            <div class="stepper">
              <button id="distUp" class="stepbtn" type="button" aria-label="Add 1 yard to go">&#9650;</button>
              <button id="distDown" class="stepbtn" type="button" aria-label="Remove 1 yard to go">&#9660;</button>
            </div>
          </div>
        </div>
        <div class="fld"><label>Ball on</label>
          <div class="yards-row">
            <button id="ylSignBtn" class="signbtn loss" type="button">&#8722;</button>
            <input id="yl" class="num-w" type="number" inputmode="numeric" placeholder="&ndash;" min="1" max="50">
            <div class="stepper">
              <button id="ylUp" class="stepbtn" type="button" aria-label="Add 1 yard ball on">&#9650;</button>
              <button id="ylDown" class="stepbtn" type="button" aria-label="Remove 1 yard ball on">&#9660;</button>
            </div>
          </div>
          <div class="hint" id="ylHint">Your side &mdash; tap &plusmn; to flip</div>
        </div>
        <div class="fld"><label>Hash</label>
          <div class="seg" id="hash">
            <button data-v="L">L</button>
            <button data-v="M" class="on">M</button>
            <button data-v="R">R</button>
          </div>
        </div>
      </div>

      <div class="row" id="seriesRow" style="display:none">
        <div class="series-hint" id="seriesHint"></div>
        <div id="timedControls" style="display:none;align-items:center;gap:8px;margin-left:10px;flex-shrink:0;flex-wrap:wrap">
          <div id="timedIdle" style="display:flex;align-items:center;gap:6px">
            <input type="number" id="timedMinsInput" min="1" max="99" value="5"
                   style="width:52px;padding:4px 6px;font-size:14px;border:1.5px solid var(--border,#D1D5DB);border-radius:6px;font-family:var(--num);text-align:center">
            <span style="font-size:12px;color:var(--slate)">min</span>
            <button type="button" id="timerStartBtn" class="btn-secondary" style="font-size:13px;height:34px;padding:0 14px">&#9654; Start</button>
          </div>
          <div id="timedActive" style="display:none;align-items:center;gap:6px">
            <span id="timerDisplay" style="font-family:var(--num);font-size:20px;font-weight:700;color:var(--royal);min-width:56px;text-align:center">5:00</span>
            <button type="button" id="timerPauseBtn" class="btn-secondary" style="font-size:13px;height:34px;padding:0 14px">&#9646;&#9646; Pause</button>
          </div>
          <button type="button" id="timeExpiredBtn" class="btn-secondary" style="font-size:13px;height:34px;padding:0 12px">&#9203; Time Expired</button>
        </div>
      </div>

      <div class="row">
        <div class="fld" id="ptypeFld"><label>Play type</label>
          <div class="seg type" id="ptype">
            <button data-v="run" class="on">Run</button>
            <button data-v="pass">Pass</button>
            <button data-v="punt">Punt</button>
          </div>
        </div>
        <div class="fld grow"><label>Formation</label>
          <input id="form" type="text" autocomplete="off" autocapitalize="words"
                 placeholder="Start typing &mdash; past entries appear">
          <div class="ac-drop" id="formDrop" hidden></div>
        </div>
        <div class="fld grow"><label>Play call</label>
          <input id="call" type="text" autocomplete="off" autocapitalize="words"
                 placeholder="Start typing &mdash; past entries appear">
          <div class="ac-drop" id="callDrop" hidden></div>
          <button type="button" class="btn-secondary" id="suggestBtn" style="width:100%;margin-top:4px;font-size:13px;height:36px">&#9889; Suggest Play</button>
        </div>
      </div>

      <div class="row">
        <div class="fld"><label>Motion?</label>
          <button id="motionBtn" class="eff motion-chk" type="button" aria-pressed="false">
            <span class="box">&#10003;</span> Motion
          </button>
        </div>
        <div class="fld grow" id="motionNameWrap" hidden><label>Motion name</label>
          <input id="motion" type="text" autocomplete="off" autocapitalize="words"
                 placeholder="e.g. Jet, Orbit, Z-Out">
          <div class="ac-drop" id="motionDrop" hidden></div>
        </div>
      </div>

      <div class="form-row" id="passerRow" style="display:none">
        <label class="form-label">Passer</label>
        <select id="fPasser" class="field sel-half"><option value="">— select —</option></select>
      </div>
      <div class="form-row" id="receiverRow" style="display:none">
        <label class="form-label">Receiver</label>
        <select id="fReceiver" class="field sel-half"><option value="">— select —</option></select>
      </div>
      <div class="form-row" id="rusherRow" style="display:none">
        <label class="form-label">Rusher</label>
        <select id="fRusher" class="field sel-half"><option value="">— select —</option></select>
      </div>

      <div class="row">
        <div class="fld grow" id="frontFld"><label>Defensive front</label>
          <input id="front" type="text" autocomplete="off" autocapitalize="words"
                 placeholder="Start typing &mdash; past entries appear">
          <div class="ac-drop" id="frontDrop" hidden></div>
        </div>
        <div class="fld grow"><label>Coverage</label>
          <input id="coverage" type="text" autocomplete="off" autocapitalize="words"
                 placeholder="Start typing &mdash; past entries appear">
          <div class="ac-drop" id="coverageDrop" hidden></div>
        </div>
      </div>

      <div class="row">
        <div class="fld"><label>Yards gained</label>
          <div class="yards-row">
            <button id="yardSignBtn" class="signbtn gain" type="button">+</button>
            <input id="yards" class="num-w" type="number" inputmode="numeric" placeholder="0" min="0">
            <div class="stepper">
              <button id="yardsUp" class="stepbtn" type="button" aria-label="Add 1 yard">&#9650;</button>
              <button id="yardsDown" class="stepbtn" type="button" aria-label="Remove 1 yard">&#9660;</button>
            </div>
          </div>
          <div class="hint" id="yardsHint">Gain &mdash; tap +/&minus; for a loss</div>
        </div>
        <div class="fld"><label>Effective play?</label>
          <button id="effBtn" class="eff on" type="button" aria-pressed="true">
            <span class="box">&#10003;</span> Effective Play
          </button>
          <div class="hint" id="effHint">Auto-checked when the play gains enough</div>
        </div>
        <div class="fld"><label>Touchdown?</label>
          <button id="tdBtn" class="eff" type="button" aria-pressed="false" style="background:#fff;border:1.5px solid #E2E8F0;color:var(--ink)">
            <span class="box">&#127944;</span> TD
          </button>
        </div>
        <div class="fld grow"><label>Result (tap any)</label>
          <div class="chips" id="tags">
            <button class="chip" data-v="1st Down">1st Down</button>
            <button class="chip" data-v="TD">TD</button>
            <button class="chip" data-v="Incomplete">Incomplete</button>
            <button class="chip" data-v="Sack">Sack</button>
            <button class="chip" data-v="Penalty">Penalty</button>
            <button class="chip" data-v="Turnover">Turnover</button>
          </div>
        </div>
      </div>

      <div class="row">
        <button class="add" id="addBtn">+ Add Play</button>
        <button class="note-btn" id="noteBtn" type="button">&#128221; <span id="noteBtnLabel">Add Note</span></button>
        <button class="cancel" id="cancelEdit" type="button" hidden>Cancel</button>
      </div>
    </section>

    <div class="log-head">
      <h2>Play log</h2>
    </div>

    <div class="table-scroll">
      <table>
        <thead><tr>
          <th>#</th><th>Qtr</th><th>Dn &amp; Dist</th><th>Ball</th><th>Type</th>
          <th>Formation</th><th>Play call</th><th>Yds</th><th>Effective</th>
          <th>Result</th><th>Notes</th><th></th>
        </tr></thead>
        <tbody id="logBody"></tbody>
      </table>
    </div>

    <div class="splits" id="splits"></div>

    <div class="game-toolbar">
      <button class="toolbar-btn primary" id="quickReportBtn">&#128203; Quick Report</button>
      <button class="toolbar-btn" id="exportCsvBtn">Export CSV</button>
      <button class="toolbar-btn" id="exportHudlBtn">Export for Hudl</button>
      <button class="toolbar-btn" id="printBtn">Print</button>
    </div>
  </div>

  <div class="modal-back" id="noteModal" hidden>
    <div class="modal">
      <h2>Play Note</h2>
      <textarea id="noteText" class="note-area" placeholder="Notes for this play..."></textarea>
      <div class="modal-btns" style="flex-direction:row;gap:10px">
        <button class="btn-primary" id="noteSave">Save Note</button>
        <button class="modal-cancel" id="noteCancel">Cancel</button>
      </div>
    </div>
  </div>

  <div class="modal-back" id="reportOverlay" hidden>
    <div class="report-panel">
      <div class="report-head">
        <h2>Quick Report</h2>
        <button class="back" id="reportClose">&#x2715;</button>
      </div>
      <div class="report-tabs">
        <button class="rtab active" data-tab="eff">Most Effective</button>
        <button class="rtab" data-tab="ineff">Least Effective</button>
        <button class="rtab" data-tab="call">By Play Call</button>
        <button class="rtab" data-tab="down">By Down</button>
        <button class="rtab" data-tab="hash">By Hash</button>
        <button class="rtab" data-tab="players">Players</button>
        <button class="rtab" data-tab="stats">Game Stats</button>
        <button class="rtab" data-tab="heatmap">Heat Map</button>
        <button class="rtab" data-tab="redzone">Red Zone</button>
        <button class="rtab" id="rtabSeries" data-tab="series" style="display:none">By Series</button>
        <button class="rtab" data-tab="notes">Game Notes</button>
      </div>
      <div class="report-body" id="reportBody"></div>
    </div>
  </div>

  <div class="modal-back" id="penaltyModal" hidden>
    <div class="modal">
      <h2>Penalty</h2>
      <p>Will the down be replayed?</p>
      <div class="modal-btns">
        <button class="mode-pick" id="penaltyYes"><b>Yes &mdash; replay the down</b><span>Same down &middot; distance adjusted for yards</span></button>
        <button class="mode-pick" id="penaltyNo"><b>No &mdash; advance normally</b><span>Apply standard yardage rules</span></button>
      </div>
    </div>
  </div>

  <div class="modal-back" id="drillModal" hidden>
    <div class="modal modal-wide">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px">
        <h2 id="drillTitle" style="margin:0;font-size:18px"></h2>
        <button id="drillClose" class="modal-cancel" style="margin:0;flex:none;font-size:22px;line-height:1;padding:0 6px">&times;</button>
      </div>
      <div id="drillBody" class="drill-scroll"></div>
    </div>
  </div>

  <div class="modal-back" id="respotModal" hidden>
    <div class="modal" style="max-width:320px;text-align:center">
      <h2 style="margin-bottom:8px">After the TD</h2>
      <p style="font-size:14px;color:var(--slate);margin-bottom:16px">Where does the next drive start? (ball-on yard line)</p>
      <input id="respotInput" type="number" class="field" style="width:100%;text-align:center;font-size:24px;height:52px;margin-bottom:16px" placeholder="25" min="1" max="99">
      <div style="display:flex;gap:10px">
        <button class="btn-secondary" id="respotSkip" style="flex:1">Skip</button>
        <button class="btn-primary" id="respotSet" style="flex:1">Set</button>
      </div>
    </div>
  </div>

  <div class="modal-back" id="suggestModal" hidden>
    <div class="modal" style="max-width:480px;width:95%">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <h2 style="font-size:18px">Suggest a Play</h2>
        <button class="back" id="suggestClose">&#x2715;</button>
      </div>

      <!-- Situation pickers -->
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px">
        <div>
          <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--slate);display:block;margin-bottom:4px">Down</label>
          <select id="suggestDown" class="field" style="width:100%">
            <option value="">Any</option>
            <option value="1">1st</option>
            <option value="2">2nd</option>
            <option value="3">3rd</option>
            <option value="4">4th</option>
          </select>
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--slate);display:block;margin-bottom:4px">To Go</label>
          <select id="suggestDist" class="field" style="width:100%">
            <option value="">Any</option>
            <option value="short">Short (1&ndash;3)</option>
            <option value="medium">Medium (4&ndash;7)</option>
            <option value="long">Long (8+)</option>
          </select>
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--slate);display:block;margin-bottom:4px">Hash</label>
          <select id="suggestHash" class="field" style="width:100%">
            <option value="">Any</option>
            <option value="L">Left</option>
            <option value="M">Middle</option>
            <option value="R">Right</option>
          </select>
        </div>
      </div>

      <!-- Results -->
      <div id="suggestResults"></div>
    </div>
  </div>
</div>`;
}
