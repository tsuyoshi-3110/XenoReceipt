/** ファイルを引いてきている間に出す「ここに落とす」の印（useFileDrop と組で使う。落とせる所の要素は relative にする） */
export function FileDropOverlay({ label, rounded = "rounded-xl" }: { label: string; rounded?: string }) {
  return <div className={`pointer-events-none absolute inset-0 z-30 grid place-items-center ${rounded} border-2 border-dashed border-blue-400 bg-blue-50/90 p-4 text-center text-sm font-bold text-blue-700`}>{label}</div>;
}
