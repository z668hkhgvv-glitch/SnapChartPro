import "./style.css";
import { onAuthChange } from "./auth.js";
import { renderLogin } from "./ui/login.js";
import { renderDashboard } from "./ui/dashboard.js";
import { renderOnboarding } from "./ui/onboarding.js";
import { getUserTeam, getMember, checkInvite, acceptInvite } from "./db.js";

const app = document.getElementById("app");

async function route(user) {
  if (!user) {
    renderLogin(app);
    return;
  }

  app.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F3F4F6">
      <div style="font-family:Inter,sans-serif;color:#6B7280;font-size:14px">Loading&hellip;</div>
    </div>`;

  try {
    let teamId = null;
    let role   = null;

    // 1. Check if user is already on a team
    const ut = await getUserTeam(user.uid);
    if (ut?.teamId) {
      const member = await getMember(ut.teamId, user.uid);
      if (member) {
        teamId = ut.teamId;
        role   = member.role;
      }
    }

    // 2. No team found — check for a pending invite
    if (!teamId) {
      const invite = await checkInvite(user.email);
      if (invite) {
        const result = await acceptInvite(user.uid, user.email, invite);
        teamId = result.teamId;
        role   = result.role;
      }
    }

    if (teamId) {
      renderDashboard(app, user, teamId, role, () => route(user));
    } else {
      renderOnboarding(app, user, () => route(user));
    }
  } catch (err) {
    console.error("Route error:", err);
    app.innerHTML = `
      <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;
                  flex-direction:column;gap:12px;background:#F3F4F6;font-family:Inter,sans-serif">
        <div style="color:#DC2626;font-size:14px">Failed to load. Check your connection.</div>
        <button onclick="location.reload()" style="padding:8px 16px;border-radius:8px;
          border:1.5px solid #16317F;background:#fff;color:#16317F;cursor:pointer;font-size:14px">
          Retry
        </button>
      </div>`;
  }
}

onAuthChange(route);
