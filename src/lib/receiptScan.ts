/*
 * 元: renova project/renova18.5/src/lib/receiptScan.ts（2026-11-03 に写した）。
 * 外部依存ゼロの純粋な計算。ProcNova・ProcMana と撮れ方をそろえるため、直したら向こうにも配ること。
 */
/**
 * レシート撮影の画像解析。
 *
 * ライブ映像の1コマを縮小して調べ、「いま撮ってよいか」を判定する。
 * iOS Safari からはカメラのピント状態を読めないので、鮮鋭度を自分で測る。
 *
 * 判定に使うのは3つだけ:
 *   1. レシートらしい明るい塊が写っているか（＋その範囲）
 *   2. その範囲が十分な大きさか（小さすぎると文字が潰れる）
 *   3. ピントが合っているか（鮮鋭度）
 *
 * すべて縮小画像（長辺 ANALYZE_SIZE）の上で行う。実寸で回すとスマホで
 * コマ落ちする。判定さえ通れば、切り抜きは元の解像度で行う。
 *
 * DOM に依存しない純粋な計算だけを置く（テスト・検証がしやすいように）。
 */

/** 解析に使う縮小画像の長辺。これ以上大きくしても判定は良くならない */
export const ANALYZE_SIZE = 320;

/**
 * 画素の入れ物。ブラウザの ImageData をそのまま渡せる形にしてある。
 * ImageData 型を直接使わないのは、この寸法計算を DOM の無いところでも
 * 動かして検証したいため（ImageData はブラウザにしか無い）。
 */
export type Frame = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

export type ScanRect = {
  /** 0〜1 の相対座標。実寸に掛けて使う */
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ScanQuality =
  /** レシートらしいものが見つからない */
  | "searching"
  /** 見つかったが小さい。近づいてほしい */
  | "tooSmall"
  /** 暗すぎる */
  | "tooDark"
  /** 画面の端に寄っている */
  | "offCenter"
  /** 斜めから写している。台形に見えている */
  | "tilted"
  /** ピントが甘い、または手ブレ */
  | "blurry"
  /** 撮ってよい */
  | "ready";

export type ScanResult = {
  quality: ScanQuality;
  /** 検出したレシートの範囲（相対座標）。見つからなければ null */
  rect: ScanRect | null;
  /** レシートの4隅（相対座標・左上右上右下左下）。台形補正に使う */
  quad: Quad | null;
  /** 鮮鋭度スコア。しきい値との比較用に生値も返す */
  sharpness: number;
  /**
   * 上辺の水平からのずれ（度）。0 が水平。水準器の【左右】に使う。
   * 4隅が取れないときは 0。
   */
  tiltDegrees: number;
  /**
   * 上辺と下辺の長さの差（-1〜1）。0 が正面。水準器の【上下】に使う。
   *
   * 手前に倒すと下辺が長く写り、奥に倒すと上辺が長く写る。
   * 台形の度合いそのものなので、あおりの向きと量がこれで分かる。
   */
  skewRatio: number;
  /**
   * 左辺と右辺の長さの差（-1〜1）。0 が正面。右辺が長いと正。
   * 端末を左右に倒したときのゆがみ。水準器の【左右】に、回転と合わせて使う。
   */
  sideSkewRatio: number;
  /** 上下のあおりの上限（skewLimitFor）。写っている長さで変わる */
  skewLimit: number;
  /** 左右のあおりの上限（skewLimitFor） */
  sideSkewLimit: number;
  /**
   * 正面から写せているか（自動撮影の傾き条件と同じ判定）。
   *
   * 水準器の色はこれで決める。表示用に別の閾値を持つと
   * 「緑なのに撮れない」というズレが必ず起きる。
   */
  faceOn: boolean;
  /** 画面に占める割合（0〜1） */
  coverage: number;
  /** 画面全体の明るさ（0〜255） */
  brightness: number;
};

/**
 * 判定のしきい値。
 *
 * 実機（iPhone・室内・机の上のレシート）で詰めた値。厳しくしすぎると
 * いつまでも自動撮影されず、緩めるとピンボケが通る。迷ったら緩めにして、
 * 手動シャッターを残す方に倒している（撮れないより、撮れて撮り直せる方がよい）。
 */
const MIN_COVERAGE = 0.12;
/**
 * 長い辺がここまで画面に写っていれば、面積が小さくても「近づけて」とは言わない。
 *
 * 長いレシートを丸ごと収めると、縦は画面いっぱいでも幅が細く、面積は
 * MIN_COVERAGE を割る。そこで「近づけて」と出すと、近づけば端が切れるので
 * 行き止まりになっていた。
 */
const FULL_LENGTH = 0.75;
/**
 * 画面のほとんどが「明るい塊」になったら、検出できていないとみなす。
 * 白いテーブルの上の白いレシートで起きる（紙と机の区別がつかず全面が明るい）。
 * ここで弾かないと、画面全体を切り抜いて「検出できた」顔をしてしまう。
 */
const MAX_COVERAGE = 0.9;
/** 検出した枠の中が明るい画素で埋まっている割合の下限。散らばった反射を落とす */
const MIN_FILL_RATIO = 0.4;
/** レシート面の明るさ。画面全体ではなく紙の上で測る（暗い机の上でも通るように） */
const MIN_BRIGHTNESS = 60;
/**
 * 画面全体が暗すぎる。検出できない理由が「暗さ」なのか「写っていない」のか
 * 区別できないと、真っ暗な場所で「レシートを枠に入れてください」と出続ける。
 * 先に暗さを見て、明かりを点けるよう伝える。
 */
const VERY_DARK = 40;
/**
 * 鮮鋭度のしきい値。
 *
 * ラプラシアン分散はコントラストの2乗に比例して増えるので、生値のままだと
 * 照明や紙の白さでスケールが変わり、機種ごとにしきい値を決め直す羽目になる。
 * 輝度の分散で割って正規化し、「同じ絵がボケているか」だけを見るようにする。
 */
/**
 * 縮小画像で「ボケている」と出す下限。実機で詰めた値なので動かさない。
 *
 * これは【緑にするかどうか】の目安で、ピント合わせが終わったかどうかは
 * 見分けられない。縮小はぼかしと同じ働きをするので、合わせている途中でも
 * この値を超えてしまう。自動シャッターの可否は、等倍で測った値が
 * 伸び止まったかどうか（sharpnessOf と呼び出し側の判定）で決めること。
 */
export const MIN_SHARPNESS = 1.2;

/**
 * 正面から写していると見なす、あおり（台形のゆがみ）の上限。
 * 向かい合う辺の長さの差（-1〜1）で見る。上辺と下辺、左辺と右辺の両方。
 *
 * 斜めから写すと、台形補正で長方形へ直せはするが、引き伸ばすぶん
 * 文字がぼけて読み取りの精度が落ちる。自動で撮るときは
 * 「まっすぐ上から」を待った方が結果が良い。
 *
 * 以前は「各辺が画面の水平・垂直からどれだけずれているか」で見ていたが、
 * それだと台形のゆがみと、レシートが画面の中で少し回っているだけの状態を
 * 区別できなかった。縦長のレシートでは2度ほど回っただけで「斜め」と判定され、
 * 水準器の丸は中央にあるのに撮れない、ということが起きていた。
 * 回っているだけなら台形補正でまっすぐに戻るので、ゆがみとは分けて見る。
 *
 * この値は、レシートが画面の半分ほどの長さに写っているときのもの（SKEW_REFERENCE_LENGTH）。
 * 実際の上限は写っている長さで広げる（skewLimitFor）。
 */
export const MAX_SKEW = 0.08;

/**
 * MAX_SKEW をそのまま使ってよい、写っている長さ（画面に対する比）。
 *
 * 同じ角度だけ端末を倒しても、上辺と下辺の長さの差は【写っている長さ】に比例して
 * 大きくなる（遠い端と近い端の距離の差が開くため）。長いレシートを丸ごと収めると、
 * ほんの少し倒しただけで MAX_SKEW を超え、「まっすぐ上から」がいつまでも消えなかった。
 * そこで、これより長く写っているときは、長さに合わせて上限を広げる。
 * 角度で見ると同じ傾きまで許していることになる。
 */
const SKEW_REFERENCE_LENGTH = 0.5;

/** 写っている長さ（画面に対する比）から、あおりの上限を出す */
export function skewLimitFor(length: number): number {
  return MAX_SKEW * Math.max(1, length / SKEW_REFERENCE_LENGTH);
}

/**
 * 画面の中でレシートが回っていてよい角度（度）。
 *
 * 回っているだけなら4隅からの補正で文字は水平に戻るので、読み取りには響かない。
 * ただ大きく回すとレシートの端が画面から切れやすいので、ほどほどに抑える。
 */
export const MAX_ROTATION_DEG = 10;

/**
 * 画面の中央からどれだけ離れてよいか（画面の幅・高さに対する比）。
 *
 * 端に寄っていると、レンズの歪みで文字が伸び、切り抜きに背景も入りやすい。
 * 中央に寄せてもらった方が読み取りの精度が上がる。
 * 厳しくすると手持ちでは合わせ続けられないので、かなり緩めにしてある。
 */
export const MAX_OFFSET = 0.12;

/** 縮小画像のグレースケール輝度配列を作る */
export function toGrayscale(data: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < gray.length; i += 1, p += 4) {
    // 人の目の感度に合わせた重み付け。単純平均より文字と紙の差が出る
    gray[i] = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
  }
  return gray;
}

