export type AutoPair = readonly [open: string, close: string]

export type VimAutoPairs = {
  enabled: boolean
  pairs: readonly AutoPair[]
}

export type AutoPairAction =
  | { readonly type: "insert"; readonly open: string; readonly close: string }
  | { readonly type: "skip"; readonly close: string }
  | { readonly type: "backspace"; readonly open: string; readonly close: string }

export type AutoPairOptions = {
  /** Continue the auto-inserted backtick pair from the previous key. */
  nestBackticks?: boolean
}

export const DEFAULT_AUTO_PAIRS: readonly AutoPair[] = [
  ["「", "」"],
  ["『", "』"],
  ["（", "）"],
  ["《", "》"],
  ["【", "】"],
  ["〈", "〉"],
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
  ["<", ">"],
  ["`", "`"],
]

export const DEFAULT_AUTO_PAIRS_CONFIG: VimAutoPairs = {
  enabled: false,
  pairs: DEFAULT_AUTO_PAIRS,
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })

/**
 * Decides what an insert-mode key should do with a configured pair. The
 * closing key wins over the opening key so a pair that uses the same character
 * on both sides can still skip over the one already in the text.
 */
export function autoPairAction(
  key: string,
  before: string,
  after: string,
  pairs: readonly AutoPair[],
  options: AutoPairOptions = {},
): AutoPairAction | undefined {
  if (key === "<BS>") {
    const pair = pairs.find(([open, close]) => before.endsWith(open) && after.startsWith(close))
    return pair ? { type: "backspace", open: pair[0], close: pair[1] } : undefined
  }

  // An auto-inserted backtick pair keeps nesting while the key is pressed
  // again, so consecutive presses grow 2 → 4 → 6 with the cursor in the middle.
  if (key === "`" && options.nestBackticks && before.endsWith(key) && after.startsWith(key))
    return { type: "insert", open: key, close: key }

  const closing = pairs.find(([, close]) => close === key)
  if (closing && after.startsWith(key)) return { type: "skip", close: key }

  const opening = pairs.find(([open]) => open === key)
  if (!opening) return undefined

  const [open, close] = opening
  // Leave a repeated same-character opener to native typing for custom pairs.
  if (open === close && open !== "`" && before.endsWith(open)) return undefined
  return { type: "insert", open, close }
}

export function readAutoPairs(input: unknown): VimAutoPairs | undefined {
  if (!input || typeof input !== "object") return undefined
  const source = input as Record<string, unknown>
  return {
    enabled: source.enabled === true,
    pairs: readPairs(source.pairs) ?? DEFAULT_AUTO_PAIRS,
  }
}

function readPairs(input: unknown): readonly AutoPair[] | undefined {
  if (!Array.isArray(input)) return undefined
  const pairs: AutoPair[] = []
  for (const value of input) {
    const pair = readPair(value)
    if (pair) pairs.push(pair)
  }
  return pairs
}

function readPair(input: unknown): AutoPair | undefined {
  if (typeof input === "string") {
    const parts = splitGraphemes(input)
    if (parts.length === 2) return [parts[0]!, parts[1]!]
    return undefined
  }
  if (!Array.isArray(input) || input.length !== 2) return undefined
  const [open, close] = input
  if (typeof open !== "string" || typeof close !== "string") return undefined
  if (splitGraphemes(open).length !== 1 || splitGraphemes(close).length !== 1) return undefined
  return [open, close]
}

function splitGraphemes(value: string): string[] {
  return [...graphemes.segment(value)].map((part) => part.segment)
}
