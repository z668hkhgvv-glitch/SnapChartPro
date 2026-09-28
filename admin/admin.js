import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, getDocs, doc, setDoc, updateDoc,
  query, orderBy, Timestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const ADMIN_EMAIL = "rcatalano1@gmail.com";

const firebaseConfig = {
  apiKey:            "AIzaSyBGvR8-X8fHm3qVuzu4gFh3JKoVVeGYgVo",
  authDomain:        "snapchartpro.firebaseapp.com",
  projectId:         "snapchartpro",
  storageBucket:     "snapchartpro.firebasestorage.app",
  messagingSenderId: "767385141168",
  appId:             "1:767385141168:web:1353d5db4f1ad13c972075",
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ── helpers ──────────────────────────────────────────────────────────────────

function generateKey() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0, 1 for readability
  const rand = new Uint8Array(12);
  crypto.getRandomValues(rand);
  let s = "";
  for (let i = 0; i < 12; i++) {
    if (i > 0 && i % 4 === 0) s += "-";
    s += chars[rand[i] % chars.length];
  }
  return "SNAP-" + s;
}

function fmtDate(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function statusOf(lic) {
  if (lic.status === "revoked") return "revoked";
  if (!lic.activatedBy) return "available";
  if (lic.expiresAt && (lic.expiresAt.toDate ? lic.expiresAt.toDate() : new Date(lic.expiresAt.seconds * 1000)) < new Date()) return "expired";
  return "active";
}

function esc(s) { return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }

// ── auth ─────────────────────────────────────────────────────────────────────

let allLicenses = [];

onAuthStateChanged(auth, (user) => {
  if (user && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
    document.getElementById("loginScreen").style.display = "none";
    document.getElementById("adminScreen").style.display = "";
    document.getElementById("userInfo").textContent = user.email;
    document.getElementById("logoutBtn").style.display = "";
    loadLicenses();
  } else if (user) {
    signOut(auth);
    document.getElementById("errMsg").textContent = "Access denied: not an admin account.";
  } else {
    document.getElementById("loginScreen").style.display = "";
    document.getElementById("adminScreen").style.display = "none";
    document.getElementById("logoutBtn").style.display = "none";
    document.getElementById("userInfo").textContent = "";
  }
});

document.getElementById("loginBtn").addEventListener("click", async () => {
  const email = document.getElementById("emailIn").value.trim();
  const pass  = document.getElementById("passIn").value;
  const errEl = document.getElementById("errMsg");
  const btn   = document.getElementById("loginBtn");
  errEl.textContent = "";
  btn.disabled = true;
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (e) {
    errEl.textContent = "Sign-in failed. Check your email and password.";
    btn.disabled = false;
  }
});
document.getElementById("passIn").addEventListener("keydown", e => { if (e.key === "Enter") document.getElementById("loginBtn").click(); });
document.getElementById("logoutBtn").addEventListener("click", () => signOut(auth));

// ── generate ─────────────────────────────────────────────────────────────────

const TIER_MAX = { "1": 3, "2": 6, "3": null }; // null = unlimited
const TIER_LABEL = { "1": "Tier 1 (1–3 coaches)", "2": "Tier 2 (4–6 coaches)", "3": "Tier 3 (6+ coaches)" };

document.getElementById("genBtn").addEventListener("click", async () => {
  const org   = document.getElementById("genOrg").value.trim();
  const name  = document.getElementById("genName").value.trim();
  const email = document.getElementById("genEmail").value.trim();
  const notes = document.getElementById("genNotes").value.trim();
  const tier  = document.getElementById("genTier").value;
  const msg   = document.getElementById("genMsg");
  const res   = document.getElementById("genResult");
  const cpBtn = document.getElementById("copyBtn");

  if (!org) { msg.textContent = "Organization is required."; msg.style.color = "#DC2626"; msg.style.display = ""; return; }

  const key = generateKey();
  const maxCoaches = TIER_MAX[tier];
  try {
    await setDoc(doc(db, "licenses", key), {
      status: "available",
      tier: parseInt(tier, 10),
      maxCoaches: maxCoaches,
      issuedTo: { organization: org, name, email },
      notes,
      activatedTeam: null,
      activatedBy: null,
      activatedAt: null,
      expiresAt: null,
      createdAt: Timestamp.now(),
    });
    res.textContent = key;
    res.style.display = "";
    cpBtn.style.display = "";
    msg.textContent = `✓ Key saved for ${org}`;
    msg.style.color = "#065F46";
    msg.style.display = "";
    document.getElementById("genOrg").value = "";
    document.getElementById("genName").value = "";
    document.getElementById("genEmail").value = "";
    document.getElementById("genNotes").value = "";
    loadLicenses();
  } catch (e) {
    msg.textContent = "Error saving key. Try again.";
    msg.style.color = "#DC2626";
    msg.style.display = "";
  }
});

document.getElementById("copyBtn").addEventListener("click", () => {
  const key = document.getElementById("genResult").textContent;
  navigator.clipboard.writeText(key).then(() => {
    document.getElementById("copyBtn").textContent = "Copied!";
    setTimeout(() => { document.getElementById("copyBtn").textContent = "Copy"; }, 1500);
  });
});

// ── load & render ─────────────────────────────────────────────────────────────

document.getElementById("refreshBtn").addEventListener("click", loadLicenses);
document.getElementById("searchIn").addEventListener("input", renderTable);
document.getElementById("statusFilter").addEventListener("change", renderTable);

async function loadLicenses() {
  document.getElementById("loadMsg").textContent = "Loading…";
  document.getElementById("loadMsg").style.display = "";
  document.getElementById("licTable").style.display = "none";
  try {
    const snap = await getDocs(query(collection(db, "licenses"), orderBy("createdAt", "desc")));
    allLicenses = snap.docs.map(d => ({ _key: d.id, ...d.data() }));
    renderTable();
  } catch (e) {
    document.getElementById("loadMsg").textContent = "Error loading licenses. Refresh to try again.";
  }
}

function renderTable() {
  const search = document.getElementById("searchIn").value.toLowerCase();
  const filter = document.getElementById("statusFilter").value;
  const tbody  = document.getElementById("licBody");
  const table  = document.getElementById("licTable");
  const loadMsg = document.getElementById("loadMsg");

  const rows = allLicenses.filter(l => {
    const st = statusOf(l);
    if (filter && st !== filter) return false;
    if (!search) return true;
    return [l._key, l.issuedTo?.organization, l.issuedTo?.name, l.issuedTo?.email, l.notes]
      .some(v => String(v || "").toLowerCase().includes(search));
  });

  if (!rows.length) {
    table.style.display = "none";
    loadMsg.textContent = allLicenses.length ? "No keys match your filter." : "No license keys yet.";
    loadMsg.style.display = "";
    return;
  }

  loadMsg.style.display = "none";
  table.style.display = "";
  tbody.innerHTML = rows.map(l => {
    const st = statusOf(l);
    const tierNum = l.tier ? String(l.tier) : "";
    const tierStr = tierNum ? TIER_LABEL[tierNum] || ("Tier " + tierNum) : "—";
    return `<tr>
      <td class="mono">${esc(l._key)} <button class="copy-btn" data-action="copy" data-key="${esc(l._key)}">Copy</button></td>
      <td><b>${esc(l.issuedTo?.organization)}</b></td>
      <td>${esc(l.issuedTo?.name)}<br><span style="color:#6b7280;font-size:11px">${esc(l.issuedTo?.email)}</span></td>
      <td style="font-size:12px">${esc(tierStr)}</td>
      <td><span class="badge ${st}">${st}</span></td>
      <td style="font-size:12px">${l.activatedTeam ? fmtDate(l.activatedAt) : (l.activatedBy ? fmtDate(l.activatedAt) : "—")}<br><span style="color:#6b7280;font-size:11px">${l.activatedTeam ? "team: " + esc(l.activatedTeam.slice(0, 10)) + "…" : (l.activatedBy ? "uid: " + esc(l.activatedBy.slice(0, 10)) + "…" : "")}</span></td>
      <td style="font-size:12px">${fmtDate(l.expiresAt)}</td>
      <td style="font-size:12px;color:#6b7280">${fmtDate(l.createdAt)}</td>
      <td>
        ${st !== "revoked"
          ? `<button class="sm red" data-action="revoke" data-key="${esc(l._key)}">Revoke</button>`
          : `<button class="sm gray" data-action="reinstate" data-key="${esc(l._key)}">Reinstate</button>`}
      </td>
    </tr>`;
  }).join("");
}

// ── revoke / reinstate — delegated, no inline onclick ────────────────────────

async function revokeKey(key) {
  if (!confirm(`Revoke key ${key}?\n\nThe user will lose access immediately.`)) return;
  try {
    await updateDoc(doc(db, "licenses", key), { status: "revoked" });
    allLicenses = allLicenses.map(l => l._key === key ? { ...l, status: "revoked" } : l);
    renderTable();
  } catch (e) { alert("Error revoking key. Try again."); }
}

async function reinstateKey(key) {
  if (!confirm(`Reinstate key ${key}?`)) return;
  try {
    await updateDoc(doc(db, "licenses", key), { status: "active" });
    allLicenses = allLicenses.map(l => l._key === key ? { ...l, status: "active" } : l);
    renderTable();
  } catch (e) { alert("Error reinstating key. Try again."); }
}

// Event delegation on the table body — handles copy/revoke/reinstate
// without any inline onclick attributes (so the CSP can drop unsafe-inline).
document.getElementById("licBody").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const key    = btn.dataset.key;
  const action = btn.dataset.action;
  if (action === "copy") {
    navigator.clipboard.writeText(key).then(() => {
      btn.textContent = "Copied!";
      setTimeout(() => { btn.textContent = "Copy"; }, 1500);
    });
  } else if (action === "revoke") {
    await revokeKey(key);
  } else if (action === "reinstate") {
    await reinstateKey(key);
  }
});
