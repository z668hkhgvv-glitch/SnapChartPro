import { logoutCoach } from "../auth.js";
import { createTeamWithAdmin } from "../db.js";

export function renderOnboarding(container, user, onDone) {
  container.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card" style="max-width:460px">
        <div class="auth-logo">
          <svg width="560" height="160" viewBox="0 0 560 160" xmlns="http://www.w3.org/2000/svg"
               aria-label="SnapChart Pro" role="img"
               style="width:100%;max-width:320px;height:auto;display:block;margin:0 auto 4px">
            <rect x="20" y="34" width="92" height="92" rx="20" fill="#16317f"/>
            <rect x="38" y="80" width="15" height="28" rx="3" fill="#ffffff"/>
            <rect x="59" y="66" width="15" height="42" rx="3" fill="#ffffff"/>
            <rect x="80" y="50" width="15" height="58" rx="3" fill="#ffffff"/>
            <path d="M79 44 l5 6 l12 -15" fill="none" stroke="#F59E0B" stroke-width="6"
                  stroke-linecap="round" stroke-linejoin="round"/>
            <text x="132" y="92" font-size="46"
                  font-family="Oswald,'Arial Narrow',sans-serif" font-weight="700">
              <tspan fill="#16317f">Snap</tspan><tspan fill="#1e44c4">Chart</tspan>
              <tspan fill="#F59E0B" font-size="36"> Pro</tspan>
            </text>
          </svg>
        </div>
        <p class="auth-sub" style="margin-bottom:24px">
          Signed in as <b>${esc(user.email)}</b>
        </p>

        <div class="onboard-options">
          <button class="mode-pick" id="createTeamBtn">
            <b>Create a new team</b>
            <span>You&rsquo;ll be the team administrator</span>
          </button>
          <div class="onboard-or">or</div>
          <div class="onboard-wait">
            <div style="font-weight:600;font-size:14px;color:#0F1830;margin-bottom:4px">
              Waiting to be added?
            </div>
            <div style="font-size:13px;color:#6B7280;line-height:1.5">
              Ask your team admin to invite <b>${esc(user.email)}</b>.
              Once they do, tap Refresh and you&rsquo;ll be joined automatically.
            </div>
            <button class="btn-secondary" id="refreshBtn"
                    style="margin-top:10px;width:100%">Refresh</button>
          </div>
        </div>

        <button class="modal-cancel" id="signOutBtn"
                style="margin-top:20px;width:100%">Sign out</button>
      </div>
    </div>

    <div class="modal-back" id="createTeamModal" hidden>
      <div class="modal">
        <h2>New Team</h2>
        <p>Give your team a name. You&rsquo;ll be the administrator and can invite
           coaches from Settings.</p>
        <div class="form-field">
          <label>Team Name</label>
          <input id="teamNameInput" type="text"
                 placeholder="e.g. Lincoln High Football"
                 autocomplete="off" maxlength="60">
        </div>
        <div id="teamCreateError" class="auth-error" hidden></div>
        <div class="modal-btns" style="margin-top:4px">
          <button class="btn-primary" id="teamCreateBtn" style="width:100%">
            Create Team
          </button>
        </div>
        <button class="modal-cancel" id="teamCreateCancel">Cancel</button>
      </div>
    </div>
  `;

  container.querySelector("#createTeamBtn").addEventListener("click", () => {
    container.querySelector("#createTeamModal").hidden = false;
    container.querySelector("#teamNameInput").focus();
  });

  container.querySelector("#teamCreateCancel").addEventListener("click", () => {
    container.querySelector("#createTeamModal").hidden = true;
  });

  container.querySelector("#refreshBtn").addEventListener("click", () => onDone());

  container.querySelector("#signOutBtn").addEventListener("click", () => logoutCoach());

  container.querySelector("#teamCreateBtn").addEventListener("click", () => doCreate());
  container.querySelector("#teamNameInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") doCreate();
  });

  async function doCreate() {
    const name   = container.querySelector("#teamNameInput").value.trim();
    const errEl  = container.querySelector("#teamCreateError");
    const btn    = container.querySelector("#teamCreateBtn");
    if (!name) {
      errEl.textContent = "Please enter a team name.";
      errEl.hidden = false;
      return;
    }
    btn.disabled = true;
    btn.textContent = "Creating…";
    errEl.hidden = true;
    try {
      await createTeamWithAdmin(user.uid, user.email, name);
      onDone();
    } catch (err) {
      errEl.textContent = "Could not create team: " + err.message;
      errEl.hidden = false;
      btn.disabled = false;
      btn.textContent = "Create Team";
    }
  }
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]
  );
}
