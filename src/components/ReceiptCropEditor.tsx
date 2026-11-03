/*
 * 元: renova project/renova18.5/src/app/proclink/projects/[projectId]/expenses/_components/ReceiptCropEditor.tsx（2026-11-03 に写した）
 *
 * ProcNova・ProcMana と同じ切り抜きの直し方にするための複製。直したら、向こうにも配ること。
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  ANALYZE_SIZE,
  analyzeFrame,
  quadSize,
  refineQuad,
  warpQuad,
  type Point,
  type Quad,
} from "@/lib/receiptScan";

/**
 * レシートの切り抜きを、4隅をドラッグして直す画面。
 *
 * 自動の切り抜きは、机の模様・影・テカりが強いとずれることがある。
 * そのときに撮り直さなくて済むよう、撮った元の写真の上に4つの角を出し、
 * 紙の角へ合わせてもらってから、長方形へ引き伸ばして保存する（斜め・台形も直る）。
 *
 * 直すのは保存する写真だけ。読み取った金額・日付は触らない（AIを使い直さない）。
 */

/** 切り抜く前の写真と、自動で見つけた4隅（その写真の画素座標）。4隅が無ければ開いたときに探す */
export type ReceiptSource = { image: Blob; quad: Quad | null };

/*
 * 撮った写真（File）に、切り抜く前の元の写真を結びつけておく。
 * 撮影画面 → 経費の画面 の受け渡しは File 1つなので、引数を増やさずに持ち回れるようにする。
 * File が捨てられれば一緒に消える（WeakMap）。
 */
const sources = new WeakMap<Blob, ReceiptSource>();

export function rememberReceiptSource(file: Blob, source: ReceiptSource): void {
  sources.set(file, source);
}

/** 撮影画面で撮った写真なら元の写真と4隅を、端末から選んだ写真ならその写真そのものを返す */
export function receiptSourceOf(file: Blob): ReceiptSource {
  return sources.get(file) ?? { image: file, quad: null };
}

/** 保存する写真の長辺の上限（撮影画面・経費の画面と同じ） */
const OUTPUT_MAX_SIDE = 1600;
/** 角のつまみの半径（CSSピクセル）。指で掴めるように大きめ */
const HANDLE_RADIUS = 14;
/** 角を動かしている間に出す拡大鏡の大きさと倍率 */
const LOUPE_SIZE = 120;
const LOUPE_ZOOM = 3;

/** 画像を向きを直して読み込む（iPhone の写真は横向きのまま保存されていることがある） */
async function loadBitmap(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob, { imageOrientation: "from-image" });
}

/** 自動で4隅を探す（撮影画面と同じ手順。縮小で探してから、等倍で測り直す） */
function detectQuad(bitmap: ImageBitmap): Quad | null {
  const scale = ANALYZE_SIZE / Math.max(bitmap.width, bitmap.height);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const small = document.createElement("canvas");
  small.width = width;
  small.height = height;
  const smallContext = small.getContext("2d", { willReadFrequently: true });
  if (!smallContext) return null;
  smallContext.drawImage(bitmap, 0, 0, width, height);
  const result = analyzeFrame(smallContext.getImageData(0, 0, width, height));
  if (!result.quad) return null;
  const coarse = result.quad.map((p) => ({ x: p.x * bitmap.width, y: p.y * bitmap.height })) as Quad;

  const full = document.createElement("canvas");
  full.width = bitmap.width;
  full.height = bitmap.height;
  const fullContext = full.getContext("2d", { willReadFrequently: true });
  if (!fullContext) return coarse;
  fullContext.drawImage(bitmap, 0, 0);
  return refineQuad(fullContext.getImageData(0, 0, bitmap.width, bitmap.height), coarse, 1 / scale) ?? coarse;
}

/** 見つからなければ、写真の少し内側を囲んでおく（そこから動かしてもらう） */
function insetQuad(width: number, height: number): Quad {
  const dx = width * 0.08;
  const dy = height * 0.08;
  return [
    { x: dx, y: dy },
    { x: width - dx, y: dy },
    { x: width - dx, y: height - dy },
    { x: dx, y: height - dy },
  ];
}

