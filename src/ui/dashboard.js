import { logoutCoach } from "../auth.js";
import {
  getGames, createGame, deleteGame,
  getTeam, updateTeam,
  getMembers, getTeamInvites,
  inviteCoach, cancelInvite,
  updateMemberRole, removeMember,
  getPlays, getSeasons, archiveSeason,
} from "../db.js";
import { renderGame } from "./game.js";

// ── Hudl CSV roster import helper ────────────────────────────────────────────

function importHudlRosterCSV(text, existingRoster) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return 0;
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, "").toLowerCase());
  let iFirst = -1, iLast = -1, iName = -1, iJersey = -1, iPos = -1;
  headers.forEach((h, i) => {
    if (h === "first name" || h === "firstname") iFirst = i;
    else if (h === "last name" || h === "lastname") iLast = i;
    else if (h === "name" || h === "player" || h === "full name") iName = i;
    if (h === "number" || h === "jersey" || h === "jersey number" || h === "#" || h === "no.") iJersey = i;
    if (h === "position" || h === "pos") iPos = i;
  });
  let added = 0;
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",").map(c => c.trim().replace(/^"|"$/g, ""));
    let name = iName >= 0 ? (cells[iName] || "") : ((cells[iFirst] || "") + " " + (cells[iLast] || "")).trim();
    const jersey = iJersey >= 0 ? (cells[iJersey] || "") : "";
    let pos = (iPos >= 0 ? (cells[iPos] || "") : "").toUpperCase();
    if (!name) continue;
    const known = ["QB","RB","WR","TE","OL","K"];
    if (!known.includes(pos)) pos = "Other";
    const dup = existingRoster.some(p => p.name.toLowerCase() === name.toLowerCase() && p.jersey === jersey);
    if (dup) continue;
    existingRoster.push({ id: "p_" + Date.now() + "_" + Math.random().toString(36).slice(2), name, jersey, pos });
    added++;
  }
  return added;
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function renderDashboard(container, user, teamId, userRole, onRefresh) {
  let team;
  try {
    team = await getTeam(teamId);
  } catch (err) {
    console.error("getTeam failed:", err);
    team = null;
  }
  const teamName = team?.name || "My Team";
  const isAdmin  = userRole === "admin";
  const canChart = userRole !== "readonly";

  container.innerHTML = `
    <div class="dash-wrap">
      <header class="dash-header">
        <div>
          <svg width="480" height="80" viewBox="0 28 480 80"
               xmlns="http://www.w3.org/2000/svg" aria-label="SnapChart Pro" role="img"
               style="height:42px;width:auto;display:block">
            <rect x="20" y="34" width="92" height="92" rx="20"
                  fill="#ffffff" fill-opacity="0.15"/>
            <rect x="38" y="80" width="15" height="28" rx="3" fill="#ffffff"/>
            <rect x="59" y="66" width="15" height="42" rx="3" fill="#ffffff"/>
            <rect x="80" y="50" width="15" height="58" rx="3" fill="#ffffff"/>
            <path d="M79 44 l5 6 l12 -15" fill="none" stroke="#F59E0B" stroke-width="6"
                  stroke-linecap="round" stroke-linejoin="round"/>
            <text x="132" y="92" font-size="46"
                  font-family="Oswald,'Arial Narrow',sans-serif" font-weight="700">
              <tspan fill="#ffffff">Snap</tspan>
              <tspan fill="rgba(255,255,255,0.75)">Chart</tspan>
              <tspan fill="#F59E0B" font-size="36"> Pro</tspan>
            </text>
          </svg>
        </div>
        <div class="dash-header-right">
          <span class="coach-email" id="headerTeamName">${esc(teamName)}</span>
          <span class="role-badge role-${userRole}">${roleName(userRole)}</span>
          ${isAdmin
            ? `<button id="settingsBtn" class="btn-ghost">&#9881; Settings</button>`
            : ""}
          <button id="seasonReviewBtn" class="btn-ghost">&#9776; Season Review</button>
          <button id="logoutBtn" class="btn-ghost">Sign out</button>
        </div>
      </header>

      <main class="dash-main">
        <div class="dash-top">
          <h2>Games</h2>
          ${canChart
            ? `<button id="newGameBtn" class="btn-primary">+ New Game</button>`
            : ""}
        </div>
        <div id="gameList" class="game-list">
          <div class="loading">Loading games&hellip;</div>
        </div>
      </main>
    </div>
  `;

  document.getElementById("logoutBtn").addEventListener("click", () => logoutCoach());

  document.getElementById("seasonReviewBtn").addEventListener("click", () =>
    renderSeasonReview(container, user, teamId, userRole,
      () => renderDashboard(container, user, teamId, userRole, onRefresh))
  );

  if (canChart) {
    document.getElementById("newGameBtn").addEventListener("click", () =>
      showNewGameModal(container, user, teamId, userRole, onRefresh)
    );
  }

  if (isAdmin) {
    document.getElementById("settingsBtn").addEventListener("click", () =>
      showSettingsModal(container, teamId, user, onRefresh)
    );
  }

  await refreshGameList(container, user, teamId, userRole, onRefresh);
}

// ── Game list ─────────────────────────────────────────────────────────────────

async function refreshGameList(container, user, teamId, userRole, onRefresh) {
  const list = document.getElementById("gameList");
  if (!list) return;

  let games;
  try {
    games = await getGames(teamId);
  } catch (err) {
    console.error("getGames failed:", err);
    list.innerHTML = `<div class="empty-state" style="color:#DC2626">Error loading games: ${esc(err.message)}</div>`;
    return;
  }

  const isAdmin  = userRole === "admin";

  if (!games.length) {
    list.innerHTML = `<div class="empty-state">No games yet.${
      userRole !== "readonly" ? " Tap <b>+ New Game</b> to start." : ""
    }</div>`;
    return;
  }

  list.innerHTML = games.map((g) => `
    <div class="game-card" data-id="${esc(g.id)}">
      <div class="game-card-name">${g.opponent ? "vs " + esc(g.opponent) : "Untitled game"}</div>
      <div class="game-card-meta">${esc(g.date || "")}${g.date ? " &middot; " : ""}${esc(g.mode || "standard")}</div>
      <div style="display:flex;gap:8px;align-items:center;flex-shrink:0">
        <button class="btn-secondary open-game" data-id="${esc(g.id)}">Open</button>
        ${isAdmin
          ? `<button class="del-game icon-btn" data-id="${esc(g.id)}" title="Delete game">&times;</button>`
          : ""}
      </div>
    </div>
  `).join("");

  list.querySelectorAll(".open-game").forEach((btn) => {
    const game = games.find((g) => g.id === btn.dataset.id);
    btn.addEventListener("click", () =>
      loadGame(container, user, teamId, game, userRole, onRefresh)
    );
  });

  if (isAdmin) {
    list.querySelectorAll(".del-game").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm("Delete this game and all its plays? This can't be undone.")) return;
        try {
          await deleteGame(teamId, btn.dataset.id);
          await refreshGameList(container, user, teamId, userRole, onRefresh);
        } catch (err) {
          alert("Could not delete: " + err.message);
        }
      });
    });
  }
}

async function loadGame(container, user, teamId, game, userRole, onRefresh) {
  let teamSettings = {};
  try {
    const t = await getTeam(teamId);
    // Merge top-level player-tracking fields + nested settings
    teamSettings = {
      ...(t?.settings || {}),
      trackPlayers: t?.trackPlayers || false,
      roster: t?.roster || [],
    };
  } catch (_) {}
  renderGame(container, user, teamId, game, userRole, teamSettings, () =>
    renderDashboard(container, user, teamId, userRole, onRefresh)
  );
}

// ── New game modal ─────────────────────────────────────────────────────────────

function showNewGameModal(container, user, teamId, userRole, onRefresh) {
  const overlay = document.createElement("div");
  overlay.className = "modal-back";
  overlay.innerHTML = `
    <div class="modal">
      <h2>New Game</h2>
      <p>Choose the game type for this session.</p>
      <div style="margin-bottom:14px">
        <div class="form-field">
          <label>Opponent</label>
          <input id="ngOpponent" type="text" placeholder="e.g. Rival High" autocomplete="off">
        </div>
      </div>
      <div class="modal-btns">
        <button class="mode-pick" data-mode="standard">
          <b>Standard</b><span>Full down/distance, all fields</span>
        </button>
        <button class="mode-pick" data-mode="7v7">
          <b>7v7</b><span>Pass-only, ball-driven series</span>
        </button>
        <button class="mode-pick" data-mode="scrimmage">
          <b>Scrimmage</b><span>10 plays per series, no downs</span>
        </button>
      </div>
      <button class="modal-cancel" id="ngCancel">Cancel</button>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelectorAll(".mode-pick").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const mode     = btn.getAttribute("data-mode");
      const opponent = (overlay.querySelector("#ngOpponent").value || "").trim();
      const date     = new Date().toLocaleDateString("en-US",
        { month: "short", day: "numeric", year: "numeric" });
      document.body.removeChild(overlay);
      try {
        const gameId = await createGame(teamId, { opponent, date, mode });
        loadGame(container, user, teamId, { id: gameId, opponent, date, mode },
                 userRole, onRefresh);
      } catch (err) {
        console.error("createGame failed:", err);
        alert("Could not create game: " + err.message);
      }
    });
  });

  overlay.querySelector("#ngCancel").addEventListener("click", () =>
    document.body.removeChild(overlay)
  );
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) document.body.removeChild(overlay);
  });
}

