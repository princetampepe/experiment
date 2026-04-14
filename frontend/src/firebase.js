import { getApp, getApps, initializeApp } from "firebase/app";
import { getAnalytics, isSupported } from "firebase/analytics";
import { browserLocalPersistence, getAuth, setPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBY92Efk8OdOaHGDF68kiPatX5Cq2Qzx_A",
  authDomain: "pulsesocial-fe039.firebaseapp.com",
  projectId: "pulsesocial-fe039",
  storageBucket: "pulsesocial-fe039.firebasestorage.app",
  messagingSenderId: "751042817031",
  appId: "1:751042817031:web:ad20abd8e74a2ad9e9cea2",
  measurementId: "G-KN3X72EEZ0",
};

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const firestoreDb = getFirestore(firebaseApp);
export const firebaseAuth = getAuth(firebaseApp);

if (typeof window !== "undefined") {
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
