import type { MetadataRoute } from "next";

/**
 * ホーム画面に追加したとき（PWA）の名前・色・ロゴ。
 * ロゴは public/icons。maskable は Android が丸や角丸に切り抜くので、絵を中央の安全域に小さめに置いてある。
 * iPhone はこれを使わず app/apple-icon.png を使う（layout の appleWebApp と組）。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "XenoReceipt",
    short_name: "XenoReceipt",
    description: "レシートを撮るだけで、店名・日付・金額・費目を読み取って経費の一覧にします。",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f7f9",
    theme_color: "#142c8e",
    lang: "ja",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