export type RegionStats = { mean: number; variance: number };

/** 範囲内の平均輝度と分散。範囲を省くと画面全体 */
export function regionStats(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  region?: { x0: number; y0: number; x1: number; y1: number },
): RegionStats {
  const x0 = Math.max(0, region?.x0 ?? 0);
  const y0 = Math.max(0, region?.y0 ?? 0);
  const x1 = Math.min(width, region?.x1 ?? width);
  const y1 = Math.min(height, region?.y1 ?? height);
  let sum = 0;
  let sumSquares = 0;
  let count = 0;
  for (let y = y0; y < y1; y += 1) {
    const row = y * width;
    for (let x = x0; x < x1; x += 1) {
      const value = gray[row + x];
      sum += value;
      sumSquares += value * value;
      count += 1;
    }
  }
  if (count === 0) return { mean: 0, variance: 0 };
  const mean = sum / count;
  return { mean, variance: Math.max(0, sumSquares / count - mean * mean) };
}

/**
 * 鮮鋭度（ラプラシアン分散）。
 *
 * ピントが合っていると輪郭が立ち、2階微分の散らばりが大きくなる。
 * ボケていると輪郭がなだらかになり値が小さくなる。ピント判定の定番手法で、
 * カメラのフォーカス状態を読めない環境ではこれを代わりに使う。
 *
 * レシートの範囲だけを見る（背景の木目やコードが鮮明でも意味がないため）。
 */
export function laplacianVariance(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  region?: { x0: number; y0: number; x1: number; y1: number },
): number {
  const x0 = Math.max(1, region?.x0 ?? 1);
  const y0 = Math.max(1, region?.y0 ?? 1);
  const x1 = Math.min(width - 1, region?.x1 ?? width - 1);
  const y1 = Math.min(height - 1, region?.y1 ?? height - 1);
  if (x1 <= x0 || y1 <= y0) return 0;

  let sum = 0;
  let sumSquares = 0;
  let count = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = y * width + x;
      // 4近傍ラプラシアン
      const value = gray[i - 1] + gray[i + 1] + gray[i - width] + gray[i + width] - 4 * gray[i];
      sum += value;
      sumSquares += value * value;
      count += 1;
    }
  }
  if (count === 0) return 0;
  const mean = sum / count;
  return sumSquares / count - mean * mean;
}

/**
 * 大津の二値化のしきい値。
 *
 * 「明るい／暗い」の境目を、画像の輝度分布から自動で決める。
 * 最小値と最大値の中間で決める方式だと、光の反射（極端に明るい1点）や
 * 影（極端に暗い1点）だけで境目が動き、紙が文字の行で分断されたりする。
 * 大津法は分布全体を見て、2つの山がいちばんよく分かれる位置を選ぶ。
 */
export function otsuThreshold(gray: Uint8ClampedArray): number {
  const histogram = new Int32Array(256);
  for (let i = 0; i < gray.length; i += 1) histogram[gray[i]] += 1;

  const total = gray.length;
  let sum = 0;
  for (let value = 0; value < 256; value += 1) sum += value * histogram[value];

  let sumBackground = 0;
  let weightBackground = 0;
  let best = 0;
  let bestVariance = -1;
  for (let value = 0; value < 256; value += 1) {
    weightBackground += histogram[value];
    if (weightBackground === 0) continue;
    const weightForeground = total - weightBackground;
    if (weightForeground === 0) break;
    sumBackground += value * histogram[value];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    // クラス間分散が最大になる位置が、2つの山のいちばん良い境目
    const variance = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      best = value;
    }
  }
  return best;
}

/**
 * 二値マスクの膨張・収縮（縦横に分けて計算する）。
 *
 * 膨張してから収縮する（closing）と、細い隙間だけが埋まって外形は元に戻る。
 * レシートの文字は細い暗線なので、これで紙が一続きの面になる。
 * ぼかして平均を取る方式にしないのは、しきい値との差が紙の明るさによって
 * 変わり、暗い場面で文字が埋まりきらずに紙が分断されたため。
 */
function morph(mask: Uint8Array, width: number, height: number, radius: number, dilate: boolean): Uint8Array {
  const hit = dilate ? 1 : 0;
  const horizontal = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      let found = false;
      for (let d = -radius; d <= radius && !found; d += 1) {
        const nx = x + d;
        if (nx < 0 || nx >= width) continue;
        if (mask[row + nx] === hit) found = true;
      }
      horizontal[row + x] = found ? hit : 1 - hit;
    }
  }
  const result = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let found = false;
      for (let d = -radius; d <= radius && !found; d += 1) {
        const ny = y + d;
        if (ny < 0 || ny >= height) continue;
        if (horizontal[ny * width + x] === hit) found = true;
      }
      result[y * width + x] = found ? hit : 1 - hit;
    }
  }
  return result;
}

/** 文字の細い隙間を埋める。膨張→収縮 */
export function closeMask(mask: Uint8Array, width: number, height: number, radius = 2): Uint8Array {
  return morph(morph(mask, width, height, radius, true), width, height, radius, false);
}

/**
 * 明るい塊（＝レシート）の範囲を探す。
 *
 * 【つながった塊で選ぶ】
 * 明るい画素の広がりを行・列で数えて外接矩形にすると、離れた場所にある
 * 2つの白い物体をまとめて囲んでしまう（実機で、机の上の白いキーボードごと
 * 切り抜かれた）。そこで「つながっている塊」を数え上げ、いちばん大きい塊
 * だけを採る。レシートとキーボードは机の暗い部分で切れているので分離できる。
 *
 * 【この方法が苦手なケース】
 * 白いテーブルの上の白いレシート。明暗の差が出ないので塊が取れない。
 * その場合は null を返し、画面は「レシートを枠に入れてください」のまま
 * 手動シャッターに委ねる（無理に検出して誤った位置で切り抜かない）。
 */
