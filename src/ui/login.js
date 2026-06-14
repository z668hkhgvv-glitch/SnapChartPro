import { loginCoach, registerCoach } from "../auth.js";

export function renderLogin(container) {
  container.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card">
        <div class="auth-logo">
          <span class="logo-snap">Snap</span><span class="logo-chart">Chart</span>
          <span class="logo-pro">PRO</span>
        </div>
        <p class="auth-sub">Shared play charting for your entire staff</p>

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
