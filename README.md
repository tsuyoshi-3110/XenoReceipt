# XenoReceipt

レシートを撮る（PC は画像・PDF を取り込む）と、AI が店名・利用日・合計・税の区分・費目を読み取り、月ごとの一覧にする Web アプリ。
月の一覧は Excel（明細・費目別）と PDF（合計・明細・写真）に書き出せる。

撮影（ReceiptScanner / ReceiptCropEditor / lib/receiptScan.ts）は ProcNova（renova18.5）から、
読み取りの本体（lib/receiptExtraction.ts）も renova18.5 から 2026-11-03 に写した。読み取りのプロンプトはここが正本。

## はじめに

1. Firebase で新しいプロジェクトを作る（ProcNova の proclink-8d582 とは別）
   - Authentication：Google ログインを有効にする
   - Firestore と Storage を作る
2. `.env.example` を `.env.local` に写して値を入れる
3. ルールを出す：`npx firebase deploy --only firestore:rules,storage`
4. Storage の CORS を設定する（PDF に写真を貼るのに要る）：`gsutil cors set cors.json gs://<バケット名>`
5. `npm install` → `npm run dev`

## 確かめ方

`npx tsc --noEmit`・`npm run lint`・`npm test`

## 決めてあること

- AI は補助。読めなくても撮った写真を持ったまま手入力に倒す
- 品目は読まない。金額は必ず「合計」
- 費目は候補（lib/categories.ts）から AI が1つ選ぶ。決めきれなければ空（未設定）
- AI の読み取りは1人・月 `RECEIPT_MONTHLY_LIMIT` 回まで（XenoCoin の課金を入れるまでの仮の枠）