/**
 * 4隅を 左上・右上・右下・左下 の順に並べ直す。
 * ドラッグで角どうしを入れ替えてしまっても、ねじれた形で引き伸ばさないように。
 */
function orderQuad(points: Point[]): Quad {
  const cx = points.reduce((sum, p) => sum + p.x, 0) / 4;
  const cy = points.reduce((sum, p) => sum + p.y, 0) / 4;
  // 中心から見た角度で時計回りに並べる（画面は y が下向きなので atan2 のままで時計回り）
  const sorted = [...points].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  // x+y が最小のものを左上として先頭に回す
  let first = 0;
  for (let i = 1; i < 4; i += 1) {
    if (sorted[i].x + sorted[i].y < sorted[first].x + sorted[first].y) first = i;
  }
  return [0, 1, 2, 3].map((i) => sorted[(first + i) % 4]) as Quad;
}

/** 4隅で切り抜いて長方形へ引き伸ばし、JPEG にする */
async function cropToBlob(bitmap: ImageBitmap, quad: Quad): Promise<Blob> {
  const source = document.createElement("canvas");
  source.width = bitmap.width;
  source.height = bitmap.height;
  const sourceContext = source.getContext("2d", { willReadFrequently: true });
  if (!sourceContext) throw new Error("画像の変換に失敗しました。");
  sourceContext.drawImage(bitmap, 0, 0);

  const ordered = orderQuad(quad);
  const size = quadSize(ordered);
  const warpWidth = Math.max(1, Math.round(size.width));
  const warpHeight = Math.max(1, Math.round(size.height));
  // 引き伸ばしは等倍で行い、縮めるのは最後にブラウザに任せる（撮影画面と同じ理由）
  const warped = warpQuad(sourceContext.getImageData(0, 0, bitmap.width, bitmap.height), ordered, warpWidth, warpHeight);
  if (!warped) throw new Error("この形では切り抜けません。角の位置を見直してください。");

  const warpCanvas = document.createElement("canvas");
  warpCanvas.width = warpWidth;
  warpCanvas.height = warpHeight;
  const warpContext = warpCanvas.getContext("2d");
  const scale = Math.min(1, OUTPUT_MAX_SIDE / Math.max(warpWidth, warpHeight));
  const output = document.createElement("canvas");
  output.width = Math.max(1, Math.round(warpWidth * scale));
  output.height = Math.max(1, Math.round(warpHeight * scale));
  const outputContext = output.getContext("2d");
  if (!warpContext || !outputContext) throw new Error("画像の変換に失敗しました。");
  const image = warpContext.createImageData(warped.width, warped.height);
  image.data.set(warped.data);
  warpContext.putImageData(image, 0, 0);
  outputContext.imageSmoothingEnabled = true;
  outputContext.imageSmoothingQuality = "high";
  outputContext.drawImage(warpCanvas, 0, 0, output.width, output.height);

  const blob = await new Promise<Blob | null>((resolve) => output.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) throw new Error("画像の変換に失敗しました。");
  return blob;
}

