import { DEFAULT_ENGLISH_PATTERN, DEFAULT_OTHER_PATTERN } from "./context"

export type VimInputSourceCursorColors = {
  english?: string
  other?: string
}

export type VimInputSource = {
  enabled: boolean
  normal: string
  insert?: string
  command?: string
  getCommand?: string
  setCommand?: string
  waitMs?: number
  context: boolean
  contextAggressiveLine: boolean
  englishPattern: string
  otherPattern: string
  pollInterval: number
  cursorColors: VimInputSourceCursorColors
  indicator: boolean
}

export const DEFAULT_POLL_INTERVAL = 500

export const DEFAULT_INPUT_SOURCE: VimInputSource = {
  enabled: false,
  normal: "",
  context: true,
  contextAggressiveLine: true,
  englishPattern: DEFAULT_ENGLISH_PATTERN,
  otherPattern: DEFAULT_OTHER_PATTERN,
  pollInterval: DEFAULT_POLL_INTERVAL,
  cursorColors: {},
  indicator: true,
}

/** Read only the input-source part of the `vim` plugin options. */
export function readInputSourceConfig(options: unknown): VimInputSource {
  if (!options || typeof options !== "object") return DEFAULT_INPUT_SOURCE
  const vim = (options as Record<string, unknown>).vim
  if (!vim || typeof vim !== "object") return DEFAULT_INPUT_SOURCE
  return readInputSource((vim as Record<string, unknown>).inputSource) ?? DEFAULT_INPUT_SOURCE
}

export function readInputSource(input: unknown): VimInputSource | undefined {
  if (!input || typeof input !== "object") return undefined
  const source = input as Record<string, unknown>
  const normal = readString(source.normal)

  return {
    enabled: source.enabled === true && !!normal,
    normal: normal ?? "",
    insert: readString(source.insert),
    command: readString(source.command),
    getCommand: readString(source.getCommand),
    setCommand: readString(source.setCommand),
    waitMs: readNonNegative(source.waitMs),
    context: typeof source.context === "boolean" ? source.context : true,
    contextAggressiveLine: typeof source.contextAggressiveLine === "boolean" ? source.contextAggressiveLine : true,
    englishPattern: readPattern(source.englishPattern, DEFAULT_ENGLISH_PATTERN),
    otherPattern: readPattern(source.otherPattern, DEFAULT_OTHER_PATTERN),
    pollInterval: readNonNegative(source.pollInterval) ?? DEFAULT_POLL_INTERVAL,
    cursorColors: readCursorColors(source.cursorColors),
    indicator: typeof source.indicator === "boolean" ? source.indicator : true,
  }
}

function readCursorColors(input: unknown): VimInputSourceCursorColors {
  if (!input || typeof input !== "object") return {}
  const source = input as Record<string, unknown>
  return {
    english: readColor(source.english),
    other: readColor(source.other),
  }
}

function readString(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined
  const value = input.trim()
  return value.length > 0 ? value : undefined
}

function readColor(input: unknown): string | undefined {
  const value = readString(input)
  if (!value || !/^#[0-9a-fA-F]{3,8}$/.test(value)) return undefined
  return value
}

function readPattern(input: unknown, fallback: string): string {
  const value = readString(input)
  if (!value) return fallback
  try {
    new RegExp(value)
    return value
  } catch {
    return fallback
  }
}

function readNonNegative(input: unknown): number | undefined {
  return typeof input === "number" && Number.isFinite(input) && input >= 0 ? input : undefined
}
