/**
 * Dashboard — shown after login.
 * Lists the team's games and lets the coach start a new one
 * or join a live game in progress.
 *
 * This is a placeholder shell; full game logic will be ported
 * from SnapChart (index.html) in subsequent sprints.
 */

import { logoutCoach } from "../auth.js";
import { getGames, createGame } from "../db.js";
import { renderGame } from "./game.js";

export async function renderDashboard(container, user, teamId, gameToOpen) {
  container.innerHTML = `
    <div class="dash-wrap">
      <header class="dash-header">
        <div>
          <svg width="480" height="80" viewBox="0 28 480 80" xmlns="http://www.w3.org/2000/svg" aria-label="SnapChart Pro" role="img" style="height:42px;width:auto;display:block">
            <rect x="20" y="34" width="92" height="92" rx="20" fill="#ffffff" fill-opacity="0.15"/>
            <rect x="38" y="80" width="15" height="28" rx="3" fill="#ffffff"/>
            <rect x="59" y="66" width="15" height="42" rx="3" fill="#ffffff"/>
            <rect x="80" y="50" width="15" height="58" rx="3" fill="#ffffff"/>
            <path d="M79 44 l5 6 l12 -15" fill="none" stroke="#F59E0B" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
            <text x="132" y="92" font-size="46" font-family="Oswald,'Arial Narrow',sans-serif" font-weight="700"><tspan fill="#ffffff">Snap</tspan><tspan fill="rgba(255,255,255,0.75)">Chart</tspan><tspan fill="#F59E0B" font-size="36"> Pro</tspan></text>
          </svg>
        </div>
        <div class="dash-header-right">
          <span class="coach-email">${user.email}</span>
          <button id="logoutBtn" class="btn-ghost">Sign out</button>
        </div>
      </header>

      <main class="dash-main">
        <div class="dash-top">
          <h2>Games</h2>
          <button id="newGameBtn" class="btn-primary">+ New Game</button>
        </div>
        <div id="gameList" class="game-list">
          <div class="loading">Loading games…</div>
        </div>
      </main>
    </div>
  `;

  document.getElementById("logoutBtn").addEventListener("click", () => logoutCoach());

  document.getElementById("newGameBtn").addEventListener("click", async () => {
    showNewGameModal(container, user, teamId);
  });

  await refreshGameList(container, user, teamId);

  if (gameToOpen) {
    loadGame(container, user, teamId, gameToOpen);
  }
}

async function refreshGameList(container, user, teamId) {
  const list = document.getElementById("gameList");
  if (!list) return;

  const games = await getGames(teamId);
  if (!games.length) {
    list.innerHTML = `<div class="empty-state">No games yet. Tap <b>+ New Game</b> to start.</div>`;
    return;
  }

  list.innerHTML = games.map((g) => `
    <div class="game-card" data-id="${g.id}">
      <div class="game-card-name">${g.opponent ? "vs " + g.opponent : "Untitled game"}</div>
      <div class="game-card-meta">${g.date || ""} &middot; ${g.mode || "standard"}</div>
      <button class="btn-secondary open-game" data-id="${g.id}">Open</button>
    </div>
  `).join("");

  list.querySelectorAll(".open-game").forEach((btn) => {
    const game = games.find((g) => g.id === btn.dataset.id);
    btn.addEventListener("click", () => loadGame(container, user, teamId, game));
  });
}

function loadGame(container, user, teamId, game) {
  renderGame(container, user, teamId, game, () => {
    renderDashboard(container, user, teamId);
  });
}

function showNewGameModal(container, user, teamId) {
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
          <b>Standard</b>
          <span>Full down/distance, all fields</span>
        </button>
        <button class="mode-pick" data-mode="7v7">
          <b>7v7</b>
          <span>Pass-only, ball-driven series</span>
        </button>
        <button class="mode-pick" data-mode="scrimmage">
          <b>Scrimmage</b>
          <span>10 plays per series, no downs</span>
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
      const date     = new Date().toLocaleDateString("en-US", {
        month: "short", day: "numeric", year: "numeric",
      });
      document.body.removeChild(overlay);
      const gameId = await createGame(teamId, { opponent, date, mode });
      loadGame(container, user, teamId, { id: gameId, opponent, date, mode });
    });
  });

  overlay.querySelector("#ngCancel").addEventListener("click", () => {
    document.body.removeChild(overlay);
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) document.body.removeChild(overlay);
  });
}
