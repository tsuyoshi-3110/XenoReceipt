import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

/**
 * サーバー側の Firebase。IDトークンの検証と、AI の読み取り回数の記録に使う。
 * 鍵は FIREBASE_SERVICE_ACCOUNT_JSON（サービスアカウントの JSON を1行で）。
 * 無ければ実行環境の既定の資格情報（Cloud 上・エミュレータ）に任せる。
 */
function adminApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (json) return initializeApp({ credential: cert(JSON.parse(json)) });
  return initializeApp({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID });
}

export const adminAuth = () => getAuth(adminApp());
export const adminDb = () => getFirestore(adminApp());
