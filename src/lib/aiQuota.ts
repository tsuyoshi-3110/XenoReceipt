import { FieldValue } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebaseAdmin";

/*
 * AI でレシートを読む回数の枠（1人・1か月）。
 *
 * XenoCoin の課金を入れるまでの仮の歯止め。ログインだけで通すと、
 * アカウントを増やすほど AI の費用がかさむので、人ごとに月の回数で止める。
 * 回数は users/{uid}/aiUsage/{YYYY-MM} にサーバーだけが書く（ルールで本人の書き込みを断っている）。
 */

export type Quota = { used: number; limit: number };

export function monthlyLimit(): number {
  const value = Number(process.env.RECEIPT_MONTHLY_LIMIT);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 50;
}

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
  return { used: Number.isFinite(used) ? used : 0, limit: monthlyLimit() };
}

/**
 * 呼ぶ直前に1回ぶん確保する。枠を超えていたら null。
 * 読み取りに失敗しても戻さない（AI は呼んでいるので費用はかかっている。何度でも撮り直せる穴を作らない）。
 */
export async function consumeQuota(uid: string): Promise<Quota | null> {
  const limit = monthlyLimit();
  const ref = usageRef(uid);
  return adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const used = Number(snap.get("receiptReads") ?? 0) || 0;
    if (used >= limit) return null;
    tx.set(ref, { receiptReads: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { used: used + 1, limit };
  });
}
