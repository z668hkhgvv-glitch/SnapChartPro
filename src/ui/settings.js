/**
 * settings.js — Two-panel settings screen for SnapChart Pro.
 *
 * Left sidebar lists section headers; right pane renders only the
 * fields for the active section. Settings persist to localStorage.
 */

const STORAGE_KEY = "snapchart_settings";

export const SETTING_DEFAULTS = {
  effStd1:     5,
  effStd2:     50,
  effStd3:     100,
  effStd4:     100,
  effScrim:    5,
  defaultDist: 10,
  scrimmPlays: 10,
  formations: [
    "Shotgun","Singleback","I-Form","Pistol","Empty",
    "Trips Right","Trips Left","Goal Line","Wildcat",
  ],
  teamName: "",
};

export function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    const merged = { ...SETTING_DEFAULTS, ...stored };
    // Ensure formations is always an array
    if (!Array.isArray(merged.formations)) merged.formations = [...SETTING_DEFAULTS.formations];
    return merged;
  } catch {
    return { ...SETTING_DEFAULTS, formations: [...SETTING_DEFAULTS.formations] };
  }
}

function saveSettings(s) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

// ---------- section definitions -----------------------------------------------

const SECTIONS = [
  { id: "effectiveness", label: "Effectiveness",  icon: "✓" },
  { id: "defaults",      label: "Game Defaults",  icon: "⚙" },
  { id: "formations",    label: "Formations",     icon: "≡" },
  { id: "account",       label: "Account",        icon: "◎" },
];

// ---------- public entry point ------------------------------------------------

