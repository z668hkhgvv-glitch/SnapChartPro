import { db } from "./firebase.js";
import {
  doc, getDoc, updateDoc,
  collection, query, where, getDocs,
  Timestamp,
} from "firebase/firestore";

export const TRIAL_GAME_LIMIT = 2;
export const TRIAL_PLAY_LIMIT = 25;

// Tier definitions keyed by tier number
export const TIER_MAX_COACHES = { 1: 3, 2: 6, 3: Infinity };
export const TIER_LABELS = {
  1: "Tier 1 — up to 3 coaches",
  2: "Tier 2 — up to 6 coaches",
  3: "Tier 3 — unlimited coaches",
};

export async function getLicenseForTeam(teamId) {
  const q = query(collection(db, "licenses"), where("activatedTeam", "==", teamId));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return { _key: snap.docs[0].id, ...snap.docs[0].data() };
}

export async function checkLicensed(teamId) {
  const lic = await getLicenseForTeam(teamId);
  if (!lic) return { licensed: false };
  if (lic.status === "revoked") return { licensed: false, reason: "revoked" };
  if (lic.expiresAt && lic.expiresAt.toDate() < new Date()) {
    return { licensed: false, reason: "expired", license: lic };
  }
  return { licensed: true, license: lic };
}

export async function activateLicense(uid, teamId, rawKey) {
  const key = rawKey.trim().toUpperCase().replace(/\s/g, "");
  if (!key) throw new Error("Please enter a license key.");
  const ref = doc(db, "licenses", key);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Invalid license key. Please check and try again.");
  const lic = snap.data();
  if (lic.status === "revoked") throw new Error("This key has been revoked. Contact SidelineLabz.");
  if (lic.activatedTeam && lic.activatedTeam !== teamId) {
    throw new Error("This key is already activated for another team.");
  }
  if (lic.activatedTeam === teamId) {
    if (lic.expiresAt && lic.expiresAt.toDate() < new Date()) {
      throw new Error("Your license has expired. Contact SidelineLabz to renew.");
    }
    return { licensed: true, license: { ...lic, _key: key } };
  }
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);
  await updateDoc(ref, {
    activatedTeam: teamId,
    activatedBy: uid,
    activatedAt: Timestamp.fromDate(now),
    expiresAt: Timestamp.fromDate(expiresAt),
    status: "active",
  });
  return {
    licensed: true,
    license: {
      ...lic,
      activatedTeam: teamId,
      activatedBy: uid,
      activatedAt: Timestamp.fromDate(now),
      expiresAt: Timestamp.fromDate(expiresAt),
      _key: key,
    },
  };
}
