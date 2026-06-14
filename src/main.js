import "./style.css";
import { onAuthChange } from "./auth.js";
import { renderLogin } from "./ui/login.js";
import { renderDashboard } from "./ui/dashboard.js";

const app = document.getElementById("app");

// Placeholder teamId until team-management sprint is built.
// After that, the teamId will come from the user's Firestore profile.
const TEAM_ID_PLACEHOLDER = "default-team";

onAuthChange((user) => {
  if (user) {
    renderDashboard(app, user, TEAM_ID_PLACEHOLDER);
  } else {
    renderLogin(app);
  }
});
