/*
 * 元: renova project/renova18.5/src/app/proclink/projects/[projectId]/expenses/_components/ReceiptScanner.tsx（2026-11-03 に写した）
 *
 * ProcNova・ProcMana と同じ撮れ方にするための複製。撮影まわりを直したら、向こうにも配ること。
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Loader2, X } from "lucide-react";

import {
  ANALYZE_SIZE,
  MAX_OFFSET,
  QUALITY_MESSAGE,
  analyzeFrame,
  sharpnessOf,
  expandRect,
  isAxisAligned,
  isNearRectangle,
  levelOffset,
  quadSize,
  refineQuad,
  warpQuad,
  type Quad,
  type ScanQuality,
  type ScanRect,
} from "@/lib/receiptScan";

import { rememberReceiptSource } from "./ReceiptCropEditor";

/**
 * レシートのスキャナ。
 *
 * 標準カメラに撮影を任せる（input capture）と、こちらからは何も見えないので
 * 案内も自動撮影もできない。ここではアプリ内にライブ映像を持ち、
 * 毎コマ「いま撮ってよいか」を判定して、良くなった瞬間に自動で撮る。
 *
 *   1. レシートの範囲を検出して枠で囲む（現在の状態を色で見せる）
 *   2. 十分な大きさ・明るさ・ピントが【続けて】満たされたら自動撮影
 *   3. 撮った瞬間に、その枠で切り抜いてから返す（背景を落として文字を大きくする）
 *
 * 【必ずフォールバックを残すこと】
 * getUserMedia は HTTPS でしか動かず、権限も拒否されうる。開けなかったときは
 * 従来のカメラ起動（input capture）へ黙って戻す。撮れないという行き止まりを作らない。
 */

/**
 * レシートの中央を等倍で切り抜いて、ピントを測る。
 *
 * 検出用の縮小画像では測れない。縮小はぼかしと同じ働きをするので、
 * ボケていても数値が上がり、ピント合わせの途中でシャッターが切れてしまう。
 * 中央60%を使うのは、傾けて撮っても紙の上に載るため。
 * 測れないときは null（縮小画像での判定のままにする）。
 */
function measureFocus(
  video: HTMLVideoElement,
  rect: ScanRect,
  canvas: HTMLCanvasElement,
): number | null {
  const sx = (rect.x + rect.width * 0.2) * video.videoWidth;
  const sy = (rect.y + rect.height * 0.2) * video.videoHeight;
  const sw = rect.width * 0.6 * video.videoWidth;
  const sh = rect.height * 0.6 * video.videoHeight;
  if (sw < 16 || sh < 16) return null;

  // 等倍のまま切り出す。大きいときだけ縮める（拡大しても細部は増えない）
  const scale = Math.min(1, FOCUS_CROP_SIZE / Math.max(sw, sh));
  const width = Math.max(1, Math.round(sw * scale));
  const height = Math.max(1, Math.round(sh * scale));
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  context.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
  return sharpnessOf(context.getImageData(0, 0, width, height));
}

/** 自動撮影までに「良い」状態が続く必要のあるコマ数。手ブレの一瞬で撮らないため */
const STABLE_FRAMES = 6;
/** 解析の間隔。毎フレーム回す必要はなく、電池と発熱を抑える */
const ANALYZE_INTERVAL_MS = 100;
/**
 * ピントを測る切り抜きの長辺。
 *
 * 検出は縮小画像で足りるが、ピントは足りない。縮小はぼかしと同じ働きを
 * するので、ボケていても縮小後は数値が上がってしまう（ピント合わせの
 * 途中でシャッターが切れる原因）。レシートの中央を【等倍で】切り抜いて測る。
 * 大きすぎると重いので、この長辺で頭打ちにする。
 */
const FOCUS_CROP_SIZE = 480;
/**
 * ピントが「まだ伸びている」と見なす倍率。
 *
 * 等倍で測った鮮鋭度は端末・レンズ・距離で桁が変わるので、固定の閾値は当てない。
 * 代わりに【同じ場面の中で伸びているか】だけを見る。
 * 直近の新しい半分の平均が、古い半分の平均をこの倍率より上回っていたら
 * 「まだカメラが合わせている途中」とみなして待つ。
 *
 * 生の値どうしを比べないのは、映像のノイズで1コマごとに大きく揺れるため。
 * 揺れで弾き続けると、いつまでも自動で撮れなくなる（一度そうなった）。
 */
