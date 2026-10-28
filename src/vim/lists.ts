const UNORDERED = /^([ \t]*)([-*+])([ \t]+)(.*)$/
const ORDERED = /^([ \t]*)(\d{1,9})([.)])([ \t]+)(.*)$/
const TASK = /^\[([ xX])\]([ \t]+|$)/
const THEMATIC_BREAK = /^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/

export type ListLine = {
  /** Leading whitespace of the source line. */
  indent: string
  /** Prefix for the next line after its indentation, such as `- ` or `2. `. */
  next: string
  /** Length of the source line's indentation, marker, spacing, and task box. */
  prefixLength: number
  /** True when nothing follows the prefix. */
  empty: boolean
}

export type OrderedLine = {
  indent: string
  digits: string
  delimiter: "." | ")"
  gap: string
  content: string
  /** Index of the first digit within the line. */
  digitsStart: number
  /** Index after the last digit within the line. */
  digitsEnd: number
}

export type NumberEdit = {
  line: number
  start: number
  end: number
  value: string
}

/**
 * Reads an ordered list marker, including the positions of its digits so a
 * later edit can replace only the number.
 */
export function orderedLine(line: string): OrderedLine | undefined {
  const match = ORDERED.exec(line)
  if (!match) return undefined
  const indent = match[1]!
  const digits = match[2]!
  return {
    indent,
    digits,
    delimiter: match[3] as "." | ")",
    gap: match[4]!,
    content: match[5]!,
    digitsStart: indent.length,
    digitsEnd: indent.length + digits.length,
  }
}

/**
 * Increments the number of every following ordered item at the same
 * indentation and with the same delimiter. Deeper lines are skipped so nested
 * lists keep their own numbering; a blank, non-list, dedented, or different
 * list line ends the scan.
 */
export function renumberOrderedSiblings(
  lines: readonly string[],
  after: number,
  indent: string,
  delimiter: "." | ")",
): NumberEdit[] {
  const edits: NumberEdit[] = []

  for (let index = after + 1; index < lines.length; index++) {
    const line = lines[index] ?? ""
    if (line.trim() === "") break

    const leading = /^[ \t]*/.exec(line)![0]
    if (leading !== indent) {
      if (leading.length > indent.length) continue
      break
    }

    const item = orderedLine(line)
    if (!item || item.delimiter !== delimiter) break
    edits.push({
      line: index,
      start: item.digitsStart,
      end: item.digitsEnd,
      value: increment(item.digits),
    })
  }

  return edits
}

/**
 * Reads the list marker on a line and derives the marker for a new item below
 * it. Returns undefined for non-list lines, thematic breaks, and lines without
 * the whitespace Markdown requires after a marker.
 */
export function listLine(line: string): ListLine | undefined {
  if (THEMATIC_BREAK.test(line)) return undefined

  const unordered = UNORDERED.exec(line)
  const ordered = unordered ? undefined : orderedLine(line)
  if (!unordered && !ordered) return undefined

  const indent = unordered ? unordered[1]! : ordered!.indent
  const gap = unordered ? unordered[3]! : ordered!.gap
  const rest = unordered ? unordered[4]! : ordered!.content
  const marker = unordered ? unordered[2]! : `${increment(ordered!.digits)}${ordered!.delimiter}`
  const markerLength = unordered ? 1 : ordered!.digits.length + 1

  let next = marker + gap
  let prefixLength = indent.length + markerLength + gap.length

  const task = TASK.exec(rest)
  if (task) {
    // New task items start unchecked; keep the source spacing when present.
    next += "[ ]" + (task[2] || " ")
    prefixLength += 3 + task[2]!.length
  }

  return {
    indent,
    next,
    prefixLength,
    empty: rest.slice(task?.[0].length ?? 0).trim() === "",
  }
}

/**
 * True when `line` sits inside a fenced code block whose opening fence is in
 * one of the preceding `lines`.
 */
export function inFencedCode(lines: readonly string[], line: number): boolean {
  let fence: { marker: string; length: number } | undefined
  const end = Math.max(0, Math.min(line, lines.length))

  for (let index = 0; index < end; index++) {
    const match = FENCE.exec(lines[index] ?? "")
    if (!match) continue
    const marker = match[1]![0]!
    const length = match[1]!.length
    const rest = match[2] ?? ""

    if (!fence) {
      // A backtick fence's info string cannot itself contain a backtick.
      if (marker === "`" && rest.includes("`")) continue
      fence = { marker, length }
      continue
    }
    if (fence.marker === marker && length >= fence.length && rest.trim() === "") fence = undefined
  }

  return fence !== undefined
}

function increment(digits: string) {
  return String(Number(digits) + 1).padStart(digits.length, "0")
}
