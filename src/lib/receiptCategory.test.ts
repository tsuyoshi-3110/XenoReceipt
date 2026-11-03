import { test } from "node:test";
import assert from "node:assert/strict";
import { categoryInstructions } from "./receiptCategory";

const lineOf = (text: string, head: string) => text.split("\n").find((line) => line.startsWith(head)) ?? "";

test("飲食店は接待交際費、飲み物は福利厚生費を選ばせる", () => {
  const text = categoryInstructions(["消耗品費", "接待交際費", "会議費", "福利厚生費"]);
  assert.match(lineOf(text, "- 飲食店"), /→ 「接待交際費」$/);
  assert.match(lineOf(text, "- コンビニ"), /→ 「福利厚生費」$/);
});

test("福利厚生費が候補に無ければ、飲み物は空欄にさせる（ほかの費目で代用しない）", () => {
  const text = categoryInstructions(["消耗品費", "接待交際費", "会議費"]);
  assert.match(lineOf(text, "- コンビニ"), /→ 空文字 ""/);
  assert.match(lineOf(text, "- 飲食店"), /→ 「接待交際費」$/);
});

test("候補が無ければ（現場経費）費目の指示を出さない", () => {
  assert.equal(categoryInstructions([]), "");
});