export function renderSettings(container, onBack) {
  let settings = loadSettings();
  let active   = SECTIONS[0].id;

  container.innerHTML = buildShell();

  document.getElementById("settingsBackBtn").addEventListener("click", onBack);

  const navItems = Array.from(document.querySelectorAll(".sn-item"));
  navItems.forEach((btn) => {
    btn.addEventListener("click", () => {
      active = btn.getAttribute("data-section");
      navItems.forEach((b) => b.classList.toggle("active", b === btn));
      showSection(active);
    });
  });

  // Activate first item
  if (navItems[0]) navItems[0].classList.add("active");
  showSection(active);

  // ---------- section renderer -------------------------------------------------

  function showSection(id) {
    const pane = document.getElementById("settingsPane");
    pane.innerHTML = buildSection(id);
    wireSection(id);
  }

  function buildSection(id) {
    if (id === "effectiveness") return buildEffHTML();
    if (id === "defaults")      return buildDefaultsHTML();
    if (id === "formations")    return buildFormationsHTML();
    if (id === "account")       return buildAccountHTML();
    return "";
  }

  // ---- Effectiveness ----------------------------------------------------------

  function buildEffHTML() {
    const s = settings;
    return `
<div class="sp-section">
  <div class="sp-head">
    <h2>Effectiveness Thresholds</h2>
    <p>A play is auto-marked effective when it meets these thresholds. You can always override per-play.</p>
  </div>

  <div class="sp-group">
    <div class="sp-group-title">Standard mode &mdash; by down</div>

    <div class="sp-row">
      <div class="sp-row-label">
        <span class="sp-label">1st down</span>
        <span class="sp-hint">Minimum yards gained to be effective</span>
      </div>
      <div class="sp-control">
        <input type="number" id="effStd1" class="sp-num" value="${s.effStd1}" min="0" max="99">
        <span class="sp-unit">yds</span>
      </div>
    </div>

    <div class="sp-row">
      <div class="sp-row-label">
        <span class="sp-label">2nd down</span>
        <span class="sp-hint">% of remaining distance needed</span>
      </div>
      <div class="sp-control">
        <input type="number" id="effStd2" class="sp-num" value="${s.effStd2}" min="0" max="100">
        <span class="sp-unit">%</span>
      </div>
    </div>

    <div class="sp-row">
      <div class="sp-row-label">
        <span class="sp-label">3rd down</span>
        <span class="sp-hint">% of remaining distance needed</span>
      </div>
      <div class="sp-control">
        <input type="number" id="effStd3" class="sp-num" value="${s.effStd3}" min="0" max="100">
        <span class="sp-unit">%</span>
      </div>
    </div>

    <div class="sp-row">
      <div class="sp-row-label">
        <span class="sp-label">4th down</span>
        <span class="sp-hint">% of remaining distance needed</span>
      </div>
      <div class="sp-control">
        <input type="number" id="effStd4" class="sp-num" value="${s.effStd4}" min="0" max="100">
        <span class="sp-unit">%</span>
      </div>
    </div>
  </div>

  <div class="sp-group">
    <div class="sp-group-title">Scrimmage mode</div>

    <div class="sp-row">
      <div class="sp-row-label">
        <span class="sp-label">Minimum yards</span>
        <span class="sp-hint">Yards gained to count a scrimmage play as effective</span>
      </div>
      <div class="sp-control">
        <input type="number" id="effScrim" class="sp-num" value="${s.effScrim}" min="0" max="99">
        <span class="sp-unit">yds</span>
      </div>
    </div>
  </div>

  <div class="sp-footer">
    <button class="sp-save" id="effSaveBtn">Save changes</button>
  </div>
</div>`;
  }

  // ---- Defaults ---------------------------------------------------------------

  function buildDefaultsHTML() {
    const s = settings;
    return `
<div class="sp-section">
  <div class="sp-head">
    <h2>Game Defaults</h2>
    <p>Starting values applied when a new game begins.</p>
  </div>

  <div class="sp-group">
    <div class="sp-group-title">Standard mode</div>
    <div class="sp-row">
      <div class="sp-row-label">
        <span class="sp-label">Default yards to go</span>
        <span class="sp-hint">Pre-filled in the "To go" field at the start of each drive</span>
      </div>
      <div class="sp-control">
        <input type="number" id="defaultDist" class="sp-num" value="${s.defaultDist}" min="1" max="99">
        <span class="sp-unit">yds</span>
      </div>
    </div>
  </div>

  <div class="sp-group">
    <div class="sp-group-title">Scrimmage mode</div>
    <div class="sp-row">
      <div class="sp-row-label">
        <span class="sp-label">Plays per series</span>
        <span class="sp-hint">How many plays make up one scrimmage series</span>
      </div>
      <div class="sp-control">
        <input type="number" id="scrimmPlays" class="sp-num" value="${s.scrimmPlays}" min="1" max="50">
        <span class="sp-unit">plays</span>
      </div>
    </div>
  </div>

  <div class="sp-footer">
    <button class="sp-save" id="defaultsSaveBtn">Save changes</button>
  </div>
</div>`;
  }

  // ---- Formations -------------------------------------------------------------

  function buildFormationsHTML() {
    const forms = settings.formations || [];
    return `
<div class="sp-section">
  <div class="sp-head">
    <h2>Formations</h2>
    <p>These appear as autocomplete suggestions in the Formation field. Formations entered during games are also remembered per-game.</p>
  </div>

  <div class="sp-group">
    <div class="sp-group-title">Default formation list</div>
    <ul class="sp-form-list" id="formationList">
      ${forms.length ? forms.map((f, i) => `
        <li class="sp-form-item" data-idx="${i}">
          <span class="sp-form-name">${esc(f)}</span>
          <button class="sp-form-del" data-idx="${i}" title="Remove">&times;</button>
        </li>
      `).join("") : `<li class="sp-form-empty">No formations yet.</li>`}
    </ul>
    <div class="sp-form-add">
      <input type="text" id="newFormInput" placeholder="Add a formation…" autocomplete="off" autocapitalize="words" class="sp-form-inp">
      <button class="sp-add-btn" id="addFormBtn">Add</button>
    </div>
  </div>
</div>`;
  }

  // ---- Account ----------------------------------------------------------------

  function buildAccountHTML() {
    return `
<div class="sp-section">
  <div class="sp-head">
    <h2>Account</h2>
    <p>Team and profile settings.</p>
  </div>

  <div class="sp-group">
    <div class="sp-group-title">Team</div>
    <div class="sp-row">
      <div class="sp-row-label">
        <span class="sp-label">Team name</span>
        <span class="sp-hint">Shown on reports and exports</span>
      </div>
      <div class="sp-control sp-control-wide">
        <input type="text" id="teamName" class="sp-text" value="${esc(settings.teamName || "")}" placeholder="e.g. Lincoln Eagles" autocomplete="off">
      </div>
    </div>
  </div>

  <div class="sp-footer">
    <button class="sp-save" id="accountSaveBtn">Save changes</button>
  </div>
</div>`;
  }

  // ---------- section event wiring ---------------------------------------------

  function wireSection(id) {
    if (id === "effectiveness") {
      document.getElementById("effSaveBtn").addEventListener("click", () => {
        settings.effStd1  = clamp(parseInt(document.getElementById("effStd1").value), 0, 99);
        settings.effStd2  = clamp(parseInt(document.getElementById("effStd2").value), 0, 100);
        settings.effStd3  = clamp(parseInt(document.getElementById("effStd3").value), 0, 100);
        settings.effStd4  = clamp(parseInt(document.getElementById("effStd4").value), 0, 100);
        settings.effScrim = clamp(parseInt(document.getElementById("effScrim").value), 0, 99);
        saveSettings(settings);
        flashSaved("effSaveBtn");
      });
    }

    if (id === "defaults") {
      document.getElementById("defaultsSaveBtn").addEventListener("click", () => {
        settings.defaultDist = clamp(parseInt(document.getElementById("defaultDist").value), 1, 99);
        settings.scrimmPlays = clamp(parseInt(document.getElementById("scrimmPlays").value), 1, 50);
        saveSettings(settings);
        flashSaved("defaultsSaveBtn");
      });
    }

    if (id === "formations") {
      document.getElementById("addFormBtn").addEventListener("click", doAddFormation);
      document.getElementById("newFormInput").addEventListener("keydown", (e) => {
        if (e.key === "Enter") doAddFormation();
      });
      document.getElementById("formationList").addEventListener("click", (e) => {
        const btn = e.target.closest(".sp-form-del");
        if (!btn) return;
        const idx = parseInt(btn.getAttribute("data-idx"), 10);
        settings.formations.splice(idx, 1);
        saveSettings(settings);
        showSection("formations");
      });
    }

    if (id === "account") {
      document.getElementById("accountSaveBtn").addEventListener("click", () => {
        settings.teamName = (document.getElementById("teamName").value || "").trim();
        saveSettings(settings);
        flashSaved("accountSaveBtn");
      });
    }
  }

  function doAddFormation() {
    const inp = document.getElementById("newFormInput");
    const val = inp.value.trim();
    if (!val) return;
    const already = settings.formations.some((f) => f.toLowerCase() === val.toLowerCase());
    if (!already) {
      settings.formations.push(val);
      saveSettings(settings);
    }
    showSection("formations");
  }
}

