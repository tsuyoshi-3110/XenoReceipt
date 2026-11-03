"use client";

import { onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword, type User } from "firebase/auth";
import { Loader2, Receipt } from "lucide-react";
import { useEffect, useState } from "react";

import { ReceiptBook } from "@/components/ReceiptBook";
import { auth } from "@/lib/firebaseClient";

/** ログインに失敗した理由。何が起きたか分からないと、押し直すしかなくなる */
function loginErrorMessage(code: string | undefined): string {
  if (code === "auth/network-request-failed") return "通信できませんでした。電波のよい所で、もう一度お試しください。";
  if (code === "auth/invalid-email") return "メールアドレスの形が正しくありません。";
  if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") return "メールアドレスかパスワードが違います。";
  // 新しい利用者の登録は Firebase で止めてある（2026-11-03 身内だけで使う）
  if (code === "auth/admin-restricted-operation") return "このアカウントは登録されていません。使いたいときは、管理者に登録を頼んでください。";
  if (code === "auth/too-many-requests") return "続けて失敗したので、しばらく止めています。少し待ってからお試しください。";
  return "ログインできませんでした。もう一度お試しください。";
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

  if (user === undefined) {
    return <main className="grid min-h-dvh place-items-center"><Loader2 className="animate-spin text-slate-400" /></main>;
  }
  if (user) return <ReceiptBook user={user} />;

  /*
   * メールアドレスとパスワードのログインだけにする（2026-11-03）。Google のログインは、ホーム画面から開いた
   * iPhone のアプリで行き来の結果が戻らないことがあり、ボタンを外した。Google で作ったアカウントも、
   * 「パスワードを忘れたとき」でパスワードを決めれば、同じアカウントのまま入れる。
   * 自分でアカウントは作れない（身内だけで使う。Firebase で新しい利用者の登録を止めてある）。
   * アカウントは管理者が Firebase コンソールの「ユーザーを追加」で作る。パスワードを忘れたら再設定のメールで決め直す。
   */
  async function login() {
    setError(""); setNotice("");
    if (!email.trim() || !password) { setError("メールアドレスとパスワードを入れてください。"); return; }
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
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
        <form className="space-y-3 text-left" onSubmit={(event) => { event.preventDefault(); void login(); }}>
          <input className="xr-input" type="email" autoComplete="email" inputMode="email" placeholder="メールアドレス" aria-label="メールアドレス" value={email} disabled={busy} onChange={(event) => setEmail(event.target.value)} />
          <input className="xr-input" type="password" autoComplete="current-password" placeholder="パスワード" aria-label="パスワード" value={password} disabled={busy} onChange={(event) => setPassword(event.target.value)} />
          <button type="submit" className="xr-black w-full justify-center" disabled={busy}>{busy && <Loader2 size={15} className="animate-spin" />}ログイン</button>
          <button type="button" className="text-xs text-blue-700 underline" disabled={busy} onClick={() => void resetPassword()}>パスワードを忘れたとき</button>
        </form>

        {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
        {notice && <p className="text-sm font-semibold text-blue-800">{notice}</p>}
        <p className="text-xs text-slate-400">アカウントは管理者が作ります。使いたいときは管理者に頼んでください。</p>
      </div>
    </main>
  );
}
