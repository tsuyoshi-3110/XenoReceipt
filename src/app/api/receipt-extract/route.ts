/*
 * レシートの読み取り。読み取りの本体（プロンプト・スキーマ・モデルの順番）は lib/receiptExtraction.ts。
 *
 * 入場はログインした人だけ。回数で止めることはせず、呼ぶたびに数えるだけ（lib/aiQuota.ts。身内だけで使うので上限は外した）。
 * 失敗しても画面は撮った写真を持ったまま手入力へ倒れるので、ここでは例外を投げずに返す。
 */
import { NextResponse } from "next/server";

import { countRead, readQuota } from "@/lib/aiQuota";
import { adminAuth } from "@/lib/firebaseAdmin";
import { MAX_IMAGE_CHARS, normalizeCategories, normalizeDate, runExtraction } from "@/lib/receiptExtraction";

export const runtime = "nodejs";
export const maxDuration = 90;

/**
 * ログインした人の uid。メールアドレスとパスワードで登録して、まだ確認メールのリンクを押していない人は "unverified"。
 * 使い捨てのメールでアカウントを増やせば AI を呼び続けられてしまうので、確認が済むまで読み取りは使わせない。
 */
async function uidOf(request: Request): Promise<string | "unverified" | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    if (decoded.firebase?.sign_in_provider === "password" && decoded.email_verified !== true) return "unverified";
    return decoded.uid;
  } catch {
    return null;
  }
}

const unauthorized = () => NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
const unverified = () => NextResponse.json(
  { ok: false, unreadable: true, unverified: true, error: "メールアドレスの確認が済んでいないので、AI の読み取りは使えません。届いたメールのリンクを押してください（手で入れて登録はできます）。" },
  { status: 403 },
);

/** 今月の残りの回数（表示用） */
export async function GET(request: Request) {
  const uid = await uidOf(request);
  if (!uid) return unauthorized();
  if (uid === "unverified") return unverified();
  const quota = await readQuota(uid);
  return NextResponse.json({ ok: true, quota }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const uid = await uidOf(request);
  if (!uid) return unauthorized();
  if (uid === "unverified") return unverified();

  const body = (await request.json().catch(() => ({}))) as { image?: unknown; today?: unknown; categories?: unknown };
  const image =
    typeof body.image === "string"
    && body.image.startsWith("data:image/")
    && body.image.length <= MAX_IMAGE_CHARS
      ? body.image
      : "";
  if (!image) {
    return NextResponse.json({ ok: false, error: "レシート画像がありません。" }, { status: 400 });
  }
  const today = normalizeDate(body.today) || new Date().toISOString().slice(0, 10);

  await countRead(uid);

  const result = await runExtraction(image, today, normalizeCategories(body.categories));
  if (result.ok === false) {
    return NextResponse.json(
      { ok: false, unreadable: result.unreadable, error: result.unreadable ? result.error : "読み取りできませんでした。手動で入力してください。" },
      { status: result.unreadable ? 200 : 502 },
    );
  }

  return NextResponse.json(
    { ok: true, ...result.data, model: result.model },
    { headers: { "Cache-Control": "no-store" } },
  );
}
