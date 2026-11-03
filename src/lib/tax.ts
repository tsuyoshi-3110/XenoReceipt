/*
 * 消費税の区分から税抜を出す計算。
 * 元は ProcMana の sharedContracts/siteExpenses.ts（2026-11-03 に写した）。
 */

export const TAX_RATES = [10, 8, 0] as const;

export function taxLabel(rate: number): string {
  if (rate === 8) return "軽減8%";
  if (rate === 0) return "対象外";
  return "10%";
}

/** 読めなかった区分は 0 として扱う（負数・NaN も 0） */
function positiveAmount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

export function exTax(amountIncTax: number, taxRate = 10): number {
  return Math.round(amountIncTax / (1 + taxRate / 100));
}

/**
 * 1件の税抜額。区分が2つ以上読めていて合計と合えば、区分ごとに割って足す。
 * まとめて割ると、少ないほうの税率のぶんだけずれる（資材3,300＋お茶1,080なら18円）。
 * 非課税・不課税の区分は割らずにそのまま足す。
 */
export function exTaxOf(
  amount: number,
  taxRate: number,
  taxable10Amount = 0,
  taxable8Amount = 0,
  taxFreeAmount = 0,
): number {
  const ten = positiveAmount(taxable10Amount);
  const eight = positiveAmount(taxable8Amount);
  const free = positiveAmount(taxFreeAmount);
  const kinds = (ten > 0 ? 1 : 0) + (eight > 0 ? 1 : 0) + (free > 0 ? 1 : 0);
  // 丸めで区分ごとに±1円出ることがあるので、合計とのずれは2円まで許す
  if (kinds >= 2 && Math.abs(ten + eight + free - Math.round(amount)) <= 2) {
    return exTax(ten, 10) + exTax(eight, 8) + free;
  }
  return exTax(amount, taxRate);
}

/** 区分の対象額から、この1件を何%として見せるか。混ざっていれば多いほう。読めなければ 10 */
export function taxRateFromReceipt(taxable10Amount: number, taxable8Amount: number, taxFreeAmount = 0): number {
  const ten = positiveAmount(taxable10Amount);
  const eight = positiveAmount(taxable8Amount);
  const free = positiveAmount(taxFreeAmount);
  if (ten === 0 && eight === 0 && free === 0) return 10;
  if (free > ten && free > eight) return 0;
  return eight > ten ? 8 : 10;
}

/** 区分が2つ以上印字されているか。レジ袋5円（非課税）が付くだけで2区分になる */
export function isMixedTaxReceipt(taxable10Amount: number, taxable8Amount: number, taxFreeAmount = 0): boolean {
  const kinds = (positiveAmount(taxable10Amount) > 0 ? 1 : 0)
    + (positiveAmount(taxable8Amount) > 0 ? 1 : 0)
    + (positiveAmount(taxFreeAmount) > 0 ? 1 : 0);
  return kinds >= 2;
}
