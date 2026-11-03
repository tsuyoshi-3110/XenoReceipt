"use client";

import { Loader2, SlidersHorizontal, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AmountInput } from "@/components/AmountInput";
import { ReceiptForm } from "@/components/ReceiptForm";
import { fieldsFromRead } from "@/lib/batchFields";
import { DEFAULT_CATEGORY, EXPENSE_CATEGORIES } from "@/lib/categories";
import { formatYen } from "@/lib/format";
import { blobToDataUrl, normalizeReceiptImage, readReceipt, todayLocal } from "@/lib/receiptImage";
import { ReceiptImageUploadError, createReceipt, type ReceiptFields } from "@/lib/receipts";
import { isMixedTaxReceipt, taxLabel } from "@/lib/tax";

/**
 * まとめて撮った（選んだ）レシートを、読み取ってから確かめて保存する画面。
 *
 * 「完了」を押してから読み始め、読めたものから順に欄が埋まる。保存は人が「n枚を保存」を押したときだけ。
 * 税の内訳など、この一覧では直しにくいものは「詳しく」で1枚ずつの確認画面を開いて直す（保存はここでまとめて）。
 */

type Draft = {
  key: string;
  /** 読み取り・保存に使う写真（JPEG にそろえたもの）。そろえる前は null */
  image: Blob | null;
  url: string;
  status: "reading" | "ready" | "broken";
  fields: ReceiptFields;
  ocrUsed: boolean;
  /** 見てほしい理由。空なら問題なし */
  attention: string;
  /** 保存に失敗した理由 */
  saveError: string;
  saved: boolean;
};

/** 同時に読む枚数。1枚ずつより速く、多すぎるとスマホの回線でどれも遅くなる */
const PARALLEL = 3;

const emptyFields = (): ReceiptFields => ({
  expenseDate: todayLocal(),
  storeName: "",
  amount: 0,
  taxRate: 10,
  taxable10Amount: 0,
  taxable8Amount: 0,
  taxFreeAmount: 0,
  category: DEFAULT_CATEGORY,
  memo: "",
});

/** 保存できる中身か。だめなら理由 */
function problemOf(fields: ReceiptFields): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.expenseDate)) return "利用日を入れてください。";
  if (fields.storeName.trim() === "") return "店名を入れてください。";
  if (fields.amount <= 0) return "金額を入れてください。";
  return "";
}

function taxSummary(fields: ReceiptFields): string {
  if (!isMixedTaxReceipt(fields.taxable10Amount, fields.taxable8Amount, fields.taxFreeAmount)) return `消費税 ${taxLabel(fields.taxRate)}`;
  const parts = [
    fields.taxable10Amount > 0 && `10% ${formatYen(fields.taxable10Amount)}`,
    fields.taxable8Amount > 0 && `8% ${formatYen(fields.taxable8Amount)}`,
    fields.taxFreeAmount > 0 && `対象外 ${formatYen(fields.taxFreeAmount)}`,
  ].filter(Boolean);
  return `税率が混在：${parts.join("・")}`;
}

