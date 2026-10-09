import type { BufferReader, CursorPosition, MotionRange, Operator } from "@vimee/core"

/**
 * Vim word motions with Unicode character classes.
 *
 * The engine classifies characters with JavaScript's \w, which treats every
 * CJK character as punctuation. Word motions therefore jump over a whole
 * Chinese run, and operators such as "dw" delete it in one go. This module
 * mirrors the classes Vim and Neovim use for "w", "b" and "e" instead:
 *
 *   0   white space
 *   1   punctuation
 *   >=2 word characters, one class per script
 *   3   emoji
 *
 * Because each script has its own class, boundaries between ASCII, Han,
 * kana and Hangul are word boundaries too.
 */

export type WordDecoder = (value: string) => string

const BLANK = 0
const PUNCTUATION = 1
const WORD = 2
const EMOJI = 3

// Superscripts, subscripts and braille, which Vim keeps apart from other
// word characters.
const SUPERSCRIPT = 0x2070
const SUBSCRIPT = 0x2080
const BRAILLE = 0x2800
const HIRAGANA = 0x3040
const KATAKANA = 0x30a0
const HAN = 0x4e00
const HANGUL = 0xac00

/** Character classes produced by charClass(). */
export const WordClass = {
  blank: BLANK,
  punctuation: PUNCTUATION,
  word: WORD,
  emoji: EMOJI,
  superscript: SUPERSCRIPT,
  subscript: SUBSCRIPT,
  braille: BRAILLE,
  hiragana: HIRAGANA,
  katakana: KATAKANA,
  han: HAN,
  hangul: HANGUL,
} as const

// Sorted, non-overlapping character classes as used by Vim's utf_class().
const CLASS_RANGES: ReadonlyArray<readonly [number, number, number]> = [
  [0x37e, 0x37e, PUNCTUATION],
  [0x387, 0x387, PUNCTUATION],
  [0x55a, 0x55f, PUNCTUATION],
  [0x589, 0x589, PUNCTUATION],
  [0x5be, 0x5be, PUNCTUATION],
  [0x5c0, 0x5c0, PUNCTUATION],
  [0x5c3, 0x5c3, PUNCTUATION],
  [0x5f3, 0x5f4, PUNCTUATION],
  [0x60c, 0x60c, PUNCTUATION],
  [0x61b, 0x61b, PUNCTUATION],
  [0x61f, 0x61f, PUNCTUATION],
  [0x66a, 0x66d, PUNCTUATION],
  [0x6d4, 0x6d4, PUNCTUATION],
  [0x700, 0x70d, PUNCTUATION],
  [0x964, 0x965, PUNCTUATION],
  [0x970, 0x970, PUNCTUATION],
  [0xdf4, 0xdf4, PUNCTUATION],
  [0xe4f, 0xe4f, PUNCTUATION],
  [0xe5a, 0xe5b, PUNCTUATION],
  [0xf04, 0xf12, PUNCTUATION],
  [0xf3a, 0xf3d, PUNCTUATION],
  [0xf85, 0xf85, PUNCTUATION],
  [0x104a, 0x104f, PUNCTUATION],
  [0x10fb, 0x10fb, PUNCTUATION],
  [0x1361, 0x1368, PUNCTUATION],
  [0x166d, 0x166e, PUNCTUATION],
  [0x1680, 0x1680, BLANK],
  [0x169b, 0x169c, PUNCTUATION],
  [0x16eb, 0x16ed, PUNCTUATION],
  [0x1735, 0x1736, PUNCTUATION],
  [0x17d4, 0x17dc, PUNCTUATION],
  [0x1800, 0x180a, PUNCTUATION],
  [0x2000, 0x200b, BLANK],
  [0x200c, 0x2027, PUNCTUATION],
  [0x2028, 0x2029, BLANK],
  [0x202a, 0x202e, PUNCTUATION],
  [0x202f, 0x202f, BLANK],
  [0x2030, 0x205e, PUNCTUATION],
  [0x205f, 0x205f, BLANK],
  [0x2060, 0x206f, PUNCTUATION],
  [0x2070, 0x207f, SUPERSCRIPT],
  [0x2080, 0x2094, SUBSCRIPT],
  [0x20a0, 0x27ff, PUNCTUATION],
  [0x2800, 0x28ff, BRAILLE],
  [0x2900, 0x2998, PUNCTUATION],
  [0x29d8, 0x29db, PUNCTUATION],
  [0x29fc, 0x29fd, PUNCTUATION],
  [0x2e00, 0x2e7f, PUNCTUATION],
  [0x3000, 0x3000, BLANK],
  [0x3001, 0x3020, PUNCTUATION],
  [0x3030, 0x3030, PUNCTUATION],
  [0x303d, 0x303d, PUNCTUATION],
  [0x3040, 0x309f, HIRAGANA],
  [0x30a0, 0x30ff, KATAKANA],
  [0x3300, 0x9fff, HAN],
  [0xac00, 0xd7a3, HANGUL],
  [0xf900, 0xfaff, HAN],
  [0xfd3e, 0xfd3f, PUNCTUATION],
  [0xfe30, 0xfe6b, PUNCTUATION],
  [0xff00, 0xff0f, PUNCTUATION],
  [0xff1a, 0xff20, PUNCTUATION],
  [0xff3b, 0xff40, PUNCTUATION],
  [0xff5b, 0xff65, PUNCTUATION],
  [0x1d000, 0x1d24f, PUNCTUATION],
  [0x1d400, 0x1d7ff, PUNCTUATION],
  [0x1f000, 0x1f2ff, PUNCTUATION],
  [0x1f300, 0x1f9ff, PUNCTUATION],
  [0x20000, 0x2a6df, HAN],
  [0x2a700, 0x2b73f, HAN],
  [0x2b740, 0x2b81f, HAN],
  [0x2f800, 0x2fa1f, HAN],
]