// ── Settings modal (admin only) ───────────────────────────────────────────────

async function showSettingsModal(container, teamId, user, onRefresh) {
  const team = await getTeam(teamId);
  const teamSettings = {
    ...(team?.settings || {}),
    trackPlayers: team?.trackPlayers || false,
    roster: team?.roster || [],
    rosterSort: team?.rosterSort || "number",
    library: team?.library || { forms:[], calls:[], motions:[], fronts:[], coverages:[] },
    coachName: team?.coachName || "",
  };
  const ACCENT_COLORS = [
    '#16317F','#1E44C4','#C92828','#D97706',
    '#15803D','#0E7B6C','#6D3EC4','#BE185D',
    '#0369A1','#374151','#7C3AED','#B45309',
    '#047857','#DC2626','#1D4ED8','#9333EA',
  ];
  const currentAccent   = teamSettings.accentColor   || '#16317F';
  const currentMode     = teamSettings.defaultMode    || 'standard';
  const currentStart7v7 = teamSettings.start7v7       ?? 40;
  const currentLine1    = teamSettings.line1_7v7      ?? 20;
  const currentLine2    = teamSettings.line2_7v7      ?? 5;
  const currentPlays7v7 = teamSettings.playsPerSeries7v7 ?? 4;
  const currentEff7v7   = teamSettings.eff7v7Mode     || 'pace';
  const currentScrimMode = teamSettings.scrimmageMode || 'advance';
  const currentScrimPlaysEff = teamSettings.effScrimPlays ?? (teamSettings.scrimmPlays ?? 10);
  const LIB_CATS_PRO = [
    {key:"forms",    label:"Formations"},
    {key:"calls",    label:"Play Calls"},
    {key:"motions",  label:"Motions"},
    {key:"fronts",   label:"Defensive Fronts"},
    {key:"coverages",label:"Coverages"},
  ];
  function libAlphaSortPro(arr){ return [...arr].sort((a,b)=>a.toLowerCase().localeCompare(b.toLowerCase())); }
  let localLib = { forms:[...(teamSettings.library.forms||[])], calls:[...(teamSettings.library.calls||[])], motions:[...(teamSettings.library.motions||[])], fronts:[...(teamSettings.library.fronts||[])], coverages:[...(teamSettings.library.coverages||[])] };
  let libEditingCatPro = null, libEditingIdxPro = -1;

  const overlay = document.createElement("div");
  overlay.className = "modal-back";
  overlay.innerHTML = `
    <div class="modal settings-modal">
      <div class="settings-layout">
        <nav class="settings-nav">
          <div class="settings-nav-head">Settings</div>
          <button class="snav-btn active" data-pane="general">General</button>
          <button class="snav-btn" data-pane="scoring">Scoring</button>
          <button class="snav-btn" data-pane="library">Library</button>
          <button class="snav-btn" data-pane="players">Players</button>
          <button class="snav-btn" data-pane="v7">7v7</button>
          <button class="snav-btn" data-pane="scrimmage">Scrimmage</button>
          <button class="snav-btn" data-pane="team">Team</button>
          <button class="snav-btn" data-pane="data">Data</button>
          <button id="settingsClose" class="snav-close">&#x2715; Close</button>
        </nav>
        <div class="settings-content">

          <div class="settings-pane" data-pane="general">
            <div class="settings-label">Team Name</div>
            <div style="display:flex;gap:8px">
              <input id="teamNameField" type="text" value="${esc(team?.name || "")}"
                     style="flex:1;padding:9px 12px;border:2px solid #E5E7EB;
                            border-radius:8px;font-size:15px;font-family:var(--body)">
              <button class="btn-secondary" id="saveTeamNameBtn">Save</button>
            </div>
            <div style="margin-top:10px">
              <label style="font-size:14px;color:var(--slate);display:block;margin-bottom:4px">Coach Name</label>
              <input id="coachNameField" type="text" value="${esc(teamSettings.coachName)}"
                     placeholder="Head coach name"
                     style="width:100%;box-sizing:border-box;padding:9px 12px;border:2px solid #E5E7EB;
                            border-radius:8px;font-size:14px;font-family:var(--body)">
            </div>
            <div id="teamNameMsg" style="font-size:12px;margin-top:4px;display:none"></div>

            <div style="margin-top:20px">
              <div class="settings-label">Default Game Mode</div>
              <div style="display:flex;gap:0;border:2px solid #E5E7EB;border-radius:8px;overflow:hidden;width:fit-content">
                ${['standard','7v7','scrimmage'].map(m => {
                  const labels = { standard:'Standard', '7v7':'7v7', scrimmage:'Scrimmage' };
                  return `<button class="mode-seg-btn${m === currentMode ? ' mode-seg-active' : ''}"
                                  data-mode="${m}"
                                  style="padding:8px 18px;font-size:14px;border:none;cursor:pointer;
                                         font-family:var(--body);
                                         background:${m === currentMode ? '#16317F' : '#fff'};
                                         color:${m === currentMode ? '#fff' : '#374151'}">${labels[m]}</button>`;
                }).join('')}
              </div>
              <input type="hidden" id="defaultModeVal" value="${esc(currentMode)}">
              <div style="margin-top:8px;display:flex;align-items:center;gap:10px">
                <button class="btn-secondary" id="saveGameModeBtn">Save</button>
                <span id="gameModeMsg" style="font-size:12px;display:none"></span>
              </div>
            </div>

            <div style="margin-top:20px">
              <div class="settings-label">Team Accent Color</div>
              <div id="accentColorGrid" style="display:grid;grid-template-columns:repeat(8,28px);gap:8px;margin-bottom:10px">
                ${ACCENT_COLORS.map(c => `
                  <button class="accent-swatch${c === currentAccent ? ' accent-selected' : ''}"
                          data-color="${c}"
                          title="${c}"
                          style="width:24px;height:24px;border-radius:50%;background:${c};cursor:pointer;
                                 border:${c === currentAccent ? '3px solid #111' : '2px solid transparent'};
                                 box-shadow:${c === currentAccent ? '0 0 0 2px #fff inset' : 'none'};
                                 padding:0;outline:none"></button>`).join('')}
              </div>
              <input type="hidden" id="accentColorVal" value="${esc(currentAccent)}">
              <div style="display:flex;align-items:center;gap:10px">
                <button class="btn-secondary" id="saveAccentColorBtn">Save</button>
                <span id="accentColorMsg" style="font-size:12px;display:none"></span>
              </div>
            </div>
          </div>

          <div class="settings-pane" data-pane="scoring" hidden>
            <h3 style="margin:0 0 12px;font-size:15px">Charting Defaults</h3>
            <div class="chart-defaults-grid">
              <label>Default yards to go</label>
              <input id="cfgDist" type="number" min="1" max="99" value="${team?.settings?.defaultDist ?? 10}">

              <label>Scrimmage plays/series</label>
              <input id="cfgScrimmPlays" type="number" min="1" max="50" value="${team?.settings?.scrimmPlays ?? 10}">

              <label>Effective: scrimmage (yds)</label>
              <input id="cfgEffScrim" type="number" min="0" max="99" value="${team?.settings?.effScrim ?? 5}">

              <label>Effective: 1st down (yds)</label>
              <input id="cfgEff1" type="number" min="0" max="99" value="${team?.settings?.effStd1 ?? 5}">

              <label>Effective: 2nd down (%&nbsp;of dist)</label>
              <input id="cfgEff2" type="number" min="0" max="100" value="${team?.settings?.effStd2 ?? 50}">

              <label>Effective: 3rd down (%&nbsp;of dist)</label>
              <input id="cfgEff3" type="number" min="0" max="100" value="${team?.settings?.effStd3 ?? 100}">

              <label>Effective: 4th down (%&nbsp;of dist)</label>
              <input id="cfgEff4" type="number" min="0" max="100" value="${team?.settings?.effStd4 ?? 100}">
            </div>
            <div style="margin-top:10px;display:flex;align-items:center;gap:10px">
              <button class="btn-secondary" id="saveChartDefaultsBtn">Save Defaults</button>
              <span id="chartDefaultsMsg" style="font-size:12px;display:none"></span>
            </div>
          </div>

          <div class="settings-pane" data-pane="library" hidden>
            <h3 style="margin:0 0 4px;font-size:15px">Autocomplete Library</h3>
            <p style="font-size:13px;color:var(--slate);margin:0 0 14px">Entries available to all coaches when charting plays. Sorted alphabetically.</p>
            <div id="proLibAll"></div>
            <div style="margin-top:12px;display:flex;align-items:center;gap:10px">
              <button class="btn-secondary" id="saveLibraryBtn">Save Library</button>
              <span id="libraryMsg" style="font-size:12px;display:none"></span>
            </div>
          </div>

          <div class="settings-pane" data-pane="players" hidden>
            <h3 style="margin:0 0 12px;font-size:15px">Player Tracking</h3>
            <label class="toggle-row" style="margin-bottom:10px;display:flex;align-items:center;gap:10px;cursor:pointer">
              <span>Track passer / receiver / rusher</span>
              <input type="checkbox" id="stgTrackPlayers" ${teamSettings.trackPlayers ? "checked" : ""}>
            </label>
            <div id="rosterSection" style="${teamSettings.trackPlayers ? "" : "display:none"}">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:6px">
                <span style="font-size:13px;color:var(--slate)">Roster</span>
                <div style="display:flex;gap:4px">
                  <button id="rosterSortNum" class="btn-ghost" style="font-size:12px;padding:3px 10px">#</button>
                  <button id="rosterSortName" class="btn-ghost" style="font-size:12px;padding:3px 10px">A–Z</button>
                </div>
                <button id="importRosterBtn" class="btn-ghost" style="font-size:12px;padding:4px 10px;color:var(--royal);border:1px solid var(--chalk);background:#fff;border-radius:6px">Import Hudl CSV</button>
                <input id="rosterCsvInput" type="file" accept=".csv" style="display:none">
              </div>
              <div id="rosterList" style="margin-bottom:10px;max-height:200px;overflow-y:auto"></div>
              <div style="display:flex;gap:6px;flex-wrap:wrap">
                <input id="rosterName" type="text" class="field" placeholder="Player name" style="flex:1;min-width:120px;padding:8px 10px;border:1.5px solid var(--chalk);border-radius:8px;font-size:14px;font-family:var(--body)">
                <input id="rosterJersey" type="text" class="field" placeholder="#" style="width:60px;padding:8px 10px;border:1.5px solid var(--chalk);border-radius:8px;font-size:14px;font-family:var(--body)">
                <select id="rosterPos" class="field role-sel" style="width:80px">
                  <option value="QB">QB</option>
                  <option value="RB">RB</option>
                  <option value="WR">WR</option>
                  <option value="TE">TE</option>
                  <option value="OL">OL</option>
                  <option value="K">K</option>
                  <option value="Other">Other</option>
                </select>
                <button id="addRosterPlayerBtn" class="btn-primary" style="flex:none">Add</button>
              </div>
            </div>
            <div style="margin-top:12px;display:flex;align-items:center;gap:10px">
              <button class="btn-secondary" id="savePlayerTrackingBtn">Save Player Tracking</button>
              <span id="playerTrackingMsg" style="font-size:12px;display:none"></span>
            </div>
          </div>

          <div class="settings-pane" data-pane="v7" hidden>
            <h3 style="margin:0 0 12px;font-size:15px">7v7 Settings</h3>
            <div class="chart-defaults-grid">
              <label>Starting Position (yd)</label>
              <input id="cfg7vStart" type="number" min="1" max="99" value="${currentStart7v7}">

              <label>Line 1 (yd)</label>
              <input id="cfg7vLine1" type="number" min="1" max="99" value="${currentLine1}">

              <label>Line 2 (yd)</label>
              <input id="cfg7vLine2" type="number" min="1" max="99" value="${currentLine2}">

              <label>Plays per Series</label>
              <input id="cfg7vPlays" type="number" min="1" max="20" value="${currentPlays7v7}">

              <label>Effectiveness Mode</label>
              <select id="cfg7vEff" class="role-sel">
                <option value="pace"   ${currentEff7v7 === 'pace'   ? 'selected' : ''}>Pace (any 1st down = effective)</option>
                <option value="strict" ${currentEff7v7 === 'strict' ? 'selected' : ''}>Strict (must advance the line)</option>
              </select>
            </div>
            <div style="margin-top:10px;display:flex;align-items:center;gap:10px">
              <button class="btn-secondary" id="save7v7Btn">Save 7v7 Settings</button>
              <span id="v7Msg" style="font-size:12px;display:none"></span>
            </div>
          </div>

          <div class="settings-pane" data-pane="scrimmage" hidden>
            <h3 style="margin:0 0 12px;font-size:15px">Scrimmage Settings</h3>
            <div class="chart-defaults-grid">
              <label>Ball Movement</label>
              <select id="cfgScrimMode" class="role-sel">
                <option value="advance"   ${currentScrimMode === 'advance'   ? 'selected' : ''}>Advance (ball moves after each series)</option>
                <option value="fixed"     ${currentScrimMode === 'fixed'     ? 'selected' : ''}>Fixed (ball stays at starting spot)</option>
                <option value="simulated" ${currentScrimMode === 'simulated' ? 'selected' : ''}>Simulated (game-like with downs)</option>
              </select>

              <label>Plays per Series</label>
              <input id="cfgEffScrimPlays" type="number" min="1" max="50" value="${currentScrimPlaysEff}">
            </div>
            <div style="margin-top:10px;display:flex;align-items:center;gap:10px">
              <button class="btn-secondary" id="saveScrimBtn">Save Scrimmage Settings</button>
              <span id="scrimMsg" style="font-size:12px;display:none"></span>
            </div>
          </div>

          <div class="settings-pane" data-pane="team" hidden>
            <div class="settings-label">Coaches</div>
            <div id="membersList"><div class="loading">Loading&hellip;</div></div>

            <div style="margin-top:20px">
              <div class="settings-label">Invite a Coach</div>
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                <input id="inviteEmail" type="email" placeholder="coach@school.edu"
                       style="flex:1;min-width:180px;padding:9px 12px;border:2px solid #E5E7EB;
                              border-radius:8px;font-size:14px;font-family:var(--body)">
                <select id="inviteRole" class="role-sel">
                  <option value="editor">Editor</option>
                  <option value="readonly">Read-Only</option>
                  <option value="admin">Admin</option>
                </select>
                <button class="btn-primary" id="sendInviteBtn">Invite</button>
              </div>
              <div id="inviteMsg" style="font-size:12px;margin-top:6px;display:none"></div>
              <div id="invitesList" style="margin-top:10px"></div>
            </div>
          </div>

          <div class="settings-pane" data-pane="data" hidden>
            <h3 style="margin:0 0 8px;font-size:15px">Export Data</h3>
            <p style="font-size:13px;color:var(--slate);margin:0 0 12px">Download all games and settings as a JSON file for backup or external analysis.</p>
            <div style="display:flex;align-items:center;gap:10px">
              <button class="btn-secondary" id="exportJsonBtn">Export Team Data (JSON)</button>
              <span id="exportMsg" style="font-size:12px;display:none"></span>
            </div>
          </div>

        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector("#settingsClose").addEventListener("click", () =>
    document.body.removeChild(overlay)
  );
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) document.body.removeChild(overlay);
  });

  // Settings nav switching
  overlay.querySelectorAll(".snav-btn[data-pane]").forEach(btn => {
    btn.addEventListener("click", () => {
      overlay.querySelectorAll(".snav-btn[data-pane]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      overlay.querySelectorAll(".settings-pane").forEach(p => { p.hidden = true; });
      overlay.querySelector(`.settings-pane[data-pane="${btn.dataset.pane}"]`).hidden = false;
    });
  });

  // Save team name + coach name
  overlay.querySelector("#saveTeamNameBtn").addEventListener("click", async () => {
    const name      = overlay.querySelector("#teamNameField").value.trim();
    const coachName = overlay.querySelector("#coachNameField").value.trim();
    const msgEl     = overlay.querySelector("#teamNameMsg");
    if (!name) return;
    try {
      await updateTeam(teamId, { name, coachName });
      const hdr = document.getElementById("headerTeamName");
      if (hdr) hdr.textContent = name;
      msgEl.style.color = "#15803d";
      msgEl.textContent = "Saved.";
      msgEl.style.display = "block";
      setTimeout(() => { msgEl.style.display = "none"; }, 2000);
    } catch (err) {
      msgEl.style.color = "#DC2626";
      msgEl.textContent = "Error: " + err.message;
      msgEl.style.display = "block";
    }
  });

  // Default game mode segmented control
  overlay.querySelectorAll(".mode-seg-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      overlay.querySelectorAll(".mode-seg-btn").forEach(b => {
        b.style.background = "#fff";
        b.style.color = "#374151";
      });
      btn.style.background = "#16317F";
      btn.style.color = "#fff";
      overlay.querySelector("#defaultModeVal").value = btn.getAttribute("data-mode");
    });
  });

  overlay.querySelector("#saveGameModeBtn").addEventListener("click", async () => {
    const msgEl = overlay.querySelector("#gameModeMsg");
    const defaultMode = overlay.querySelector("#defaultModeVal").value;
    try {
      const t = await getTeam(teamId);
      await updateTeam(teamId, { settings: { ...(t?.settings || {}), defaultMode } });
      msgEl.style.color = "#15803d";
      msgEl.textContent = "Saved.";
      msgEl.style.display = "inline";
      setTimeout(() => { msgEl.style.display = "none"; }, 2000);
    } catch (err) {
      msgEl.style.color = "#DC2626";
      msgEl.textContent = "Error: " + err.message;
      msgEl.style.display = "inline";
    }
  });

  // Team accent color swatches
  overlay.querySelector("#accentColorGrid").addEventListener("click", e => {
    const btn = e.target.closest(".accent-swatch");
    if (!btn) return;
    const color = btn.getAttribute("data-color");
    overlay.querySelectorAll(".accent-swatch").forEach(b => {
      const c = b.getAttribute("data-color");
      b.style.border = "2px solid transparent";
      b.style.boxShadow = "none";
    });
    btn.style.border = "3px solid #111";
    btn.style.boxShadow = "0 0 0 2px #fff inset";
    overlay.querySelector("#accentColorVal").value = color;
  });

  overlay.querySelector("#saveAccentColorBtn").addEventListener("click", async () => {
    const msgEl = overlay.querySelector("#accentColorMsg");
    const accentColor = overlay.querySelector("#accentColorVal").value;
    try {
      const t = await getTeam(teamId);
      await updateTeam(teamId, { settings: { ...(t?.settings || {}), accentColor } });
      msgEl.style.color = "#15803d";
      msgEl.textContent = "Saved.";
      msgEl.style.display = "inline";
      setTimeout(() => { msgEl.style.display = "none"; }, 2000);
    } catch (err) {
      msgEl.style.color = "#DC2626";
      msgEl.textContent = "Error: " + err.message;
      msgEl.style.display = "inline";
    }
  });

  // Save 7v7 settings
  overlay.querySelector("#save7v7Btn").addEventListener("click", async () => {
    const msgEl = overlay.querySelector("#v7Msg");
    const numVal = (id, fallback) => {
      const v = parseInt(overlay.querySelector(id).value, 10);
      return isNaN(v) ? fallback : v;
    };
    try {
      const t = await getTeam(teamId);
      await updateTeam(teamId, {
        settings: {
          ...(t?.settings || {}),
          start7v7:        numVal("#cfg7vStart", 40),
          line1_7v7:       numVal("#cfg7vLine1", 20),
          line2_7v7:       numVal("#cfg7vLine2", 5),
          playsPerSeries7v7: numVal("#cfg7vPlays", 4),
          eff7v7Mode:      overlay.querySelector("#cfg7vEff").value,
        },
      });
      msgEl.style.color = "#15803d";
      msgEl.textContent = "Saved.";
      msgEl.style.display = "inline";
      setTimeout(() => { msgEl.style.display = "none"; }, 2000);
    } catch (err) {
      msgEl.style.color = "#DC2626";
      msgEl.textContent = "Error: " + err.message;
      msgEl.style.display = "inline";
    }
  });

  // Save scrimmage settings
  overlay.querySelector("#saveScrimBtn").addEventListener("click", async () => {
    const msgEl = overlay.querySelector("#scrimMsg");
    const effScrimPlays = parseInt(overlay.querySelector("#cfgEffScrimPlays").value, 10) || 10;
    const scrimmageMode = overlay.querySelector("#cfgScrimMode").value;
    try {
      const t = await getTeam(teamId);
      await updateTeam(teamId, {
        settings: {
          ...(t?.settings || {}),
          scrimmageMode,
          effScrimPlays,
        },
      });
      msgEl.style.color = "#15803d";
      msgEl.textContent = "Saved.";
      msgEl.style.display = "inline";
      setTimeout(() => { msgEl.style.display = "none"; }, 2000);
    } catch (err) {
      msgEl.style.color = "#DC2626";
      msgEl.textContent = "Error: " + err.message;
      msgEl.style.display = "inline";
    }
  });

  // Export Team Data (JSON)
  overlay.querySelector("#exportJsonBtn").addEventListener("click", async () => {
    const msgEl = overlay.querySelector("#exportMsg");
    const btn   = overlay.querySelector("#exportJsonBtn");
    btn.disabled = true;
    btn.textContent = "Exporting…";
    msgEl.style.display = "none";
    try {
      const [currentTeam, games] = await Promise.all([getTeam(teamId), getGames(teamId)]);
      const exportDate = new Date().toISOString().slice(0, 10);
      const payload = JSON.stringify({
        exportedAt: new Date().toISOString(),
        team: currentTeam,
        games,
      }, null, 2);
      const blob = new Blob([payload], { type: "application/json" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `snapchart-export-${exportDate}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      msgEl.style.color = "#15803d";
      msgEl.textContent = "Downloaded.";
      msgEl.style.display = "inline";
      setTimeout(() => { msgEl.style.display = "none"; }, 3000);
    } catch (err) {
      msgEl.style.color = "#DC2626";
      msgEl.textContent = "Error: " + err.message;
      msgEl.style.display = "inline";
    }
    btn.disabled = false;
    btn.textContent = "Export Team Data (JSON)";
  });

  // Save charting defaults
  overlay.querySelector("#saveChartDefaultsBtn").addEventListener("click", async () => {
    const msgEl = overlay.querySelector("#chartDefaultsMsg");
    const num = (id, fallback) => {
      const v = parseInt(overlay.querySelector(id).value, 10);
      return isNaN(v) ? fallback : v;
    };
    const settings = {
      defaultDist:  num("#cfgDist", 10),
      scrimmPlays:  num("#cfgScrimmPlays", 10),
      effScrim:     num("#cfgEffScrim", 5),
      effStd1:      num("#cfgEff1", 5),
      effStd2:      num("#cfgEff2", 50),
      effStd3:      num("#cfgEff3", 100),
      effStd4:      num("#cfgEff4", 100),
    };
    try {
      await updateTeam(teamId, { settings });
      msgEl.style.color = "#15803d";
      msgEl.textContent = "Saved.";
      msgEl.style.display = "inline";
      setTimeout(() => { msgEl.style.display = "none"; }, 2000);
    } catch (err) {
      msgEl.style.color = "#DC2626";
      msgEl.textContent = "Error: " + err.message;
      msgEl.style.display = "inline";
    }
  });

  // Invite
  overlay.querySelector("#sendInviteBtn").addEventListener("click", async () => {
    const email = (overlay.querySelector("#inviteEmail").value || "").trim().toLowerCase();
    const role  = overlay.querySelector("#inviteRole").value;
    const msgEl = overlay.querySelector("#inviteMsg");
    const btn   = overlay.querySelector("#sendInviteBtn");

    if (!email || !email.includes("@")) {
      msgEl.style.color = "#DC2626";
      msgEl.textContent = "Enter a valid email address.";
      msgEl.style.display = "block";
      return;
    }

    btn.disabled = true;
    btn.textContent = "Inviting…";
    msgEl.style.display = "none";

    try {
      const t = await getTeam(teamId);
      await inviteCoach(email, role, teamId, t?.name || "", user.email);
      overlay.querySelector("#inviteEmail").value = "";
      msgEl.style.color = "#15803d";
      msgEl.textContent =
        `✓ Invite created for ${email}. Tell them to sign in at this app with that email address.`;
      msgEl.style.display = "block";
      await refreshMembersList(overlay, teamId, user);
    } catch (err) {
      msgEl.style.color = "#DC2626";
      msgEl.textContent = "Error: " + err.message;
      msgEl.style.display = "block";
    }

    btn.disabled = false;
    btn.textContent = "Invite";
  });

  await refreshMembersList(overlay, teamId, user);

  // ---- Player tracking roster wiring ----
  let localRoster = (teamSettings.roster || []).slice();
  let localRosterSort = teamSettings.rosterSort || "number";

  function sortedLocalRoster() {
    return localRoster.slice().sort((a, b) =>
      localRosterSort === "name"
        ? a.name.toLowerCase().localeCompare(b.name.toLowerCase())
        : (Number(a.jersey) || 0) - (Number(b.jersey) || 0)
    );
  }
  function paintSortBtnsDash() {
    const numBtn  = overlay.querySelector("#rosterSortNum");
    const nameBtn = overlay.querySelector("#rosterSortName");
    if (!numBtn || !nameBtn) return;
    const byNum = localRosterSort !== "name";
    numBtn.style.background  = byNum  ? "var(--royal)" : "";
    numBtn.style.color       = byNum  ? "#fff"         : "";
    numBtn.style.borderColor = byNum  ? "var(--royal)" : "";
    nameBtn.style.background = !byNum ? "var(--royal)" : "";
    nameBtn.style.color      = !byNum ? "#fff"         : "";
    nameBtn.style.borderColor= !byNum ? "var(--royal)" : "";
  }
  let editingRosterPlayerId = null;
  function renderRosterListDash() {
    const listEl = overlay.querySelector("#rosterList");
    if (!listEl) return;
    paintSortBtnsDash();
    if (!localRoster.length) {
      listEl.innerHTML = '<div style="font-size:13px;color:var(--slate);padding:6px 0">No players yet.</div>';
      return;
    }
    listEl.innerHTML = sortedLocalRoster().map(p => {
      if (p.id === editingRosterPlayerId) {
        return `<div class="roster-player" style="flex-wrap:wrap;gap:4px">
        <input id="editRJersey" class="field" value="${esc(p.jersey)}" placeholder="#" style="width:48px;height:34px;font-size:13px;padding:0 6px">
        <input id="editRName" class="field" value="${esc(p.name)}" placeholder="Name" style="flex:1;min-width:80px;height:34px;font-size:13px;padding:0 8px">
        <input id="editRPos" class="field" value="${esc(p.pos)}" placeholder="Pos" style="width:44px;height:34px;font-size:13px;padding:0 6px">
        <button class="btn-primary" data-save-roster="${esc(p.id)}" style="height:34px;padding:0 12px;font-size:12px;flex-shrink:0">Save</button>
        <button class="modal-cancel" data-cancel-roster-edit style="margin:0;height:34px;padding:0 8px;flex-shrink:0">✕</button>
      </div>`;
      }
      return `<div class="roster-player">
      <span class="roster-jersey">#${esc(p.jersey)}</span>
      <span class="roster-name">${esc(p.name)}</span>
      <span class="roster-pos">${esc(p.pos)}</span>
      <button class="lib-edit-btn" data-edit-roster="${esc(p.id)}" title="Edit" style="flex-shrink:0">✎</button>
      <button class="modal-cancel" style="margin:0;font-size:18px;line-height:1;padding:0 6px" data-del-player="${esc(p.id)}">&times;</button>
    </div>`;
    }).join("");
  }
  renderRosterListDash();

  overlay.querySelector("#stgTrackPlayers").addEventListener("change", function() {
    overlay.querySelector("#rosterSection").style.display = this.checked ? "" : "none";
  });
  overlay.querySelector("#rosterSortNum").addEventListener("click", () => {
    localRosterSort = "number"; renderRosterListDash();
  });
  overlay.querySelector("#rosterSortName").addEventListener("click", () => {
    localRosterSort = "name"; renderRosterListDash();
  });

  overlay.querySelector("#addRosterPlayerBtn").addEventListener("click", () => {
    const name = overlay.querySelector("#rosterName").value.trim();
    const jersey = overlay.querySelector("#rosterJersey").value.trim();
    const pos = overlay.querySelector("#rosterPos").value;
    if (!name) { alert("Enter a player name."); return; }
    localRoster.push({ id: "p_" + Date.now() + "_" + Math.random().toString(36).slice(2), name, jersey, pos });
    overlay.querySelector("#rosterName").value = "";
    overlay.querySelector("#rosterJersey").value = "";
    renderRosterListDash();
  });

  overlay.querySelector("#rosterList").addEventListener("click", e => {
    // Edit player
    const editBtn = e.target.closest("[data-edit-roster]");
    if (editBtn) {
      editingRosterPlayerId = editBtn.getAttribute("data-edit-roster");
      renderRosterListDash();
      const inp = overlay.querySelector("#editRName"); if (inp) inp.focus();
      return;
    }
    // Save player edit
    const saveBtn = e.target.closest("[data-save-roster]");
    if (saveBtn) {
      const pid = saveBtn.getAttribute("data-save-roster");
      const jersey = (overlay.querySelector("#editRJersey")?.value || "").replace(/^#/, "");
      const name = (overlay.querySelector("#editRName")?.value || "").trim();
      const pos = (overlay.querySelector("#editRPos")?.value || "").trim();
      if (name) {
        const idx = localRoster.findIndex(r => r.id === pid);
        if (idx >= 0) localRoster[idx] = { id: pid, name, jersey, pos };
      }
      editingRosterPlayerId = null;
      renderRosterListDash();
      return;
    }
    // Cancel edit
    if (e.target.closest("[data-cancel-roster-edit]")) {
      editingRosterPlayerId = null;
      renderRosterListDash();
      return;
    }
    const btn = e.target.closest("[data-del-player]");
    if (!btn) return;
    const id = btn.getAttribute("data-del-player");
    localRoster = localRoster.filter(p => p.id !== id);
    renderRosterListDash();
  });

  overlay.querySelector("#importRosterBtn").addEventListener("click", () =>
    overlay.querySelector("#rosterCsvInput").click()
  );
  overlay.querySelector("#rosterCsvInput").addEventListener("change", function() {
    const file = this.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const added = importHudlRosterCSV(e.target.result, localRoster);
      renderRosterListDash();
      alert(`Imported ${added} player${added === 1 ? "" : "s"} from CSV.`);
    };
    reader.readAsText(file);
    this.value = "";
  });

  overlay.querySelector("#savePlayerTrackingBtn").addEventListener("click", async () => {
    const msgEl = overlay.querySelector("#playerTrackingMsg");
    try {
      await updateTeam(teamId, {
        trackPlayers: overlay.querySelector("#stgTrackPlayers").checked,
        roster: localRoster,
        rosterSort: localRosterSort,
      });
      msgEl.style.color = "#15803d";
      msgEl.textContent = "Saved.";
      msgEl.style.display = "inline";
      setTimeout(() => { msgEl.style.display = "none"; }, 2000);
    } catch (err) {
      msgEl.style.color = "#DC2626";
      msgEl.textContent = "Error: " + err.message;
      msgEl.style.display = "inline";
    }
  });

  // ---- Autocomplete Library ----
  function renderProLib() {
    const el = overlay.querySelector("#proLibAll"); if (!el) return;
    el.innerHTML = LIB_CATS_PRO.map(cat => {
      const arr = localLib[cat.key] || [];
      const rows = arr.length ? arr.map((entry, i) => {
        if (libEditingCatPro === cat.key && libEditingIdxPro === i) {
          return `<div class="st-tag-row" style="display:flex;align-items:center;gap:6px">
            <input class="pro-lib-inp field" data-cat="${esc(cat.key)}" data-idx="${i}" value="${esc(entry)}"
                   style="flex:1;min-width:0;height:36px;font-size:14px;padding:0 8px;border:1.5px solid var(--chalk);border-radius:8px">
            <button class="btn-primary pro-lib-save" data-cat="${esc(cat.key)}" data-idx="${i}" style="height:36px;padding:0 12px;font-size:13px">Save</button>
            <button class="modal-cancel pro-lib-cancel" style="margin:0;height:36px;padding:0 10px;font-size:13px">✕</button>
          </div>`;
        }
        return `<div class="st-tag-row" style="display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:14px">${esc(entry)}</span>
          <div style="display:flex;gap:2px;flex-shrink:0">
            <button class="lib-edit-btn pro-lib-edit" data-cat="${esc(cat.key)}" data-edit="${i}" title="Edit">✎</button>
            <button class="st-tag-del pro-lib-del" data-cat="${esc(cat.key)}" data-del="${i}" title="Delete">&times;</button>
          </div>
        </div>`;
      }).join("") : `<div class="lib-empty" style="padding:8px 0;color:var(--slate);font-size:13px;font-style:italic">No entries yet.</div>`;
      return `<div class="lib-section">
        <div class="lib-section-head">${esc(cat.label)}</div>
        <div>${rows}</div>
        <div style="display:flex;gap:8px;margin-top:6px">
          <input id="proLibNew_${cat.key}" class="field" type="text" placeholder="Add ${esc(cat.label.toLowerCase())}…"
                 style="flex:1;min-width:0;height:38px;padding:0 10px;border:1.5px solid var(--chalk);border-radius:8px;font-size:14px;font-family:var(--body)" autocapitalize="words">
          <button class="btn-secondary pro-lib-add" data-cat="${esc(cat.key)}" style="flex:0 0 auto;height:38px;padding:0 14px;font-size:13px">+ Add</button>
        </div>
      </div>`;
    }).join("");
  }
  renderProLib();

  overlay.querySelector("#proLibAll").addEventListener("click", e => {
    const del = e.target.closest(".pro-lib-del");
    if (del) {
      const cat = del.getAttribute("data-cat"), i = Number(del.getAttribute("data-del"));
      if (!confirm(`Delete "${localLib[cat][i]}"?`)) return;
      localLib[cat].splice(i, 1);
      libEditingCatPro = null; libEditingIdxPro = -1; renderProLib(); return;
    }
    const edit = e.target.closest(".pro-lib-edit");
    if (edit) {
      libEditingCatPro = edit.getAttribute("data-cat");
      libEditingIdxPro = Number(edit.getAttribute("data-edit"));
      renderProLib();
      const inp = overlay.querySelector(".pro-lib-inp"); if (inp) inp.focus();
      return;
    }
    const save = e.target.closest(".pro-lib-save");
    if (save) {
      const cat = save.getAttribute("data-cat"), idx = Number(save.getAttribute("data-idx"));
      const inp = overlay.querySelector(".pro-lib-inp");
      const val = (inp ? inp.value : "").trim().replace(/\b\w/g, c => c.toUpperCase());
      if (val) { localLib[cat][idx] = val; localLib[cat] = libAlphaSortPro(localLib[cat]); }
      libEditingCatPro = null; libEditingIdxPro = -1; renderProLib(); return;
    }
    if (e.target.closest(".pro-lib-cancel")) { libEditingCatPro = null; libEditingIdxPro = -1; renderProLib(); return; }
    const addBtn = e.target.closest(".pro-lib-add");
    if (addBtn) {
      const cat = addBtn.getAttribute("data-cat");
      const inp = overlay.querySelector(`#proLibNew_${cat}`);
      const val = (inp ? inp.value : "").trim().replace(/\b\w/g, c => c.toUpperCase());
      if (!val) return;
      if (!localLib[cat].map(s => s.toLowerCase()).includes(val.toLowerCase())) {
        localLib[cat].push(val);
        localLib[cat] = libAlphaSortPro(localLib[cat]);
      }
      if (inp) inp.value = "";
      renderProLib();
      const newInp = overlay.querySelector(`#proLibNew_${cat}`); if (newInp) newInp.focus();
    }
  });
  overlay.querySelector("#proLibAll").addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    const saveBtn = overlay.querySelector(".pro-lib-save"); if (saveBtn) { saveBtn.click(); return; }
    const addInp = e.target.closest('[id^="proLibNew_"]');
    if (addInp) { const cat = addInp.id.replace("proLibNew_",""); overlay.querySelector(`.pro-lib-add[data-cat="${cat}"]`)?.click(); }
  });

  overlay.querySelector("#saveLibraryBtn").addEventListener("click", async () => {
    const msgEl = overlay.querySelector("#libraryMsg");
    try {
      await updateTeam(teamId, { library: localLib });
      msgEl.style.color = "#15803d"; msgEl.textContent = "Saved.";
      msgEl.style.display = "inline";
      setTimeout(() => { msgEl.style.display = "none"; }, 2000);
    } catch (err) {
      msgEl.style.color = "#DC2626"; msgEl.textContent = "Error: " + err.message;
      msgEl.style.display = "inline";
    }
  });
}

