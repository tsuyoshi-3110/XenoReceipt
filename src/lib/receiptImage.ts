"use client";

import { auth } from "@/lib/firebaseClient";
import { loadPdfjs } from "@/lib/pdfjs";

/*
 * 撮った・選んだレシートを、読み取りと保存に使う JPEG にそろえる。
 * 元は ProcMana の siteExpenseEntry.ts（2026-11-03 に写した）。
 */

/** 保存する画像の長辺。スマホの写真をそのまま上げると重く、これで十分に文字が読める */
const RECEIPT_MAX_SIDE = 1600;

/** PDF か。拡張子でも見る（端末によっては type が空で届く） */
export function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

/** 画像なら EXIF の向きを反映して長辺を制限、PDF なら1ページ目を描いて JPEG にする */
export async function normalizeReceiptImage(file: File): Promise<Blob> {
  if (isPdfFile(file)) return renderPdfReceipt(file);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("この画像は読み込めませんでした。JPEG・PNG・PDFでお試しください。");
  }
  const scale = Math.min(1, RECEIPT_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画像の変換に失敗しました。");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvasToJpeg(canvas, "画像の変換に失敗しました。");
}

async function renderPdfReceipt(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const pdfjs = await loadPdfjs();
    const pdf = await pdfjs.getDocument({ url }).promise;
    try {
      const page = await pdf.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: RECEIPT_MAX_SIDE / Math.max(base.width, base.height) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("PDFの変換に失敗しました。");
      // 透明な背景のままだと JPEG で黒くなるので、紙の白を敷いてから描く
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      return await canvasToJpeg(canvas, "PDFの変換に失敗しました。");
    } finally {
      await pdf.destroy();
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("PDFの変換")) throw error;
    throw new Error("このPDFは読み込めませんでした。パスワード付きのPDFは、画像で保存してからお試しください。");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToJpeg(canvas: HTMLCanvasElement, message: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(message))), "image/jpeg", 0.85);
  });
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("画像を読み込めませんでした。"));
    reader.readAsDataURL(blob);
  });
}

export type ReceiptReadResult =
  | {
    ok: true;
    storeName: string;
    date: string;
    totalAmount: number;
    taxable10Amount: number;
    taxable8Amount: number;
    taxFreeAmount: number;
    hasMultipleTaxRates: boolean;
    category: string;
  }
  /** 読み取れなかった。画面は撮った写真を持ったまま手入力に倒れる */
  | { ok: false; message: string };

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/** 今日を YYYY-MM-DD へ。toISOString は UTC 基準で、日本時間の朝9時前だと前日になる */
export function todayLocal(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * レシートを AI で読む。どんな失敗でも例外を投げずに ok:false を返す。
 * AI は補助で、登録が AI の生死に引きずられてはいけない。
 */
export async function readReceipt(imageDataUrl: string, categories: readonly string[]): Promise<ReceiptReadResult> {
  const fallback = "読み取りできませんでした。手動で入力してください。";
  try {
    const token = await auth.currentUser?.getIdToken();
    const response = await fetch("/api/receipt-extract", {
      method: "POST",
      headers: { "Content-Type": "application/json", authorization: `Bearer ${token ?? ""}` },
      body: JSON.stringify({ image: imageDataUrl, today: todayLocal(), categories }),
    });
    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!data || data.ok !== true) return { ok: false, message: text(data?.error) || fallback };
    return {
      ok: true,
      storeName: text(data.storeName),
      date: text(data.date),
      totalAmount: num(data.totalAmount),
      taxable10Amount: num(data.taxable10Amount),
      taxable8Amount: num(data.taxable8Amount),
      taxFreeAmount: num(data.taxFreeAmount),
      hasMultipleTaxRates: data.hasMultipleTaxRates === true,
      category: text(data.category),
    };
  } catch {
    return { ok: false, message: fallback };
  }
}
