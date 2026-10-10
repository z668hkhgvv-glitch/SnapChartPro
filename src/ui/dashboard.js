/**
 * Dashboard — shown after login.
 * Lists the team's games and lets the coach start a new one
 * or join a live game in progress.
 *
 * This is a placeholder shell; full game logic will be ported
 * from SnapChart (index.html) in subsequent sprints.
 */

import { logoutCoach } from "../auth.js";
import { getGames, createGame, deleteGame } from "../db.js";
import { renderGame } from "./game.js";
import { renderSettings } from "./settings.js";

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

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
          <span class="coach-email">${esc(user.email)}</span>
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
    <div class="game-card" data-id="${esc(g.id)}">
      <div class="game-card-name">${g.opponent ? "vs " + esc(g.opponent) : "Untitled game"}</div>
      <div class="game-card-meta">${esc(g.date || "")} &middot; ${esc(g.mode || "standard")}</div>
      <div style="display:flex;gap:8px;align-items:center;flex-shrink:0">
        <button class="btn-secondary open-game" data-id="${esc(g.id)}">Open</button>
        <button class="del-game icon-btn" data-id="${esc(g.id)}" title="Delete game" style="color:#DC2626;font-size:18px;border:none;background:none;cursor:pointer;padding:4px 8px;line-height:1">&times;</button>
      </div>
    </div>
  `).join("");

  list.querySelectorAll(".open-game").forEach((btn) => {
    const game = games.find((g) => g.id === btn.dataset.id);
    btn.addEventListener("click", () => loadGame(container, user, teamId, game));
  });

  list.querySelectorAll(".del-game").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const game = games.find((g) => g.id === btn.dataset.id);
      const confirmed = await confirmDeleteGame(game);
      if (!confirmed) return;
      try {
        await deleteGame(teamId, btn.dataset.id);
        await refreshGameList(container, user, teamId);
      } catch {
        alert("Could not delete. Please try again.");
      }
    });
  });
}

function loadGame(container, user, teamId, game) {
  renderGame(container, user, teamId, game, () => {
    renderDashboard(container, user, teamId);
  });
}

// Two-step delete confirmation — returns Promise<boolean>
function confirmDeleteGame(game) {
  return new Promise((resolve) => {
    const name = game?.opponent ? `vs ${game.opponent}` : "Untitled game";
    const date = game?.date ? ` — ${game.date}` : "";

    const overlay = document.createElement("div");
    overlay.className = "modal-back";
    overlay.innerHTML = `
      <div class="modal" style="max-width:400px">
        <h2 style="color:#DC2626">Delete Game?</h2>
        <p style="font-weight:600;font-size:15px;margin:8px 0 4px">${esc(name)}${esc(date)}</p>
        <p style="color:#6b7280;font-size:13px;margin:0 0 20px">
          All plays in this game will be permanently deleted.
          This action <strong>cannot be undone</strong>.
        </p>
        <div id="delStep1" style="display:flex;gap:10px;justify-content:flex-end">
          <button id="delCancel1" class="modal-cancel" style="margin:0">Cancel</button>
          <button id="delNext" style="background:#DC2626;color:#fff;border:none;padding:8px 18px;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer">Delete Game →</button>
        </div>
        <div id="delStep2" style="display:none">
          <p style="background:#FEF2F2;border:1px solid #FECACA;border-radius:6px;padding:10px 14px;font-size:13px;color:#991B1B;margin:0 0 16px">
            ⚠️ Second confirmation required. Are you absolutely sure?
          </p>
          <div style="display:flex;gap:10px;justify-content:flex-end">
            <button id="delCancel2" class="modal-cancel" style="margin:0">Cancel</button>
            <button id="delConfirm" style="background:#991B1B;color:#fff;border:none;padding:8px 18px;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer">Yes, Permanently Delete</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = (result) => { document.body.removeChild(overlay); resolve(result); };

    overlay.querySelector("#delCancel1").addEventListener("click", () => close(false));
    overlay.querySelector("#delCancel2").addEventListener("click", () => close(false));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(false); });

    overlay.querySelector("#delNext").addEventListener("click", () => {
      overlay.querySelector("#delStep1").style.display = "none";
      overlay.querySelector("#delStep2").style.display = "block";
    });

    overlay.querySelector("#delConfirm").addEventListener("click", () => close(true));
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
