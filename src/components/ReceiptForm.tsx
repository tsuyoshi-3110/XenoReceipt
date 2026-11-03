"use client";

import { Camera, Crop, Loader2, Receipt as ReceiptIcon, Sparkles, TriangleAlert, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AmountInput } from "@/components/AmountInput";
import { FileDropOverlay } from "@/components/FileDropOverlay";
import { ReceiptCropEditor, receiptSourceOf, type ReceiptSource } from "@/components/ReceiptCropEditor";
import { ReceiptScanner } from "@/components/ReceiptScanner";
import { useDesktopPointer } from "@/components/useDesktopPointer";
import { useFileDrop } from "@/components/useFileDrop";
import { EXPENSE_CATEGORIES } from "@/lib/categories";
import { formatYen } from "@/lib/format";
import { blobToDataUrl, isPdfFile, normalizeReceiptImage, readReceipt, todayLocal } from "@/lib/receiptImage";
import { createReceipt, receiptImageUrl, updateReceipt, type Receipt, type ReceiptFields } from "@/lib/receipts";
import { TAX_RATES, exTax, exTaxOf, isMixedTaxReceipt, taxLabel, taxRateFromReceipt } from "@/lib/tax";
import { isScannerAvailable } from "@/lib/receiptScan";

/**
 * レシートを1件入れる・直すダイアログ。ProcMana・ProcNova の経費登録と同じ流れ。
 * 撮る（選ぶ）と店名・利用日・合計・税の区分・費目が入り、目で確かめて保存する。
 *
 * 【AIは補助】読めなくても撮った写真は持ったまま手入力に倒す。写真なしの手入力だけでも保存できる。
 */

type Props = {
  uid: string;
  /** 直すとき。新規は null */
  editing: Receipt | null;
  /** 一覧へドラッグされたファイル。開いてすぐ読み取る */
  initialFile: File | null;
  /** 保存した利用日。一覧はその月へ移る */
  onSaved: (expenseDate: string) => void;
  onClose: () => void;
};

