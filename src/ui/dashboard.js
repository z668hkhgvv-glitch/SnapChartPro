import { logoutCoach } from "../auth.js";
import {
  getGames, createGame, deleteGame,
  getTeam, updateTeam,
  getMembers, getTeamInvites,
  inviteCoach, cancelInvite,
  updateMemberRole, removeMember,
} from "../db.js";
import { renderGame } from "./game.js";

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
    teamSettings = t?.settings || {};
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

  const overlay = document.createElement("div");
  overlay.className = "modal-back";
  overlay.innerHTML = `
    <div class="modal settings-modal">
      <h2>Settings</h2>

      <div class="settings-section">
        <div class="settings-label">Team Name</div>
        <div style="display:flex;gap:8px">
          <input id="teamNameField" type="text" value="${esc(team?.name || "")}"
                 style="flex:1;padding:9px 12px;border:2px solid #E5E7EB;
                        border-radius:8px;font-size:15px;font-family:var(--body)">
          <button class="btn-secondary" id="saveTeamNameBtn">Save</button>
        </div>
        <div id="teamNameMsg" style="font-size:12px;margin-top:4px;display:none"></div>
      </div>

      <div class="settings-section">
        <div class="settings-label">Coaches</div>
        <div id="membersList"><div class="loading">Loading&hellip;</div></div>
      </div>

      <div class="settings-section">
        <div class="settings-label">Charting Defaults</div>
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

      <div class="settings-section" style="border-bottom:none;padding-bottom:0">
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

      <button class="modal-cancel" id="settingsClose" style="margin-top:16px">Close</button>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector("#settingsClose").addEventListener("click", () =>
    document.body.removeChild(overlay)
  );
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) document.body.removeChild(overlay);
  });

  // Save team name
  overlay.querySelector("#saveTeamNameBtn").addEventListener("click", async () => {
    const name  = overlay.querySelector("#teamNameField").value.trim();
    const msgEl = overlay.querySelector("#teamNameMsg");
    if (!name) return;
    try {
      await updateTeam(teamId, { name });
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
