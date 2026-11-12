export const pad2 = (n: number) => String(n).padStart(2, '0')
export const projectLabel = (n: number) => `Project ${pad2(n)}`
export const fmt = (v: number | string | null | undefined, digits = 2) =>
  v === null || v === undefined ? '–' : Number(v).toFixed(digits)

function cell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  // Neutralise spreadsheet formula injection as well as quoting.
  const safe = /^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s)) ? `'${s}` : s
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function downloadCsv(filename: string, rows: (string | number | null)[][]) {
  const body = rows.map((r) => r.map(cell).join(',')).join('\r\n')
  // BOM so Excel opens UTF-8 correctly.
  const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