export type Component = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  size: number;
  /** 塊の4隅（画素座標） */
  quad: Quad;
};

/**
 * 二値マスクの中で、つながっている塊のうちいちばん大きいものを返す。
 *
 * 明るさで探す場合も、文字のざらつきで探す場合も、最後にやることは同じ
 * （散らばった小さな塊を捨てて、いちばん大きい面だけを採る）なので共通にする。
 * 再帰ではなくスタックでたどる（画面いっぱいの塊だと再帰では深くなりすぎる）。
 */
export function largestComponent(mask: Uint8Array, width: number, height: number): Component | null {
  const visited = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  let best: Component | null = null;

  for (let start = 0; start < visited.length; start += 1) {
    if (visited[start] || mask[start] === 0) continue;
    let top = 0;
    stack[top++] = start;
    visited[start] = 1;

    let size = 0;
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    // 4隅の候補。塊をたどりながら x+y と x-y の両端を覚えておく
    let tl = { x: 0, y: 0 };
    let tr = { x: 0, y: 0 };
    let br = { x: 0, y: 0 };
    let bl = { x: 0, y: 0 };
    let minSum = Infinity;
    let maxSum = -Infinity;
    let minDiff = Infinity;
    let maxDiff = -Infinity;

    while (top > 0) {
      const index = stack[--top];
      const x = index % width;
      const y = (index - x) / width;
      size += 1;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      const sum = x + y;
      const diff = x - y;
      if (sum < minSum) { minSum = sum; tl = { x, y }; }
      if (sum > maxSum) { maxSum = sum; br = { x, y }; }
      if (diff > maxDiff) { maxDiff = diff; tr = { x, y }; }
      if (diff < minDiff) { minDiff = diff; bl = { x, y }; }

      // 上下左右へ広げる
      if (x > 0 && !visited[index - 1] && mask[index - 1]) {
        visited[index - 1] = 1;
        stack[top++] = index - 1;
      }
      if (x < width - 1 && !visited[index + 1] && mask[index + 1]) {
        visited[index + 1] = 1;
        stack[top++] = index + 1;
      }
      if (y > 0 && !visited[index - width] && mask[index - width]) {
        visited[index - width] = 1;
        stack[top++] = index - width;
      }
      if (y < height - 1 && !visited[index + width] && mask[index + width]) {
        visited[index + width] = 1;
        stack[top++] = index + width;
      }
    }

    if (!best || size > best.size) best = { x0, y0, x1, y1, size, quad: [tl, tr, br, bl] };
  }

  if (!best || best.x1 < best.x0 || best.y1 < best.y0) return null;
  return best;
}

/**
 * 明るい塊（＝レシート）の範囲を探す。
 *
 * 【つながった塊で選ぶ】
 * 明るい画素の広がりを行・列で数えて外接矩形にすると、離れた場所にある
 * 2つの白い物体をまとめて囲んでしまう（実機で、机の上の白いキーボードごと
 * 切り抜かれた）。そこで「つながっている塊」を数え上げ、いちばん大きい塊
 * だけを採る。レシートとキーボードは机の暗い部分で切れているので分離できる。
 *
 * 【この方法が苦手なケース】
 * 白いテーブルの上の白いレシート。明暗の差が出ないので塊が取れない。
 * その場合は null を返し、呼び出し側が文字のざらつきによる検出へ回す。
 */
export function findBrightRegion(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
): { rect: ScanRect; quad: Quad } | null {
  let min = 255;
  let max = 0;
  for (let i = 0; i < gray.length; i += 1) {
    if (gray[i] < min) min = gray[i];
    if (gray[i] > max) max = gray[i];
  }
  // 明暗差が乏しい（白い机の上の白い紙、真っ暗など）。無理に検出しない
  if (max - min < 40) return null;

  /*
   * 大津法が返す値は「その値以下が暗い側」を指す境目なので、
   * 明るい側は【しきい値より大きい】画素。>= にすると背景の輝度が
   * そのまま境目になった場面で画面全体が明るい扱いになる。
   */
  const threshold = otsuThreshold(gray);
  const raw = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i += 1) raw[i] = gray[i] > threshold ? 1 : 0;
  // 文字で紙が分断されないよう、細い隙間を埋めてから塊を数える
  const mask = closeMask(raw, width, height);

  const best = largestComponent(mask, width, height);
  if (!best) return null;

  /*
   * 塊が外接矩形をどれだけ埋めているか。斜めに細長い反射などを落とす。
   * レシートは四角いので、まっすぐ写っていれば9割方埋まる。
   */
  const area = (best.x1 - best.x0 + 1) * (best.y1 - best.y0 + 1);
  if (area === 0 || best.size / area < MIN_FILL_RATIO) return null;

  const rect = {
    x: best.x0 / width,
    y: best.y0 / height,
    width: (best.x1 - best.x0 + 1) / width,
    height: (best.y1 - best.y0 + 1) / height,
  };
  // 画面いっぱいなら、紙と背景を分離できていない。検出しなかったことにする
  if (rect.width * rect.height > MAX_COVERAGE) return null;

  // 4隅も相対座標にそろえる（実寸に掛けて使えるように）
  const quad = best.quad.map((p) => ({ x: p.x / width, y: p.y / height })) as Quad;
  return { rect, quad };
}

/**
 * 文字のざらつきで紙を探す（明るさで分離できないときの代わり）。
 *
 * 白いテーブルの上に置いた白いレシートは、明暗の差が出ないので明るさでは
 * 切り出せない。ただしレシートには文字が印字されていて、無地の机には何も無い。
 * 小さな区画ごとの輝度の散らばりを見れば、「文字のある面」と「のっぺりした面」
 * を分けられる。
 *
 * 木目の机では木目自体がざらつくのでこの方法は当てにならないが、
 * その場合は明るさでの検出が先に成功しているので出番が無い。
 */
export function findTexturedRegion(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
): { rect: ScanRect; quad: Quad } | null {
  const block = 8;
  const cols = Math.floor(width / block);
  const rows = Math.floor(height / block);
  if (cols < 4 || rows < 4) return null;

  // 区画ごとの散らばり（標準偏差）を出す
  const spread = new Uint8ClampedArray(cols * rows);
  for (let by = 0; by < rows; by += 1) {
    for (let bx = 0; bx < cols; bx += 1) {
      let sum = 0;
      let sumSquares = 0;
      for (let y = by * block; y < (by + 1) * block; y += 1) {
        const row = y * width;
        for (let x = bx * block; x < (bx + 1) * block; x += 1) {
          const value = gray[row + x];
          sum += value;
          sumSquares += value * value;
        }
      }
      const count = block * block;
      const mean = sum / count;
      spread[by * cols + bx] = Math.min(255, Math.sqrt(Math.max(0, sumSquares / count - mean * mean)));
    }
  }

  // ざらついた区画を、明るさのときと同じ手順（大津→closing→最大の塊）で拾う
  let min = 255;
  let max = 0;
  for (let i = 0; i < spread.length; i += 1) {
    if (spread[i] < min) min = spread[i];
    if (spread[i] > max) max = spread[i];
  }
  // 全体が一様（真っ白な机だけ、など）。文字が無いので紙も無い
  if (max - min < 8) return null;

  const threshold = otsuThreshold(spread);
  const raw = new Uint8Array(spread.length);
  for (let i = 0; i < spread.length; i += 1) raw[i] = spread[i] > threshold ? 1 : 0;
  const mask = closeMask(raw, cols, rows, 1);

  const found = largestComponent(mask, cols, rows);
  if (!found) return null;

  const rect = {
    x: (found.x0 * block) / width,
    y: (found.y0 * block) / height,
    width: ((found.x1 - found.x0 + 1) * block) / width,
    height: ((found.y1 - found.y0 + 1) * block) / height,
  };
  if (rect.width * rect.height > MAX_COVERAGE) return null;

  // 区画単位なので4隅は粗い。台形補正には使わず、外接矩形として扱う
  const quad = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ] as Quad;
  return { rect, quad };
}

