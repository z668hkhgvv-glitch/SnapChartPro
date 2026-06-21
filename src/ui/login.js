import { loginCoach, registerCoach } from "../auth.js";

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

        <div class="tab-row">
          <button class="tab-btn active" data-tab="login">Sign In</button>
          <button class="tab-btn" data-tab="register">Create Account</button>
        </div>

        <form id="authForm" autocomplete="on">
          <div class="form-field">
            <label>Email</label>
            <input id="authEmail" type="email" autocomplete="email" placeholder="coach@school.edu" required>
          </div>
          <div class="form-field">
            <label>Password</label>
            <input id="authPassword" type="password" autocomplete="current-password" placeholder="••••••••" required minlength="6">
          </div>
          <div id="authError" class="auth-error" hidden></div>
          <button type="submit" class="btn-primary" id="authSubmit">Sign In</button>
        </form>

        <p class="auth-footer">SidelineLabz &middot; SnapChart Pro</p>
      </div>
    </div>
  `;

  let mode = "login";

  container.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      mode = btn.dataset.tab;
      container.querySelectorAll(".tab-btn").forEach((b) =>
        b.classList.toggle("active", b.dataset.tab === mode)
      );
      document.getElementById("authSubmit").textContent =
        mode === "login" ? "Sign In" : "Create Account";
      document.getElementById("authError").hidden = true;
    });
  });

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
      // onAuthChange in main.js will take over from here
    } catch (err) {
      errEl.textContent = friendlyError(err.code);
      errEl.hidden = false;
      btn.disabled = false;
      btn.textContent = mode === "login" ? "Sign In" : "Create Account";
    }
  });
}

function friendlyError(code) {
  const map = {
    "auth/user-not-found":     "No account found with that email.",
    "auth/wrong-password":     "Incorrect password.",
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/email-already-in-use": "An account with that email already exists.",
    "auth/weak-password":      "Password must be at least 6 characters.",
    "auth/invalid-email":      "Please enter a valid email address.",
    "auth/too-many-requests":  "Too many attempts. Try again later.",
  };
  return map[code] || "Something went wrong. Please try again.";
}
