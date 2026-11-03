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
  // ホーム画面から開いた iPhone で、下のバー（ホームに戻る横線）の高さを env(safe-area-inset-bottom) で読めるようにする。
  // 読めないと、下に固定したボタンがその横線と重なる（2026-11-03）
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Safari や拡張機能が読み込み前に html / body へ属性を書き足すことがあり、開発中に食い違いの知らせが出る。この2つだけは見逃す
    <html lang="ja" suppressHydrationWarning>
      <body className="min-h-dvh antialiased" suppressHydrationWarning>{children}</body>
    </html>
  );
}
