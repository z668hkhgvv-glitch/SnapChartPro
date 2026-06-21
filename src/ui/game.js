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
  if (mode === "7v7")       return autoEff7v7(down, dist, yards);
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

function autoEff7v7(down, toGo, yards) {
  toGo  = Number(toGo)  || 0;
  yards = Number(yards) || 0;
  down  = Number(down)  || 1;
  if (toGo <= 0) return yards >= 0;
  if (yards >= toGo) return true;
  const remaining = Math.max(1, 5 - down);
  return yards >= toGo / remaining;
}

function target7v7(ballOn) {
  ballOn = Number(ballOn);
  if (isNaN(ballOn)) return null;
  if (ballOn > 20) return 20;
  if (ballOn > 5)  return 5;
  return 0;
}

function advance7v7(ballOn, down, yards) {
  const nb = Number(ballOn) - Number(yards);
  if (nb <= 0) return { ball: 40, down: 1 };
  const prevTarget = target7v7(ballOn);
  if (nb <= prevTarget) return { ball: nb, down: 1 };
  if (Number(down) >= 4) return { ball: 40, down: 1 };
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

// ---------- public entry point -----------------------------------------------

export function renderGame(container, user, teamId, game, userRole, onBack) {
  // Per-render state
  let plays = [];
  let editingId = null;
  let unsub = null;
  let penaltyPendingPlay = null;

  // Role gates
  const canChart  = userRole !== "readonly";   // add & edit plays
  const canDelete = userRole !== "readonly";   // delete individual plays
  // (deleting games is admin-only, enforced in dashboard)

  const mode = game.mode || "standard";
  const is7   = mode === "7v7";
  const isScrim = mode === "scrimmage";

  const settings = {
    effStd1: 5, effStd2: 50, effStd3: 100, effStd4: 100,
    effScrim: 5, defaultDist: 10, scrimmPlays: 10,
  };

  // Draft holds the in-progress form values that are NOT simple text inputs.
  const draft = {
    qtr:       is7 || isScrim ? "" : "1",
    down:      isScrim ? "" : "1",
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
  wireSeg("ptype", "type");
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
    const t    = target7v7(ballOn);
    const toGo = Number(ballOn) - t;
    document.getElementById("dist").value = toGo;
    const targetLabel = t === 0 ? "the end zone" : "the " + t;
    hint.innerHTML = `Play <b>${esc(draft.down)} of 4</b> · reach <b>${targetLabel}</b> · <b>${toGo}</b> to go`;
    refreshAutoEff();
  }
  function updateScrimHint() {
    if (mode !== "scrimmage") return;
    const sp = settings.scrimmPlays || 10;
    const playNum = (plays.length % sp) + 1;
    const series  = Math.floor(plays.length / sp) + 1;
    document.getElementById("seriesHint").innerHTML =
      `Play <b>${playNum} of ${sp}</b> · series <b>${series}</b> · effective at ${settings.effScrim || 5}+ yards`;
  }

  // Apply mode visibility once on initial render
  applyModeVisibility();
  if (is7) {
    document.getElementById("yl").value = 40;
    update7v7Hint();
  } else if (isScrim) {
    updateScrimHint();
  }

  function applyModeVisibility() {
    document.getElementById("qtrFld").style.display   = is7 || isScrim ? "none" : "";
    document.getElementById("downFld").style.display  = isScrim ? "none" : "";
    document.getElementById("ptypeFld").style.display = is7 ? "none" : "";
    document.getElementById("distFld").style.display  = is7 || isScrim ? "none" : "";
    document.getElementById("seriesRow").style.display = is7 || isScrim ? "" : "none";
    document.getElementById("frontFld").style.display = is7 ? "none" : "";
    const modeBadge = document.getElementById("modeBadge");
    if (modeBadge) {
      modeBadge.style.display = is7 || isScrim ? "" : "none";
      modeBadge.textContent = is7 ? "7v7 · pass-only" : isScrim ? `Scrimmage · ${settings.scrimmPlays || 10}-play series` : "";
    }
    const ylSignBtnEl = document.getElementById("ylSignBtn");
    const ylHintEl    = document.getElementById("ylHint");
    if (ylSignBtnEl) ylSignBtnEl.style.display = is7 ? "none" : "";
    if (ylHintEl)    ylHintEl.style.display    = is7 ? "none" : "";
  }

  // ---- autocomplete dropdowns ----
  const AC_IDS = ["formDrop","callDrop","motionDrop","frontDrop","coverageDrop"];
  function closeAllAC() {
    AC_IDS.forEach((id) => {
      const d = document.getElementById(id);
      if (d) { d.hidden = true; d.innerHTML = ""; }
    });
  }
  function getACList(key) {
    const fromPlays = plays.map((p) => p[key] || "");
    const defaults  = key === "form" ? DEFAULT_FORMS : [];
    return uniqCI(defaults.concat(fromPlays)).sort();
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
    const sp = settings.scrimmPlays || 10;

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
    };
    if (isScrim) {
      playData.playNum = (plays.length % sp) + 1;
      playData.series  = Math.floor(plays.length / sp) + 1;
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

        await dbAddPlay(teamId, game.id, playData);
        finishEntry(true);

        // Auto-advance form state
        if (mode === "7v7") {
          const res = advance7v7(playData.yl, playData.down, yards);
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
          const adv = advanceBallOn(playData.yl, yards);
          if (adv) {
            document.getElementById("yl").value = adv.yl;
            draft.ylSign = adv.sign;
            paintYlSign();
          }
        }
        if (isScrim) updateScrimHint();
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
      const res = advance7v7(last.yl, last.down, last.yards);
      draft.down = String(res.down); setSeg("down", String(res.down));
      document.getElementById("yl").value = res.ball;
      update7v7Hint();
    } else if (mode === "scrimmage") {
      draft.down = ""; setSeg("down", "");
      const advS = advanceBallOn(last.yl, last.yards);
      if (advS) { document.getElementById("yl").value = advS.yl; draft.ylSign = advS.sign; paintYlSign(); }
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
      body.innerHTML = plays.map((p, i) => {
        const dir  = p.yards > 0 ? "up" : p.yards < 0 ? "down" : "flat";
        const sign = p.yards > 0 ? "+" : "";
        const tags = (p.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("");
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
          `<td>${esc(p.call || "—")}</td>` +
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
</div>`;
}