async function refreshMembersList(overlay, teamId, user) {
  const [members, invites] = await Promise.all([
    getMembers(teamId),
    getTeamInvites(teamId),
  ]);

  // Current members
  const membersList = overlay.querySelector("#membersList");
  membersList.innerHTML = members.map((m) => {
    const isMe = m.uid === user.uid;
    return `
      <div class="member-row" data-uid="${esc(m.uid)}">
        <div class="member-email">
          ${esc(m.email)}
          ${isMe ? '<span class="you-tag">You</span>' : ""}
        </div>
        <select class="role-sel member-role-sel" data-uid="${esc(m.uid)}"
                ${isMe ? "disabled" : ""}>
          <option value="admin"    ${m.role === "admin"    ? "selected" : ""}>Admin</option>
          <option value="editor"   ${m.role === "editor"   ? "selected" : ""}>Editor</option>
          <option value="readonly" ${m.role === "readonly" ? "selected" : ""}>Read-Only</option>
        </select>
        ${!isMe
          ? `<button class="remove-member icon-btn" data-uid="${esc(m.uid)}"
                     title="Remove from team">&times;</button>`
          : ""}
      </div>
    `;
  }).join("");

  overlay.querySelectorAll(".member-role-sel").forEach((sel) => {
    sel.addEventListener("change", async () => {
      try {
        await updateMemberRole(teamId, sel.dataset.uid, sel.value);
      } catch (err) {
        alert("Could not update role: " + err.message);
        await refreshMembersList(overlay, teamId, user);
      }
    });
  });

  overlay.querySelectorAll(".remove-member").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const row   = btn.closest(".member-row");
      const email = row.querySelector(".member-email").firstChild.textContent.trim();
      if (!confirm(`Remove ${email} from the team?`)) return;
      try {
        await removeMember(teamId, btn.dataset.uid);
        await refreshMembersList(overlay, teamId, user);
      } catch (err) {
        alert("Could not remove: " + err.message);
      }
    });
  });

  // Pending invites
  const invitesList = overlay.querySelector("#invitesList");
  if (invites.length) {
    invitesList.innerHTML = `
      <div class="settings-label" style="margin-bottom:6px">Pending Invites</div>
      ${invites.map((inv) => `
        <div class="member-row" style="opacity:.85">
          <div class="member-email">${esc(inv.email)}</div>
          <span class="role-badge role-${inv.role}">${roleName(inv.role)}</span>
          <span style="font-size:12px;color:#6B7280;flex:1">Pending</span>
          <button class="cancel-invite icon-btn" data-email="${esc(inv.email)}"
                  title="Cancel invite">&times;</button>
        </div>
      `).join("")}
    `;
    overlay.querySelectorAll(".cancel-invite").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await cancelInvite(btn.dataset.email);
          await refreshMembersList(overlay, teamId, user);
        } catch (err) {
          alert("Could not cancel invite: " + err.message);
        }
      });
    });
  } else {
    invitesList.innerHTML = "";
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function roleName(role) {
  return role === "admin" ? "Admin" : role === "editor" ? "Editor" : "Read-Only";
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]
  );
}

