"use client";

import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getRedirectResult,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  type User,
} from "firebase/auth";
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
  if (code === "auth/invalid-email") return "メールアドレスの形が正しくありません。";
  if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") return "メールアドレスかパスワードが違います。";
  if (code === "auth/email-already-in-use") return "このメールアドレスはもう登録されています。「ログイン」を押してください。";
  if (code === "auth/weak-password") return "パスワードは6文字以上にしてください。";
  if (code === "auth/too-many-requests") return "続けて失敗したので、しばらく止めています。少し待ってからお試しください。";
  if (code === "auth/account-exists-with-different-credential") return "このメールアドレスは Google で登録されています。「Google でログイン」を押してください。";
  return "ログインできませんでした。もう一度お試しください。";
}

/**
 * 窓を開かず、画面ごと Google へ移ってログインするか。
 * ホーム画面から開いた iPhone のアプリは、別の窓（ポップアップ）を開くとその結果が戻らない。
 * スマホは Safari でも窓の扱いが不安定なので、PC（マウスで操作する端末）以外は画面ごと移る。
 */
function shouldRedirect(): boolean {
  const standalone = window.matchMedia("(display-mode: standalone)").matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const desktop = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  return standalone || !desktop;
}

export default function Home() {
  // undefined＝まだ分からない、null＝ログインしていない
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // 確認メール・再設定メールを日本語で送る
    auth.languageCode = "ja";
    return onAuthStateChanged(auth, setUser);
  }, []);
  // 画面ごと Google へ移ってログインして戻ってきたとき、失敗していれば理由を出す（成功なら onAuthStateChanged が受け取る）
  useEffect(() => {
    getRedirectResult(auth).catch((cause: { code?: string }) => setError(loginErrorMessage(cause?.code)));
  }, []);

  if (user === undefined) {
    return <main className="grid min-h-dvh place-items-center"><Loader2 className="animate-spin text-slate-400" /></main>;
  }
  if (user) return <ReceiptBook user={user} />;

  /*
   * メールアドレスとパスワードのログイン（2026-11-03）。ホーム画面から開いた iPhone のアプリでは、
   * Google のログインの行き来がうまくいかないことがあるので、画面を移らずに入れる方法を並べる。
   * 新しく登録した人には確認メールを送り、確認が済むまで AI の読み取りは使えない（サーバーで断る）。
   * 使い捨てのメールでアカウントを増やして AI を呼び続けられないように。
   */
  async function run(action: "login" | "signup") {
    setError(""); setNotice("");
    if (!email.trim() || !password) { setError("メールアドレスとパスワードを入れてください。"); return; }
    setBusy(true);
    try {
      if (action === "login") {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      } else {
        const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await sendEmailVerification(credential.user).catch(() => undefined);
      }
    } catch (cause) {
      setError(loginErrorMessage((cause as { code?: string })?.code));
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    setError(""); setNotice("");
    if (!email.trim()) { setError("パスワードを忘れたときは、メールアドレスを入れてから押してください。"); return; }
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setNotice("パスワードを決め直すメールを送りました。メールのリンクから新しいパスワードを決めてください。");
    } catch (cause) {
      setError(loginErrorMessage((cause as { code?: string })?.code));
    }
  }

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
          disabled={busy}
          onClick={() => {
            setError(""); setNotice("");
            const provider = new GoogleAuthProvider();
            const signIn = shouldRedirect() ? signInWithRedirect(auth, provider) : signInWithPopup(auth, provider);
            signIn.catch((cause: { code?: string }) => setError(loginErrorMessage(cause?.code)));
          }}
        >Google でログイン</button>

        <div className="flex items-center gap-3 text-xs text-slate-400"><span className="h-px flex-1 bg-slate-200" />またはメールアドレスで<span className="h-px flex-1 bg-slate-200" /></div>

        <form className="space-y-3 text-left" onSubmit={(event) => { event.preventDefault(); void run("login"); }}>
          <input className="xr-input" type="email" autoComplete="email" inputMode="email" placeholder="メールアドレス" aria-label="メールアドレス" value={email} disabled={busy} onChange={(event) => setEmail(event.target.value)} />
          <input className="xr-input" type="password" autoComplete="current-password" placeholder="パスワード（6文字以上）" aria-label="パスワード" value={password} disabled={busy} onChange={(event) => setPassword(event.target.value)} />
          <div className="flex gap-2">
            <button type="submit" className="xr-secondary flex-1 justify-center" disabled={busy}>{busy && <Loader2 size={15} className="animate-spin" />}ログイン</button>
            <button type="button" className="xr-secondary flex-1 justify-center" disabled={busy} onClick={() => void run("signup")}>新しく登録</button>
          </div>
          <button type="button" className="text-xs text-blue-700 underline" disabled={busy} onClick={() => void resetPassword()}>パスワードを忘れたとき</button>
        </form>

        {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
        {notice && <p className="text-sm font-semibold text-blue-800">{notice}</p>}
      </div>
    </main>
  );
}
