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
};

export default nextConfig;