/**
 * 明るい塊で見つけた範囲の4隅を、紙の縁の直線から出し直す（findEdgeQuad）。
 * 直線で出せないとき（縁が画面から切れている・机と紙の差が無い）は、明るい塊のままにする。
 */
function withStraightEdges(
  found: { rect: ScanRect; quad: Quad } | null,
  gray: Uint8ClampedArray,
  width: number,
  height: number,
): { rect: ScanRect; quad: Quad } | null {
  if (!found) return null;
  const box = {
    x0: Math.floor(found.rect.x * width),
    y0: Math.floor(found.rect.y * height),
    x1: Math.ceil((found.rect.x + found.rect.width) * width) - 1,
    y1: Math.ceil((found.rect.y + found.rect.height) * height) - 1,
  };
  const edges = findEdgeQuad(gray, width, height, box);
  // 角が画面の外に出る＝紙が画面から切れている。直線の交点は当てにならない
  if (!edges || edges.some((p) => p.x < -1 || p.y < -1 || p.x > width || p.y > height)) return found;
  const xs = edges.map((p) => Math.min(width, Math.max(0, p.x)));
  const ys = edges.map((p) => Math.min(height, Math.max(0, p.y)));
  const rect = {
    x: Math.min(...xs) / width,
    y: Math.min(...ys) / height,
    width: (Math.max(...xs) - Math.min(...xs)) / width,
    height: (Math.max(...ys) - Math.min(...ys)) / height,
  };
  return { rect, quad: edges.map((p) => ({ x: p.x / width, y: p.y / height })) as Quad };
}

/** 1コマを判定する。呼び出し側は縮小済みの ImageData を渡す */
export function analyzeFrame(image: Frame): ScanResult {
  const { width, height } = image;
  const gray = toGrayscale(image.data, width, height);
  /*
   * まず明るさで探し、取れなければ文字のざらつきで探す。
   * 明るさは暗い机の上で確実に効き、ざらつきは白い机の上で効く。
   */
  const found = withStraightEdges(findBrightRegion(gray, width, height), gray, width, height) ??
    findTexturedRegion(gray, width, height);
  const rect = found?.rect ?? null;
  const quad = found?.quad ?? null;
  const coverage = rect ? rect.width * rect.height : 0;

  /*
   * 明るさも鮮鋭度も【レシートの範囲だけ】で測る。
   * 画面全体で測ると、暗い机の上に置かれた明るいレシートが「暗すぎる」になり、
   * 背景の木目にピントが合っているだけで「くっきり」と判定されてしまう。
   */
  /*
   * 測るのは検出範囲の【中央60%】。
   *
   * 外接矩形いっぱいで測ると、レシートが傾いているぶん四隅に背景が入る。
   * 背景と紙の明暗差で輝度分散が膨らみ、同じ鮮明さでも正規化した鮮鋭度が
   * 下がって「ボケている」と判定されてしまう（傾けて撮るほど不利になる）。
   * 中央なら、どんな傾きでもまず紙の上に載る。
   */
  const region = rect
    ? {
        x0: Math.round((rect.x + rect.width * 0.2) * width),
        y0: Math.round((rect.y + rect.height * 0.2) * height),
        x1: Math.round((rect.x + rect.width * 0.8) * width),
        y1: Math.round((rect.y + rect.height * 0.8) * height),
      }
    : undefined;
  const tilt = measureTilt(quad, width, height);
  const { tiltDegrees, skewRatio, sideSkewRatio, skewLimit, sideSkewLimit } = tilt;

  /** 自動撮影の傾き条件。水準器の色もこれに合わせる */
  const faceOn = quad !== null && isFaceOn(tilt);

  const stats = regionStats(gray, width, height, region);
  const brightness = stats.mean;
  // 輝度の分散で正規化して、照明・紙の白さでスケールが変わらないようにする
  const sharpness = laplacianVariance(gray, width, height, region) / (stats.variance + 1);
  const overall = rect ? regionStats(gray, width, height).mean : brightness;

  const quality: ScanQuality =
    overall < VERY_DARK
      ? "tooDark"
      : rect === null
        ? "searching"
        : coverage < MIN_COVERAGE && Math.max(rect.width, rect.height) < FULL_LENGTH
          ? "tooSmall"
          : brightness < MIN_BRIGHTNESS
            ? "tooDark"
            : /*
               * 構えを先に直してもらう。位置 → 傾き → ピントの順。
               * 斜めや端に寄ったままピントだけ合っても、読み取りは良くならない。
               */
              rect !== null &&
                (Math.abs(rect.x + rect.width / 2 - 0.5) > MAX_OFFSET ||
                  Math.abs(rect.y + rect.height / 2 - 0.5) > MAX_OFFSET)
              ? "offCenter"
              : quad !== null && !faceOn
                ? "tilted"
                : sharpness < MIN_SHARPNESS
                  ? "blurry"
                  : "ready";

  return {
    quality,
    rect,
    quad,
    sharpness,
    tiltDegrees,
    skewRatio,
    sideSkewRatio,
    skewLimit,
    sideSkewLimit,
    faceOn,
    coverage,
    brightness,
  };
}

export type Tilt = {
  tiltDegrees: number;
  skewRatio: number;
  sideSkewRatio: number;
  skewLimit: number;
  sideSkewLimit: number;
};

/**
 * 4隅から、回転（度）とあおり（上下・左右）を測る。
 * 正規化座標のままでは画面の縦横比で角度や長さが歪むので、画素の座標に直して測る。
 *
 * あおりの上限も一緒に返す。上下のあおりは縦に写っている長さ、
 * 左右のあおりは横に写っている長さで広がる（skewLimitFor）。
 */
export function measureTilt(quad: Quad | null, width: number, height: number): Tilt {
  if (!quad) return { tiltDegrees: 0, skewRatio: 0, sideSkewRatio: 0, skewLimit: MAX_SKEW, sideSkewLimit: MAX_SKEW };
  const [tl, tr, br, bl] = quad.map((point) => ({ x: point.x * width, y: point.y * height }));
  const top = (Math.atan2(tr.y - tl.y, tr.x - tl.x) * 180) / Math.PI;
  const bottom = (Math.atan2(br.y - bl.y, br.x - bl.x) * 180) / Math.PI;
  const lengthDifference = (a: number, b: number) => (a + b > 0 ? (a - b) / (a + b) : 0);
  const verticalLength = (distance(tl, bl) + distance(tr, br)) / 2 / height;
  const horizontalLength = (distance(tl, tr) + distance(bl, br)) / 2 / width;
  return {
    tiltDegrees: (top + bottom) / 2,
    skewRatio: lengthDifference(distance(bl, br), distance(tl, tr)),
    sideSkewRatio: lengthDifference(distance(tr, br), distance(tl, bl)),
    skewLimit: skewLimitFor(verticalLength),
    sideSkewLimit: skewLimitFor(horizontalLength),
  };
}