const EMOJI_PATTERN = /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u

export const WORD_MOTION_KEYS = new Set(["w", "W", "b", "B", "e", "E"])

export function charClass(value: string | undefined, big: boolean, decode?: WordDecoder): number {
  if (!value) return BLANK
  const decoded = decode ? decode(value) : value
  const code = decoded.codePointAt(0)
  if (code === undefined) return BLANK
  if (code === 0x20 || code === 0x09 || code === 0x00) return BLANK
  const kind = unicodeClass(code, decoded)
  if (kind === BLANK) return BLANK
  return big ? PUNCTUATION : kind
}

function unicodeClass(code: number, decoded: string): number {
  if (code < 0x100) {
    if (code === 0xa0) return BLANK
    // Vim's default 'iskeyword': letters, digits, underscore, 192-255.
    const word =
      (code >= 0x30 && code <= 0x39) ||
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a) ||
      code === 0x5f ||
      (code >= 0xc0 && code <= 0xff)
    return word ? WORD : PUNCTUATION
  }
  if (EMOJI_PATTERN.test(decoded)) return EMOJI
  return rangeClass(code)
}

function rangeClass(code: number): number {
  let low = 0
  let high = CLASS_RANGES.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    const [first, last, kind] = CLASS_RANGES[middle]
    if (code < first) high = middle - 1
    else if (code > last) low = middle + 1
    else return kind
  }
  return WORD
}

type Step = { cursor: CursorPosition; kind: 0 | 1 | 2 }

// Increment the cursor like Vim's inc(): step within the line, then onto the
// end-of-line position, then across the line boundary. Kind 2 marks the
// end-of-line position, kind 1 a move to the next line.
function inc(buffer: BufferReader, cursor: CursorPosition): Step | null {
  const length = buffer.getLineLength(cursor.line)
  if (cursor.col < length) {
    const col = cursor.col + 1
    return { cursor: { line: cursor.line, col }, kind: col >= length ? 2 : 0 }
  }
  if (cursor.line < buffer.getLineCount() - 1) {
    return { cursor: { line: cursor.line + 1, col: 0 }, kind: 1 }
  }
  return null
}

// Decrement the cursor like Vim's dec(): crossing backwards lands on the
// end-of-line position of the previous line, not on its last character.
function dec(buffer: BufferReader, cursor: CursorPosition): Step | null {
  if (cursor.col > 0) return { cursor: { line: cursor.line, col: cursor.col - 1 }, kind: 0 }
  if (cursor.line > 0) {
    const line = cursor.line - 1
    return { cursor: { line, col: buffer.getLineLength(line) }, kind: 1 }
  }
  return null
}

// Like Vim's decl(): skip the end-of-line position when crossing backwards.
function decl(buffer: BufferReader, cursor: CursorPosition): CursorPosition | null {
  let step = dec(buffer, cursor)
  if (step?.kind === 1 && step.cursor.col !== 0) step = dec(buffer, step.cursor)
  return step?.cursor ?? null
}