export function ReceiptForm({ uid, editing, initialFile, onSaved, onClose }: Props) {
  const [expenseDate, setExpenseDate] = useState(editing?.expenseDate || todayLocal());
  const [storeName, setStoreName] = useState(editing?.storeName ?? "");
  const [amount, setAmount] = useState(editing?.amount ?? 0);
  const [memo, setMemo] = useState(editing?.memo ?? "");
  // 費目は空から始める。AI が決めきれないレシートに関係ない費目が付くと、毎回直す手間になる
  const [category, setCategory] = useState(editing?.category ?? "");
  /** 費目を AI が選んだか。人が選び直したら消す */
  const [categorySuggested, setCategorySuggested] = useState(false);
  const [taxRate, setTaxRate] = useState(editing?.taxRate ?? 10);
  /*
   * 税率が混ざっているレシートの内訳。1枚を2件に割ると写真が片方にしか付かないので、
   * 1件のまま内訳を持たせ、税抜は区分ごとに割って足す。ふだんは閉じておく。
   */
  const [splitTax, setSplitTax] = useState(isMixedTaxReceipt(editing?.taxable10Amount ?? 0, editing?.taxable8Amount ?? 0, editing?.taxFreeAmount ?? 0));
  const [amount10, setAmount10] = useState(editing?.taxable10Amount ?? 0);
  const [amount8, setAmount8] = useState(editing?.taxable8Amount ?? 0);
  const [amountFree, setAmountFree] = useState(editing?.taxFreeAmount ?? 0);
  /** 保存する写真。直すときは差し替えない（撮り直すなら登録し直す） */
  const [image, setImage] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  /** 切り抜く前の元の写真。自動の切り抜きがずれたときに「切り抜きを直す」で使う */
  const [source, setSource] = useState<ReceiptSource | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [reading, setReading] = useState(false);
  const [readMessage, setReadMessage] = useState("");
  const [ocrUsed, setOcrUsed] = useState(editing?.ocrUsed ?? false);
  /** 読み取ったレシートの合計。内訳の合計と見比べて、合っていなければ知らせる */
  const [readTotal, setReadTotal] = useState(0);
  const [mixedTax, setMixedTax] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  /** スキャナを開けなかった理由。出したうえで、端末のカメラへ落とす */
  const [scannerError, setScannerError] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const desktop = useDesktopPointer();

  // 作ったプレビューURLは差し替え・閉じるときに解放する
  const objectUrlRef = useRef("");
  useEffect(() => () => { if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current); }, []);

  // 直すときは保存済みの写真を出す
  useEffect(() => {
    if (!editing?.imagePath) return;
    let alive = true;
    receiptImageUrl(editing.imagePath).then((url) => { if (alive) setPreviewUrl(url); }).catch(() => undefined);
    return () => { alive = false; };
  }, [editing?.imagePath]);

  function showImage(blob: Blob) {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = URL.createObjectURL(blob);
    setImage(blob);
    setPreviewUrl(objectUrlRef.current);
  }

  async function chooseReceipt(file: File | null) {
    if (!file) return;
    setError(""); setReadMessage("");
    let normalized: Blob;
    try {
      normalized = await normalizeReceiptImage(file);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "画像を読み込めませんでした。");
      return;
    }
    showImage(normalized);
    // PDF は描いた画像のほうを切り抜きの元にする（PDF のままでは画像として開けない）
    const original = receiptSourceOf(file);
    setSource(original.image === file && isPdfFile(file) ? { image: normalized, quad: null } : original);

    setReading(true);
    try {
      const result = await readReceipt(await blobToDataUrl(normalized), EXPENSE_CATEGORIES);
      if (!result.ok) {
        setOcrUsed(false);
        setReadMessage(result.message);
        return;
      }
      // 読めた項目だけ入れる。空で上書きすると、打った内容が消える
      if (result.storeName) setStoreName(result.storeName);
      if (result.date) setExpenseDate(result.date);
      if (result.totalAmount > 0) setAmount(result.totalAmount);
      setOcrUsed(true);
      if (result.category && (EXPENSE_CATEGORIES as readonly string[]).includes(result.category)) {
        setCategory(result.category);
        setCategorySuggested(true);
      } else {
        setCategorySuggested(false);
      }
      setTaxRate(taxRateFromReceipt(result.taxable10Amount, result.taxable8Amount, result.taxFreeAmount));
      /*
       * 区分が2つ以上読めたとき、または金額までは読めなくても AI が混在を見つけたときは内訳を開く。
       * ただし読めた区分1つで合計がぴったり説明できるなら混ざっていない（「8%対象 ¥0」だけの印字など）。
       */
      const bucketSum = result.taxable10Amount + result.taxable8Amount + result.taxFreeAmount;
      const bucketsExplainTotal = bucketSum > 0 && bucketSum === result.totalAmount;
      const mixed = isMixedTaxReceipt(result.taxable10Amount, result.taxable8Amount, result.taxFreeAmount)
        || (result.hasMultipleTaxRates && !bucketsExplainTotal);
      setMixedTax(mixed);
      setReadTotal(result.totalAmount);
      if (mixed) {
        setSplitTax(true);
        setAmount10(result.taxable10Amount);
        setAmount8(result.taxable8Amount);
        setAmountFree(result.taxFreeAmount);
      }
      setReadMessage("読み取りました。金額と日付が合っているか確かめてください。");
    } finally {
      setReading(false);
    }
  }

  // 一覧へドラッグされたファイルは、開いてすぐ読み取る（初回だけ）
  const initialHandled = useRef(false);
  useEffect(() => {
    if (!initialFile || initialHandled.current) return;
    initialHandled.current = true;
    // 読み取りの結果で欄を埋める非同期の処理。描画の途中で state を変えないよう、次の番に回す
    queueMicrotask(() => { void chooseReceipt(initialFile); });
    // chooseReceipt は毎回作り直されるが、ここでは最初の1回だけ呼べばよい
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  const busy = saving || reading;
  const drop = useFileDrop((files) => {
    const file = files.find((item) => item.type.startsWith("image/") || isPdfFile(item));
    if (!file) { setError("レシートの画像（JPEG・PNG など）か PDF をドラッグしてください。"); return; }
    void chooseReceipt(file);
  }, !editing && !busy);

  /** 内訳を開いているときの合計。開いていなければ打った額をそのまま使う */
  const effectiveAmount = splitTax ? amount10 + amount8 + amountFree : amount;
  const filledKinds = (amount10 > 0 ? 1 : 0) + (amount8 > 0 ? 1 : 0) + (amountFree > 0 ? 1 : 0);
  const taxNotice = !splitTax
    ? "このレシートは税率が混ざっています。まとめると税抜がずれます。内訳を入れてください。"
    : filledKinds === 0
      ? "このレシートは税率が混ざっています。税率ごとの金額は読み取れなかったので、レシートの「10%対象」「8%対象」の金額を下に入れてください。"
      : readTotal > 0 && effectiveAmount !== readTotal
        ? `このレシートは税率が混ざっています。読み取った内訳の合計（${formatYen(effectiveAmount)}）が、レシートの合計（${formatYen(readTotal)}）と合っていません。下の金額をレシートと見比べて直してください。`
        : "このレシートは税率が混ざっています。読み取った内訳を下に入れました。額が合っているか確かめてください。";

  async function submit() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)) { setError("利用日を入力してください。"); return; }
    if (storeName.trim() === "") { setError("店名・支払先を入力してください。"); return; }
    if (effectiveAmount <= 0) { setError(splitTax ? "区分ごとの金額を入力してください。" : "金額を入力してください。"); return; }
    if (splitTax && filledKinds < 2) { setError("区分が1つだけです。混ざっていないなら「税率をまとめる」に戻してください。"); return; }
    const fields: ReceiptFields = {
      expenseDate,
      storeName: storeName.trim(),
      amount: Math.round(effectiveAmount),
      // 内訳を開いているときは、いちばん多い区分を代表の税率にする
      taxRate: splitTax ? taxRateFromReceipt(amount10, amount8, amountFree) : taxRate,
      taxable10Amount: splitTax ? amount10 : 0,
      taxable8Amount: splitTax ? amount8 : 0,
      taxFreeAmount: splitTax ? amountFree : 0,
      category,
      memo: memo.trim(),
    };
    setSaving(true); setError("");
    try {
      if (editing) await updateReceipt(uid, editing.id, fields);
      else await createReceipt(uid, fields, image, ocrUsed);
      onSaved(fields.expenseDate);
    } catch {
      setError("保存できませんでした。通信を確かめて、もう一度お試しください。");
      setSaving(false);
    }
  }

  if (scannerOpen) {
    return <ReceiptScanner
      onCapture={(file) => { setScannerOpen(false); void chooseReceipt(file); }}
      onClose={() => setScannerOpen(false)}
      onUnavailable={(reason) => {
        // 権限拒否など。ここから input.click() しても iOS は操作と認めないので、押してもらう案内を出す
        setScannerOpen(false);
        setScannerError(reason);
      }}
    />;
  }

  return <div className="fixed inset-0 z-[110] grid place-items-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label="レシート">
    <div className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <h2 className="flex items-center gap-2 font-bold"><ReceiptIcon size={17} className="text-[var(--brand)]" />{editing ? "レシートを直す" : "レシートを登録"}</h2>
        <button type="button" className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label="閉じる" onClick={onClose}><X size={18} /></button>
      </div>

      <div className="relative min-h-0 flex-1 space-y-4 overflow-y-auto p-5" {...drop.handlers}>
        {drop.dragging && <FileDropOverlay label="ここで離すと、レシートを取り込みます" />}
        {!editing && <div>
          <input ref={fileRef} type="file" accept={desktop ? "image/*,application/pdf" : "image/*"} capture={desktop ? undefined : "environment"} className="hidden" onChange={(event) => { void chooseReceipt(event.target.files?.[0] ?? null); event.target.value = ""; }} />
          <button
            type="button"
            className="xr-secondary w-full justify-center"
            disabled={busy}
            onClick={() => {
              // 押した流れのまま開く。非同期に判定してから input.click() すると、iOS が撮影結果を取りこぼす
              if (!desktop && !scannerError && isScannerAvailable()) { setScannerOpen(true); return; }
              fileRef.current?.click();
            }}
          >
            {reading ? <Loader2 size={16} className="animate-spin" /> : desktop ? <Upload size={16} /> : <Camera size={16} />}
            {reading ? "読み取り中…" : desktop ? (previewUrl ? "レシートを選び直す" : "レシートを取り込む") : previewUrl ? "レシートを撮り直す" : "レシートを撮る・選ぶ"}
          </button>
          <p className="mt-1.5 text-xs text-slate-400">{desktop
            ? "レシートの画像（JPEG・PNG）か PDF を選ぶと、店名・利用日・金額・費目が入ります。この画面へドラッグしても取り込めます（PDF は1ページ目を読み取ります）。"
            : "枠と水準器を出して、まっすぐ・大きく写った瞬間に自動で撮ります。写真なしの手入力でも登録できます。"}</p>
          {!desktop && scannerError && <p className="mt-1.5 text-xs font-semibold text-amber-700">{scannerError}　いまは端末のカメラで撮影します。</p>}
        </div>}

        {previewUrl && <div className="overflow-hidden rounded-xl border border-slate-200">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="レシート" className="max-h-56 w-full bg-slate-50 object-contain" />
        </div>}
        {/* 自動の切り抜きがずれたとき、撮り直さずに4隅を合わせ直す。写真だけ差し替え、読み取った値はそのまま */}
        {!editing && source && image && <button type="button" className="xr-secondary -mt-2 w-full justify-center" disabled={busy} onClick={() => setCropOpen(true)}>
          <Crop size={16} />切り抜きを直す
        </button>}
        {cropOpen && source && <ReceiptCropEditor
          source={source}
          onClose={() => setCropOpen(false)}
          onApply={(cropped) => { showImage(cropped); setCropOpen(false); }}
        />}

        {readMessage && <p className={`flex items-start gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold ${ocrUsed ? "bg-blue-50 text-blue-800" : "bg-amber-50 text-amber-800"}`}>
          {ocrUsed ? <Sparkles size={14} className="mt-px shrink-0" /> : <TriangleAlert size={14} className="mt-px shrink-0" />}{readMessage}
        </p>}

        <label className="block text-sm font-semibold">利用日
          <input type="date" className="xr-input mt-2" disabled={saving} value={expenseDate} onChange={(event) => setExpenseDate(event.target.value)} />
        </label>
        <label className="block text-sm font-semibold">店名・支払先
          <input className="xr-input mt-2" disabled={saving} value={storeName} placeholder="○○ストア" onChange={(event) => setStoreName(event.target.value)} />
        </label>
        <label className="block text-sm font-semibold">金額（税込）
          {/* 内訳を開いているあいだは、合計は足し算の結果に固定する（合計と内訳が食い違ったまま保存させない） */}
          {splitTax
            ? <p className="xr-input mt-2 flex items-center justify-end bg-slate-50 text-right text-base font-bold tabular-nums text-slate-700">{formatYen(effectiveAmount)}</p>
            : <AmountInput className="xr-input mt-2 text-right text-base font-bold tabular-nums" disabled={saving} value={amount} placeholder="0" onChange={setAmount} />}
          <span className="mt-1 block text-xs font-normal text-slate-400">
            {splitTax ? "下の内訳を足した額です。レシートの「合計」と合っているか確かめてください。" : "レシートの「合計」を入れてください。"}
          </span>
        </label>
        {mixedTax && <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
          <TriangleAlert size={14} className="mt-px shrink-0" />{taxNotice}
        </p>}

        {splitTax
          ? <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">税率ごとの内訳（税込）</p>
              <button
                type="button"
                className="text-xs font-semibold text-blue-700 underline"
                disabled={saving}
                onClick={() => {
                  // 打った分を捨てない。合計へ戻し、いちばん多い区分の税率にしておく。内訳が空なら読み取った合計に戻す
                  setAmount(effectiveAmount > 0 ? effectiveAmount : readTotal);
                  setTaxRate(taxRateFromReceipt(amount10, amount8, amountFree));
                  setSplitTax(false);
                }}
              >税率をまとめる</button>
            </div>
            {/*
              レシートによって10%が先のものと8%が先のものがあり、上から順に打つと入れ替わる。
              合計は同じなので足し算では見つからない。こちらで出した税額を並べ、レシートの「内消費税等」と見比べてもらう。
            */}
            <label className="block text-sm font-semibold">10%対象
              <span className="ml-1.5 text-xs font-normal text-slate-400">酒・日用品など</span>
              <AmountInput className="xr-input mt-1.5 text-right tabular-nums" disabled={saving} value={amount10} placeholder="0" onChange={setAmount10} />
              {amount10 > 0 && <span className="mt-1 block text-right text-xs font-normal tabular-nums text-slate-500">うち消費税 {formatYen(amount10 - exTax(amount10, 10))}</span>}
            </label>
            <label className="block text-sm font-semibold">8%対象（軽減）
              <span className="ml-1.5 text-xs font-normal text-slate-400">飲食料品・新聞</span>
              <AmountInput className="xr-input mt-1.5 text-right tabular-nums" disabled={saving} value={amount8} placeholder="0" onChange={setAmount8} />
              {amount8 > 0 && <span className="mt-1 block text-right text-xs font-normal tabular-nums text-slate-500">うち消費税 {formatYen(amount8 - exTax(amount8, 8))}</span>}
            </label>
            <label className="block text-sm font-semibold">非課税・対象外
              <AmountInput className="xr-input mt-1.5 text-right tabular-nums" disabled={saving} value={amountFree} placeholder="0" onChange={setAmountFree} />
              <span className="mt-1 block text-xs font-normal text-slate-400">レジ袋・印紙・切手など。税抜＝税込のまま足します。</span>
            </label>
            {effectiveAmount > 0 && <p className="text-xs text-slate-500">税抜 {formatYen(exTaxOf(effectiveAmount, 10, amount10, amount8, amountFree))}（区分ごとに割って足しています）</p>}
            {amount10 > 0 && amount8 > 0 && <p className="flex items-start gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
              <TriangleAlert size={13} className="mt-px shrink-0" />
              上の「うち消費税」が、レシートの「内消費税等」と同じ額か見てください。違っていたら10%と8%が入れ替わっています。
            </p>}
          </div>
          : <label className="block text-sm font-semibold">消費税
            <select className="xr-input mt-2" disabled={saving} value={taxRate} onChange={(event) => setTaxRate(Number(event.target.value))}>
              {TAX_RATES.map((rate) => <option key={rate} value={rate}>{taxLabel(rate)}</option>)}
            </select>
            <button type="button" className="mt-2 text-xs font-semibold text-blue-700 underline" disabled={saving} onClick={() => {
              // 開くときは今の合計を、いま選んでいる税率の欄へ入れておく
              setAmount10(taxRate === 10 ? amount : 0);
              setAmount8(taxRate === 8 ? amount : 0);
              setAmountFree(taxRate === 0 ? amount : 0);
              setSplitTax(true);
            }}>税率が混ざっている（内訳を入れる）</button>
          </label>}

        <label className="block text-sm font-semibold">費目
          <select className="xr-input mt-2" disabled={saving} value={category} onChange={(event) => { setCategory(event.target.value); setCategorySuggested(false); }}>
            <option value="">未設定</option>
            {EXPENSE_CATEGORIES.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          {categorySuggested && <span className="mt-1 flex items-center gap-1 text-xs font-normal text-blue-700"><Sparkles size={12} />AI が選びました。違っていたら選び直してください。</span>}
        </label>
        <label className="block text-sm font-semibold">メモ
          <input className="xr-input mt-2" disabled={saving} value={memo} placeholder="誰と・何のため など" onChange={(event) => setMemo(event.target.value)} />
        </label>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}
      </div>

      <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
        <button type="button" className="xr-secondary" disabled={saving} onClick={onClose}>やめる</button>
        <button type="button" className="xr-primary" disabled={busy} onClick={() => void submit()}>
          {saving && <Loader2 size={16} className="animate-spin" />}{editing ? "直す" : "登録する"}
        </button>
      </div>
    </div>
  </div>;
}
