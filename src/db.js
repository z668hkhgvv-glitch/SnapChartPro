/**
 * db.js — Firestore persistence layer.
 *
 * Data model:
 *   teams/{teamId}
 *     name, ownerUid, createdAt
 *
 *   teams/{teamId}/games/{gameId}
 *     opponent, date, mode, createdAt, updatedAt
 *
 *   teams/{teamId}/games/{gameId}/plays/{playId}
 *     (all play fields from the original app)
 *
 * A "team" maps to one subscription. Coaches are invited by email
 * and stored as members on the team document (added in a later sprint).
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
} from "firebase/firestore";
import { db } from "./firebase.js";

// ---- Teams ----------------------------------------------------------------

export async function createTeam(uid, teamName) {
  const ref = doc(collection(db, "teams"));
  await setDoc(ref, {
    name: teamName,
    ownerUid: uid,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function getTeam(teamId) {
  const snap = await getDoc(doc(db, "teams", teamId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// ---- Games ----------------------------------------------------------------

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

// ---- Plays ----------------------------------------------------------------

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

/**
 * Subscribe to live play updates for a game.
 * cb(plays[]) is called immediately and on every change.
 * Returns an unsubscribe function.
 */
export function subscribePlays(teamId, gameId, cb) {
  const q = query(
    collection(db, "teams", teamId, "games", gameId, "plays"),
    orderBy("createdAt", "asc")
  );
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}
