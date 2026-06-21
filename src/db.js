/**
 * db.js — Firestore persistence layer.
 *
 * Data model:
 *   userTeams/{uid}
 *     teamId                          ← quick lookup: which team is this user on?
 *
 *   teams/{teamId}
 *     name, ownerUid, createdAt
 *
 *   teams/{teamId}/members/{uid}
 *     email, role (admin|editor|readonly), addedAt, addedBy
 *
 *   teams/{teamId}/games/{gameId}
 *     opponent, date, mode, createdAt, updatedAt
 *
 *   teams/{teamId}/games/{gameId}/plays/{playId}
 *     (all play fields)
 *
 *   invites/{emailKey}
 *     email, teamId, teamName, role, invitedByEmail, invitedAt
 *     emailKey = email.toLowerCase() with @ and . replaced by _
 */

import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  query,
  orderBy,
  where,
} from "firebase/firestore";
import { db } from "./firebase.js";

// ── User team lookup ──────────────────────────────────────────────────────────

export async function getUserTeam(uid) {
  const snap = await getDoc(doc(db, "userTeams", uid));
  return snap.exists() ? snap.data() : null;
}

export async function setUserTeam(uid, teamId) {
  await setDoc(doc(db, "userTeams", uid), { teamId });
}

// ── Teams ─────────────────────────────────────────────────────────────────────

/** Create a brand-new team. Caller becomes the admin member. */
export async function createTeamWithAdmin(uid, email, teamName) {
  const ref = doc(collection(db, "teams"));
  const teamId = ref.id;

  await setDoc(ref, {
    name: teamName,
    ownerUid: uid,
    createdAt: serverTimestamp(),
  });

  await setDoc(doc(db, "teams", teamId, "members", uid), {
    email: email.toLowerCase(),
    role: "admin",
    addedAt: serverTimestamp(),
    addedBy: uid,
  });

  await setUserTeam(uid, teamId);
  return teamId;
}

export async function getTeam(teamId) {
  const snap = await getDoc(doc(db, "teams", teamId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function updateTeam(teamId, fields) {
  await updateDoc(doc(db, "teams", teamId), fields);
}

// ── Members ───────────────────────────────────────────────────────────────────

export async function getMember(teamId, uid) {
  const snap = await getDoc(doc(db, "teams", teamId, "members", uid));
  return snap.exists() ? { uid: snap.id, ...snap.data() } : null;
}

export async function getMembers(teamId) {
  const snap = await getDocs(collection(db, "teams", teamId, "members"));
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}

export async function updateMemberRole(teamId, uid, role) {
  await updateDoc(doc(db, "teams", teamId, "members", uid), { role });
}

export async function removeMember(teamId, uid) {
  await deleteDoc(doc(db, "teams", teamId, "members", uid));
}

// ── Invites ───────────────────────────────────────────────────────────────────

function inviteKey(email) {
  return email.toLowerCase().replace(/[@.]/g, "_");
}

export async function checkInvite(email) {
  const snap = await getDoc(doc(db, "invites", inviteKey(email)));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function inviteCoach(email, role, teamId, teamName, invitedByEmail) {
  await setDoc(doc(db, "invites", inviteKey(email)), {
    email: email.toLowerCase(),
    role,
    teamId,
    teamName,
    invitedByEmail: invitedByEmail.toLowerCase(),
    invitedAt: serverTimestamp(),
  });
}

export async function cancelInvite(email) {
  await deleteDoc(doc(db, "invites", inviteKey(email)));
}

export async function getTeamInvites(teamId) {
  const q = query(collection(db, "invites"), where("teamId", "==", teamId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function acceptInvite(uid, email, invite) {
  await setDoc(doc(db, "teams", invite.teamId, "members", uid), {
    email: email.toLowerCase(),
    role: invite.role,
    addedAt: serverTimestamp(),
    addedBy: null,
  });
  await setUserTeam(uid, invite.teamId);
  await cancelInvite(email);
  return { teamId: invite.teamId, role: invite.role };
}

// ── Games ─────────────────────────────────────────────────────────────────────

export async function createGame(teamId, { opponent, date, mode }) {
  const ref = doc(collection(db, "teams", teamId, "games"));
  await setDoc(ref, {
    opponent: opponent || "",
    date: date || "",
    mode: mode || "standard",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateGame(teamId, gameId, fields) {
  await updateDoc(doc(db, "teams", teamId, "games", gameId), {
    ...fields,
    updatedAt: serverTimestamp(),
  });
}

export async function getGames(teamId) {
  const snap = await getDocs(
    query(collection(db, "teams", teamId, "games"), orderBy("createdAt", "desc"))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function deleteGame(teamId, gameId) {
  await deleteDoc(doc(db, "teams", teamId, "games", gameId));
}

// ── Plays ─────────────────────────────────────────────────────────────────────

export async function addPlay(teamId, gameId, play) {
  const ref = await addDoc(
    collection(db, "teams", teamId, "games", gameId, "plays"),
    { ...play, createdAt: serverTimestamp() }
  );
  return ref.id;
}

export async function updatePlay(teamId, gameId, playId, fields) {
  await updateDoc(
    doc(db, "teams", teamId, "games", gameId, "plays", playId),
    fields
  );
}

export async function deletePlay(teamId, gameId, playId) {
  await deleteDoc(doc(db, "teams", teamId, "games", gameId, "plays", playId));
}

export function subscribePlays(teamId, gameId, cb) {
  const q = query(
    collection(db, "teams", teamId, "games", gameId, "plays"),
    orderBy("createdAt", "asc")
  );
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}
