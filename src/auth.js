import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
} from "firebase/auth";
import { auth } from "./firebase.js";

export function registerCoach(email, password) {
  return createUserWithEmailAndPassword(auth, email, password);
}

export function loginCoach(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function logoutCoach() {
  return signOut(auth);
}

// cb(user) — user is null when logged out
export function resetPassword(email) {
  return sendPasswordResetEmail(auth, email);
}

export function onAuthChange(cb) {
  return onAuthStateChanged(auth, cb);
}
