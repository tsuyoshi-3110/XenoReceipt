"use client";

import { UNSET_CATEGORY } from "@/lib/categories";
import { monthLabel } from "@/lib/format";
import { receiptExTax, type Receipt } from "@/lib/receipts";
import { chronological, totalsByCategory } from "@/lib/summary";
import { taxLabel } from "@/lib/tax";

/**
 * 月のレシートを Excel にする。1枚目が明細、2枚目が費目ごとの合計。
 * 金額は数値のまま入れる（文字にすると Excel で足せない）。
 */
export async function exportReceiptsExcel(month: string, receipts: Receipt[]): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const book = new ExcelJS.Workbook();
  const yen = "#,##0";

  const detail = book.addWorksheet("明細");
  detail.columns = [
    { header: "利用日", key: "date", width: 12 },
    { header: "支払先", key: "store", width: 28 },
    { header: "費目", key: "category", width: 14 },
    { header: "金額（税込）", key: "amount", width: 14, style: { numFmt: yen } },
    { header: "税抜", key: "exTax", width: 12, style: { numFmt: yen } },
    { header: "税率", key: "rate", width: 10 },
    { header: "10%対象", key: "t10", width: 11, style: { numFmt: yen } },
    { header: "8%対象", key: "t8", width: 11, style: { numFmt: yen } },
    { header: "対象外", key: "free", width: 10, style: { numFmt: yen } },
    { header: "メモ", key: "memo", width: 30 },
  ];
  const rows = chronological(receipts);
  for (const receipt of rows) {
    const mixed = receipt.taxable10Amount + receipt.taxable8Amount + receipt.taxFreeAmount > 0;
    detail.addRow({
      date: receipt.expenseDate,
      store: receipt.storeName,
      category: receipt.category || UNSET_CATEGORY,
      amount: receipt.amount,
      exTax: receiptExTax(receipt),
      rate: mixed ? "混在" : taxLabel(receipt.taxRate),
      // 区分は混ざっているときだけ入る。単一税率なら空のままにする（0 と並べると読みにくい）
      t10: mixed ? receipt.taxable10Amount : null,
      t8: mixed ? receipt.taxable8Amount : null,
      free: mixed ? receipt.taxFreeAmount : null,
      memo: receipt.memo,
    });
  }
  const total = detail.addRow({
    store: "合計",
    amount: rows.reduce((sum, r) => sum + r.amount, 0),
    exTax: rows.reduce((sum, r) => sum + receiptExTax(r), 0),
  });
  total.font = { bold: true };
  detail.getRow(1).font = { bold: true };
  detail.views = [{ state: "frozen", ySplit: 1 }];

  const byCategory = book.addWorksheet("費目別");
  byCategory.columns = [
    { header: "費目", key: "category", width: 16 },
    { header: "件数", key: "count", width: 8 },
    { header: "金額（税込）", key: "amount", width: 14, style: { numFmt: yen } },
    { header: "税抜", key: "exTax", width: 14, style: { numFmt: yen } },
  ];
  for (const row of totalsByCategory(receipts)) byCategory.addRow(row);
  byCategory.getRow(1).font = { bold: true };

  const buffer = await book.xlsx.writeBuffer();
  download(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `レシート_${monthLabel(month)}.xlsx`);
}

export function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
