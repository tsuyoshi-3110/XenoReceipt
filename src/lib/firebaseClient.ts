import { getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

/**
 * ログインの窓口のアドレス。本番（https）では開いているこのアドレスにして、next.config の中継で Firebase へつなぐ。
 * 別のアドレス（〇〇.firebaseapp.com）のままだと、ホーム画面から開いた iPhone のアプリへログインの結果が戻らない。
 * 手元（http の localhost・〇〇.local）では中継の戻り先が使えないので、今までどおり Firebase のアドレス。
 */
function authDomain(): string {
  const fallback = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "demo.firebaseapp.com";
  if (typeof window === "undefined" || window.location.protocol !== "https:") return fallback;
  return window.location.host;
}

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "demo-api-key",
  authDomain: authDomain(),
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "xenoreceipt-demo",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "xenoreceipt-demo.appspot.com",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "000000000000",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:000000000000:web:demo",
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