// ── Season Review ─────────────────────────────────────────────────────────────

async function renderSeasonReview(container, user, teamId, userRole, onBack) {
  const isAdmin = userRole === "admin";

  container.innerHTML = `
    <div class="sr-wrap">
      <header class="board">
        <div class="board-top">
          <div style="display:flex;align-items:center;gap:12px">
            <button id="srBack" class="back" aria-label="Back">&larr;</button>
            <div>
              <h1>Season Review</h1>
              <div class="sub">All saved games &middot; aggregated statistics</div>
            </div>
          </div>
          ${isAdmin
            ? `<button id="srArchiveBtn" class="btn-ghost">Archive Season</button>`
            : ""}
        </div>
      </header>

      <div class="sr-body" id="srBody">
        <div class="loading">Loading season data&hellip;</div>
      </div>

      <div class="modal-back" id="srArchiveModal" hidden>
        <div class="modal">
          <h2>Archive Season</h2>
          <p>Name this season. All current games will be tagged with it and you can view them from the season selector.</p>
          <div class="form-field">
            <label>Season name</label>
            <input id="srArchiveName" type="text" placeholder="e.g. 2025 Fall Season" maxlength="60">
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn-primary" id="srArchiveConfirm" style="flex:1">Archive &amp; Start New Season</button>
            <button class="modal-cancel" id="srArchiveCancel" style="margin:0;flex:0 0 auto">Cancel</button>
          </div>
        </div>
      </div>

      <div class="modal-back" id="srDrillModal" hidden>
        <div class="modal modal-wide">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px">
            <h2 id="srDrillTitle" style="margin:0;font-size:18px"></h2>
            <button id="srDrillClose" class="modal-cancel" style="margin:0;flex:none;font-size:22px;line-height:1;padding:0 6px">&times;</button>
          </div>
          <div id="srDrillBody" class="drill-scroll"></div>
        </div>
      </div>
    </div>
  `;

  document.getElementById("srBack").addEventListener("click", onBack);

  if (isAdmin) {
    document.getElementById("srArchiveBtn").addEventListener("click", () => {
      const yr = new Date().getFullYear();
      document.getElementById("srArchiveName").value = yr + " Season";
      document.getElementById("srArchiveModal").hidden = false;
    });
    document.getElementById("srArchiveConfirm").addEventListener("click", async () => {
      const name = (document.getElementById("srArchiveName").value || "").trim();
      if (!name) { alert("Please enter a season name."); return; }
      const btn = document.getElementById("srArchiveConfirm");
      btn.disabled = true; btn.textContent = "Archiving…";
      try {
        await archiveSeason(teamId, name);
        document.getElementById("srArchiveModal").hidden = true;
        renderSeasonReview(container, user, teamId, userRole, onBack);
      } catch (err) {
        alert("Could not archive: " + err.message);
        btn.disabled = false; btn.textContent = "Archive & Start New Season";
      }
    });
    document.getElementById("srArchiveCancel").addEventListener("click", () => {
      document.getElementById("srArchiveModal").hidden = true;
    });
    document.getElementById("srArchiveModal").addEventListener("click", (e) => {
      if (e.target === document.getElementById("srArchiveModal"))
        document.getElementById("srArchiveModal").hidden = true;
    });
  }

  document.getElementById("srDrillClose").addEventListener("click", () => {
    document.getElementById("srDrillModal").hidden = true;
  });
  document.getElementById("srDrillModal").addEventListener("click", (e) => {
    if (e.target === document.getElementById("srDrillModal"))
      document.getElementById("srDrillModal").hidden = true;
  });

  // Load all games + their plays
  let allGames, seasons;
  try {
    [allGames, seasons] = await Promise.all([getGames(teamId), getSeasons(teamId)]);
    allGames = await Promise.all(allGames.map(async (g) => ({
      ...g, plays: await getPlays(teamId, g.id),
    })));
  } catch (err) {
    document.getElementById("srBody").innerHTML =
      `<div class="loading" style="color:#DC2626">Error loading data: ${esc(err.message)}</div>`;
    return;
  }

  // Season selector state
  let viewingSeasonId = null; // null = current season

  function getActiveGames() {
    if (viewingSeasonId) return allGames.filter((g) => g.seasonId === viewingSeasonId);
    return allGames.filter((g) => !g.seasonId);
  }

  function renderBody() {
    const body = document.getElementById("srBody");
    const activeGames = getActiveGames();
    const all = activeGames.flatMap((g) => g.plays);

    // Season tabs
    let tabsHtml = "";
    if (seasons.length) {
      const currentActive = !viewingSeasonId;
      tabsHtml = `<div class="sr-tabs">` +
        `<button class="srtab${currentActive ? " srtab-active" : ""}" data-stab="current">Current Season</button>` +
        seasons.map((s) => {
          const active = viewingSeasonId === s.id;
          return `<button class="srtab${active ? " srtab-active" : ""}" data-stab="${esc(s.id)}">${esc(s.name)}</button>`;
        }).join("") +
        `</div>`;
    }

    if (!activeGames.length) {
      body.innerHTML = tabsHtml + `<div class="loading">No games in this season yet.</div>`;
      rewireTabs();
      return;
    }

    const n = all.length;
    const eff = all.filter((p) => p.success).length;
    const rate = n ? Math.round(100 * eff / n) : 0;
    const runs = all.filter((p) => p.type === "run").length;
    const passes = n - runs;

    const statsHtml = `<div class="sr-cards">
      <div class="stat"><div class="v">${activeGames.length}</div><div class="k">Games</div></div>
      <div class="stat"><div class="v">${n}</div><div class="k">Plays</div></div>
      <div class="stat good"><div class="v">${rate}%</div><div class="k">Effective</div></div>
      <div class="stat"><div class="v">${n ? Math.round(100*runs/n) + "/" + Math.round(100*passes/n) : "—"}</div><div class="k">Run / Pass</div></div>
    </div>`;

    const topHtml = `<h3 class="sr-section-head">Top plays this season <span class="sr-section-sub">run 2+ times · ranked by success rate · tap a row to see every instance</span></h3>` +
      srCallsTable(all, false);
    const leastHtml = `<h3 class="sr-section-head">Least effective plays this season <span class="sr-section-sub">run 2+ times · lowest success rate first</span></h3>` +
      srCallsTable(all, true);

    const gamesHtml = `<h3 class="sr-section-head">Games</h3>` +
      activeGames.map((g) => {
        const np = g.plays.length;
        const ep = g.plays.filter((p) => p.success).length;
        const rp = np ? Math.round(100 * ep / np) : 0;
        const avgp = np ? (g.plays.reduce((a, p) => a + (Number(p.yards) || 0), 0) / np).toFixed(1) : "0.0";
        const gameName = g.opponent ? "vs " + esc(g.opponent) : "Untitled game";
        return `<div class="sr-game-card">
          <div class="sr-game-top">
            <div>
              <div class="sr-game-name">${gameName}</div>
              <div class="sr-game-meta">${esc(g.date || "")}${g.date && g.mode ? " · " : ""}${esc(g.mode || "")}</div>
            </div>
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              <span style="font-family:var(--num);font-size:14px">${np} plays · <span style="color:#15803d">${rp}%</span> eff · ${avgp >= 0 ? "+" : ""}${avgp} yds/play</span>
              <button class="btn-secondary sr-view-btn" data-view-game="${esc(g.id)}">View</button>
            </div>
          </div>
          <div id="sr-gd-${esc(g.id)}" style="display:none;margin-top:12px">
            ${srPlayTable(g.plays)}
          </div>
        </div>`;
      }).join("");

    body.innerHTML = tabsHtml + `<div class="sr-content">` + statsHtml + topHtml + leastHtml + gamesHtml + `</div>`;
    rewireTabs();

    // Wire game expand buttons
    body.querySelectorAll(".sr-view-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-view-game");
        const detail = document.getElementById("sr-gd-" + id);
        if (!detail) return;
        const isOpen = detail.style.display !== "none";
        detail.style.display = isOpen ? "none" : "";
        btn.textContent = isOpen ? "View" : "Hide";
      });
    });

    // Wire drill-down
    body.addEventListener("click", (e) => {
      const row = e.target.closest("[data-drill]");
      if (!row) return;
      const callName = row.getAttribute("data-drill");
      document.getElementById("srDrillTitle").textContent = callName;
      document.getElementById("srDrillBody").innerHTML = srBuildDrillDown(callName, activeGames);
      document.getElementById("srDrillModal").hidden = false;
    });
  }

  function rewireTabs() {
    document.querySelectorAll(".srtab").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tid = btn.getAttribute("data-stab");
        viewingSeasonId = tid === "current" ? null : tid;
        renderBody();
      });
    });
  }

  renderBody();
}