/** 正面から写せているか。回転とあおりを別々に見る（回転は補正で戻るので緩い） */
export function isFaceOn(tilt: Tilt): boolean {
  return (
    Math.abs(tilt.tiltDegrees) <= MAX_ROTATION_DEG &&
    Math.abs(tilt.skewRatio) <= tilt.skewLimit &&
    Math.abs(tilt.sideSkewRatio) <= tilt.sideSkewLimit
  );
}

/**
 * 水準器の丸の位置（-1〜1 に収めない生の値）。1 が「ここを超えると撮れない」境目。
 *   左右 … 回転と左右のあおりのうち、境目に近い方
 *   上下 … 上下のあおり
 * 境目を中央の輪の縁に合わせて描けば、丸が輪の中にある＝撮れる、がそのまま一致する。
 */
export function levelOffset(tilt: Tilt): { x: number; y: number } {
  const rotation = tilt.tiltDegrees / MAX_ROTATION_DEG;
  const side = tilt.sideSkewRatio / tilt.sideSkewLimit;
  return {
    x: Math.abs(rotation) >= Math.abs(side) ? rotation : side,
    y: tilt.skewRatio / tilt.skewLimit,
  };
}

export const QUALITY_MESSAGE: Record<ScanQuality, string> = {
  searching: "レシートを枠に入れてください",
  offCenter: "レシートを画面の中央に寄せてください",
  tilted: "まっすぐ上から写してください",
  tooSmall: "もう少し近づけてください",
  tooDark: "明るい場所で撮ってください",
  blurry: "ピントを合わせています…動かさないでください",
  ready: "そのまま静止してください",
};

/**
 * 切り抜く範囲。検出した範囲に余白を足す。
 *
 * ぴったりで切ると、端の文字（合計金額が一番下にあることが多い）が
 * 欠けることがある。読み取りたいのは「合計」なので、切りすぎるより
 * 少し背景が残る方が安全。
 */
export const CROP_MARGIN = 0.025;

/**
 * 渡された画像そのものの鮮鋭度。
 *
 * ラプラシアンの分散を輝度の分散で割って、照明や紙の白さでスケールが
 * 変わらないようにしている。呼ぶ側が【レシートの中央あたりを等倍で
 * 切り抜いて】渡すこと。縮小画像を渡すと、ボケていても高い値が出る。
 *
 * 【この値に固定の閾値を当てないこと】
 * 端末・レンズ・被写体までの距離で桁が変わる。使い方は「同じ場面の中で
 * 伸びが止まったか」を見る相対判定に限る。固定値を当てると、機種によって
 * いつまでも撮れない／ボケたまま撮る、のどちらかになる。
 */
export function sharpnessOf(image: Frame): number {
  const gray = toGrayscale(image.data, image.width, image.height);
  const stats = regionStats(gray, image.width, image.height);
  return laplacianVariance(gray, image.width, image.height) / (stats.variance + 1);
}

export function expandRect(rect: ScanRect, margin = CROP_MARGIN): ScanRect {
  const x = Math.max(0, rect.x - margin);
  const y = Math.max(0, rect.y - margin);
  return {
    x,
    y,
    width: Math.min(1 - x, rect.width + margin * 2),
    height: Math.min(1 - y, rect.height + margin * 2),
  };
}

/**
 * アプリ内カメラ（ライブ映像）が使えるか。
 *
 * MediaDevices はセキュアコンテキスト専用なので、HTTP で開いていると
 * navigator.mediaDevices ごと存在しない。ここで【同期的に】判定できるので、
 * ボタンの onClick の中で分岐して、使えないときはその場で標準カメラを起動できる
 * （非同期に判定してから起動すると、iOSがユーザー操作と認めず撮影結果を落とす）。
 */
export function isScannerAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

/* -------------------------------------------------------
 * 台形補正（斜めから撮っても真っ直ぐに直す）
 *
 * 外接矩形で切ると、レシートが傾いているぶんだけ四隅に机が残る。
 * 4隅を見つけて、そこから長方形へ引き伸ばせば背景が消え、文字も水平になる。
 * OpenCV.js（約8MB）を入れずに済ませたいので、必要な計算だけを自前で持つ。
 * ------------------------------------------------------- */

export type Point = { x: number; y: number };
/** 左上・右上・右下・左下の順 */
export type Quad = [Point, Point, Point, Point];

/**
 * 塊の画素から4隅を取る。
 *
 * x+y が最小なら左上、最大なら右下。x-y が最大なら右上、最小なら左下。
 * 長方形が多少傾いていても、この4点は角に落ちる。輪郭を追って多角形近似する
 * より単純で、レシートのようにまっすぐな四角形なら実用上これで足りる。
 * （45度を超えて回すと破綻するが、レシートをそこまで傾けて撮る場面は無い）
 */
export function cornersOf(points: { x: number; y: number }[]): Quad | null {
  if (points.length < 4) return null;
  let tl = points[0];
  let br = points[0];
  let tr = points[0];
  let bl = points[0];
  for (const p of points) {
    const sum = p.x + p.y;
    const diff = p.x - p.y;
    if (sum < tl.x + tl.y) tl = p;
    if (sum > br.x + br.y) br = p;
    if (diff > tr.x - tr.y) tr = p;
    if (diff < bl.x - bl.y) bl = p;
  }
  return [tl, tr, br, bl];
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 4隅から、引き伸ばし先の長方形の大きさを決める。長い方の辺に合わせる */
export function quadSize(quad: Quad): { width: number; height: number } {
  const [tl, tr, br, bl] = quad;
  return {
    width: Math.max(distance(tl, tr), distance(bl, br)),
    height: Math.max(distance(tl, bl), distance(tr, br)),
  };
}

/**
 * 四隅がほぼ長方形か（傾きも歪みもほとんど無いか）。
 *
 * まっすぐ撮れているときは引き伸ばさない。等倍で切り出す方が
 * 再標本化のぼけが入らず、文字がそのまま残るため。
 */
export function isNearRectangle(quad: Quad, tolerance = 0.03): boolean {
  const xs = quad.map((p) => p.x);
  const ys = quad.map((p) => p.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  if (width <= 0 || height <= 0) return true;
  const [tl, tr, br, bl] = quad;
  // 各辺が水平・垂直からどれだけずれているか
  const slack = Math.max(
    Math.abs(tl.y - tr.y) / height,
    Math.abs(bl.y - br.y) / height,
    Math.abs(tl.x - bl.x) / width,
    Math.abs(tr.x - br.x) / width,
  );
  return slack <= tolerance;
}

/**
 * 出力の長方形 → 元画像 への射影変換（ホモグラフィ）を解く。
 *
 * 出力側の画素を1つずつ元画像のどこから採るかを知りたいので、
 * 「出力→元」の向きで解く（逆行列を作らずに済む）。
 * 8元1次方程式をガウスの消去法で解く。
 */
export function solveHomography(source: Quad, destination: Quad): number[] | null {
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const s = source[i];
    const d = destination[i];
    a.push([s.x, s.y, 1, 0, 0, 0, -d.x * s.x, -d.x * s.y]);
    b.push(d.x);
    a.push([0, 0, 0, s.x, s.y, 1, -d.y * s.x, -d.y * s.y]);
    b.push(d.y);
  }

  const n = 8;
  for (let col = 0; col < n; col += 1) {
    // 部分ピボット選択。桁落ちで解が崩れるのを防ぐ
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-9) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    [b[col], b[pivot]] = [b[pivot], b[col]];

    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row][col] / a[col][col];
      if (factor === 0) continue;
      for (let k = col; k < n; k += 1) a[row][k] -= factor * a[col][k];
      b[row] -= factor * b[col];
    }
  }

  const h = new Array<number>(9);
  for (let i = 0; i < n; i += 1) h[i] = b[i] / a[i][i];
  h[8] = 1;
  return h;
}

