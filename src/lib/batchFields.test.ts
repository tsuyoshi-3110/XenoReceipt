import { test } from "node:test";
import assert from "node:assert/strict";
import { fieldsFromRead } from "./batchFields";

const read = (over: Partial<Parameters<typeof fieldsFromRead>[0] & { ok: true }> = {}) => ({
  ok: true as const,
  storeName: "アカカベ阪急淡路店",
  date: "2026-11-02",
  totalAmount: 817,
  taxable10Amount: 0,
  taxable8Amount: 817,
  taxFreeAmount: 0,
  hasMultipleTaxRates: false,
  category: "材料費",
  ...over,
});

test("全部読めて単一税率なら要確認にしない。税率は区分から決める", () => {
  const { fields, needsReview } = fieldsFromRead(read(), "2026-11-03");
  assert.equal(needsReview, false);
  assert.equal(fields.taxRate, 8);
  assert.equal(fields.taxable8Amount, 0);
  assert.equal(fields.category, "材料費");
});

test("読めなかったら今日の日付・既定の費目で、要確認にして保存する", () => {
  const { fields, needsReview } = fieldsFromRead({ ok: false, message: "x" }, "2026-11-03");
  assert.equal(needsReview, true);
  assert.equal(fields.expenseDate, "2026-11-03");
  assert.equal(fields.category, "消耗品費");
});

test("店名・合計が欠けていたら要確認。何が読めなかったかを書く", () => {
  assert.equal(fieldsFromRead(read({ storeName: "" }), "2026-11-03").needsReview, true);
  assert.equal(fieldsFromRead(read({ storeName: "", totalAmount: 0 }), "2026-11-03").attention, "店名・合計が読めませんでした。");
  assert.equal(fieldsFromRead(read({ totalAmount: 0 }), "2026-11-03").needsReview, true);
});

test("混ざった内訳が合計と合わなければ要確認、合えば内訳を持たせる", () => {
  const ok = fieldsFromRead(read({ totalAmount: 4650, taxable10Amount: 504, taxable8Amount: 4141, taxFreeAmount: 5 }), "2026-11-03");
  assert.equal(ok.needsReview, false);
  assert.equal(ok.fields.taxable10Amount, 504);
  assert.equal(fieldsFromRead(read({ totalAmount: 5000, taxable10Amount: 504, taxable8Amount: 4141 }), "2026-11-03").needsReview, true);
});

test("AI が混在を見つけたのに内訳が読めていなければ要確認", () => {
  assert.equal(fieldsFromRead(read({ hasMultipleTaxRates: true, taxable8Amount: 0 }), "2026-11-03").needsReview, true);
});

test("候補に無い費目は既定の消耗品費にする", () => {
  assert.equal(fieldsFromRead(read({ category: "" }), "2026-11-03").fields.category, "消耗品費");
});
