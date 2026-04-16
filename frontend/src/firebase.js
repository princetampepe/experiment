import { getApp, getApps, initializeApp } from "firebase/app";
import { getAnalytics, isSupported } from "firebase/analytics";
import { browserLocalPersistence, getAuth, setPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "",
};

const requiredFirebaseKeys = ["apiKey", "authDomain", "projectId", "appId"];
export const firebaseEnabled = requiredFirebaseKeys.every((key) => {
  const value = firebaseConfig[key];
  return Boolean(String(value || "").trim());
});

export const firebaseApp = firebaseEnabled
  ? (getApps().length ? getApp() : initializeApp(firebaseConfig))
  : null;

export const firestoreDb = firebaseApp ? getFirestore(firebaseApp) : null;
export const firebaseAuth = firebaseApp ? getAuth(firebaseApp) : null;

if (firebaseApp && firebaseAuth && typeof window !== "undefined") {
  setPersistence(firebaseAuth, browserLocalPersistence).catch(() => {
    // Persistence may fail in strict browser privacy modes.
  });

  isSupported()
    .then((supported) => {
      if (supported) {
        getAnalytics(firebaseApp);
      }
    })
    .catch(() => {
      // Analytics is optional for local dev.
    });
}
