import "./style.css";
import { onAuthChange } from "./auth.js";
import { renderLogin } from "./ui/login.js";
import { renderDashboard } from "./ui/dashboard.js";

const app = document.getElementById("app");

onAuthChange((user) => {
  if (user) {
    // Use the user's UID as the team ID — gives each coach their own
    // isolated data namespace with no cross-user access.
    renderDashboard(app, user, user.uid);
  } else {
    renderLogin(app);
  }
});
