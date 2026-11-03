import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "XenoReceipt",
  description: "レシートを撮るだけで、店名・日付・金額・費目を読み取って経費の一覧にします。",
  // iPhone でホーム画面に追加したとき、アドレス欄なしで開き、名前を「XenoReceipt」にする（ロゴは app/apple-icon.png）
  appleWebApp: { capable: true, title: "XenoReceipt", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#142c8e",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Safari や拡張機能が読み込み前に html / body へ属性を書き足すことがあり、開発中に食い違いの知らせが出る。この2つだけは見逃す
    <html lang="ja" suppressHydrationWarning>
      <body className="min-h-dvh antialiased" suppressHydrationWarning>{children}</body>
    </html>
  );
}
