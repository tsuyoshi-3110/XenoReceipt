"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { saveCapturedReceipt, type SavedReceipt } from "@/lib/batchReceipt";

export type QueueState = {
  /** 読み取り・保存を待っている枚数（いま処理中の1枚を含む） */
  waiting: number;
  saved: number;
  /** 保存したうち、要確認を付けた枚数 */
  review: number;
  /** 保存できなかった枚数。写真は手元に残してあり、「もう一度」で送り直せる */
  failed: number;
};

const EMPTY: QueueState = { waiting: 0, saved: 0, review: 0, failed: 0 };

/**
 * 続けて撮った写真を、1枚ずつ順に読んで保存する。
 *
 * 同時に流さないのは、読み取りの回数の枠をサーバーで1回ずつ確保しているのと、
 * スマホの回線で何枚も同時に送ると、どれも遅くなるため。撮る手は止めずに、裏で順に片付ける。
 * 保存できなかった写真は捨てずに持っておき、「もう一度」で送り直す（撮り直さなくて済むように）。
 */
export function useReceiptQueue(uid: string, onSaved: (saved: SavedReceipt) => void) {
  const queue = useRef<File[]>([]);
  const failedFiles = useRef<File[]>([]);
  const running = useRef(false);
  const [state, setState] = useState<QueueState>(EMPTY);
  const onSavedRef = useRef(onSaved);
  useEffect(() => { onSavedRef.current = onSaved; });

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    while (queue.current.length > 0) {
      const file = queue.current.shift() as File;
      try {
        const saved = await saveCapturedReceipt(uid, file);
        setState((s) => ({ ...s, waiting: s.waiting - 1, saved: s.saved + 1, review: s.review + (saved.needsReview ? 1 : 0) }));
        onSavedRef.current(saved);
      } catch {
        failedFiles.current.push(file);
        setState((s) => ({ ...s, waiting: s.waiting - 1, failed: s.failed + 1 }));
      }
    }
    running.current = false;
  }, [uid]);

  const add = useCallback((files: File[]) => {
    if (files.length === 0) return;
    queue.current.push(...files);
    setState((s) => ({ ...s, waiting: s.waiting + files.length }));
    void pump();
  }, [pump]);

  const retry = useCallback(() => {
    const files = failedFiles.current;
    failedFiles.current = [];
    setState((s) => ({ ...s, failed: 0 }));
    add(files);
  }, [add]);

  /** 片付いたあとに知らせを閉じる。待っている・送り直せていないものがあるあいだは消さない */
  const dismiss = useCallback(() => {
    setState((s) => (s.waiting > 0 || s.failed > 0 ? s : EMPTY));
  }, []);

  // 保存前に画面を閉じると、撮った写真が消える。待っているあいだは閉じる前に確かめる
  useEffect(() => {
    if (state.waiting === 0 && state.failed === 0) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state.waiting, state.failed]);

  return { ...state, add, retry, dismiss };
}