const FOCUS_RISING_RATIO = 1.3;
/** 伸びを見るのに使う直近のコマ数。半分ずつに割って平均を比べる */
const FOCUS_HISTORY = 6;

/**
 * ピントが落ち着いたか。
 *
 * 止まっている・下がっているときは true。伸び続けている間だけ false。
 * 判断できるコマ数が溜まるまでは false（合わせ始めに撮らないため）。
 */
function isFocusSettled(history: number[]): boolean {
  if (history.length < FOCUS_HISTORY) return false;
  const half = Math.floor(history.length / 2);
  const average = (values: number[]) =>
    values.reduce((sum, value) => sum + value, 0) / values.length;
  const older = average(history.slice(0, half));
  const newer = average(history.slice(-half));
  if (older <= 0) return true;
  return newer <= older * FOCUS_RISING_RATIO;
}
/** 水準器（右上の四角）の一辺と、画面の端からの余白（CSSピクセル） */
const LEVEL_BOX = 76;
const LEVEL_MARGIN = 14;
/** 中の丸の半径と、中央の目標円の半径 */
const LEVEL_BUBBLE_RADIUS = 9;
const LEVEL_TARGET_RADIUS = 14;
/*
 * 丸の動く量は、撮れる境目（回転・あおりの上限）がちょうど中央の輪の縁に来るように決める。
 * 以前は丸の範囲と撮れる条件を別々の値で持っていたので、丸が輪の中なのに撮れないことがあった。
 */

/** 枠線の太さ（CSSピクセル）。細いと屋外の明るい画面で見えない */
const RING_WIDTH = 6;
/**
 * 枠を前のコマからどれだけ動かすか（0で固定・1で即追従）。
 *
 * 検出はコマごとに数画素ぶれるので、そのまま描くと枠が小刻みに震える。
 * 少しずつ寄せると、追従は保ったまま震えが消える。
 */
const RING_SMOOTHING = 0.35;

/** 撮影する静止画の長辺の上限。OCRに使うので大きすぎても意味がない */
const CAPTURE_MAX_SIDE = 1600;
/**
 * 自動で撮れないまま何コマ過ぎたら、手動シャッターを促すか（100msごとなので8秒）。
 *
 * しきい値は室内の机を想定して決めてあり、現場の照明や机の色によっては
 * いつまでも緑にならないことがありうる。そのとき何の案内も無いと、
 * 撮れないまま画面を見つめることになる。行き止まりを作らないための保険。
 */
const STUCK_FRAMES = 80;

/**
 * 続けて撮るとき、撮ったあと「レシートが画面から外れた」とみなすコマ数（100ms ごとなので 0.8秒）。
 * 撮った直後は同じレシートがまだ写っているので、外れるまで自動では撮らない（同じ1枚を2回撮らない）。
 * 短いと、ピントが一瞬揺れただけで外れたとみなし、同じ1枚をもう一度撮ってしまう。
 */
const SWAP_FRAMES = 8;

type Props = {
  onCapture: (file: File) => void;
  onClose: () => void;
  /** カメラを開けなかったとき。呼び出し側は従来のファイル選択へ切り替える */
  onUnavailable: (reason: string) => void;
  /**
   * 続けて撮る。撮ったあともカメラを開いたままにして、次のレシートに置き換わったらまた自動で撮る。
   * カメラを1枚ごとに開き直すと、Safari の「カメラへのアクセスが許可されています」が毎回出る（2026-11-03 XenoReceipt で追加）。
   */
  continuous?: boolean;
  /** 続けて撮った枚数（見出しに出す） */
  capturedCount?: number;
  /** 撮りためた写真から選ぶ。渡したときだけ、シャッターの右にボタンを出す */
  onPickPhotos?: () => void;
};

