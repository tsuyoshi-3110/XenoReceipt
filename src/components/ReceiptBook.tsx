"use client";

import { signOut, type User } from "firebase/auth";
import { Camera, ChevronLeft, ChevronRight, FileSpreadsheet, FileText, Images, Loader2, Plus, Sparkles, Trash2, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { FileDropOverlay } from "@/components/FileDropOverlay";
import { ReceiptForm } from "@/components/ReceiptForm";
import { ReceiptScanner } from "@/components/ReceiptScanner";
import { useDesktopPointer } from "@/components/useDesktopPointer";
import { useFileDrop } from "@/components/useFileDrop";
import { useReceiptQueue } from "@/components/useReceiptQueue";
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
  /** 続けて撮るスキャナを開いているか。開いているあいだに撮った枚数 */
  const [scanning, setScanning] = useState(false);
  const [shots, setShots] = useState(0);
  /** スキャナを開けなかった理由。出したうえで、写真を選ぶほうへ回す */
  const [scanError, setScanError] = useState("");
  /** 続けて保存したうち、いま見ている月ではない日付だったもの。消えたように見えないよう知らせる */
  const [otherMonths, setOtherMonths] = useState<string[]>([]);
  const pickRef = useRef<HTMLInputElement | null>(null);
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

  // 続けて撮った（まとめて取り込んだ）レシートは裏で順に読んで保存する。1枚終わるごとに一覧を読み直す
  const batch = useReceiptQueue(user.uid, (saved) => {
    const savedMonth = saved.expenseDate.slice(0, 7);
    if (savedMonth === month) void load();
    else setOtherMonths((list) => (list.includes(savedMonth) ? list : [...list, savedMonth]));
  });

  /*
   * 一覧へレシートの画像・PDF をドラッグしたら取り込む。
   * 1枚なら登録の画面を開いて確かめながら、何枚もまとめてなら続けて撮ったときと同じく裏で保存する。
   */
  const drop = useFileDrop((files) => {
    const receiptsDropped = files.filter((item) => item.type.startsWith("image/") || isPdfFile(item));
    if (receiptsDropped.length === 1) setForm({ editing: null, file: receiptsDropped[0] });
    else batch.add(receiptsDropped);
  }, form === null && !scanning);

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

    {(batch.waiting > 0 || batch.saved > 0 || batch.failed > 0) && <section className="mt-5 rounded-2xl bg-white p-4 text-sm shadow-sm">
      {batch.waiting > 0
        ? <p className="flex items-center gap-2 font-semibold"><Loader2 size={15} className="animate-spin text-[var(--brand)]" />読み取って保存しています（残り {batch.waiting}枚）</p>
        : <div className="flex items-center justify-between gap-2">
          <p className="font-semibold">{batch.saved}枚 保存しました{batch.review > 0 && <span className="text-amber-700">（要確認 {batch.review}枚）</span>}</p>
          {batch.failed === 0 && <button type="button" className="text-xs text-slate-500 underline" onClick={() => { batch.dismiss(); setOtherMonths([]); }}>閉じる</button>}
        </div>}
      {otherMonths.length > 0 && <p className="mt-1 text-xs text-slate-500">
        レシートの日付が {otherMonths.map(monthLabel).join("・")} のものは、その月に入りました。
        {otherMonths.map((m) => <button key={m} type="button" className="ml-2 font-semibold text-blue-700 underline" onClick={() => setMonth(m)}>{monthLabel(m)}を見る</button>)}
      </p>}
      {batch.failed > 0 && <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
        <span>{batch.failed}枚 保存できませんでした。写真は残っています。</span>
        <button type="button" className="xr-secondary min-h-0 py-1.5" disabled={batch.waiting > 0} onClick={batch.retry}>もう一度</button>
      </div>}
    </section>}

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
      {/* 写真をまとめて選ぶ（スキャナが使えない端末・撮りためた写真から）。選んだ分は続けて撮ったときと同じく裏で保存する */}
      <input ref={pickRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(event) => { batch.add([...(event.target.files ?? [])]); event.target.value = ""; }} />
      {scanError && <p className="mx-auto mb-2 max-w-sm rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">{scanError}　写真を選んで取り込めます。</p>}
      <div className="mx-auto flex max-w-sm gap-2">
        {desktop
          ? <button type="button" className="xr-primary flex-1 justify-center shadow-lg" onClick={() => setForm({ editing: null, file: null })}><Plus size={18} />レシートを登録</button>
          : <>
            <button
              type="button"
              className="xr-primary flex-1 justify-center shadow-lg"
              onClick={() => {
                // 押した流れのまま開く。開けない端末（http・古い端末）は写真を選ぶほうへ
                if (!scanError && isScannerAvailable()) { setShots(0); setScanning(true); return; }
                pickRef.current?.click();
              }}
            ><Camera size={18} />続けて撮る</button>
            <button type="button" className="xr-secondary justify-center shadow-lg" onClick={() => pickRef.current?.click()} aria-label="写真から選ぶ"><Images size={18} />写真から</button>
            <button type="button" className="xr-secondary justify-center shadow-lg" onClick={() => setForm({ editing: null, file: null })} aria-label="1枚だけ確かめながら登録"><Plus size={18} />1枚</button>
          </>}
      </div>
    </div>

    {scanning && <ReceiptScanner
      continuous
      capturedCount={shots}
      onCapture={(file) => { setShots((n) => n + 1); batch.add([file]); }}
      onClose={() => { setScanning(false); void loadQuota(); }}
      onUnavailable={(reason) => {
        // 権限拒否など。ここから input.click() しても iOS は操作と認めないので、押してもらう案内を出す
        setScanning(false);
        setScanError(reason);
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