// ---------- helpers -----------------------------------------------------------

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]
  );
}

function clamp(n, lo, hi) {
  return isNaN(n) ? lo : Math.max(lo, Math.min(hi, n));
}

function flashSaved(btnId) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  const orig = btn.textContent;
  btn.textContent = "Saved!";
  btn.classList.add("saved");
  setTimeout(() => {
    if (btn.isConnected) { btn.textContent = orig; btn.classList.remove("saved"); }
  }, 1600);
}

// ---------- shell HTML --------------------------------------------------------

function buildShell() {
  return `
<div class="settings-wrap">
  <header class="board">
    <div class="board-top">
      <div style="display:flex;align-items:center;gap:12px">
        <button id="settingsBackBtn" class="back" aria-label="Back to dashboard">&larr;</button>
        <div>
          <h1>Settings</h1>
          <div class="sub">Team &amp; app configuration</div>
        </div>
      </div>
    </div>
  </header>

  <div class="settings-body">
    <nav class="settings-nav" aria-label="Settings sections">
      ${SECTIONS.map((s) => `
        <button class="sn-item" data-section="${s.id}">
          <span class="sn-icon">${s.icon}</span>
          <span class="sn-label">${s.label}</span>
        </button>
      `).join("")}
    </nav>

    <div class="settings-pane" id="settingsPane"></div>
  </div>
</div>`;
}
