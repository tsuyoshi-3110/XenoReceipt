import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * スマホから同じ Wi-Fi の Mac（192.168.x.x:3000）の開発サーバーを開くための許可。
   * Next.js は localhost 以外からの開発用の読み込みを断るので、画面の JavaScript が届かず、
   * 読み込み中のくるくるのまま止まる。本番（Vercel）には関係しない。
   */
  allowedDevOrigins: ["192.168.*.*"],
};

export default nextConfig;