function oneLeft(cursor: CursorPosition): CursorPosition | null {
  if (cursor.col === 0) return null
  return { line: cursor.line, col: cursor.col - 1 }
}

function classAt(buffer: BufferReader, cursor: CursorPosition, big: boolean, decode?: WordDecoder) {
  const line = buffer.getLine(cursor.line)
  return charClass(line[cursor.col] as string | undefined, big, decode)
}

function isChangeWordTarget(buffer: BufferReader, cursor: CursorPosition) {
  const char = buffer.getLine(cursor.line)[cursor.col]
  return char !== undefined && char !== " " && char !== "\t"
}

function skipChars(
  buffer: BufferReader,
  cursor: CursorPosition,
  kind: number,
  big: boolean,
  direction: "forward" | "backward",
  decode?: WordDecoder,
): { cursor: CursorPosition; boundary: boolean } {
  let current = cursor
  while (classAt(buffer, current, big, decode) === kind) {
    const step = direction === "forward" ? inc(buffer, current) : dec(buffer, current)
    if (!step) return { cursor: current, boundary: true }
    current = step.cursor
  }
  return { cursor: current, boundary: false }
}

function backInLine(buffer: BufferReader, cursor: CursorPosition, big: boolean, decode?: WordDecoder): CursorPosition {
  const startClass = classAt(buffer, cursor, big, decode)
  let current = cursor
  while (current.col > 0) {
    const step = dec(buffer, current)
    if (!step) break
    current = step.cursor
    if (classAt(buffer, current, big, decode) !== startClass) {
      const back = inc(buffer, current)
      if (back) current = back.cursor
      break
    }
  }
  return current
}

export type WordMotionResult = { cursor: CursorPosition; failed: boolean }

/**
 * Vim's fwd_word(). "eol" makes the motion stop at the end of a line, as it
 * does while an operator is pending.
 */
export function forwardWord(
  cursor: CursorPosition,
  count: number,
  big: boolean,
  buffer: BufferReader,
  eol: boolean,
  decode?: WordDecoder,
): WordMotionResult {
  let current = cursor
  for (let remaining = count; remaining > 0; remaining--) {
    const lastLine = current.line === buffer.getLineCount() - 1
    const startClass = classAt(buffer, current, big, decode)
    const first = inc(buffer, current)
    if (!first) return { cursor: current, failed: true }
    // Vim fails when the cursor is already on the last character of the
    // buffer, but keeps the end-of-line position it just stepped onto.
    if (first.kind >= 1 && lastLine) return { cursor: first.cursor, failed: true }
    if (first.kind >= 1 && eol && remaining === 1) return { cursor: first.cursor, failed: false }
    current = first.cursor

    if (startClass !== BLANK) {
      while (classAt(buffer, current, big, decode) === startClass) {
        const step = inc(buffer, current)
        if (!step) return { cursor: current, failed: false }
        if (step.kind >= 1 && eol && remaining === 1) return { cursor: step.cursor, failed: false }
        current = step.cursor
      }
    }

    while (classAt(buffer, current, big, decode) === BLANK) {
      if (current.col === 0 && buffer.getLineLength(current.line) === 0) break
      const step = inc(buffer, current)
      if (!step) return { cursor: current, failed: false }
      if (step.kind >= 1 && eol && remaining === 1) return { cursor: step.cursor, failed: false }
      current = step.cursor
    }
  }
  return { cursor: current, failed: false }
}

/** Vim's bck_word(). */
export function backwardWord(
  cursor: CursorPosition,
  count: number,
  big: boolean,
  buffer: BufferReader,
  decode?: WordDecoder,
): WordMotionResult {
  let current = cursor
  for (let remaining = count; remaining > 0; remaining--) {
    const back = dec(buffer, current)
    if (!back) return { cursor: current, failed: true }
    current = back.cursor

    let stopped = false
    while (classAt(buffer, current, big, decode) === BLANK) {
      if (current.col === 0 && buffer.getLineLength(current.line) === 0) {
        stopped = true
        break
      }
      const step = dec(buffer, current)
      if (!step) return { cursor: current, failed: false }
      current = step.cursor
    }

    if (!stopped) {
      const skipped = skipChars(buffer, current, classAt(buffer, current, big, decode), big, "backward", decode)
      if (skipped.boundary) return { cursor: skipped.cursor, failed: false }
      current = skipped.cursor
      const forward = inc(buffer, current)
      if (forward) current = forward.cursor
    }
  }
  return { cursor: current, failed: false }
}

