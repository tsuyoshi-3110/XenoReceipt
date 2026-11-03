import { FieldValue } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebaseAdmin";

/*
 * AI でレシートを読んだ回数（1人・1か月）。
 *
 * 身内だけで使い、新しい利用者の登録も止めてあるので、回数で止めることはしない（2026-11-03 ユーザー指定で上限を外した）。
 * AI の費用の目安として数えるだけ残す。人を広く入れるときは、ここで止めるか XenoCoin の課金にする。
 * 回数は users/{uid}/aiUsage/{YYYY-MM} にサーバーだけが書く（ルールで本人の書き込みを断っている）。
 */

export type Quota = { used: number };

/** 日本時間の YYYY-MM。月の切り替わりを日本の0時にそろえる */
export function monthKeyJst(now: Date = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, "0")}`;
}

function usageRef(uid: string) {
  return adminDb().collection("users").doc(uid).collection("aiUsage").doc(monthKeyJst());
}

export async function readQuota(uid: string): Promise<Quota> {
  const snap = await usageRef(uid).get();
  const used = Number(snap.get("receiptReads") ?? 0);
  return { used: Number.isFinite(used) ? used : 0 };
}

/** AI を呼ぶたびに1回数える。数えられなくても読み取りは止めない（目安なので） */
export async function countRead(uid: string): Promise<void> {
  await usageRef(uid)
    .set({ receiptReads: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    .catch((error) => console.error("[receipt-extract] 読み取りの回数を数えられませんでした", error));
}
