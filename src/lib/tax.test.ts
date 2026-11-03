import { test } from "node:test";
import assert from "node:assert/strict";
import { exTaxOf, isMixedTaxReceipt, taxRateFromReceipt } from "./tax";

test("食品8%＋10%＋レジ袋（非課税）は区分ごとに割って足す", () => {
  // 8%対象 4,141 ＋ 10%対象 504 ＋ 非課税 5 ＝ 4,650 → 3,834 ＋ 458 ＋ 5
  assert.equal(exTaxOf(4650, 8, 504, 4141, 5), 4297);
});

test("区分の合計が合わなければ単一税率で割る", () => {
  assert.equal(exTaxOf(1100, 10, 500, 300, 0), 1000);
});

test("代表の税率は多いほう。読めなければ10%", () => {
  assert.equal(taxRateFromReceipt(0, 0, 0), 10);
  assert.equal(taxRateFromReceipt(100, 500, 0), 8);
  assert.equal(taxRateFromReceipt(0, 0, 300), 0);
  assert.equal(isMixedTaxReceipt(0, 540, 5), true);
  assert.equal(isMixedTaxReceipt(1080, 0, 0), false);
});