/**
 * Vim's end_word(). "stop" keeps a change inside the current word when the
 * cursor already sits on its last character; "empty" stops on empty lines.
 */
export function endWord(
  cursor: CursorPosition,
  count: number,
  big: boolean,
  stop: boolean,
  empty: boolean,
  buffer: BufferReader,
  decode?: WordDecoder,
): WordMotionResult {
  let current = cursor
  let stopFlag = stop
  for (let remaining = count; remaining > 0; remaining--) {
    const startClass = classAt(buffer, current, big, decode)
    const first = inc(buffer, current)
    if (!first) return { cursor: current, failed: true }
    current = first.cursor

    let finished = false
    if (classAt(buffer, current, big, decode) === startClass && startClass !== BLANK) {
      const skipped = skipChars(buffer, current, startClass, big, "forward", decode)
      if (skipped.boundary) return { cursor: skipped.cursor, failed: true }
      current = skipped.cursor
    } else if (!stopFlag || startClass === BLANK) {
      while (classAt(buffer, current, big, decode) === BLANK) {
        if (empty && current.col === 0 && buffer.getLineLength(current.line) === 0) {
          finished = true
          break
        }
        const step = inc(buffer, current)
        if (!step) return { cursor: current, failed: true }
        current = step.cursor
      }
      if (!finished) {
        const skipped = skipChars(buffer, current, classAt(buffer, current, big, decode), big, "forward", decode)
        if (skipped.boundary) return { cursor: skipped.cursor, failed: true }
        current = skipped.cursor
      }
    }

    if (!finished) {
      const back = dec(buffer, current)
      if (back) current = back.cursor
    }
    stopFlag = false
  }
  return { cursor: current, failed: false }
}

export type WordMotion = { cursor: CursorPosition; range: MotionRange }

/** Resolve "w", "W", "b", "B", "e" or "E" into a cursor and motion range. */
export function wordMotion(
  key: string,
  cursor: CursorPosition,
  count: number,
  buffer: BufferReader,
  operator: Operator | null,
  decode?: WordDecoder,
): WordMotion {
  const big = key === "W" || key === "B" || key === "E"
  if (key === "b" || key === "B") {
    const target = backwardWord(cursor, count, big, buffer, decode).cursor
    return { cursor: target, range: { start: cursor, end: target, linewise: false, inclusive: false } }
  }
  if (key === "e" || key === "E") {
    const target = endWord(cursor, count, big, false, false, buffer, decode).cursor
    return { cursor: target, range: { start: cursor, end: target, linewise: false, inclusive: true } }
  }
  // "cw" changes to the end of the word, like "ce" (Vim's 'cpo' includes
  // the '_' flag), unless the cursor sits on a blank.
  if (operator === "c" && isChangeWordTarget(buffer, cursor)) {
    const target = endWord(cursor, count, big, true, false, buffer, decode).cursor
    return { cursor: target, range: { start: cursor, end: target, linewise: false, inclusive: true } }
  }
  const target = forwardWord(cursor, count, big, buffer, operator !== null, decode).cursor
  return { cursor: target, range: { start: cursor, end: target, linewise: false, inclusive: false } }
}

/** Vim's "iw"/"aw" and "iW"/"aW" text objects. */
export function wordTextObject(
  modifier: "i" | "a",
  cursor: CursorPosition,
  big: boolean,
  buffer: BufferReader,
  decode?: WordDecoder,
): MotionRange | null {
  const include = modifier === "a"
  let start = backInLine(buffer, cursor, big, decode)
  const startClass = classAt(buffer, start, big, decode)
  let end = start
  let includeWhite = false

  if ((startClass === BLANK) === include) {
    const target = endWord(start, 1, big, true, true, buffer, decode)
    if (target.failed) return null
    end = target.cursor
  } else {
    const moved = forwardWord(start, 1, big, buffer, true, decode).cursor
    const left = moved.col === 0 ? decl(buffer, moved) : oneLeft(moved)
    end = left ?? moved
    if (include) includeWhite = true
  }

  if (includeWhite && classAt(buffer, end, big, decode) !== BLANK) {
    // Include the whitespace before the word when there is none after it.
    const left = oneLeft(start)
    if (left) {
      const back = backInLine(buffer, left, big, decode)
      if (classAt(buffer, back, big, decode) === BLANK && back.col > 0) start = back
    }
  }

  return { start, end, linewise: false, inclusive: true }
}
