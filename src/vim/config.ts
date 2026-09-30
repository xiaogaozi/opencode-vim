import { parseKeySequence } from "@vimee/core"
import { DEFAULT_ENGLISH_PATTERN, DEFAULT_OTHER_PATTERN } from "./context"
import type { VimMode } from "./state"

export type VimCursorStyle = {
  style: "block" | "line" | "underline" | "default"
  blinking?: boolean
}

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

export type VimConfig = {
  defaultMode: VimMode
  diffView: DiffView
  sessionKey: string
  keymapTimeout: number
  cursorStyles: Record<VimMode, VimCursorStyle>
  inputSource: VimInputSource
  debug: boolean
  debugPath?: string
  keymaps: VimKeymaps
}

export type VimOptions = {
  defaultMode?: VimMode
  diffView?: DiffView
  sessionKey?: string
  keymapTimeout?: number
  cursorStyles?: Partial<Record<VimMode, VimCursorStyle>>
  inputSource?: VimInputSource
  debug?: boolean
  debugPath?: string
  keymaps?: VimKeymaps
}

export type DiffView = "after" | "before" | "diff"
export type SessionAction = "switch-panel" | "passthrough"
export type VimKeymaps = Partial<Record<VimMode, Record<string, VimMappedAction>>> & {
  session?: Record<string, SessionAction>
  panes?: Record<string, VimMappedAction>
}
/** A single action, or a chain of steps run in order by one mapping. */
export type VimMappedAction = string | readonly string[]

const DEFAULT_CURSOR_STYLES: Record<VimMode, VimCursorStyle> = {
  insert: { style: "line", blinking: true },
  normal: { style: "block", blinking: true },
  visual: { style: "block", blinking: true },
  "visual-line": { style: "block", blinking: true },
}

const DEFAULT_POLL_INTERVAL = 500

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

export function createVimConfig(options: unknown): VimConfig {
  const input = readOptions(options)
  return {
    defaultMode: input.defaultMode ?? "insert",
    diffView: input.diffView ?? "after",
    sessionKey: input.sessionKey ?? "s",
    keymapTimeout: Math.max(0, input.keymapTimeout ?? 500),
    cursorStyles: {
      insert: { ...DEFAULT_CURSOR_STYLES.insert, ...input.cursorStyles?.insert },
      normal: { ...DEFAULT_CURSOR_STYLES.normal, ...input.cursorStyles?.normal },
      visual: { ...DEFAULT_CURSOR_STYLES.visual, ...input.cursorStyles?.visual },
      "visual-line": { ...DEFAULT_CURSOR_STYLES["visual-line"], ...input.cursorStyles?.["visual-line"] },
    },
    inputSource: input.inputSource ?? DEFAULT_INPUT_SOURCE,
    debug: input.debug ?? process.env.VIM_PROMPT_DEBUG === "1",
    debugPath: input.debugPath,
    keymaps: input.keymaps ?? {},
  }
}

function readOptions(options: unknown): VimOptions {
  if (!options || typeof options !== "object") return {}
  const raw = "vim" in options ? (options as { vim?: unknown }).vim : options
  if (!raw || typeof raw !== "object") return {}

  const source = raw as Record<string, unknown>
  return {
    defaultMode: isMode(source.defaultMode) ? source.defaultMode : undefined,
    diffView:
      source.diffView === "after" || source.diffView === "before" || source.diffView === "diff"
        ? source.diffView
        : undefined,
    sessionKey: readSessionKey(source.sessionKey),
    keymapTimeout: readNumber(source.keymapTimeout),
    cursorStyles: readCursorStyles(source.cursorStyles),
    inputSource: readInputSource(source.inputSource),
    debug: typeof source.debug === "boolean" ? source.debug : undefined,
    debugPath: typeof source.debugPath === "string" ? source.debugPath : undefined,
    keymaps: readKeymaps(source.keymaps),
  }
}

function readSessionKey(input: unknown): string | undefined {
  if (typeof input !== "string") return
  try {
    if (parseKeySequence(input).length === 1) return input
  } catch {}
}

function readKeymaps(input: unknown): VimKeymaps | undefined {
  if (!input || typeof input !== "object") return undefined
  const source = input as Record<string, unknown>
  const keymaps: VimKeymaps = {}

  for (const mode of ["insert", "normal", "visual", "visual-line", "panes"] as const) {
    const raw = source[mode]
    if (!raw || typeof raw !== "object") continue
    keymaps[mode] = {}
    for (const [key, action] of Object.entries(raw as Record<string, unknown>)) {
      const mapped = readMappedAction(action)
      if (mapped) keymaps[mode][key] = mapped
    }
  }
  if (source.session && typeof source.session === "object") {
    keymaps.session = {}
    for (const [key, action] of Object.entries(source.session)) {
      if (action === "switch-panel" || action === "passthrough") keymaps.session[key] = action
    }
  }

  return keymaps
}

function readCursorStyles(input: unknown): VimOptions["cursorStyles"] {
  if (!input || typeof input !== "object") return undefined
  const source = input as Record<string, unknown>
  return {
    insert: readCursorStyle(source.insert),
    normal: readCursorStyle(source.normal),
    visual: readCursorStyle(source.visual),
    "visual-line": readCursorStyle(source["visual-line"]),
  }
}

function readCursorStyle(input: unknown): VimCursorStyle | undefined {
  if (!input || typeof input !== "object") return undefined
  const source = input as Record<string, unknown>
  if (!isCursorStyle(source.style)) return undefined
  return {
    style: source.style,
    blinking: typeof source.blinking === "boolean" ? source.blinking : undefined,
  }
}

function readInputSource(input: unknown): VimInputSource | undefined {
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

function isCursorStyle(value: unknown): value is VimCursorStyle["style"] {
  return value === "block" || value === "line" || value === "underline" || value === "default"
}

function isMode(value: unknown): value is VimMode {
  return value === "insert" || value === "normal" || value === "visual" || value === "visual-line"
}

function readMappedAction(value: unknown): VimMappedAction | undefined {
  if (typeof value === "string") return value.length > 0 ? value : undefined
  if (!Array.isArray(value)) return undefined
  const steps = value.filter((step): step is string => typeof step === "string" && step.length > 0)
  return steps.length > 0 ? steps : undefined
}

function readNumber(value: unknown) {
  return typeof value === "number" ? value : undefined
}
