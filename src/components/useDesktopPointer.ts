"use client";

import { useSyncExternalStore } from "react";

/*
 * PC（マウスで操作する端末）か。ProcNova・ProcMana の経費と同じ見分け方。
 *
 * PC ではレシートをその場で撮ることはまず無く、スマホで撮って送った写真・スキャンした画像・
 * ネット注文の領収書（PDF）を入れる。PC のカメラはピントも明るさもレシートに向かない。
 * そこで PC では「撮る」を「取り込む」に替える。
 * 機種名ではなく、主に使う指し示し方（マウスか指か）で見る。iPad はマウスを付けても
 * 主は指なので撮影のまま、タッチ画面の PC は主がマウスなので取り込みになる。
 */
const DESKTOP_QUERY = "(hover: hover) and (pointer: fine)";

function subscribe(onChange: () => void) {
  const media = window.matchMedia(DESKTOP_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function useDesktopPointer(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    // サーバーでは分からないので、スマホ（撮影）として描いておく
    () => false,
  );
}