// ── Season Review helpers ─────────────────────────────────────────────────────

function srGroupCalls(list) {
  const map = {};
  list.forEach((p) => {
    const name = (p.call || "").trim() || "(unnamed)";
    const key = name.toLowerCase();
    if (!map[key]) map[key] = { name, count: 0, eff: 0, yds: 0 };
    map[key].count++; map[key].yds += Number(p.yards) || 0;
    if (p.success) map[key].eff++;
  });
  const arr = Object.values(map).map((g) => {
    g.rate = g.count ? g.eff / g.count : 0;
    g.avg  = g.count ? g.yds / g.count  : 0;
    return g;
  });
  arr.sort((a, b) => b.rate !== a.rate ? b.rate - a.rate : b.avg - a.avg);
  return arr;
}

function srCallsTable(list, least) {
  const all = srGroupCalls(list).filter((g) => g.count >= 2);
  const calls = least ? all.slice(-10).reverse() : all.slice(0, 10);
  if (!calls.length) return `<div class="loading" style="padding:16px 0">Not enough data yet (need plays run 2+ times).</div>`;
  const rows = calls.map((g, i) => {
    const rate = Math.round(100 * g.rate);
    const sign = g.avg > 0 ? "+" : "";
    const badClass = least ? " rank-bad" : "";
    const barClass = least ? " bad" : "";
    return `<tr data-drill="${esc(g.name)}">
      <td><span class="sr-rank${badClass}">${i + 1}</span></td>
      <td><b>${esc(g.name)}</b></td>
      <td><b style="font-family:var(--num)">${g.count}</b></td>
      <td><b style="font-family:var(--num)">${g.eff}/${g.count}</b></td>
      <td>
        <div class="sr-ratecell">
          <div class="sr-bar${barClass}"><i style="width:${rate}%"></i></div>
          <b>${rate}%</b>
        </div>
      </td>
      <td><span class="res ${g.avg > 0 ? "up" : g.avg < 0 ? "down" : "flat"}">${sign}${g.avg.toFixed(1)}</span></td>
    </tr>`;
  }).join("");
  return `<div class="table-scroll" style="margin-bottom:20px"><table><thead><tr>
    <th>Rank</th><th>Play call</th><th>Times</th><th>Effective</th><th>Success rate</th><th>Avg yds</th>
  </tr></thead><tbody>${rows}</tbody></table></div>`;
}

