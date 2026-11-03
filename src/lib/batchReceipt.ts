"use client";

import { fieldsFromRead } from "@/lib/batchFields";
import { EXPENSE_CATEGORIES } from "@/lib/categories";
import { blobToDataUrl, normalizeReceiptImage, readReceipt, todayLocal } from "@/lib/receiptImage";
import { createReceipt } from "@/lib/receipts";

/*
 * 続けて撮った（まとめて取り込んだ）レシートを、人が確かめずに保存する。
 *
 * 1枚ずつの登録と同じく AI で読むが、画面で確かめる手順が無いので、怪しいものには「要確認」を付けて保存する。
 * 一覧で要確認を開いて直せば消える。読めなかった1枚でも、写真は必ず残す（撮り直さなくて済むように）。
 */

export type SavedReceipt = { expenseDate: string; needsReview: boolean };

/** 1枚を読んで保存する。写真が読めない・保存できないときだけ例外を投げる（AI の失敗は要確認で保存する） */
export async function saveCapturedReceipt(uid: string, file: File): Promise<SavedReceipt> {
  const image = await normalizeReceiptImage(file);
  const result = await readReceipt(await blobToDataUrl(image), EXPENSE_CATEGORIES);
  const { fields, needsReview } = fieldsFromRead(result, todayLocal());
  await createReceipt(uid, fields, image, result.ok, needsReview);
  return { expenseDate: fields.expenseDate, needsReview };
}
