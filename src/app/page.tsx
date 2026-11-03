"use client";

import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, type User } from "firebase/auth";
import { Loader2, Receipt } from "lucide-react";
import { useEffect, useState } from "react";

import { ReceiptBook } from "@/components/ReceiptBook";
import { auth } from "@/lib/firebaseClient";

/** ログインに失敗した理由。何が起きたか分からないと、押し直すしかなくなる */
function loginErrorMessage(code: string | undefined): string {
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return "";
  if (code === "auth/popup-blocked") return "ログインの窓が開けませんでした。ポップアップを許可して、もう一度押してください。";
  if (code === "auth/unauthorized-domain") return `このアドレス（${window.location.hostname}）からはログインできません。本番のアドレスから開いてください。`;
  if (code === "auth/network-request-failed") return "通信できませんでした。電波のよい所で、もう一度お試しください。";
  return "ログインできませんでした。もう一度お試しください。";
}

export default function Home() {
  // undefined＝まだ分からない、null＝ログインしていない
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [error, setError] = useState("");

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  if (user === undefined) {
    return <main className="grid min-h-dvh place-items-center"><Loader2 className="animate-spin text-slate-400" /></main>;
  }
  if (user) return <ReceiptBook user={user} />;

  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="w-full max-w-sm space-y-5 rounded-2xl bg-white p-8 text-center shadow-sm">
        <Receipt size={36} className="mx-auto text-[var(--brand)]" />
        <div>
          <h1 className="text-xl font-bold">XenoReceipt</h1>
          <p className="mt-2 text-sm text-slate-500">レシートを撮るだけで、店名・日付・金額・費目が入ります。月ごとに Excel と PDF で書き出せます。</p>
        </div>
        <button
          type="button"
          className="xr-primary w-full justify-center"
          onClick={() => {
            setError("");
            signInWithPopup(auth, new GoogleAuthProvider()).catch((cause: { code?: string }) => setError(loginErrorMessage(cause?.code)));
          }}
        >Google でログイン</button>
        {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
      </div>
    </main>
  );
}