const RING_COLOR: Record<ScanQuality, string> = {
  searching: "#94a3b8",
  tooSmall: "#f59e0b",
  tooDark: "#f59e0b",
  offCenter: "#f59e0b",
  tilted: "#f59e0b",
  blurry: "#f59e0b",
  ready: "#22c55e",
};

export function ReceiptScanner({ onCapture, onClose, onUnavailable, continuous = false, capturedCount = 0, onPickPhotos }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  /** 解析用の縮小キャンバス。毎回作ると GC が走るので使い回す */
  const analyzeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  /**
   * 「良い」状態が続いたコマ数。
   * 判定ループから毎回読み書きするので ref に持ち、表示用は state に写す
   * （ref のまま描画に使うと、状態が安定している間は再描画が起きず
   *   進捗バーが止まって見える）。
   */
  const stableRef = useRef(0);
  /** 直近の検出範囲。撮影時の切り抜きに使う */
  const rectRef = useRef<ScanRect | null>(null);
  /** 直近の4隅。斜めから撮ったときの台形補正に使う */
  const quadRef = useRef<Quad | null>(null);
  /** 二重撮影を防ぐ。撮り始めたら解析を止める */
  const capturedRef = useRef(false);
  /** ピントを測る用の作業キャンバス。毎回作らない */
  const focusCanvasRef = useRef<HTMLCanvasElement | null>(null);
  /** 直近の鮮鋭度。まだ伸びている＝ピント合わせの途中、の判定に使う */
  const focusHistoryRef = useRef<number[]>([]);
  /** ピントが落ち着いたか。なぜ撮らないのかを数値表示に出すために持つ */
  const settledRef = useRef(false);
  /**
   * 呼び出し側から渡された関数。ref に写して effect の依存から外す。
   *
   * 親が毎回その場で作った関数を渡すので、依存に入れると親が再描画される
   * たびにカメラを開き直してしまう。ブラウザの「カメラを使用しています」が
   * 何度も降りてきて、映像も一瞬途切れる（実際にそうなっていた）。
   */
  const onCaptureRef = useRef(onCapture);
  const onUnavailableRef = useRef(onUnavailable);
  const continuousRef = useRef(continuous);
  useEffect(() => {
    onCaptureRef.current = onCapture;
    onUnavailableRef.current = onUnavailable;
    continuousRef.current = continuous;
  });
  /** 続けて撮るとき、撮った1枚が画面から外れるのを待っているか。待っている間は自動で撮らない */
  const awaitingSwapRef = useRef(false);
  /** 外れたとみなすまでに数える、レシートの写っていないコマ数 */
  const awayFramesRef = useRef(0);
  const [awaitingSwap, setAwaitingSwap] = useState(false);
  /**
   * 数値表示を開いているか。
   * 解析ループの依存に入れると、開閉のたびにループを張り直すことになるので
   * ref で読む（張り直すとカメラの判定が一瞬途切れる）。
   */
  const showDebugRef = useRef(false);
  /** 枠のちらつきを抑えるため、前のコマの枠を残して少しずつ寄せる */
  const smoothRectRef = useRef<ScanRect | null>(null);
  /** 水準器も同じく少しずつ寄せる。生の値は小刻みに揺れる */
  const smoothTiltRef = useRef(0);
  const smoothSkewRef = useRef(0);

  const [ready, setReady] = useState(false);
  const [quality, setQuality] = useState<ScanQuality>("searching");
  /** 自動撮影までの進み具合（0〜1）。描画のために state で持つ */
  const [progress, setProgress] = useState(0);
  /** 判定の生値。実機でしきい値を詰めるために出す */
  const [debug, setDebug] = useState<{
    sharpness: number;
    /** 等倍で測ったピント。null は測れなかった（範囲が小さすぎる等） */
    focus: number | null;
    /** ピントが落ち着いたか。撮らない理由を切り分けるために出す */
    settled: boolean;
    coverage: number;
    brightness: number;
  } | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [autoCapture, setAutoCapture] = useState(true);
  /** 自動で撮れないまま経過したコマ数。一定を超えたら手動を促す */
  const stuckRef = useRef(0);
  const [stuck, setStuck] = useState(false);
  const [capturing, setCapturing] = useState(false);

  /**
   * 今の映像から静止画を作る。検出できていれば、その範囲＋余白で切り抜く。
   * 切り抜くとレシートが画面いっぱいになるので、同じ長辺でも文字が大きく写る。
   */
  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video || capturedRef.current) return;
    capturedRef.current = true;
    setCapturing(true);

    const fullWidth = video.videoWidth;
    const fullHeight = video.videoHeight;
    if (fullWidth === 0 || fullHeight === 0) {
      capturedRef.current = false;
      setCapturing(false);
      return;
    }

    const canvas = document.createElement("canvas");
    /*
     * 切り抜く前の元の写真。自動の切り抜きがずれたとき、経費の画面の「切り抜きを直す」で
     * 4隅を合わせ直せるように、撮った写真と一緒に渡す（rememberReceiptSource）。
     */
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = fullWidth;
    sourceCanvas.height = fullHeight;
    const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
    sourceContext?.drawImage(video, 0, 0);
    /** 自動で決めた4隅（元の写真の画素座標）。直す画面の最初の位置になる */
    let sourceQuad: Quad | null = null;

    const finish = () => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            capturedRef.current = false;
            setCapturing(false);
            return;
          }
          const file = new File([blob], `receipt-${Date.now()}.jpg`, { type: "image/jpeg" });
          const send = () => {
            onCaptureRef.current(file);
            if (!continuousRef.current) return;
            // 続けて撮る：カメラは開いたまま、次のレシートに置き換わるのを待つ
            capturedRef.current = false;
            setCapturing(false);
            stableRef.current = 0;
            focusHistoryRef.current = [];
            settledRef.current = false;
            awaitingSwapRef.current = true;
            awayFramesRef.current = 0;
            setAwaitingSwap(true);
            setProgress(0);
          };
          if (!sourceContext) {
            send();
            return;
          }
          sourceCanvas.toBlob(
            (original) => {
              if (original) rememberReceiptSource(file, { image: original, quad: sourceQuad });
              send();
            },
            "image/jpeg",
            0.92,
          );
        },
        "image/jpeg",
        0.9,
      );
    };

    /*
     * レシートの4隅から長方形へ引き伸ばして、まっすぐに直す。四隅に残る机が消え、文字も水平にそろう。
     *
     * 解析の4隅は縮小画像で測ったもので、等倍では1度前後ずれる。そのまま使うと
     * 「少し曲がった」切り抜きになるので、撮った画像そのもので紙の縁を測り直す（refineQuad）。
     * 測り直せたときは、わずかな傾きでも直す。測り直せなかったときは前と同じく、
     * はっきり傾いているときだけ粗い4隅で直す（粗い4隅で細かく直すと、かえって曲がる）。
     */
    const quad = quadRef.current;
    const coarseQuad = quad
      ? (quad.map((point) => ({ x: point.x * fullWidth, y: point.y * fullHeight })) as Quad)
      : null;

    if (coarseQuad) {
      // 補正には元画像の画素が要る。等倍で取り出した元の写真から引き伸ばす
      if (sourceContext) {
        const source = sourceContext.getImageData(0, 0, fullWidth, fullHeight);
        const refined = refineQuad(source, coarseQuad, Math.max(fullWidth, fullHeight) / ANALYZE_SIZE);
        const pixelQuad = refined ?? coarseQuad;
        sourceQuad = pixelQuad;
        const shouldWarp = refined ? !isAxisAligned(refined) : !isNearRectangle(coarseQuad);
        if (shouldWarp) {
          /*
           * 引き伸ばしは等倍で行い、縮めるのは最後にブラウザに任せる。
           * 縮めながら引き伸ばすと、画素を飛ばして採るので文字の縁が荒れて読みにくくなる。
           */
          const size = quadSize(pixelQuad);
          const warpWidth = Math.max(1, Math.round(size.width));
          const warpHeight = Math.max(1, Math.round(size.height));
          const warped = warpQuad(source, pixelQuad, warpWidth, warpHeight);
          if (warped) {
            const warpCanvas = document.createElement("canvas");
            warpCanvas.width = warpWidth;
            warpCanvas.height = warpHeight;
            const warpContext = warpCanvas.getContext("2d");
            const scale = Math.min(1, CAPTURE_MAX_SIDE / Math.max(warpWidth, warpHeight));
            canvas.width = Math.max(1, Math.round(warpWidth * scale));
            canvas.height = Math.max(1, Math.round(warpHeight * scale));
            const context = canvas.getContext("2d");
            if (warpContext && context) {
              // createImageData から作る（ImageData の直接生成は型が厳しい）
              const image = warpContext.createImageData(warped.width, warped.height);
              image.data.set(warped.data);
              warpContext.putImageData(image, 0, 0);
              context.imageSmoothingEnabled = true;
              context.imageSmoothingQuality = "high";
              context.drawImage(warpCanvas, 0, 0, canvas.width, canvas.height);
              finish();
              return;
            }
          }
        }
      }
    }

    // 補正しない（まっすぐ／検出できなかった）ときは、範囲を切り出すだけ
    const area = rectRef.current ? expandRect(rectRef.current) : { x: 0, y: 0, width: 1, height: 1 };
    const sx = Math.round(area.x * fullWidth);
    const sy = Math.round(area.y * fullHeight);
    const sw = Math.max(1, Math.round(area.width * fullWidth));
    const sh = Math.max(1, Math.round(area.height * fullHeight));
    const scale = Math.min(1, CAPTURE_MAX_SIDE / Math.max(sw, sh));
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      capturedRef.current = false;
      setCapturing(false);
      return;
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    // 元の写真と同じコマから切る（直す画面で見る写真と、保存する写真を食い違わせない）
    context.drawImage(sourceContext ? sourceCanvas : video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    finish();
    // 依存を空にして関数を作り直さない。作り直すと解析ループも張り直しになる
  }, []);

  // カメラを開く。開けなければ呼び出し側へ知らせて閉じる
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        // HTTPSでない・古い端末。従来のカメラ起動へ戻す
        onUnavailableRef.current("この環境ではカメラを直接開けません。");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            /*
             * 端末が対応していれば 4K をもらう。無理なら自動で落ちる。
             * 1920×1080 だと、レシートを画面いっぱいに写しても長辺が 1500px 前後しかなく、
             * 小さい文字がにじむ。4K で撮って縮める方が、同じ大きさでも文字がくっきりする。
             * 解析は縮小画像で行うので、解像度を上げても判定の重さは変わらない。
             */
            width: { ideal: 3840 },
            height: { ideal: 2160 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        setReady(true);
      } catch (error) {
        if (cancelled) return;
        const name = error instanceof Error ? error.name : "";
        onUnavailableRef.current(
          name === "NotAllowedError"
            ? "カメラの使用が許可されていません。"
            : "カメラを開けませんでした。",
        );
      }
    })();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
    // 開くのは一度だけ。開き直すとカメラの許可表示が毎回出る
  }, []);

  // 判定ループ。良い状態が続いたら自動で撮る
  useEffect(() => {
    if (!ready) return;
    let timer = 0;

    const tick = () => {
      const video = videoRef.current;
      const overlay = overlayRef.current;
      if (!video || video.videoWidth === 0 || capturedRef.current) return;

      // 解析用の縮小画像を作る
      const scale = ANALYZE_SIZE / Math.max(video.videoWidth, video.videoHeight);
      const width = Math.max(1, Math.round(video.videoWidth * scale));
      const height = Math.max(1, Math.round(video.videoHeight * scale));
      const canvas = analyzeCanvasRef.current ?? document.createElement("canvas");
      analyzeCanvasRef.current = canvas;
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      context.drawImage(video, 0, 0, width, height);

      const result = analyzeFrame(context.getImageData(0, 0, width, height));

      /*
       * ピントは等倍でも測る。縮小画像の値は「緑にするか」の目安にはなるが、
       * カメラが合わせている途中かどうかは見分けられない（縮小がぼかしと
       * 同じ働きをするため、途中でも高い値が出る）。
       * 等倍の値は端末ごとに桁が違うので、閾値ではなく伸びの止まり方で見る。
       */
      let focus: number | null = null;
      if (result.rect) {
        const focusCanvas = focusCanvasRef.current ?? document.createElement("canvas");
        focusCanvasRef.current = focusCanvas;
        focus = measureFocus(video, result.rect, focusCanvas);
      }

      rectRef.current = result.rect;
      quadRef.current = result.quad;
      setQuality(result.quality);
      /*
       * 数値は開いているときだけ state に入れる。
       * 毎回新しい object を入れると、閉じていても100msごとに再描画が起き、
       * 映像が乗った画面がちらつく。
       */
      if (showDebugRef.current) {
        setDebug({
          sharpness: result.sharpness,
          focus,
          settled: settledRef.current,
          coverage: result.coverage,
          brightness: result.brightness,
        });
      }

      /*
       * 枠を描く。
       *
       * キャンバスの大きさは【変わったときだけ】設定する。毎回入れ直すと
       * 中身が消えて確保し直しになり、それ自体がちらつきの原因になる。
       * 画面の密度（devicePixelRatio）に合わせておかないと線がぼやける。
       */
      if (overlay) {
        const box = overlay.getBoundingClientRect();
        const ratio = window.devicePixelRatio || 1;
        const pixelWidth = Math.max(1, Math.round(box.width * ratio));
        const pixelHeight = Math.max(1, Math.round(box.height * ratio));
        if (overlay.width !== pixelWidth || overlay.height !== pixelHeight) {
          overlay.width = pixelWidth;
          overlay.height = pixelHeight;
        }
        const paint = overlay.getContext("2d");
        if (paint) {
          paint.setTransform(ratio, 0, 0, ratio, 0, 0);
          paint.clearRect(0, 0, box.width, box.height);

          // 枠は前のコマから少しずつ寄せる。そのまま描くと小刻みに震える
          const target = result.rect;
          const previous = smoothRectRef.current;
          const smooth =
            target === null
              ? null
              : previous === null
                ? target
                : {
                    x: previous.x + (target.x - previous.x) * RING_SMOOTHING,
                    y: previous.y + (target.y - previous.y) * RING_SMOOTHING,
                    width: previous.width + (target.width - previous.width) * RING_SMOOTHING,
                    height: previous.height + (target.height - previous.height) * RING_SMOOTHING,
                  };
          smoothRectRef.current = smooth;

          /*
           * 中央の目安。ここへ収めてもらうと、レンズの歪みが少なく
           * 切り抜きに背景も入りにくい。判定（MAX_OFFSET）と同じ広さで描く。
           */
          const guideWidth = box.width * MAX_OFFSET * 2;
          const guideHeight = box.height * MAX_OFFSET * 2;
          paint.strokeStyle = "rgba(255,255,255,0.35)";
          paint.lineWidth = 1;
          paint.setLineDash([6, 6]);
          paint.strokeRect(
            (box.width - guideWidth) / 2,
            (box.height - guideHeight) / 2,
            guideWidth,
            guideHeight,
          );

          if (smooth) {
            paint.strokeStyle = RING_COLOR[result.quality];
            paint.lineWidth = RING_WIDTH;
            paint.lineJoin = "round";
            paint.setLineDash(result.quality === "ready" ? [] : [14, 10]);
            paint.strokeRect(
              smooth.x * box.width,
              smooth.y * box.height,
              smooth.width * box.width,
              smooth.height * box.height,
            );
          }

          /*
           * 水準器。右上の四角の中の丸が、傾きに合わせて動く。
           *   左右 … 画面の中の回転か、左右のあおりのうち、ずれが大きい方
           *   上下 … 前後のあおり（正面から写せているか）
           * 丸が中央の輪に収まって緑になれば、傾きの条件を満たしている。
           *
           * 緑にする条件は自動撮影の判定（faceOn）そのものを使う。
           * 表示用に別の閾値を持つと「緑なのに撮れない」が必ず起きる。
           */
          if (result.rect) {
            const offset = levelOffset(result);
            const tilt =
              smoothTiltRef.current +
              (offset.x - smoothTiltRef.current) * RING_SMOOTHING;
            const skew =
              smoothSkewRef.current +
              (offset.y - smoothSkewRef.current) * RING_SMOOTHING;
            smoothTiltRef.current = tilt;
            smoothSkewRef.current = skew;

            const boxX = box.width - LEVEL_MARGIN - LEVEL_BOX;
            const boxY = LEVEL_MARGIN;
            const centerX = boxX + LEVEL_BOX / 2;
            const centerY = boxY + LEVEL_BOX / 2;
            const reach = LEVEL_BOX / 2 - LEVEL_BUBBLE_RADIUS - 3;
            const clamp = (value: number) => Math.max(-1, Math.min(1, value));
            // 1（撮れる境目）で輪の縁に来る
            const levelScale = LEVEL_TARGET_RADIUS / reach;
            const bubbleX = centerX + clamp(tilt * levelScale) * reach;
            const bubbleY = centerY + clamp(skew * levelScale) * reach;
            const color = result.faceOn ? "#22c55e" : "#f59e0b";

            paint.setLineDash([]);
            // 四角（背景と枠）
            paint.fillStyle = "rgba(0,0,0,0.35)";
            paint.fillRect(boxX, boxY, LEVEL_BOX, LEVEL_BOX);
            paint.strokeStyle = "rgba(255,255,255,0.5)";
            paint.lineWidth = 1.5;
            paint.strokeRect(boxX, boxY, LEVEL_BOX, LEVEL_BOX);

            // 中央の目標。ここに丸が収まれば水平・正面
            paint.strokeStyle = color;
            paint.lineWidth = 2;
            paint.beginPath();
            paint.arc(centerX, centerY, LEVEL_TARGET_RADIUS, 0, Math.PI * 2);
            paint.stroke();

            // 十字の目安
            paint.strokeStyle = "rgba(255,255,255,0.3)";
            paint.lineWidth = 1;
            paint.beginPath();
            paint.moveTo(boxX + 6, centerY);
            paint.lineTo(boxX + LEVEL_BOX - 6, centerY);
            paint.moveTo(centerX, boxY + 6);
            paint.lineTo(centerX, boxY + LEVEL_BOX - 6);
            paint.stroke();

            // 丸
            paint.fillStyle = color;
            paint.beginPath();
            paint.arc(bubbleX, bubbleY, LEVEL_BUBBLE_RADIUS, 0, Math.PI * 2);
            paint.fill();
          }
        }
      }

      if (awaitingSwapRef.current) {
        // 撮った1枚がまだ写っている。レシートが外れたコマが続いたら、次を撮れるようにする
        awayFramesRef.current = result.quality === "ready" ? 0 : awayFramesRef.current + 1;
        if (awayFramesRef.current >= SWAP_FRAMES) {
          awaitingSwapRef.current = false;
          setAwaitingSwap(false);
        }
        stableRef.current = 0;
        setProgress(0);
        return;
      }

      if (result.quality === "ready") {
        stableRef.current += 1;
        stuckRef.current = 0;
        setStuck(false);

        /*
         * ピントが伸びている間だけ待つ。
         *
         * カメラが合わせている最中は、たまたま「良い」判定のコマが出る。
         * 止まった＝合い切った、と見て撮る。測れなかったときは待たない
         * （旧来どおりの動きに戻す。行き止まりを作らない）。
         */
        if (focus !== null) {
          focusHistoryRef.current = [...focusHistoryRef.current, focus].slice(-FOCUS_HISTORY);
        }
        const settled = focus === null || isFocusSettled(focusHistoryRef.current);
        settledRef.current = settled;

        // 良い状態が続き、かつピントが落ち着いたときだけ撮る
        if (autoCapture && settled && stableRef.current >= STABLE_FRAMES) capture();
      } else {
        stableRef.current = 0;
        // ピントの履歴も捨てる。別の対象を映し直したら測り直す
        focusHistoryRef.current = [];
        settledRef.current = false;
        stuckRef.current += 1;
        if (stuckRef.current === STUCK_FRAMES) setStuck(true);
      }
      setProgress(Math.min(1, stableRef.current / STABLE_FRAMES));
    };

    timer = window.setInterval(tick, ANALYZE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [autoCapture, capture, ready]);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="text-sm font-extrabold text-white">{continuous && capturedCount > 0 ? `${capturedCount}枚 撮りました` : "レシートを撮影"}</div>
        {continuous
          ? <button type="button" onClick={onClose} className="inline-flex h-10 items-center rounded-full bg-white px-4 text-sm font-extrabold text-black">{capturedCount > 0 ? "完了" : "やめる"}</button>
          : <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white"
          >
            <X className="h-5 w-5" strokeWidth={2.4} />
          </button>}
      </div>

      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="h-full w-full object-contain"
        />
        <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />

        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm font-bold text-white">
            <Loader2 className="h-5 w-5 animate-spin" />
            カメラを起動しています…
          </div>
        )}
      </div>

      {/* 状態の表示。色と文言の両方で伝える（色だけだと屋外で分かりにくい） */}
      <div className="px-4 pb-2">
        <div
          className="flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-extrabold text-white transition-colors"
          style={{ backgroundColor: `${RING_COLOR[quality]}33`, border: `2px solid ${RING_COLOR[quality]}` }}
        >
          <span
            className="h-3 w-3 shrink-0 rounded-full"
            style={{ backgroundColor: RING_COLOR[quality] }}
          />
          {capturing ? "撮影しています…" : awaitingSwap ? `${capturedCount}枚目を撮りました。次のレシートに置き換えるか、「完了」を押してください` : QUALITY_MESSAGE[quality]}
        </div>
        {/* 自動撮影までの進み具合。いきなり撮られた感じにしない */}
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/20">
          <div
            className="h-full rounded-full transition-[width] duration-100"
            style={{ width: `${progress * 100}%`, backgroundColor: RING_COLOR.ready }}
          />
        </div>

        {/* 自動で撮れないまま時間が過ぎたら、手動シャッターへ逃がす */}
        {stuck && !capturing && (
          <div className="mt-1.5 rounded-xl bg-white/15 px-3 py-2 text-xs font-bold text-white">
            うまく認識できないときは、下の丸いボタンで撮影できます。
            {quality === "searching" && "（レシートの下に暗い色の紙や下敷きを敷くと認識しやすくなります）"}
          </div>
        )}

        {/*
          判定の生値。しきい値は現場の照明・机の色で最適値が変わるので、
          実機で「なかなか緑にならない」ときに何が足りていないかを見えるようにする。
        */}
        <button
          type="button"
          onClick={() =>
            setShowDebug((current) => {
              // 解析ループは ref を見るので、state と一緒に写しておく
              showDebugRef.current = !current;
              return !current;
            })
          }
          className="mt-1.5 w-full text-left text-[10px] font-bold text-white/40"
        >
          {showDebug && debug
            ? `判定 ${quality}／ピント ${debug.sharpness.toFixed(2)}（1.20以上でOK）／等倍 ${debug.focus === null ? "—" : debug.focus.toFixed(2)}${debug.settled ? "・落ち着いた" : "・まだ動いている"}／大きさ ${(debug.coverage * 100).toFixed(0)}%（12%以上）／明るさ ${debug.brightness.toFixed(0)}（60以上）`
            : "詳しい数値を表示"}
        </button>
      </div>

      <div className="flex items-center justify-between gap-3 px-4 pb-6 pt-1">
        <label className="flex items-center gap-2 text-xs font-bold text-white/80">
          <input
            type="checkbox"
            checked={autoCapture}
            onChange={(event) => {
              // 入れ直した直後に撮らないよう、進み具合とピントの履歴を捨てる
              stableRef.current = 0;
              focusHistoryRef.current = [];
              setAutoCapture(event.target.checked);
            }}
            className="h-4 w-4"
          />
          自動で撮る
        </label>

        {/* 自動が効かない場面（白い机の上など）でも必ず撮れるようにする */}
        <button
          type="button"
          onClick={capture}
          disabled={!ready || capturing}
          aria-label="撮影"
          className="inline-flex h-16 w-16 items-center justify-center rounded-full border-4 border-white bg-white/20 text-white disabled:opacity-40"
        >
          <Camera className="h-7 w-7" />
        </button>

        {onPickPhotos
          ? <button type="button" onClick={onPickPhotos} className="w-16 text-center text-xs font-bold text-white/80 underline">写真から</button>
          : <span className="w-16" />}
      </div>
    </div>
  );
}
