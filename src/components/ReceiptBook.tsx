"use client";

import { sendEmailVerification, signOut, type User } from "firebase/auth";
import { Camera, ChevronLeft, ChevronRight, FileSpreadsheet, FileText, Loader2, Plus, Sparkles, Trash2, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { FileDropOverlay } from "@/components/FileDropOverlay";
import { ReceiptForm } from "@/components/ReceiptForm";
import { ReceiptReview } from "@/components/ReceiptReview";
import { ReceiptScanner } from "@/components/ReceiptScanner";
import { useDesktopPointer } from "@/components/useDesktopPointer";
import { useFileDrop } from "@/components/useFileDrop";
import { UNSET_CATEGORY } from "@/lib/categories";
import { exportReceiptsExcel } from "@/lib/exportExcel";
import { exportReceiptsPdf } from "@/lib/exportPdf";
import { auth } from "@/lib/firebaseClient";
import { formatYen, monthLabel, shiftMonth, shortDate } from "@/lib/format";
import { isPdfFile, todayLocal } from "@/lib/receiptImage";
import { deleteReceipt, listReceipts, receiptExTax, type Receipt } from "@/lib/receipts";
import { isScannerAvailable } from "@/lib/receiptScan";
import { chronological, totalsByCategory } from "@/lib/summary";

type FormState = { editing: Receipt | null; file: File | null } | null;

/** 月ごとのレシートの一覧。登録・直す・消す・Excel / PDF の書き出しはここから */
export function ReceiptBook({ user }: { user: User }) {
  const [month, setMonth] = useState(() => todayLocal().slice(0, 7));
  const [receipts, setReceipts] = useState<Receipt[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState<FormState>(null);
  const [exporting, setExporting] = useState("");
  const [exportError, setExportError] = useState("");
  const [quota, setQuota] = useState<{ used: number; limit: number } | null>(null);
  /** スキャナを開いているか。開いているあいだに撮った写真（「完了」で読み取りへ回す） */
  const [scanning, setScanning] = useState(false);
  const [shots, setShots] = useState<File[]>([]);
  /** スキャナを開けなかった理由。出したうえで、写真を選ぶほうへ回す */
  const [scanError, setScanError] = useState("");
  /** 2枚以上を読み取って確かめる画面に渡す写真 */
  const [reviewFiles, setReviewFiles] = useState<File[] | null>(null);
  /**
   * まとめて保存した枚数を、月ごとに。一覧は月ごとなので、ほかの月の日付のものはいま見ている月に出ない。
   * 小さな文で知らせていたら気づかれず「1件しか登録されていない」と思われた（2026-11-03）ので、画面の上にはっきり出す。
   */
  const [savedSummary, setSavedSummary] = useState<{ month: string; count: number }[] | null>(null);
  const pickRef = useRef<HTMLInputElement | null>(null);
  /**
   * メールアドレスとパスワードで登録して、まだ確認メールのリンクを押していないか。
   * 確認が済むまでサーバーが AI の読み取りを断るので、ここで先に知らせる（手で入れての登録はできる）。
   */
  const [unverified, setUnverified] = useState(() => user.providerData.some((p) => p.providerId === "password") && !user.emailVerified);
  const [verifyNote, setVerifyNote] = useState("");
  const desktop = useDesktopPointer();

  const load = useCallback(async () => {
    setLoadError("");
    try {
      setReceipts(await listReceipts(user.uid, month));
    } catch {
      setReceipts([]);
      setLoadError("一覧を読み込めませんでした。通信を確かめて、開き直してください。");
    }
  }, [user.uid, month]);

  const loadQuota = useCallback(async () => {
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/receipt-extract", { headers: { authorization: `Bearer ${token}` } });
      const data = (await response.json()) as { ok?: boolean; quota?: { used: number; limit: number } };
      if (data.ok && data.quota) setQuota(data.quota);
    } catch {
      // 残りの回数は目安なので、読めなくても一覧は出す
    }
  }, [user]);

  useEffect(() => {
    // 月を切り替えたら前の月の一覧を消してから読み込む（違う月の行が一瞬残らないように）
    queueMicrotask(() => { setReceipts(null); void load(); });
  }, [load]);
  useEffect(() => { queueMicrotask(() => { void loadQuota(); }); }, [loadQuota]);

  /**
   * 撮った・選んだ写真を受け取る。1枚なら今までの確認画面（読み取って、確かめて登録）、
   * 2枚以上なら、まとめて読み取って一覧で確かめる画面へ。どちらも人が保存を押すまで保存しない。
   */
  const takeFiles = (files: File[]) => {
    const usable = files.filter((item) => item.type.startsWith("image/") || isPdfFile(item));
    if (usable.length === 1) setForm({ editing: null, file: usable[0] });
    else if (usable.length > 1) setReviewFiles(usable);
  };

  // 一覧へレシートの画像・PDF をドラッグしたら取り込む（PC）
  const drop = useFileDrop(takeFiles, form === null && !scanning && reviewFiles === null);

  const reviewCount = (receipts ?? []).filter((r) => r.needsReview).length;

  const rows = receipts ? chronological(receipts) : [];
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  const totalExTax = rows.reduce((sum, r) => sum + receiptExTax(r), 0);

  async function runExport(kind: "excel" | "pdf") {
    if (!receipts || receipts.length === 0) return;
    setExportError("");
    setExporting(kind === "excel" ? "Excel を作っています…" : "PDF を作っています…");
    try {
      if (kind === "excel") await exportReceiptsExcel(month, receipts);
      else await exportReceiptsPdf(month, receipts, setExporting);
    } catch {
      setExportError(kind === "excel" ? "Excel を作れませんでした。" : "PDF を作れませんでした。");
    } finally {
      setExporting("");
    }
  }

  return <main className="relative mx-auto min-h-dvh max-w-3xl px-4 pb-24 pt-6" {...drop.handlers}>
    {drop.dragging && <FileDropOverlay label="ここで離すと、レシートを取り込みます" rounded="rounded-none" />}

    <header className="flex items-center justify-between gap-3">
      <h1 className="text-lg font-bold">XenoReceipt</h1>
      <div className="flex items-center gap-3 text-xs text-slate-500">
        {quota && <span className="flex items-center gap-1"><Sparkles size={12} />今月の読み取り 残り {Math.max(0, quota.limit - quota.used)}回</span>}
        <button type="button" className="underline" onClick={() => void signOut(auth)}>ログアウト</button>
      </div>
    </header>

    {unverified && <section className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="font-bold">メールアドレスの確認がまだです</p>
      <p className="mt-1 text-xs">{user.email} に届いたメールのリンクを押すと、AI の読み取りが使えるようになります。それまでも、手で入れて登録はできます。</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="xr-secondary min-h-0 px-3 py-1.5 text-xs" onClick={() => {
          // リンクを押したあとは、読み直さないと確認済みにならない。新しい鍵も取り直して、サーバーにも確認済みを伝える
          void user.reload().then(() => user.getIdToken(true)).then(() => {
            if (user.emailVerified) { setUnverified(false); setVerifyNote(""); void loadQuota(); }
            else setVerifyNote("まだ確認できていません。メールのリンクを押してから、もう一度押してください。");
          }).catch(() => setVerifyNote("確かめられませんでした。通信を確かめてください。"));
        }}>リンクを押した</button>
        <button type="button" className="xr-secondary min-h-0 px-3 py-1.5 text-xs" onClick={() => {
          void sendEmailVerification(user).then(() => setVerifyNote("確認のメールを送り直しました。迷惑メールのフォルダも見てください。"))
            .catch(() => setVerifyNote("送れませんでした。少し待ってからお試しください。"));
        }}>メールを送り直す</button>
      </div>
      {verifyNote && <p className="mt-2 text-xs font-semibold">{verifyNote}</p>}
    </section>}

    {savedSummary && <section className="mt-5 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
      <div className="flex items-start justify-between gap-2">
        <p className="font-bold">
          {savedSummary.reduce((sum, row) => sum + row.count, 0)}枚 保存しました：
          {savedSummary.map((row) => `${monthLabel(row.month)}に${row.count}枚`).join("・")}
        </p>
        <button type="button" className="shrink-0 text-xs text-blue-700 underline" onClick={() => setSavedSummary(null)}>閉じる</button>
      </div>
      {savedSummary.some((row) => row.month !== month) && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span>一覧は月ごとです。ほかの月の分はその月を開くと見られます。</span>
        {savedSummary.filter((row) => row.month !== month).map((row) => <button key={row.month} type="button" className="xr-secondary min-h-0 px-3 py-1.5 text-xs" onClick={() => setMonth(row.month)}>{monthLabel(row.month)}を見る</button>)}
      </div>}
    </section>}

    <section className="mt-5 rounded-2xl bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <button type="button" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="前の月" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={18} /></button>
        <p className="text-base font-bold">{monthLabel(month)}</p>
        <button type="button" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="次の月" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={18} /></button>
      </div>
      <div className="mt-3 text-center">
        <p className="text-2xl font-bold tabular-nums">{formatYen(total)}</p>
        <p className="mt-1 text-xs text-slate-500">{rows.length}件・税抜 {formatYen(totalExTax)}</p>
        {reviewCount > 0 && <p className="mt-1 text-xs font-semibold text-amber-700">要確認 {reviewCount}件（押して確かめると消えます）</p>}
      </div>
      {rows.length > 0 && <table className="mt-4 w-full text-sm">
        <tbody>
          {totalsByCategory(rows).map((row) => <tr key={row.category} className="border-t border-slate-100">
            <td className={`py-1.5 ${row.category === UNSET_CATEGORY ? "text-slate-400" : ""}`}>{row.category}</td>
            <td className="py-1.5 text-right text-xs text-slate-400">{row.count}件</td>
            <td className="w-28 py-1.5 text-right tabular-nums">{formatYen(row.amount)}</td>
          </tr>)}
        </tbody>
      </table>}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" className="xr-secondary" disabled={!rows.length || !!exporting} onClick={() => void runExport("excel")}><FileSpreadsheet size={16} />Excel</button>
        <button type="button" className="xr-secondary" disabled={!rows.length || !!exporting} onClick={() => void runExport("pdf")}><FileText size={16} />PDF</button>
      </div>
      {exporting && <p className="mt-2 flex items-center justify-end gap-1.5 text-xs text-slate-500"><Loader2 size={12} className="animate-spin" />{exporting}</p>}
      {exportError && <p className="mt-2 text-right text-xs font-semibold text-red-600">{exportError}</p>}
    </section>



    <section className="mt-5 overflow-hidden rounded-2xl bg-white shadow-sm">
      {receipts === null
        ? <p className="flex items-center justify-center gap-2 p-8 text-sm text-slate-400"><Loader2 size={16} className="animate-spin" />読み込み中…</p>
        : rows.length === 0
          ? <p className="p-8 text-center text-sm text-slate-400">{loadError || "この月のレシートはまだありません。下のボタンから撮るか、この画面へ画像・PDF をドラッグしてください。"}</p>
          : <ul>
            {rows.map((receipt) => <li key={receipt.id} className="flex items-center gap-3 border-t border-slate-100 px-4 py-3 first:border-t-0">
              <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setForm({ editing: receipt, file: null })}>
                <span className="w-10 shrink-0 text-xs tabular-nums text-slate-500">{shortDate(receipt.expenseDate)}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    {receipt.needsReview && <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800"><TriangleAlert size={10} />要確認</span>}
                    <span className={`truncate text-sm font-semibold ${receipt.storeName ? "" : "text-slate-400"}`}>{receipt.storeName || "（店名が読めませんでした）"}</span>
                  </span>
                  <span className={`block text-xs ${receipt.category ? "text-slate-500" : "text-slate-400"}`}>{receipt.category || UNSET_CATEGORY}{receipt.memo && `・${receipt.memo}`}</span>
                </span>
                <span className="shrink-0 text-sm font-bold tabular-nums">{formatYen(receipt.amount)}</span>
              </button>
              <button
                type="button"
                className="rounded-lg p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-600"
                aria-label={`${receipt.storeName} を消す`}
                onClick={() => {
                  if (!window.confirm(`${receipt.expenseDate} ${receipt.storeName} ${formatYen(receipt.amount)} を消します。写真も消え、元に戻せません。`)) return;
                  void deleteReceipt(user.uid, receipt).then(load).catch(() => setLoadError("消せませんでした。もう一度お試しください。"));
                }}
              ><Trash2 size={15} /></button>
            </li>)}
          </ul>}
    </section>

    <div className="fixed inset-x-0 bottom-0 bg-gradient-to-t from-[var(--background)] via-[var(--background)] to-transparent px-4 pb-5 pt-8">
      {/* 撮りためた写真から選ぶ（スキャナの「写真から」・スキャナが使えない端末）。1枚でも何枚でも */}
      <input ref={pickRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(event) => { const picked = [...(event.target.files ?? [])]; event.target.value = ""; setScanning(false); takeFiles([...shots, ...picked]); setShots([]); }} />
      {scanError && <p className="mx-auto mb-2 max-w-sm rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">{scanError}　写真を選んで取り込めます。</p>}
      <div className="mx-auto flex max-w-sm">
        {desktop
          ? <button type="button" className="xr-primary flex-1 justify-center shadow-lg" onClick={() => setForm({ editing: null, file: null })}><Plus size={18} />レシートを登録</button>
          : <button
            type="button"
            className="xr-primary flex-1 justify-center shadow-lg"
            onClick={() => {
              // 押した流れのまま開く。開けない端末（http・古い端末）は写真を選ぶほうへ
              if (!scanError && isScannerAvailable()) { setShots([]); setScanning(true); return; }
              pickRef.current?.click();
            }}
          ><Camera size={18} />レシートを撮る</button>}
      </div>
    </div>

    {/* 1枚でも何枚でも撮って「完了」。撮っているあいだは読み取らない */}
    {scanning && <ReceiptScanner
      continuous
      capturedCount={shots.length}
      onCapture={(file) => setShots((list) => [...list, file])}
      onPickPhotos={() => pickRef.current?.click()}
      onClose={() => { setScanning(false); takeFiles(shots); setShots([]); }}
      onUnavailable={(reason) => {
        // 権限拒否など。ここから input.click() しても iOS は操作と認めないので、押してもらう案内を出す
        setScanning(false);
        setScanError(reason);
      }}
    />}

    {reviewFiles && <ReceiptReview
      uid={user.uid}
      files={reviewFiles}
      onClose={() => { setReviewFiles(null); void loadQuota(); }}
      onSaved={(dates) => {
        setReviewFiles(null);
        void loadQuota();
        const counts = new Map<string, number>();
        for (const date of dates) counts.set(date.slice(0, 7), (counts.get(date.slice(0, 7)) ?? 0) + 1);
        // 新しい月から並べる
        setSavedSummary([...counts].map(([m, count]) => ({ month: m, count })).sort((a, b) => b.month.localeCompare(a.month)));
        void load();
      }}
    />}

    {form && <ReceiptForm
      uid={user.uid}
      editing={form.editing}
      initialFile={form.file}
      onClose={() => { setForm(null); void loadQuota(); }}
      onSaved={(expenseDate) => {
        setForm(null);
        void loadQuota();
        // 別の月の日付で登録したら、その月へ移る（今の月に出ず、消えたように見えないように）
        const savedMonth = expenseDate.slice(0, 7);
        if (savedMonth !== month) setMonth(savedMonth);
        else void load();
      }}
    />}
  </main>;
}
