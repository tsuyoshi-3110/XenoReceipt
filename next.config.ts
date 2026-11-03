import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * スマホから同じ Wi-Fi の Mac の開発サーバーを開くための許可（192.168.x.x:3000 か、Mac の名前の 〇〇.local:3000）。
   * Next.js は localhost 以外からの開発用の読み込みを断るので、画面の JavaScript が届かず、
   * 読み込み中のくるくるのまま止まる。本番（Vercel）には関係しない。
   * Google ログインは IP アドレスからは断られる（Firebase の承認済みドメインに IP は入らない）ので、
   * スマホでログインまで試すときは 〇〇.local のほうで開く。その名前は承認済みドメインに足してある。
   */
  allowedDevOrigins: ["192.168.*.*", "*.local"],
  /*
   * Google ログインのやり取りを、このアプリと同じアドレスの中で行う（Firebase の案内どおりの中継）。
   * ホーム画面から開いた iPhone のアプリは Safari と別の入れ物で動くので、xenoreceipt.firebaseapp.com の窓で
   * ログインしても結果がアプリに戻らなかった（2026-11-03）。本番は authDomain をこのアドレスにしてある（firebaseClient）。
   */
  async rewrites() {
    return [
      { source: "/__/auth/:path*", destination: "https://xenoreceipt.firebaseapp.com/__/auth/:path*" },
      { source: "/__/firebase/:path*", destination: "https://xenoreceipt.firebaseapp.com/__/firebase/:path*" },
    ];
  },
};

export default nextConfig;