function srPlayTable(plays) {
  if (!plays.length) return `<div class="loading" style="padding:8px 0">No plays.</div>`;
  const rows = plays.map((p, i) => {
    const dir = p.yards > 0 ? "up" : p.yards < 0 ? "down" : "flat";
    const sign = p.yards > 0 ? "+" : "";
    const qtr = p.mode === "scrimmage" ? esc(p.series || "") : esc(p.qtr || "");
    return `<tr>
      <td><b style="font-family:var(--num)">${i + 1}</b></td>
      <td>${qtr}</td>
      <td><b style="font-family:var(--num)">${srDnDist(p)}</b></td>
      <td>${p.yl != null && p.yl !== "" ? esc(String(p.yl)) : "&ndash;"}<span style="color:var(--slate);font-size:11px"> ${esc(p.hash || "")}</span></td>
      <td><span class="pill ${esc(p.type || "run")}">${p.type === "run" ? "RUN" : p.type === "punt" ? "PUNT" : "PASS"}</span></td>
      <td>${esc(p.form || "—")}</td>
      <td>${esc(p.call || "—")}</td>
      <td><span class="res ${dir}">${sign}${p.yards}</span></td>
      <td><span class="succ ${p.success ? "y" : "n"} static">${p.success ? "✓" : "✗"}</span></td>
    </tr>`;
  }).join("");
  return `<div class="table-scroll"><table><thead><tr>
    <th>#</th><th>Qtr/Ser</th><th>Dn &amp; Dist</th><th>Ball</th><th>Type</th><th>Formation</th><th>Play call</th><th>Yds</th><th>Eff</th>
  </tr></thead><tbody>${rows}</tbody></table></div>`;
}

