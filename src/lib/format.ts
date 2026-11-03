export function formatYen(value: number): string {
  return `¥${Math.round(value).toLocaleString("ja-JP")}`;
}

/** "2026-11" → "2026年11月" */
export function monthLabel(month: string): string {
  const [year, mon] = month.split("-");
  return `${year}年${Number(mon)}月`;
}

/** "2026-11-03" → "11/3" */
export function shortDate(date: string): string {
  const [, mon, day] = date.split("-");
  return mon && day ? `${Number(mon)}/${Number(day)}` : date;
}

export function shiftMonth(month: string, delta: number): string {
  const [year, mon] = month.split("-").map(Number);
  const d = new Date(year, mon - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
