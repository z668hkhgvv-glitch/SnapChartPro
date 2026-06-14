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

export async function renderDashboard(container, user, teamId) {
  container.innerHTML = `
    <div class="dash-wrap">
      <header class="dash-header">
        <div>
          <span class="logo-snap">Snap</span><span class="logo-chart">Chart</span>
          <span class="logo-pro">PRO</span>
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
    const opponent = prompt("Opponent name (optional):");
    if (opponent === null) return; // cancelled
    const date = new Date().toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    });
    const gameId = await createGame(teamId, {
      opponent: opponent.trim(),
      date,
      mode: "standard",
    });
    loadGame(gameId);
  });

  await refreshGameList(teamId);
}

async function refreshGameList(teamId) {
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
    btn.addEventListener("click", () => loadGame(btn.dataset.id));
  });
}

function loadGame(gameId) {
  // TODO: route to the game charting screen (ported from SnapChart)
  alert(`Game ${gameId} — charting screen coming in the next sprint.`);
}
