"use client";

import { useRef, useState, type DragEvent } from "react";

/*
 * ファイルを引いてきて落とす（ドラッグ＆ドロップ）で取り込む（2026-10-13 ユーザー指定：取り込みはこれから全部ドラッグ＆ドロップでもできるように）。
 * 落とせる所の要素に handlers を付け、dragging の間は「ここに落とす」の印を出す。ファイル以外（文字・リンク）を引いたときは何もしない。
 * 中の要素に出入りしても印がちらつかないように、入った回数を数える
 */
export function useFileDrop(onFiles: (files: File[]) => void, enabled = true) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes("Files");
  const handlers = {
    onDragEnter: (event: DragEvent) => { if (!enabled || !hasFiles(event)) return; event.preventDefault(); depth.current += 1; setDragging(true); },
    onDragOver: (event: DragEvent) => { if (!enabled || !hasFiles(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = "copy"; },
    onDragLeave: (event: DragEvent) => { if (!enabled || !hasFiles(event)) return; depth.current = Math.max(0, depth.current - 1); if (depth.current === 0) setDragging(false); },
    onDrop: (event: DragEvent) => {
      if (!enabled || !hasFiles(event)) return;
      event.preventDefault();
      depth.current = 0;
      setDragging(false);
      const files = Array.from(event.dataTransfer.files);
      if (files.length) onFiles(files);
    },
  };
  return { dragging: enabled && dragging, handlers };
}
