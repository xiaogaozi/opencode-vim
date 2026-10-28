import type { WidthMethod } from "@opentui/core"
import type { CursorPosition } from "@vimee/core"
import type { EditorInput } from "./editor"
import { displayToChar, displayWidth, hostPosition, type PromptMap } from "./map"

export type ScreenMotion = "H" | "M" | "L"

export function screenMotionKey(key: string): key is ScreenMotion {
  return key === "H" || key === "M" || key === "L"
}

/**
 * Vim's H/M/L move over screen lines. The reader wraps long lines, so resolve
 * the target against the editor's visual-line starts instead of logical lines.
 */
export function screenMotionCursor(
  input: EditorInput | undefined,
  map: PromptMap,
  key: ScreenMotion,
  count: number,
  widthMethod: WidthMethod,
): CursorPosition | undefined {
  const info = input?.editorView?.getLogicalLineInfo?.()
  const scrollY = input?.scrollY
  const height = input?.height
  if (!input || !info || scrollY === undefined || height === undefined || info.lineStartCols.length === 0) return

  const total = info.lineStartCols.length
  const top = clamp(scrollY, 0, total - 1)
  const viewportHeight = Math.max(1, Math.floor(height))
  const steps = Math.max(1, Math.floor(count))
  const atTop = top === 0
  const atBottom = top + viewportHeight >= total
  // OpenTUI keeps a one-row cursor margin while scrolled. Landing on the exact
  // edge makes the viewport follow the cursor and drift on repeated H/L.
  const inset = viewportHeight >= 3 ? 1 : 0
  let row: number
  if (key === "H") row = top + (atTop ? 0 : inset) + steps - 1
  else if (key === "M") row = top + Math.floor(viewportHeight / 2)
  else row = top + viewportHeight - 1 - (atBottom ? 0 : inset) - (steps - 1)
  row = clamp(row, 0, total - 1)

  const start = info.lineStartCols[row]
  const end = row + 1 < total ? info.lineStartCols[row + 1] : displayWidth(input.plainText, widthMethod)
  const segment = input.plainText.slice(
    displayToChar(input.plainText, start, widthMethod),
    displayToChar(input.plainText, end, widthMethod),
  )
  const first = segment.search(/\S/)
  const column = first < 0 ? start : start + displayWidth(segment.slice(0, first), widthMethod)
  return hostPosition(map, clamp(column, 0, map.displayWidth))
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max))
}
