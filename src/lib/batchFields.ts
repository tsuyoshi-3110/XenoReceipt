import { DEFAULT_CATEGORY, EXPENSE_CATEGORIES } from "@/lib/categories";
import type { ReceiptReadResult } from "@/lib/receiptImage";
import type { ReceiptFields } from "@/lib/receipts";
import { isMixedTaxReceipt, taxRateFromReceipt } from "@/lib/tax";

/*
 * まとめて撮ったレシートの読み取り結果を、確かめる一覧に並べる中身にする。
 * 見てほしい1枚には理由（attention）を付けて目立たせる。Firebase を読まない純粋な計算にして、テストできるように分けてある。
 */

/** 読み取りの結果を、一覧に入れる中身と「見てほしい理由」にする。1枚ずつの登録の判定と同じ考えで決める */
export function fieldsFromRead(result: ReceiptReadResult, today: string): { fields: ReceiptFields; needsReview: boolean; attention: string } {
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
      attention: result.message || "読み取れませんでした。写真を見ながら入れてください。",
    };
  }
  const bucketSum = result.taxable10Amount + result.taxable8Amount + result.taxFreeAmount;
  const mixed = isMixedTaxReceipt(result.taxable10Amount, result.taxable8Amount, result.taxFreeAmount);
  // 混ざっているのに内訳が合計と合わない／AI が混在を見つけたのに内訳が読めていない → 人が見ないと税抜がずれる
  const taxUnclear = (mixed && Math.abs(bucketSum - result.totalAmount) > 2)
    || (result.hasMultipleTaxRates && !mixed && bucketSum !== result.totalAmount);
  const category = (EXPENSE_CATEGORIES as readonly string[]).includes(result.category) ? result.category : DEFAULT_CATEGORY;
  const missing = [!result.storeName && "店名", !result.date && "日付", result.totalAmount <= 0 && "合計"].filter(Boolean);
  const attention = missing.length > 0
    ? `${missing.join("・")}が読めませんでした。`
    : taxUnclear
      ? "税率が混ざっています。内訳が合計と合わないので「詳しく」で確かめてください。"
      : "";
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
    needsReview: attention !== "",
    attention,
  };
}
