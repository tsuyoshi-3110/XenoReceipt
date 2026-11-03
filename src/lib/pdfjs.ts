"use client";

/*
 * pdf.js の読み込み。PDF の領収書（ネット注文・メールで届いたもの）を画像にするのに使う。
 *
 * pdfjs-dist 5.x は webpack 経由の import だと失敗するため、ProcMana・ProcNova と同じく
 * public/pdfjs/ に置いた本体をブラウザのネイティブ import で読む。
 * 版を上げるときは pdf.min.mjs / pdf.worker.min.mjs / cmaps/ / standard_fonts/ を同じ版で写し直すこと。
 */

type PdfViewport = { width: number; height: number };
type PdfPage = {
  getViewport(params: { scale: number }): PdfViewport;
  render(params: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport; canvas: HTMLCanvasElement }): { promise: Promise<void> };
};
export type PdfDocument = {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
  destroy(): Promise<void> | void;
};
type PdfJsModule = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(params: { url: string } | { data: Uint8Array }): { promise: Promise<PdfDocument> };
};

/** 日本語の文字の対応表（cMap）と、埋め込まれていない基本の字形。渡さないと日本語が消える PDF がある */
const PDF_FONT_OPTIONS = { cMapUrl: "/pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: "/pdfjs/standard_fonts/" };

let pdfjsPromise: Promise<PdfJsModule> | null = null;

export async function loadPdfjs(): Promise<PdfJsModule> {
  if (!pdfjsPromise) {
    const pdfjsSrc = "/pdfjs/pdf.min.mjs";
    pdfjsPromise = import(/* webpackIgnore: true */ /* turbopackIgnore: true */ pdfjsSrc).then((module: PdfJsModule) => {
      module.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
      return { ...module, getDocument: (params: Parameters<PdfJsModule["getDocument"]>[0]) => module.getDocument({ ...PDF_FONT_OPTIONS, ...params }) } as PdfJsModule;
    });
    // 読めなかったら次の機会にもう一度試す
    pdfjsPromise.catch(() => { pdfjsPromise = null; });
  }
  return pdfjsPromise;
}