/** 射影変換で1点を移す */
export function applyHomography(h: number[], point: Point): Point {
  const w = h[6] * point.x + h[7] * point.y + h[8];
  if (w === 0) return { x: 0, y: 0 };
  return {
    x: (h[0] * point.x + h[1] * point.y + h[2]) / w,
    y: (h[3] * point.x + h[4] * point.y + h[5]) / w,
  };
}

/**
 * 元画像の四角形を、長方形へ引き伸ばす。
 *
 * 出力の画素ごとに元画像の位置を求め、周囲4画素から線形補間して色を採る
 * （最近傍だと文字の縁がぎざぎざになり、OCRの読みが落ちる）。
 */
export function warpQuad(
  source: Frame,
  quad: Quad,
  outWidth: number,
  outHeight: number,
): Frame | null {
  const destination: Quad = [
    { x: 0, y: 0 },
    { x: outWidth - 1, y: 0 },
    { x: outWidth - 1, y: outHeight - 1 },
    { x: 0, y: outHeight - 1 },
  ];
  // 出力→元 の向きで解く（出力の画素から元の位置を引くため）
  const h = solveHomography(destination, quad);
  if (!h) return null;

  const dst = new Uint8ClampedArray(outWidth * outHeight * 4);
  const src = source.data;
  const sw = source.width;
  const sh = source.height;

  for (let y = 0; y < outHeight; y += 1) {
    for (let x = 0; x < outWidth; x += 1) {
      const p = applyHomography(h, { x, y });
      const fx = Math.min(sw - 1, Math.max(0, p.x));
      const fy = Math.min(sh - 1, Math.max(0, p.y));
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const x1 = Math.min(sw - 1, x0 + 1);
      const y1 = Math.min(sh - 1, y0 + 1);
      const rx = fx - x0;
      const ry = fy - y0;

      const i00 = (y0 * sw + x0) * 4;
      const i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;
      const o = (y * outWidth + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        const top = src[i00 + c] * (1 - rx) + src[i10 + c] * rx;
        const bottom = src[i01 + c] * (1 - rx) + src[i11 + c] * rx;
        dst[o + c] = top * (1 - ry) + bottom * ry;
      }
      dst[o + 3] = 255;
    }
  }
  return { data: dst, width: outWidth, height: outHeight };
}

/* -------------------------------------------------------
 * 撮った瞬間に、4隅を等倍の画像で測り直す
 *
 * 解析は長辺 320px の縮小画像で行うので、4隅は1画素ずれるだけで等倍では
 * 6〜12px ずれる。しかも塊の端の画素をそのまま角にしているので、紙の角の
 * 丸みや文字の隙間埋めでさらにずれる。この誤差がそのまま「少し曲がった」
 * 切り抜きになっていた。
 *
 * そこで撮るときに、粗い4隅を手がかりにして等倍の画像で紙の縁を探し直す。
 * 各辺に沿って何十か所も「机（暗）→紙（明）」に変わる位置を拾い、直線を当てはめ、
 * 4本の直線の交点を角にする。角の1点ではなく辺全体で決めるので、角が丸くても、
 * 折れていても、辺の向きは正確に出る。
 * ------------------------------------------------------- */

type Line = { point: Point; direction: Point };

/** 点の集まりに直線を当てはめる（向きは主成分。縦の辺でも崩れない） */
function fitLine(points: Point[]): Line | null {
  if (points.length < 2) return null;
  let mx = 0;
  let my = 0;
  for (const p of points) {
    mx += p.x;
    my += p.y;
  }
  mx /= points.length;
  my /= points.length;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of points) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { point: { x: mx, y: my }, direction: { x: Math.cos(angle), y: Math.sin(angle) } };
}

function distanceToLine(line: Line, p: Point): number {
  return Math.abs((p.x - line.point.x) * line.direction.y - (p.y - line.point.y) * line.direction.x);
}

/** 外れた点（文字の縁・影・指）を落としてから当てはめ直す */
function fitLineRobust(points: Point[]): Line | null {
  const first = fitLine(points);
  if (!first) return null;
  const residuals = points.map((p) => distanceToLine(first, p)).sort((a, b) => a - b);
  const median = residuals[Math.floor(residuals.length / 2)];
  const kept = points.filter((p) => distanceToLine(first, p) <= median * 2.5 + 1);
  return kept.length >= Math.max(6, points.length * 0.4) ? fitLine(kept) : null;
}

function intersect(a: Line, b: Line): Point | null {
  const det = a.direction.x * b.direction.y - a.direction.y * b.direction.x;
  if (Math.abs(det) < 1e-6) return null;
  const t = ((b.point.x - a.point.x) * b.direction.y - (b.point.y - a.point.y) * b.direction.x) / det;
  return { x: a.point.x + a.direction.x * t, y: a.point.y + a.direction.y * t };
}

/**
 * 粗い4隅（画素座標）を、等倍の画像で測り直す。測れなければ null（呼び出し側は粗い4隅を使う）。
 *
 * @param coarseScale 粗い4隅を出した縮小の倍率（等倍の長辺 ÷ 解析の長辺）。探す幅を決めるのに使う
 */
