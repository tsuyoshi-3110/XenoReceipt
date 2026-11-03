"use client";

import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { deleteObject, getBlob, getDownloadURL, ref, uploadBytes } from "firebase/storage";

import { db, storage } from "@/lib/firebaseClient";
import { exTaxOf } from "@/lib/tax";

/*
 * レシート1枚＝1件。users/{uid}/receipts/{id} に置き、写真は users/{uid}/receipts/{id}.jpg。
 * 本人しか読み書きしない（firestore.rules / storage.rules）。
 */

export type ReceiptFields = {
  /** 利用日 YYYY-MM-DD */
  expenseDate: string;
  storeName: string;
  /** 税込の合計（円） */
  amount: number;
  /** 代表の税率（10・8・0）。区分が混ざっていれば多いほう */
  taxRate: number;
  /** 区分ごとの対象額（税込）。混ざっているときだけ入る。入っていれば税抜は区分ごとに割って足す */
  taxable10Amount: number;
  taxable8Amount: number;
  taxFreeAmount: number;
  /** 費目。空＝未設定 */
  category: string;
  memo: string;
};

export type Receipt = ReceiptFields & {
  id: string;
  /** 写真の置き場。手入力だけなら空 */
  imagePath: string;
  /** AI の読み取りを使ったか */
  ocrUsed: boolean;
};

function receiptsCollection(uid: string) {
  return collection(db, "users", uid, "receipts");
}

/** 月の初日と翌月の初日（YYYY-MM-DD）。利用日の文字列で範囲を切る */
export function monthRange(month: string): { from: string; to: string } {
  const [year, mon] = month.split("-").map(Number);
  const next = mon === 12 ? `${year + 1}-01` : `${year}-${String(mon + 1).padStart(2, "0")}`;
  return { from: `${month}-01`, to: `${next}-01` };
}

export async function listReceipts(uid: string, month: string): Promise<Receipt[]> {
  const { from, to } = monthRange(month);
  const snap = await getDocs(query(
    receiptsCollection(uid),
    where("expenseDate", ">=", from),
    where("expenseDate", "<", to),
    orderBy("expenseDate", "desc"),
  ));
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      expenseDate: String(data.expenseDate ?? ""),
      storeName: String(data.storeName ?? ""),
      amount: Number(data.amount ?? 0),
      taxRate: Number(data.taxRate ?? 10),
      taxable10Amount: Number(data.taxable10Amount ?? 0),
      taxable8Amount: Number(data.taxable8Amount ?? 0),
      taxFreeAmount: Number(data.taxFreeAmount ?? 0),
      category: String(data.category ?? ""),
      memo: String(data.memo ?? ""),
      imagePath: String(data.imagePath ?? ""),
      ocrUsed: data.ocrUsed === true,
    };
  });
}

export function receiptExTax(receipt: ReceiptFields): number {
  return exTaxOf(receipt.amount, receipt.taxRate, receipt.taxable10Amount, receipt.taxable8Amount, receipt.taxFreeAmount);
}

/**
 * 新しく登録する。写真を先に上げてから記録を書く（記録だけ残って写真が無い、を作らない）。
 */
export async function createReceipt(uid: string, fields: ReceiptFields, image: Blob | null, ocrUsed: boolean): Promise<void> {
  const docRef = doc(receiptsCollection(uid));
  let imagePath = "";
  if (image) {
    imagePath = `users/${uid}/receipts/${docRef.id}.jpg`;
    await uploadBytes(ref(storage, imagePath), image, { contentType: "image/jpeg" });
  }
  await setDoc(docRef, {
    ...fields,
    imagePath,
    ocrUsed,
    inputType: image ? "receipt" : "manual",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/** 中身を直す。写真は差し替えない（撮り直すなら登録し直す） */
export async function updateReceipt(uid: string, id: string, fields: ReceiptFields): Promise<void> {
  await updateDoc(doc(receiptsCollection(uid), id), { ...fields, updatedAt: serverTimestamp() });
}

export async function deleteReceipt(uid: string, receipt: Receipt): Promise<void> {
  await deleteDoc(doc(receiptsCollection(uid), receipt.id));
  // 写真が先に消えていても記録は消せたので、写真の失敗は無視する
  if (receipt.imagePath) await deleteObject(ref(storage, receipt.imagePath)).catch(() => undefined);
}

export function receiptImageUrl(imagePath: string): Promise<string> {
  return getDownloadURL(ref(storage, imagePath));
}

/** PDF に貼るための写真。Storage の CORS（cors.json）を設定していないと読めない */
export function receiptImageBlob(imagePath: string): Promise<Blob> {
  return getBlob(ref(storage, imagePath));
}