export function ReceiptCropEditor({
  source,
  onApply,
  onClose,
}: {
  source: ReceiptSource;
  /** 切り抜き直した写真。呼び出し側は保存する写真とプレビューを差し替える */
  onApply: (image: Blob) => void;
  onClose: () => void;
}) {
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  /** 元の写真の画素座標での4隅 */
  const [quad, setQuad] = useState<Quad | null>(null);
  const [autoQuad, setAutoQuad] = useState<Quad | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  /** いま動かしている角の番号と、拡大鏡の位置 */
  const [dragging, setDragging] = useState<number | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const loupeRef = useRef<HTMLCanvasElement | null>(null);
  /** 画面に出している写真の位置と縮尺（写真の画素 → 画面のCSSピクセル） */
  const [view, setView] = useState({ left: 0, top: 0, scale: 1, width: 0 });

  // 写真を読み込み、4隅を決める
  useEffect(() => {
    let cancelled = false;
    const url = URL.createObjectURL(source.image);
    void (async () => {
      try {
        const loaded = await loadBitmap(source.image);
        if (cancelled) {
          loaded.close();
          return;
        }
        const initial = source.quad ?? detectQuad(loaded) ?? insetQuad(loaded.width, loaded.height);
        setImageUrl(url);
        setBitmap(loaded);
        setQuad(initial);
        setAutoQuad(initial);
      } catch {
        if (!cancelled) setError("写真を読み込めませんでした。撮り直してください。");
      }
    })();
    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [source]);

  useEffect(() => () => bitmap?.close(), [bitmap]);

  // 画面の大きさに合わせて、写真をはみ出さない大きさで真ん中に置く
  const layout = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || !bitmap) return;
    const box = stage.getBoundingClientRect();
    // 角のつまみが端で切れないよう、余白を取る
    const pad = HANDLE_RADIUS + 6;
    const scale = Math.min((box.width - pad * 2) / bitmap.width, (box.height - pad * 2) / bitmap.height);
    setView({
      scale,
      width: box.width,
      left: (box.width - bitmap.width * scale) / 2,
      top: (box.height - bitmap.height * scale) / 2,
    });
  }, [bitmap]);

  useEffect(() => {
    layout();
    window.addEventListener("resize", layout);
    return () => window.removeEventListener("resize", layout);
  }, [layout]);

  /** 画面の位置 → 写真の画素（写真の外には出さない） */
  const toImage = (clientX: number, clientY: number): Point | null => {
    const stage = stageRef.current;
    if (!stage || !bitmap) return null;
    const box = stage.getBoundingClientRect();
    const x = (clientX - box.left - view.left) / view.scale;
    const y = (clientY - box.top - view.top) / view.scale;
    return { x: Math.min(bitmap.width, Math.max(0, x)), y: Math.min(bitmap.height, Math.max(0, y)) };
  };

  /** 拡大鏡に、指の下あたりを大きくして描く（指で隠れた角を見ながら合わせられるように） */
  const drawLoupe = (point: Point) => {
    const canvas = loupeRef.current;
    if (!canvas || !bitmap) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = LOUPE_SIZE * ratio;
    canvas.height = LOUPE_SIZE * ratio;
    const context = canvas.getContext("2d");
    if (!context) return;
    const span = LOUPE_SIZE / (view.scale * LOUPE_ZOOM);
    context.fillStyle = "#000";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, point.x - span / 2, point.y - span / 2, span, span, 0, 0, canvas.width, canvas.height);
    // 真ん中の十字が、角を置く位置
    context.strokeStyle = "#22c55e";
    context.lineWidth = 2 * ratio;
    context.beginPath();
    context.moveTo(canvas.width / 2, canvas.height / 2 - 12 * ratio);
    context.lineTo(canvas.width / 2, canvas.height / 2 + 12 * ratio);
    context.moveTo(canvas.width / 2 - 12 * ratio, canvas.height / 2);
    context.lineTo(canvas.width / 2 + 12 * ratio, canvas.height / 2);
    context.stroke();
  };

  const onPointerDown = (index: number) => (event: React.PointerEvent) => {
    event.preventDefault();
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    setDragging(index);
    if (quad) drawLoupe(quad[index]);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (dragging === null || !quad) return;
    const point = toImage(event.clientX, event.clientY);
    if (!point) return;
    const next = [...quad] as Quad;
    next[dragging] = point;
    setQuad(next);
    drawLoupe(point);
  };

  const onPointerUp = () => setDragging(null);

  const apply = async () => {
    if (!bitmap || !quad) return;
    setSaving(true);
    setError("");
    try {
      onApply(await cropToBlob(bitmap, quad));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "切り抜けませんでした。");
      setSaving(false);
    }
  };

  const screen = quad?.map((p) => ({ x: view.left + p.x * view.scale, y: view.top + p.y * view.scale }));
  // 拡大鏡は、動かしている角と反対側の上の隅に出す（指で隠れないように）
  const loupeOnLeft = dragging !== null && screen ? screen[dragging].x > view.width / 2 : false;

  /*
   * ページの一番外（body）に出す。経費の画面の中に置くと、親のぼかし（backdrop-filter）などで
   * fixed が画面全体にならず、ダイアログの中に押し込められることがある。
   */
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[130] flex flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label="切り抜きを直す">
      <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-[max(12px,env(safe-area-inset-top))]">
        <button type="button" className="rounded-lg px-2 py-1.5 text-sm font-semibold text-white/80 hover:bg-white/10" onClick={onClose} disabled={saving}>
          やめる
        </button>
        <div className="text-sm font-bold">切り抜きを直す</div>
        <button
          type="button"
          className="rounded-lg px-2 py-1.5 text-sm font-semibold text-white/80 hover:bg-white/10 disabled:opacity-40"
          disabled={saving || !autoQuad}
          onClick={() => autoQuad && setQuad(autoQuad)}
        >
          元に戻す
        </button>
      </div>
      <p className="px-4 pb-2 text-center text-xs text-white/70">4つの角を、レシートの角に合わせてください。</p>

      <div
        ref={stageRef}
        className="relative min-h-0 flex-1 touch-none select-none overflow-hidden"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {imageUrl && bitmap && (
          // eslint-disable-next-line @next/next/no-img-element -- blob URL は next/image の最適化対象外
          <img
            src={imageUrl}
            alt="撮った写真"
            draggable={false}
            className="pointer-events-none absolute max-w-none"
            style={{ left: view.left, top: view.top, width: bitmap.width * view.scale, height: bitmap.height * view.scale, imageOrientation: "from-image" }}
          />
        )}
        {screen && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full">
            <defs>
              <mask id="receipt-crop-mask">
                <rect width="100%" height="100%" fill="white" />
                <polygon points={screen.map((p) => `${p.x},${p.y}`).join(" ")} fill="black" />
              </mask>
            </defs>
            {/* 切り抜く範囲の外を暗くする */}
            <rect width="100%" height="100%" fill="rgba(0,0,0,0.5)" mask="url(#receipt-crop-mask)" />
            <polygon points={screen.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#22c55e" strokeWidth={2} />
          </svg>
        )}
        {screen?.map((p, index) => (
          <div
            key={index}
            role="slider"
            aria-label={["左上の角", "右上の角", "右下の角", "左下の角"][index]}
            aria-valuenow={0}
            className="absolute cursor-grab touch-none rounded-full border-2 border-white bg-emerald-500/80 shadow-lg active:cursor-grabbing"
            style={{ left: p.x - HANDLE_RADIUS, top: p.y - HANDLE_RADIUS, width: HANDLE_RADIUS * 2, height: HANDLE_RADIUS * 2 }}
            onPointerDown={onPointerDown(index)}
          />
        ))}
        <canvas
          ref={loupeRef}
          className={`pointer-events-none absolute top-3 rounded-full border-2 border-white shadow-xl ${dragging === null ? "hidden" : ""} ${loupeOnLeft ? "left-3" : "right-3"}`}
          style={{ width: LOUPE_SIZE, height: LOUPE_SIZE }}
        />
        {!bitmap && !error && <div className="absolute inset-0 grid place-items-center text-sm text-white/70">写真を読み込んでいます…</div>}
      </div>

      {error && <p className="px-4 pt-2 text-center text-xs font-semibold text-amber-300">{error}</p>}
      <div className="px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
        <button
          type="button"
          className="w-full rounded-xl bg-emerald-500 py-3 text-sm font-bold text-white transition hover:bg-emerald-600 disabled:opacity-50"
          disabled={saving || !quad}
          onClick={() => void apply()}
        >
          {saving ? "切り抜いています…" : "この範囲で切り抜く"}
        </button>
      </div>
    </div>,
    document.body,
  );
}
