import type { Line, TextItem } from './types'

/**
 * Group PDF text items into visual lines: same page, baseline within `tolerance` points.
 * Lines are returned in reading order (page by page, top to bottom).
 */
export function groupLines(items: TextItem[], tolerance = 2): Line[] {
  const sorted = items
    .filter((i) => i.str.trim() !== '')
    .sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x)

  const lines: Line[] = []
  for (const item of sorted) {
    const last = lines.at(-1)
    if (last && last.page === item.page && Math.abs(last.y - item.y) <= tolerance) {
      last.items.push(item)
    } else {
      lines.push({ page: item.page, y: item.y, items: [item], text: '' })
    }
  }
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x)
    line.text = line.items.map((i) => i.str.trim()).join(' ')
  }
  return lines
}