function srDnDist(p) {
  if (p.mode === "scrimmage") return p.playNum ? "Play " + String(p.playNum) : "—";
  const ds = (p.dist === "" || p.dist == null) ? "" : String(p.dist);
  return ds ? String(p.down) + " & " + ds : String(p.down || "");
}

function srBuildDrillDown(callName, gamesData) {
  const nameKey = callName.toLowerCase();
  const groups = [];
  gamesData.forEach((g) => {
    const matching = (g.plays || []).filter((p) => (p.call || "").trim().toLowerCase() === nameKey);
    if (matching.length) {
      const gname = g.opponent ? "vs " + g.opponent : "Untitled game";
      groups.push({ name: gname, date: g.date || "", plays: matching });
    }
  });
  if (!groups.length) return `<div class="report-empty">No matching plays found.</div>`;
  const total = groups.reduce((a, g) => a + g.plays.length, 0);
  const effCount = groups.reduce((a, g) => a + g.plays.filter((p) => p.success).length, 0);
  const totalYds = groups.reduce((a, g) => a + g.plays.reduce((b, p) => b + (Number(p.yards) || 0), 0), 0);
  const rate = Math.round(100 * effCount / total);
  const avgYds = (totalYds / total).toFixed(1);
  const statsHtml = `<div class="drill-stats">
    <span><b>${total}</b>times run</span>
    <span><b>${effCount}/${total}</b>effective</span>
    <span><b>${rate}%</b>success rate</span>
    <span><b>${totalYds >= 0 ? "+" : ""}${avgYds}</b>avg yards</span>
  </div>`;
  const groupsHtml = groups.map((g) => {
    const rows = g.plays.map((p, i) => {
      const dir = p.yards > 0 ? "up" : p.yards < 0 ? "down" : "flat";
      const sign = p.yards > 0 ? "+" : "";
      const ctx = p.mode === "scrimmage" ? `Ser ${esc(p.series || "")}` : `Q${esc(p.qtr || "")}`;
      const tags = (p.tags || []).length
        ? `<span style="font-size:11px;color:var(--slate)">${p.tags.map(esc).join(", ")}</span>`
        : "";
      return `<tr>
        <td><b style="font-family:var(--num)">${i + 1}</b></td>
        <td>${ctx}</td>
        <td><b style="font-family:var(--num)">${srDnDist(p)}</b></td>
        <td>${p.yl != null && p.yl !== "" ? esc(String(p.yl)) : "&ndash;"}<span style="color:var(--slate);font-size:11px"> ${esc(p.hash || "")}</span></td>
        <td>${esc(p.form || "—")}</td>
        <td>${tags}</td>
        <td><span class="res ${dir}">${sign}${p.yards}</span></td>
        <td><span class="succ ${p.success ? "y" : "n"} static">${p.success ? "✓" : "✗"}</span></td>
      </tr>`;
    }).join("");
    return `<div class="drill-game-group">
      <div class="drill-game-head">${esc(g.name)}${g.date ? ` <span style="font-weight:400;color:var(--slate)">· ${esc(g.date)}</span>` : ""}</div>
      <div class="table-scroll"><table><thead><tr>
        <th>#</th><th>Qtr/Ser</th><th>Dn &amp; Dist</th><th>Ball On</th><th>Formation</th><th>Tags</th><th>Yds</th><th>Eff</th>
      </tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
  }).join("");
  return statsHtml + groupsHtml;
}