export function ReceiptReview({ uid, files, onClose, onSaved }: {
  uid: string;
  files: File[];
  onClose: () => void;
  /** 保存した利用日（月を移るのに使う） */
  onSaved: (expenseDates: string[]) => void;
}) {
  const [drafts, setDrafts] = useState<Draft[]>(() => files.map((file, index) => ({
    key: `${index}-${file.name}-${file.size}`,
    image: null,
    url: "",
    status: "reading",
    fields: emptyFields(),
    ocrUsed: false,
    attention: "",
    saveError: "",
    saved: false,
  })));
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const update = (key: string, change: Partial<Draft>) =>
    setDrafts((list) => list.map((draft) => (draft.key === key ? { ...draft, ...change } : draft)));
  const updateFields = (key: string, change: Partial<ReceiptFields>) =>
    setDrafts((list) => list.map((draft) => (draft.key === key ? { ...draft, fields: { ...draft.fields, ...change } } : draft)));

  // 開いたら読み始める（1回だけ）。PARALLEL 枚ずつ並べて読む
  const started = useRef(false);
  const urls = useRef<string[]>([]);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const keys = files.map((file, index) => `${index}-${file.name}-${file.size}`);
    let next = 0;
    const work = async () => {
      while (next < files.length) {
        const index = next;
        next += 1;
        const key = keys[index];
        let image: Blob;
        try {
          image = await normalizeReceiptImage(files[index]);
        } catch (cause) {
          update(key, { status: "broken", attention: cause instanceof Error ? cause.message : "写真を読み込めませんでした。" });
          continue;
        }
        const url = URL.createObjectURL(image);
        urls.current.push(url);
        update(key, { image, url });
        const result = await readReceipt(await blobToDataUrl(image), EXPENSE_CATEGORIES);
        const { fields, attention } = fieldsFromRead(result, todayLocal());
        update(key, { status: "ready", fields, ocrUsed: result.ok, attention });
      }
    };
    void Promise.all(Array.from({ length: Math.min(PARALLEL, files.length) }, work));
  }, [files]);
  useEffect(() => () => { urls.current.forEach((url) => URL.revokeObjectURL(url)); }, []);

  const remaining = drafts.filter((draft) => !draft.saved && draft.status !== "broken");
  const reading = drafts.some((draft) => draft.status === "reading");
  const detail = drafts.find((draft) => draft.key === detailKey) ?? null;

  function close() {
    if (remaining.length > 0 && !window.confirm(`まだ保存していないレシートが ${remaining.length}枚あります。閉じると読み取った内容は消えます。`)) return;
    onClose();
  }

  async function saveAll() {
    const bad = remaining.find((draft) => problemOf(draft.fields));
    if (bad) {
      setError(`${remaining.indexOf(bad) + 1}枚目：${problemOf(bad.fields)}`);
      return;
    }
    setSaving(true); setError("");
    const savedDates: string[] = [];
    // 1枚ずつ保存する。途中で失敗しても、保存できた分は保存済みにして、残りだけ押し直せばよいようにする
    for (const draft of remaining) {
      try {
        await createReceipt(uid, draft.fields, draft.image, draft.ocrUsed);
        update(draft.key, { saved: true, saveError: "" });
        savedDates.push(draft.fields.expenseDate);
      } catch (cause) {
        update(draft.key, {
          saveError: cause instanceof ReceiptImageUploadError ? "写真を送れませんでした。" : "保存できませんでした。",
        });
      }
    }
    setSaving(false);
    if (savedDates.length === remaining.length) onSaved(savedDates);
    else setError("保存できなかったレシートがあります。電波のよい所で、もう一度「保存」を押してください。");
  }

  if (detail && detail.image) {
    return <ReceiptForm
      uid={uid}
      editing={null}
      initialFile={null}
      draft={{ image: detail.image, fields: detail.fields, ocrUsed: detail.ocrUsed }}
      onDraftDone={(fields) => { update(detail.key, { fields, attention: "" }); setDetailKey(null); }}
      onSaved={() => setDetailKey(null)}
      onClose={() => setDetailKey(null)}
    />;
  }

  return <div className="fixed inset-0 z-[100] flex flex-col bg-[var(--background)]" role="dialog" aria-modal="true" aria-label="読み取った結果">
    <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
      <div>
        <h2 className="font-bold">読み取った結果を確かめる</h2>
        <p className="text-xs text-slate-500">{reading ? `読み取っています…（${drafts.filter((d) => d.status !== "reading").length}/${drafts.length}枚）` : "違う所だけ直して、下の「保存」を押してください。"}</p>
      </div>
      <button type="button" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="閉じる" onClick={close}><X size={20} /></button>
    </div>

    <ul className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 pb-28">
      {drafts.map((draft, index) => <li
        key={draft.key}
        className={`rounded-2xl bg-white p-3 shadow-sm ${draft.saved ? "opacity-50" : ""} ${draft.attention || draft.saveError ? "ring-2 ring-amber-300" : ""}`}
      >
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {draft.url ? <img src={draft.url} alt={`${index + 1}枚目のレシート`} className="h-24 w-16 shrink-0 rounded-lg bg-slate-100 object-cover" />
            : <div className="grid h-24 w-16 shrink-0 place-items-center rounded-lg bg-slate-100"><Loader2 size={16} className="animate-spin text-slate-400" /></div>}
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
              <span>{index + 1}枚目{draft.saved && "・保存しました"}</span>
              {!draft.saved && !saving && <button
                type="button"
                className="rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-600"
                aria-label={`${index + 1}枚目を外す`}
                onClick={() => setDrafts((list) => list.filter((d) => d.key !== draft.key))}
              ><X size={14} /></button>}
            </div>
            {draft.status === "reading"
              ? <p className="flex items-center gap-1.5 text-sm text-slate-500"><Loader2 size={14} className="animate-spin" />読み取っています…</p>
              : draft.status === "broken"
                ? <p className="text-sm font-semibold text-red-700">{draft.attention}</p>
                : <>
                  <input className="xr-input min-h-0 py-1.5 text-sm" disabled={draft.saved || saving} value={draft.fields.storeName} placeholder="店名" aria-label="店名" onChange={(event) => updateFields(draft.key, { storeName: event.target.value })} />
                  <div className="flex gap-2">
                    <input type="date" className="xr-input min-h-0 py-1.5 text-sm" disabled={draft.saved || saving} value={draft.fields.expenseDate} aria-label="利用日" onChange={(event) => updateFields(draft.key, { expenseDate: event.target.value })} />
                    {/* 内訳があるときは、合計は内訳を足した額に決まっているので、ここでは直させない（「詳しく」で直す） */}
                    {isMixedTaxReceipt(draft.fields.taxable10Amount, draft.fields.taxable8Amount, draft.fields.taxFreeAmount)
                      ? <p className="xr-input min-h-0 bg-slate-50 py-1.5 text-right text-sm font-bold tabular-nums">{formatYen(draft.fields.amount)}</p>
                      : <AmountInput className="xr-input min-h-0 py-1.5 text-right text-sm font-bold tabular-nums" disabled={draft.saved || saving} value={draft.fields.amount} placeholder="金額" aria-label="金額（税込）" onChange={(amount) => updateFields(draft.key, { amount })} />}
                  </div>
                  <div className="flex items-center gap-2">
                    <select className="xr-input min-h-0 flex-1 py-1.5 text-sm" disabled={draft.saved || saving} value={draft.fields.category} aria-label="費目" onChange={(event) => updateFields(draft.key, { category: event.target.value })}>
                      <option value="">未設定</option>
                      {EXPENSE_CATEGORIES.map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                    {!draft.saved && <button type="button" className="xr-secondary min-h-0 shrink-0 px-2.5 py-1.5 text-xs" disabled={saving || !draft.image} onClick={() => setDetailKey(draft.key)}><SlidersHorizontal size={13} />詳しく</button>}
                  </div>
                  <p className="text-xs text-slate-500">{taxSummary(draft.fields)}</p>
                </>}
            {(draft.attention && draft.status === "ready" || draft.saveError) && <p className="flex items-start gap-1 text-xs font-semibold text-amber-800">
              <TriangleAlert size={12} className="mt-0.5 shrink-0" />{draft.saveError || draft.attention}
            </p>}
          </div>
        </div>
      </li>)}
    </ul>

    <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white px-4 pb-5 pt-3">
      {error && <p className="mx-auto mb-2 max-w-md text-xs font-semibold text-red-700">{error}</p>}
      <div className="mx-auto flex max-w-md gap-2">
        <button type="button" className="xr-secondary" disabled={saving} onClick={close}>やめる</button>
        <button type="button" className="xr-primary flex-1 justify-center" disabled={saving || reading || remaining.length === 0} onClick={() => void saveAll()}>
          {saving && <Loader2 size={16} className="animate-spin" />}{reading ? "読み取りが終わるまでお待ちください" : `${remaining.length}枚を保存`}
        </button>
      </div>
    </div>
  </div>;
}
