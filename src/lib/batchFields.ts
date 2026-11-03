import { DEFAULT_CATEGORY, EXPENSE_CATEGORIES } from "@/lib/categories";
import type { ReceiptReadResult } from "@/lib/receiptImage";
import type { ReceiptFields } from "@/lib/receipts";
import { isMixedTaxReceipt, taxRateFromReceipt } from "@/lib/tax";

/*
 * 続けて撮ったレシートを、人が確かめずに保存するときの中身と「要確認か」。
 * Firebase を読まない純粋な計算にして、テストできるように分けてある（保存は batchReceipt.ts）。
 */

/** 読み取りの結果を、保存する中身と「要確認か」にする。画面を通さないので、1枚ずつの登録の判定と同じ考えで決める */
export function fieldsFromRead(result: ReceiptReadResult, today: string): { fields: ReceiptFields; needsReview: boolean } {
  if (!result.ok) {
    return {
      fields: {
        expenseDate: today,
        storeName: "",
        amount: 0,
        taxRate: 10,
        taxable10Amount: 0,
        taxable8Amount: 0,
        taxFreeAmount: 0,
        category: DEFAULT_CATEGORY,
        memo: "",
      },
      needsReview: true,
    };
  }
  const bucketSum = result.taxable10Amount + result.taxable8Amount + result.taxFreeAmount;
  const mixed = isMixedTaxReceipt(result.taxable10Amount, result.taxable8Amount, result.taxFreeAmount);
  // 混ざっているのに内訳が合計と合わない／AI が混在を見つけたのに内訳が読めていない → 人が見ないと税抜がずれる
  const taxUnclear = (mixed && Math.abs(bucketSum - result.totalAmount) > 2)
    || (result.hasMultipleTaxRates && !mixed && bucketSum !== result.totalAmount);
  const category = (EXPENSE_CATEGORIES as readonly string[]).includes(result.category) ? result.category : DEFAULT_CATEGORY;
  return {
    fields: {
      expenseDate: result.date || today,
      storeName: result.storeName,
      amount: result.totalAmount,
      taxRate: taxRateFromReceipt(result.taxable10Amount, result.taxable8Amount, result.taxFreeAmount),
      taxable10Amount: mixed ? result.taxable10Amount : 0,
      taxable8Amount: mixed ? result.taxable8Amount : 0,
      taxFreeAmount: mixed ? result.taxFreeAmount : 0,
      category,
      memo: "",
    },
    needsReview: !result.storeName || !result.date || result.totalAmount <= 0 || taxUnclear,
  };
}
