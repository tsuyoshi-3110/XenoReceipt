import { UNSET_CATEGORY } from "@/lib/categories";
import { receiptExTax, type Receipt } from "@/lib/receipts";

export type CategoryTotal = { category: string; count: number; amount: number; exTax: number };

/** 費目ごとの件数と合計。多い順。空の費目は「未設定」にまとめる */
export function totalsByCategory(receipts: Receipt[]): CategoryTotal[] {
  const map = new Map<string, CategoryTotal>();
  for (const receipt of receipts) {
    const key = receipt.category || UNSET_CATEGORY;
    const row = map.get(key) ?? { category: key, count: 0, amount: 0, exTax: 0 };
    row.count += 1;
    row.amount += receipt.amount;
    row.exTax += receiptExTax(receipt);
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

/** 一覧・書き出しの並び。利用日の古い順（帳簿と同じ向き） */
export function chronological(receipts: Receipt[]): Receipt[] {
  return [...receipts].sort((a, b) => a.expenseDate.localeCompare(b.expenseDate) || a.storeName.localeCompare(b.storeName, "ja"));
}