export function refineQuad(frame: Frame, quad: Quad, coarseScale: number): Quad | null {
  const { data, width, height } = frame;
  const luminance = (x: number, y: number): number => {
    const xi = Math.min(width - 1, Math.max(0, Math.round(x)));
    const yi = Math.min(height - 1, Math.max(0, Math.round(y)));
    const i = (yi * width + xi) * 4;
    return (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  };

  // 紙の明るさ。中央付近の明るさの上の方（文字の黒を避ける）
  const center = {
    x: (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4,
    y: (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4,
  };
  const samples: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    for (let t = 0.1; t < 0.9; t += 0.1) {
      const corner = quad[i];
      samples.push(luminance(center.x + (corner.x - center.x) * t, center.y + (corner.y - center.y) * t));
    }
  }
  samples.sort((a, b) => a - b);
  const paper = samples[Math.floor(samples.length * 0.75)];

  const sideLength = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
  const shortest = Math.min(...[0, 1, 2, 3].map((i) => sideLength(quad[i], quad[(i + 1) % 4])));
  // 粗い角の誤差（縮小の数画素ぶん）＋撮るまでの手ぶれを見込んだ、縁を探す幅
  const reach = Math.round(Math.min(shortest * 0.15, Math.max(12, coarseScale * 4, shortest * 0.03)));
  /*
   * 縁の手前・奥の明るさを平均する幅。広めにとって、文字1本ぶんのざらつきや
   * 背景（布・カーペット・木目）の細かい模様を均す。狭いと模様の粒を縁と見誤る。
   */
  const band = Math.max(3, Math.round(reach / 3));

  const lines: Line[] = [];
  for (let side = 0; side < 4; side += 1) {
    const a = quad[side];
    const b = quad[(side + 1) % 4];
    const length = sideLength(a, b);
    if (length < 8) return null;
    const along = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    // 4隅は時計回り（左上→右上→右下→左下）なので、辺の向きを右へ回すと紙の内側を向く
    const inward = { x: -along.y, y: along.x };

    const found: Point[] = [];
    const count = 40;
    for (let k = 0; k < count; k += 1) {
      // 角の近くは丸みや隣の辺が混ざるので使わない
      const t = 0.12 + (0.76 * k) / (count - 1);
      const base = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      // 縁に沿って3本ぶん平均した明るさの断面（外→内）
      const profile: number[] = [];
      for (let s = -reach - band; s <= reach + band; s += 1) {
        let sum = 0;
        for (let w = -1; w <= 1; w += 1) {
          sum += luminance(
            base.x + inward.x * s + along.x * w * 2,
            base.y + inward.y * s + along.y * w * 2,
          );
        }
        profile.push(sum / 3);
      }
      const at = (s: number) => profile[s + reach + band];
      const mean = (from: number, to: number) => {
        let sum = 0;
        for (let s = from; s <= to; s += 1) sum += at(s);
        return sum / (to - from + 1);
      };

      // 各位置の「外が暗く内が明るい」差
      const steps: { s: number; step: number; inside: number }[] = [];
      let maxStep = 0;
      for (let s = -reach; s <= reach; s += 1) {
        const inside = mean(s + 1, s + band);
        const outside = mean(s - band, s - 1);
        const step = inside - outside;
        steps.push({ s, step, inside });
        if (step > maxStep) maxStep = step;
      }
      if (maxStep < 20) continue;
      /*
       * いちばん外側の、十分な段差を採る。紙の内側にも文字の縁という強い段差があるが、
       * それは必ず紙の縁より内側にある。最大の段差を採ると文字の縁に吸い寄せられる。
       */
      const edge = steps.find(
        (candidate) =>
          candidate.step >= Math.max(20, maxStep * 0.5) &&
          // 紙の端は影で中央より暗いことが多いので、明るさの条件は緩めにする
          candidate.inside >= paper * 0.45 &&
          // 山の頂上（隣より段差が小さくない）だけ。坂の途中を採らない
          candidate.step >= (steps[candidate.s + reach - 1]?.step ?? -Infinity) &&
          candidate.step >= (steps[candidate.s + reach + 1]?.step ?? -Infinity),
      );
      if (!edge) continue;
      found.push({ x: base.x + inward.x * (edge.s + 0.5), y: base.y + inward.y * (edge.s + 0.5) });
    }
    // 半分以上の場所で縁が見つからない辺は、測れていない（机と紙の差が無い・切れている）
    if (found.length < count * 0.5) return null;
    const line = fitLineRobust(found);
    if (!line) return null;
    lines.push(line);
  }

  // 向かい合う辺が平行でなければ、どれかの辺で影や背景を拾っている。測り直しは使わない
  const angleOf = (line: Line) => Math.atan2(line.direction.y, line.direction.x);
  const differs = (a: Line, b: Line) => {
    const diff = Math.abs(angleOf(a) - angleOf(b)) % Math.PI;
    return Math.min(diff, Math.PI - diff) > (3 * Math.PI) / 180;
  };
  if (differs(lines[0], lines[2]) || differs(lines[1], lines[3])) return null;

  // 辺 i と辺 i-1 の交点が角 i（辺0 = 上辺 は 左上→右上）
  const corners: Point[] = [];
  for (let i = 0; i < 4; i += 1) {
    const corner = intersect(lines[(i + 3) % 4], lines[i]);
    if (!corner) return null;
    // 粗い角から大きく離れたら、別の物の縁を拾っている。使わない
    if (Math.hypot(corner.x - quad[i].x, corner.y - quad[i].y) > reach * 2.5) return null;
    corners.push(corner);
  }
  return corners as Quad;
}

/**
 * 補正しなくてよいほど真っ直ぐか（画素座標の4隅で、どの辺も1画素未満しか傾いていない）。
 * これより傾いていれば、わずかでも引き伸ばして真っ直ぐにする。
 */
export function isAxisAligned(quad: Quad): boolean {
  const [tl, tr, br, bl] = quad;
  return (
    Math.abs(tl.y - tr.y) < 1 &&
    Math.abs(bl.y - br.y) < 1 &&
    Math.abs(tl.x - bl.x) < 1 &&
    Math.abs(tr.x - br.x) < 1
  );
}

/* -------------------------------------------------------
 * 紙の縁を「直線」で探す（机のテカりに引っ張られないように）
 *
 * 明るい塊で探すと、机のテカり（反射）が紙と同じくらい明るいとき、テカりまで
 * 紙の一部として拾ってしまい、4隅が大きくずれる（実機の木の机で起きた）。
 *
 * 紙の縁は「机（暗）→紙（明）」に変わる長い直線で、テカりはまだらで直線を作らない。
 * そこで明るさの変わり目のうち、向き（外が暗く内が明るい）の合うものだけを集め、
 * 各辺ごとにいちばんよく揃う直線を選ぶ（向きを絞ったハフ変換）。
 * 紙の中の文字の行も直線の変わり目を作るが、それは必ず紙の縁より内側にあるので、
 * 十分に強い直線のうち【いちばん外側】を採る。
 * ------------------------------------------------------- */

/** 探す傾きの範囲（度）。これより回っていれば、明るい塊の4隅のままにする */
const EDGE_MAX_ANGLE = 20;
/** 角度の刻み。細かい向きは、選んだあとの当てはめ直しで出す */
const EDGE_ANGLE_STEP = 1;

/**
 * 明るい塊の外接矩形（画素座標）の中で、紙の4辺を直線として探す。
 * 見つからなければ null（呼び出し側は明るい塊の4隅を使う）。
 */
export function findEdgeQuad(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  box: { x0: number; y0: number; x1: number; y1: number },
): Quad | null {
  const x0 = Math.max(1, box.x0 - 3);
  const y0 = Math.max(1, box.y0 - 3);
  const x1 = Math.min(width - 2, box.x1 + 3);
  const y1 = Math.min(height - 2, box.y1 + 3);
  if (x1 - x0 < 16 || y1 - y0 < 16) return null;

  // 紙の明るさと、紙の中心（明るい方の画素の重心。テカりより紙の方が明るいので紙に寄る）
  const histogram = new Int32Array(256);
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) histogram[gray[y * width + x]] += 1;
  const boxPixels = (x1 - x0 + 1) * (y1 - y0 + 1);
  let paper = 255;
  for (let value = 255, seen = 0; value >= 0; value -= 1) {
    seen += histogram[value];
    if (seen >= boxPixels * 0.1) {
      paper = value;
      break;
    }
  }
  let cx = 0;
  let cy = 0;
  let count = 0;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (gray[y * width + x] >= paper * 0.9) {
        cx += x;
        cy += y;
        count += 1;
      }
    }
  }
  if (count === 0) return null;
  cx /= count;
  cy /= count;

  // 明るさの傾き（ソーベル）
  const gx = new Float32Array(width * height);
  const gy = new Float32Array(width * height);
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const i = y * width + x;
      const a = gray[i - width - 1];
      const b = gray[i - width];
      const c = gray[i - width + 1];
      const d = gray[i - 1];
      const f = gray[i + 1];
      const g = gray[i + width - 1];
      const h = gray[i + width];
      const k = gray[i + width + 1];
      gx[i] = (c + 2 * f + k - a - 2 * d - g) / 4;
      gy[i] = (g + 2 * h + k - a - 2 * b - c) / 4;
    }
  }

  const angles: number[] = [];
  for (let deg = -EDGE_MAX_ANGLE; deg <= EDGE_MAX_ANGLE; deg += EDGE_ANGLE_STEP) angles.push(Math.tan((deg * Math.PI) / 180));
  const minStep = 12;

  /**
   * 1つの辺を探す。vertical は左右の辺。sign は「中心から外へ向かって暗くなる」向き。
   * 直線は 縦の辺なら x = offset + slope·(y - cy)、横の辺なら y = offset + slope·(x - cx)。
   */
  type Side = { offset: number; slope: number; score: number };
  const findSide = (vertical: boolean, outward: 1 | -1, near?: number): Side | null => {
    /** near を渡したら、その傾き（±1.5度）の直線だけから選ぶ。向かいの辺と平行にそろえ直すときに使う */
    const allowed = (slope: number) =>
      near === undefined || Math.abs(Math.atan(slope) - Math.atan(near)) <= (1.5 * Math.PI) / 180;
    const span = vertical ? x1 - x0 + 1 : y1 - y0 + 1;
    const base = vertical ? x0 : y0;
    const bins = angles.map(() => new Float32Array(span + 1));
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        // 中心より外側の半分だけを見る
        if (vertical ? (x - cx) * outward <= 0 : (y - cy) * outward <= 0) continue;
        const i = y * width + x;
        const along = vertical ? gx[i] : gy[i];
        const across = vertical ? gy[i] : gx[i];
        // 外へ向かって暗くなる＝内が明るい。向きの合わない変わり目（文字の左端など）は数えない
        const weight = -along * outward;
        if (weight < minStep || Math.abs(along) < Math.abs(across)) continue;
        for (let a = 0; a < angles.length; a += 1) {
          const offset = vertical ? x - angles[a] * (y - cy) : y - angles[a] * (x - cx);
          const bin = Math.round(offset) - base;
          if (bin >= 0 && bin <= span) bins[a][bin] += Math.min(weight, 80);
        }
      }
    }
    // 角度ごとの最大と、全体の最大
    let best = 0;
    for (let a = 0; a < angles.length; a += 1) for (let b = 0; b <= span; b += 1) {
      if (!allowed(angles[a])) continue;
      const row = bins[a];
      const score = row[b] + (row[b - 1] ?? 0) * 0.5 + (row[b + 1] ?? 0) * 0.5;
      if (score > best) best = score;
    }
    if (best <= 0) return null;
    // 十分強い直線のうち、いちばん外側
    let chosen: { offset: number; slope: number; score: number } | null = null;
    for (let a = 0; a < angles.length; a += 1) {
      if (!allowed(angles[a])) continue;
      const row = bins[a];
      for (let b = 0; b <= span; b += 1) {
        const score = row[b] + (row[b - 1] ?? 0) * 0.5 + (row[b + 1] ?? 0) * 0.5;
        if (score < best * 0.5) continue;
        // 山の頂上だけ
        const left = (row[b - 1] ?? 0) + (row[b - 2] ?? 0) * 0.5 + row[b] * 0.5;
        const right = (row[b + 1] ?? 0) + (row[b + 2] ?? 0) * 0.5 + row[b] * 0.5;
        if (score < left || score < right) continue;
        const offset = b + base;
        const outer = chosen === null || (offset - chosen.offset) * outward > 0.5 ||
          (Math.abs(offset - chosen.offset) <= 0.5 && score > chosen.score);
        if (outer) chosen = { offset, slope: angles[a], score };
      }
    }
    if (!chosen) return null;
    /*
     * 角度の刻み（1度）では向きが粗い。選んだ直線の近くにある
     * 変わり目の点だけで、重み付きの直線を当てはめ直して細かくする。
     */
    let sw = 0;
    let st = 0;
    let so = 0;
    let stt = 0;
    let sto = 0;
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const i = y * width + x;
        const along = vertical ? gx[i] : gy[i];
        const across = vertical ? gy[i] : gx[i];
        const weight = -along * outward;
        if (weight < minStep || Math.abs(along) < Math.abs(across)) continue;
        // t は辺に沿った位置、o は辺と直交する位置
        const tpos = vertical ? y - cy : x - cx;
        const opos = vertical ? x : y;
        if (Math.abs(opos - (chosen.offset + chosen.slope * tpos)) > 1.5) continue;
        const wgt = Math.min(weight, 80);
        sw += wgt;
        st += wgt * tpos;
        so += wgt * opos;
        stt += wgt * tpos * tpos;
        sto += wgt * tpos * opos;
      }
    }
    const denominator = sw * stt - st * st;
    if (sw > 0 && Math.abs(denominator) > 1e-6) {
      const slope = (sw * sto - st * so) / denominator;
      const offset = (so - slope * st) / sw;
      // 当てはめ直しで大きく動いたら、別の点に引っ張られている。元のままにする
      if (Math.abs(Math.atan(slope) - Math.atan(chosen.slope)) < (2 * Math.PI) / 180) return { offset, slope, score: chosen.score };
    }
    return chosen;
  };

  let left = findSide(true, -1);
  let right = findSide(true, 1);
  let top = findSide(false, -1);
  let bottom = findSide(false, 1);
  if (!left || !right || !top || !bottom) return null;

  /*
   * 紙は長方形なので、向かい合う辺はほぼ平行になる（正面から撮っていれば、あおりの差は数度まで）。
   * 大きく食い違うときは、紙の端の影で縁が薄くなり、弱い方の辺が影の境目や背景の模様に
   * 引っ張られている。強い方の辺に合わせて、弱い方を平行な直線の中から選び直す。
   */
  const parallel = (a: Side, b: Side) => Math.abs(Math.atan(a.slope) - Math.atan(b.slope)) <= (3 * Math.PI) / 180;
  if (!parallel(left, right)) {
    if (left.score >= right.score) right = findSide(true, 1, left.slope);
    else left = findSide(true, -1, right.slope);
  }
  if (!parallel(top, bottom)) {
    if (top.score >= bottom.score) bottom = findSide(false, 1, top.slope);
    else top = findSide(false, -1, bottom.slope);
  }
  if (!left || !right || !top || !bottom) return null;

  const toLine = (side: { offset: number; slope: number }, vertical: boolean): Line => {
    const norm = Math.hypot(1, side.slope);
    return vertical
      ? { point: { x: side.offset, y: cy }, direction: { x: side.slope / norm, y: 1 / norm } }
      : { point: { x: cx, y: side.offset }, direction: { x: 1 / norm, y: side.slope / norm } };
  };
  const l = toLine(left, true);
  const r = toLine(right, true);
  const t = toLine(top, false);
  const b = toLine(bottom, false);
  const corners = [intersect(t, l), intersect(t, r), intersect(b, r), intersect(b, l)];
  if (corners.some((corner) => corner === null)) return null;
  const quad = corners as Quad;

  /*
   * 選んだ直線が本当に紙の縁かを確かめる。各辺に沿って、外が暗く内が明るい場所が
   * 3割以上あること。文字の行や、まだらなテカりの縁を拾っていればここで落ちる。
   * 紙の端は影で縁が薄くなるところがあるので、半分までは求めない（向かいの辺と平行かは上で見ている）。
   */
  for (let side = 0; side < 4; side += 1) {
    const a = quad[side];
    const c = quad[(side + 1) % 4];
    const length = Math.hypot(c.x - a.x, c.y - a.y);
    if (length < 12) return null;
    const along = { x: (c.x - a.x) / length, y: (c.y - a.y) / length };
    const inward = { x: -along.y, y: along.x };
    let good = 0;
    const samples = 20;
    for (let k = 0; k < samples; k += 1) {
      const tt = 0.15 + (0.7 * k) / (samples - 1);
      const px = a.x + (c.x - a.x) * tt;
      const py = a.y + (c.y - a.y) * tt;
      const at = (s: number) => {
        const x = Math.min(width - 1, Math.max(0, Math.round(px + inward.x * s)));
        const y = Math.min(height - 1, Math.max(0, Math.round(py + inward.y * s)));
        return gray[y * width + x];
      };
      const inside = (at(2) + at(3)) / 2;
      const outside = (at(-2) + at(-3)) / 2;
      if (inside - outside >= minStep && inside >= paper * 0.45) good += 1;
    }
    if (good < samples * 0.3) return null;
  }
  return quad;
}
