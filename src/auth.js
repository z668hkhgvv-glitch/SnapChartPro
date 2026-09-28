import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  sendEmailVerification,
} from "firebase/auth";
import { auth } from "./firebase.js";

export async function registerCoach(email, password) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  // Send verification email — invite acceptance is blocked for unverified accounts
  await sendEmailVerification(cred.user);
  return cred;
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
