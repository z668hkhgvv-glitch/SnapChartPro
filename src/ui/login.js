import { loginCoach, registerCoach, resetPassword } from "../auth.js";

const EYE_OPEN = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_SHUT = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

export function renderLogin(container) {
  container.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card">
        <div class="auth-logo">
          <svg width="560" height="160" viewBox="0 0 560 160" xmlns="http://www.w3.org/2000/svg" aria-label="SnapChart Pro" role="img" style="width:100%;max-width:340px;height:auto;display:block;margin:0 auto 4px">
            <rect x="20" y="34" width="92" height="92" rx="20" fill="#16317f"/>
            <rect x="38" y="80" width="15" height="28" rx="3" fill="#ffffff"/>
            <rect x="59" y="66" width="15" height="42" rx="3" fill="#ffffff"/>
            <rect x="80" y="50" width="15" height="58" rx="3" fill="#ffffff"/>
            <path d="M79 44 l5 6 l12 -15" fill="none" stroke="#F59E0B" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
            <text x="132" y="92" font-size="46" font-family="Oswald,'Arial Narrow',sans-serif" font-weight="700"><tspan fill="#16317f">Snap</tspan><tspan fill="#1e44c4">Chart</tspan><tspan fill="#F59E0B" font-size="36"> Pro</tspan></text>
            <text x="134" y="118" font-size="14" font-family="Oswald,'Arial Narrow',sans-serif" font-weight="600" letter-spacing="0.6" fill="#6b7280">Sideline play charting &#8212; Pro edition</text>
          </svg>
        </div>

        <div class="tab-row" id="authTabs">
          <button class="tab-btn active" data-tab="login">Sign In</button>
          <button class="tab-btn" data-tab="register">Create Account</button>
        </div>

        <!-- Sign in / Create account form -->
        <form id="authForm" autocomplete="on">
          <div class="form-field">
            <label>Email</label>
            <input id="authEmail" type="email" autocomplete="email" placeholder="coach@school.edu" required>
          </div>
          <div class="form-field" id="pwField">
            <label>Password</label>
            <div class="pw-wrap">
              <input id="authPassword" type="password" autocomplete="current-password" placeholder="••••••••" required minlength="6">
              <button type="button" id="pwToggle" class="pw-toggle" aria-label="Show password">${EYE_OPEN}</button>
            </div>
          </div>
          <div id="forgotRow" class="forgot-row">
            <button type="button" id="forgotBtn" class="link-btn">Forgot password?</button>
          </div>
          <div id="authError" class="auth-error" hidden></div>
          <button type="submit" class="btn-primary" id="authSubmit">Sign In</button>
        </form>

        <!-- Forgot password panel -->
        <div id="resetPanel" hidden>
          <p class="reset-hint">Enter your email and we'll send a reset link.</p>
          <div class="form-field">
            <label>Email</label>
            <input id="resetEmail" type="email" autocomplete="email" placeholder="coach@school.edu">
          </div>
          <div id="resetMsg" class="auth-error" hidden></div>
          <button type="button" class="btn-primary" id="resetSubmit" style="width:100%;font-size:16px;padding:12px">Send Reset Link</button>
          <div style="text-align:center;margin-top:14px">
            <button type="button" id="resetBack" class="link-btn">← Back to sign in</button>
          </div>
        </div>

        <p class="auth-footer">SidelineLabz &middot; SnapChart Pro <span style="font-family:var(--num);font-size:11px;opacity:0.6;margin-left:4px">1.1.1</span></p>
      </div>
    </div>
  `;

  let mode = "login";

  // --- Tab switching ---
  container.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      mode = btn.dataset.tab;
      container.querySelectorAll(".tab-btn").forEach((b) =>
        b.classList.toggle("active", b.dataset.tab === mode)
      );
      document.getElementById("authSubmit").textContent =
        mode === "login" ? "Sign In" : "Create Account";
      document.getElementById("authPassword").autocomplete =
        mode === "login" ? "current-password" : "new-password";
      document.getElementById("forgotRow").hidden = mode !== "login";
      document.getElementById("authError").hidden = true;
    });
  });

  // --- Show/hide password ---
  const pwInput  = document.getElementById("authPassword");
  const pwToggle = document.getElementById("pwToggle");
  pwToggle.addEventListener("click", () => {
    const show = pwInput.type === "password";
    pwInput.type = show ? "text" : "password";
    pwToggle.innerHTML = show ? EYE_SHUT : EYE_OPEN;
    pwToggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
    pwInput.focus();
  });

  // --- Forgot password link ---
  document.getElementById("forgotBtn").addEventListener("click", () => {
    document.getElementById("authForm").hidden = true;
    document.getElementById("authTabs").hidden = true;
    document.getElementById("resetPanel").hidden = false;
    document.getElementById("resetEmail").value = document.getElementById("authEmail").value;
    document.getElementById("resetMsg").hidden = true;
    document.getElementById("resetEmail").focus();
  });

  document.getElementById("resetBack").addEventListener("click", () => {
    document.getElementById("resetPanel").hidden = true;
    document.getElementById("authTabs").hidden = false;
    document.getElementById("authForm").hidden = false;
  });

  // --- Send reset link ---
  document.getElementById("resetSubmit").addEventListener("click", async () => {
    const email  = document.getElementById("resetEmail").value.trim();
    const msgEl  = document.getElementById("resetMsg");
    const btn    = document.getElementById("resetSubmit");

    if (!email) {
      msgEl.textContent = "Please enter your email address.";
      msgEl.className = "auth-error";
      msgEl.hidden = false;
      return;
    }

    btn.disabled = true;
    btn.textContent = "Sending…";
    msgEl.hidden = true;

    try {
      await resetPassword(email);
      msgEl.textContent = "Reset link sent — check your inbox (and spam folder).";
      msgEl.className = "auth-success";
      msgEl.hidden = false;
      btn.textContent = "Link Sent";
    } catch (err) {
      msgEl.textContent = friendlyError(err.code);
      msgEl.className = "auth-error";
      msgEl.hidden = false;
      btn.disabled = false;
      btn.textContent = "Send Reset Link";
    }
  });

  // --- Main form submit ---
  document.getElementById("authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email    = document.getElementById("authEmail").value.trim();
    const password = document.getElementById("authPassword").value;
    const errEl    = document.getElementById("authError");
    const btn      = document.getElementById("authSubmit");

    btn.disabled = true;
    btn.textContent = "Please wait…";
    errEl.hidden = true;

    try {
      if (mode === "login") {
        await loginCoach(email, password);
      } else {
        await registerCoach(email, password);
      }
    } catch (err) {
      console.error("Auth error:", err.code, err.message);
      errEl.textContent = friendlyError(err.code, err.message);
      errEl.hidden = false;
      btn.disabled = false;
      btn.textContent = mode === "login" ? "Sign In" : "Create Account";
    }
  });
}

function friendlyError(code, message = "") {
  const map = {
    // Wrong credentials
    "auth/user-not-found":           "No account found with that email.",
    "auth/wrong-password":           "Incorrect password.",
    "auth/invalid-credential":       "Email or password is incorrect.",
    "auth/invalid-login-credentials":"Email or password is incorrect.",
    // Account issues
    "auth/email-already-in-use":     "An account with that email already exists.",
    "auth/user-disabled":            "This account has been disabled. Contact support.",
    "auth/operation-not-allowed":    "Email/password sign-in is not enabled. Contact support.",
    // Input issues
    "auth/weak-password":            "Password must be at least 6 characters.",
    "auth/invalid-email":            "Please enter a valid email address.",
    "auth/missing-email":            "Please enter your email address.",
    "auth/missing-password":         "Please enter your password.",
    // Rate limiting / network
    "auth/too-many-requests":        "Too many attempts — wait a few minutes and try again.",
    "auth/network-request-failed":   "Network error — check your connection and try again.",
  };
  if (map[code]) return map[code];
  // Surface the raw code so it's diagnosable without opening DevTools
  return code ? `Sign-in failed (${code}).` : "Something went wrong — check your connection and try again.";
}
