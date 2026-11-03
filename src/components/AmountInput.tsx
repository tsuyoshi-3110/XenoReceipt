"use client";

import { useState, type InputHTMLAttributes } from "react";

/**
 * 金額欄。表示は「1,234」、打っている間はカンマを外す。
 * 打つたびに整形し直すと、カンマが入った瞬間にカーソルが末尾へ飛ぶため。
 */
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: number;
  onChange: (value: number) => void;
};

function parseAmount(raw: string): number {
  const value = Number(raw.replace(/[,，¥円\s]/g, ""));
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

export function AmountInput({ value, onChange, ...rest }: Props) {
  const [editingText, setEditingText] = useState<string | null>(null);
  const display = editingText ?? (value === 0 ? "" : value.toLocaleString("ja-JP"));
  return (
    <input
      type="text"
      inputMode="numeric"
      {...rest}
      value={display}
      onFocus={(event) => { setEditingText(value === 0 ? "" : String(value)); rest.onFocus?.(event); }}
      onChange={(event) => { setEditingText(event.target.value); onChange(parseAmount(event.target.value)); }}
      onBlur={(event) => { setEditingText(null); rest.onBlur?.(event); }}
    />
  );
}
