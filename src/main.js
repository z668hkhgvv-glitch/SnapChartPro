import "./style.css";
import { onAuthChange } from "./auth.js";
import { renderLogin } from "./ui/login.js";
import { renderDashboard } from "./ui/dashboard.js";
import { renderOnboarding } from "./ui/onboarding.js";
import { getUserTeam, getMember, checkInvite, acceptInvite } from "./db.js";

const app = document.getElementById("app");
const SPLASH_MIN_MS = 1800;

function showSplash() {
  app.innerHTML = `
    <div id="splash" style="
      min-height:100vh;display:flex;flex-direction:column;
      align-items:center;justify-content:center;
      background:#16317F;gap:28px;">
      <svg width="100" height="100" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="0" y="0" width="512" height="512" rx="112" fill="rgba(255,255,255,0.12)"/>
        <rect x="142" y="232" width="60" height="128" rx="12" fill="#ffffff"/>
        <rect x="226" y="180" width="60" height="180" rx="12" fill="#ffffff"/>
        <rect x="310" y="120" width="60" height="240" rx="12" fill="#ffffff"/>
        <path d="M306 112 L330 140 L382 76" fill="none" stroke="#F59E0B" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <div style="text-align:center;line-height:1">
        <div style="font-family:'Oswald',sans-serif;font-weight:700;font-size:36px;color:#fff;letter-spacing:.02em">
          Snap<span style="color:rgba(255,255,255,.6)">Chart</span><span style="color:#F59E0B;font-size:26px"> Pro</span>
        </div>
        <div style="font-family:'Inter',sans-serif;font-size:13px;color:rgba(255,255,255,.5);margin-top:6px;letter-spacing:.04em">
          SIDELINE PLAY CHARTING
        </div>
      </div>
      <div style="width:48px;height:3px;border-radius:2px;background:rgba(255,255,255,.2);overflow:hidden;margin-top:8px">
        <div id="splashBar" style="height:100%;width:0%;background:#F59E0B;transition:width ${SPLASH_MIN_MS}ms ease-out"></div>
      </div>
    </div>`;
  requestAnimationFrame(() => {
    const bar = document.getElementById("splashBar");
    if (bar) bar.style.width = "100%";
  });
}

// ── Service worker registration & update toast ────────────────────────────────
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });

      function offerUpdate(worker) {
        const toast = document.createElement("div");
        toast.style.cssText = [
          "position:fixed;bottom:24px;left:50%;transform:translateX(-50%)",
          "background:#16317F;color:#fff;padding:12px 20px;border-radius:12px",
          "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
          "font-size:14px;font-weight:600;display:flex;align-items:center;gap:12px",
          "box-shadow:0 4px 24px rgba(0,0,0,.35);z-index:99999;white-space:nowrap",
        ].join(";");
        toast.innerHTML = `
          <span>&#128640; Update available</span>
          <button style="background:#F59E0B;color:#000;border:none;border-radius:7px;
            padding:6px 14px;font-size:13px;font-weight:700;cursor:pointer">
            Update now
          </button>`;
        document.body.appendChild(toast);
        toast.querySelector("button").addEventListener("click", () => {
          worker.postMessage("skipWaiting");
          toast.remove();
        });
      }

      // New SW already waiting (e.g. hard reload after deploy)
      if (reg.waiting) offerUpdate(reg.waiting);

      // New SW installs while page is open
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        nw.addEventListener("statechange", () => {
          if (nw.state === "installed" && navigator.serviceWorker.controller) {
            offerUpdate(nw);
          }
        });
      });

      // When the new SW takes control, reload to run the latest code
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!refreshing) { refreshing = true; window.location.reload(); }
      });
    } catch (err) {
      console.warn("SW registration failed:", err);
    }
  });
}

// Show splash immediately on load, before auth resolves
showSplash();
const splashShownAt = Date.now();

async function route(user) {
  // Ensure splash shows for at least SPLASH_MIN_MS
  const elapsed = Date.now() - splashShownAt;
  const remaining = SPLASH_MIN_MS - elapsed;
  if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));

  if (!user) {
    renderLogin(app);
    return;
  }

  try {
    let teamId = null;
    let role   = null;

    const ut = await getUserTeam(user.uid);
    if (ut?.teamId) {
      const member = await getMember(ut.teamId, user.uid);
      if (member) {
        teamId = ut.teamId;
        role   = member.role;
      }
    }

    if (!teamId) {
      const invite = await checkInvite(user.email);
      if (invite) {
        const result = await acceptInvite(user.uid, user.email, invite);
        teamId = result.teamId;
        role   = result.role;
      }
    }

    console.log("[SnapChart] route resolved:", { uid: user.uid, email: user.email, teamId, role });

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
