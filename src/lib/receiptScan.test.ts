import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeFrame, isFaceOn, MAX_SKEW, measureTilt, type Quad } from "./receiptScan";

/** 暗い机の上に、明るい長方形（レシート）を1枚置いた縮小画像 */
function frameWithPaper(width: number, height: number, paper: { x0: number; y0: number; x1: number; y1: number }) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inside = x >= paper.x0 && x < paper.x1 && y >= paper.y0 && y < paper.y1;
      const value = inside ? 230 : 40;
      const p = (y * width + x) * 4;
      data[p] = value;
      data[p + 1] = value;
      data[p + 2] = value;
      data[p + 3] = 255;
    }
  }
  return { data, width, height };
}

test("長いレシートを丸ごと収めたら、面積が小さくても「近づけて」と言わない", () => {
  // 幅12%・高さ85%（面積は約10%で MIN_COVERAGE を割る）
  const result = analyzeFrame(frameWithPaper(240, 320, { x0: 106, y0: 24, x1: 135, y1: 296 }));
  assert.ok(result.coverage < 0.12);
  assert.notEqual(result.quality, "tooSmall");
});

test("短いレシートが小さく写っているときは、これまでどおり「近づけて」", () => {
  const result = analyzeFrame(frameWithPaper(240, 320, { x0: 100, y0: 130, x1: 140, y1: 190 }));
  assert.equal(result.quality, "tooSmall");
});

test("長く写っているほど、上下のあおりの上限が広がる", () => {
  // 上辺が下辺より約10%短い台形（実機の長いレシートで出た値）
  const long: Quad = [
    { x: 0.4, y: 0.08 },
    { x: 0.58, y: 0.08 },
    { x: 0.6, y: 0.92 },
    { x: 0.38, y: 0.92 },
  ];
  const tilt = measureTilt(long, 240, 320);
  assert.ok(tilt.skewRatio > MAX_SKEW);
  assert.ok(isFaceOn(tilt));

  // 同じゆがみでも、画面の半分ほどの長さなら斜めと判定する
  const short: Quad = [
    { x: 0.4, y: 0.3 },
    { x: 0.58, y: 0.3 },
    { x: 0.6, y: 0.7 },
    { x: 0.38, y: 0.7 },
  ];
  assert.equal(measureTilt(short, 240, 320).skewLimit, MAX_SKEW);
  assert.ok(!isFaceOn(measureTilt(short, 240, 320)));
});
