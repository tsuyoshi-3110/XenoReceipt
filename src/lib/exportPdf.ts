"use client";

import type { PDFFont, PDFPage } from "pdf-lib";

import { UNSET_CATEGORY } from "@/lib/categories";
import { download } from "@/lib/exportExcel";
import { formatYen, monthLabel } from "@/lib/format";
import { receiptExTax, receiptImageBlob, type Receipt } from "@/lib/receipts";
import { chronological, totalsByCategory } from "@/lib/summary";

/*
 * 月のレシートを PDF にする。経費精算や税理士への提出にそのまま渡せる形。
 *   1. 表紙：月の合計と費目ごとの合計
 *   2. 明細の表（ページをまたいで続く）
 *   3. 写真：1ページに2枚。写真の上に利用日・支払先・金額を添える
 * A4縦。単位は pt。
 */

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

/** 明細の列。右寄せの列は金額 */
const COLUMNS = [
  { label: "利用日", width: 64, right: false },
  { label: "支払先", width: 200, right: false },
  { label: "費目", width: 82, right: false },
  { label: "金額（税込）", width: 84, right: true },
  { label: "税抜", width: 85.28, right: true },
] as const;

/** 幅に収まるところまで切り、はみ出すなら「…」を付ける */
function fit(font: PDFFont, text: string, size: number, width: number): string {
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  let cut = text;
  while (cut.length > 0 && font.widthOfTextAtSize(`${cut}…`, size) > width) cut = cut.slice(0, -1);
  return `${cut}…`;
}

export async function exportReceiptsPdf(month: string, receipts: Receipt[], onProgress?: (message: string) => void): Promise<void> {
  const [{ PDFDocument, rgb }, fontkitModule] = await Promise.all([import("pdf-lib"), import("@pdf-lib/fontkit")]);
  const fontkit = "default" in fontkitModule ? fontkitModule.default : fontkitModule;

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit as never);
  const fontRes = await fetch("/fonts/NotoSansJP-Pdf-Regular.ttf");
  if (!fontRes.ok) throw new Error("PDF用のフォントを読み込めませんでした。");
  // subset: true は使わない。pdf-lib のサブセット化は日本語で壊れ、字の大半が抜ける（ProcNova と同じ）
  const font = await pdf.embedFont(await fontRes.arrayBuffer(), { subset: false });

  const ink = rgb(0.06, 0.09, 0.16);
  const muted = rgb(0.4, 0.45, 0.52);
  const rule = rgb(0.85, 0.87, 0.9);
  const rows = chronological(receipts);
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  const totalExTax = rows.reduce((sum, r) => sum + receiptExTax(r), 0);

  const text = (page: PDFPage, value: string, x: number, y: number, size: number, color = ink) =>
    page.drawText(value, { x, y, size, font, color });
  const textRight = (page: PDFPage, value: string, right: number, y: number, size: number, color = ink) =>
    text(page, value, right - font.widthOfTextAtSize(value, size), y, size, color);
  const line = (page: PDFPage, y: number) =>
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.5, color: rule });

  // 1. 表紙
  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN - 20;
  text(page, `レシート ${monthLabel(month)}`, MARGIN, y, 20);
  y -= 34;
  text(page, `${rows.length}件`, MARGIN, y, 11, muted);
  textRight(page, `合計 ${formatYen(total)}（税抜 ${formatYen(totalExTax)}）`, PAGE_WIDTH - MARGIN, y, 13);
  y -= 30;
  text(page, "費目別", MARGIN, y, 11, muted);
  y -= 8;
  line(page, y);
  for (const row of totalsByCategory(rows)) {
    y -= 20;
    text(page, row.category, MARGIN, y, 10.5);
    textRight(page, `${row.count}件`, MARGIN + 300, y, 10.5, muted);
    textRight(page, formatYen(row.amount), PAGE_WIDTH - MARGIN, y, 10.5);
    y -= 7;
    line(page, y);
  }

  // 2. 明細
  const ROW_HEIGHT = 20;
  const drawHeader = () => {
    let x = MARGIN;
    for (const column of COLUMNS) {
      if (column.right) textRight(page, column.label, x + column.width - 4, y, 9, muted);
      else text(page, column.label, x + 4, y, 9, muted);
      x += column.width;
    }
    y -= 7;
    line(page, y);
  };
  y -= 36;
  text(page, "明細", MARGIN, y, 11, muted);
  y -= 20;
  drawHeader();
  for (const receipt of rows) {
    if (y - ROW_HEIGHT < MARGIN) {
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN - 10;
      drawHeader();
    }
    y -= ROW_HEIGHT - 7;
    const cells = [
      receipt.expenseDate,
      receipt.storeName,
      receipt.category || UNSET_CATEGORY,
      formatYen(receipt.amount),
      formatYen(receiptExTax(receipt)),
    ];
    let x = MARGIN;
    COLUMNS.forEach((column, index) => {
      const value = fit(font, cells[index], 9.5, column.width - 8);
      if (column.right) textRight(page, value, x + column.width - 4, y, 9.5);
      else text(page, value, x + 4, y, 9.5);
      x += column.width;
    });
    y -= 7;
    line(page, y);
  }

  // 3. 写真。1ページに2枚
  const withImage = rows.filter((r) => r.imagePath);
  const SLOT_HEIGHT = (PAGE_HEIGHT - MARGIN * 2 - 20) / 2;
  for (let index = 0; index < withImage.length; index += 1) {
    const receipt = withImage[index];
    onProgress?.(`写真を貼っています（${index + 1}/${withImage.length}）`);
    if (index % 2 === 0) page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const top = PAGE_HEIGHT - MARGIN - (index % 2) * (SLOT_HEIGHT + 20);
    const caption = `${receipt.expenseDate}　${receipt.storeName}　${formatYen(receipt.amount)}`;
    text(page, fit(font, caption, 10, CONTENT_WIDTH), MARGIN, top - 10, 10);
    let image;
    try {
      image = await pdf.embedJpg(await (await receiptImageBlob(receipt.imagePath)).arrayBuffer());
    } catch {
      // 写真が読めなくても PDF は止めない。読めなかったことを、その場所に書いておく
      text(page, "（写真を読み込めませんでした）", MARGIN, top - 34, 10, muted);
      continue;
    }
    const boxHeight = SLOT_HEIGHT - 24;
    const scale = Math.min(CONTENT_WIDTH / image.width, boxHeight / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    page.drawImage(image, { x: MARGIN + (CONTENT_WIDTH - width) / 2, y: top - 20 - height, width, height });
  }

  const bytes = await pdf.save();
  download(new Blob([bytes as BlobPart], { type: "application/pdf" }), `レシート_${monthLabel(month)}.pdf`);
}
