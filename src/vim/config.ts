import { parseKeySequence } from "@vimee/core"
import { DEFAULT_INPUT_SOURCE, readInputSource } from "./input-source-config"
import type { VimInputSource } from "./input-source-config"
import { DEFAULT_INLINE, DEFAULT_INLINE_TIMEOUT_MS } from "./inline"
import type { VimInline } from "./inline"
import type { VimMode } from "./state"

export type { VimInputSource, VimInputSourceCursorColors } from "./input-source-config"
export { DEFAULT_INPUT_SOURCE, DEFAULT_POLL_INTERVAL } from "./input-source-config"

export type VimCursorStyle = {
  style: "block" | "line" | "underline" | "default"
  blinking?: boolean
}

export type VimWhichKey = {
  enabled: boolean
}

export type VimListContinuation = {
  enabled: boolean
}

export type VimConfig = {
  defaultMode: VimMode
  diffView: DiffView
  sessionKey: string
  modeIndicator: ModeIndicator
  keymapTimeout: number
  cursorStyles: Record<VimMode, VimCursorStyle>
  inputSource: VimInputSource
  inline: VimInline
  whichKey: VimWhichKey
  listContinuation: VimListContinuation
  debug: boolean
  debugPath?: string
  keymaps: VimKeymaps
}

export type VimOptions = {
  defaultMode?: VimMode
  diffView?: DiffView
  sessionKey?: string
  modeIndicator?: ModeIndicator
  keymapTimeout?: number
  cursorStyles?: Partial<Record<VimMode, VimCursorStyle>>
  inputSource?: VimInputSource
  inline?: VimInline
  whichKey?: VimWhichKey
  listContinuation?: VimListContinuation
  debug?: boolean
  debugPath?: string
  keymaps?: VimKeymaps
}

export type DiffView = "after" | "before" | "diff"
export type ModeIndicator = "full" | "none"
export type SessionAction = "switch-panel" | "passthrough"
export type VimKeymaps = Partial<Record<VimMode, Record<string, VimMappedAction>>> & {
  session?: Record<string, SessionAction>
  panes?: Record<string, VimMappedAction>
}
/** A single action, a chain of steps run in order by one mapping, or one of
 *  those with a description for the which-key popup. */
export type VimMappedAction = string | readonly string[] | VimMappedActionObject

export type VimMappedActionObject = {
  readonly action: string | readonly string[]
  readonly description?: string
}

const DEFAULT_CURSOR_STYLES: Record<VimMode, VimCursorStyle> = {
  insert: { style: "line", blinking: true },
  normal: { style: "block", blinking: true },
  visual: { style: "block", blinking: true },
  "visual-line": { style: "block", blinking: true },
}

const DEFAULT_WHICH_KEY: VimWhichKey = { enabled: false }

const DEFAULT_LIST_CONTINUATION: VimListContinuation = { enabled: true }

export function createVimConfig(options: unknown): VimConfig {
  const input = readOptions(options)
  return {
    defaultMode: input.defaultMode ?? "insert",
    diffView: input.diffView ?? "after",
    sessionKey: input.sessionKey ?? "s",
    modeIndicator: input.modeIndicator ?? "full",
    keymapTimeout: Math.max(0, input.keymapTimeout ?? 500),
    cursorStyles: {
      insert: { ...DEFAULT_CURSOR_STYLES.insert, ...input.cursorStyles?.insert },
      normal: { ...DEFAULT_CURSOR_STYLES.normal, ...input.cursorStyles?.normal },
      visual: { ...DEFAULT_CURSOR_STYLES.visual, ...input.cursorStyles?.visual },
      "visual-line": { ...DEFAULT_CURSOR_STYLES["visual-line"], ...input.cursorStyles?.["visual-line"] },
    },
    inputSource: input.inputSource ?? DEFAULT_INPUT_SOURCE,
    inline: input.inline ?? DEFAULT_INLINE,
    whichKey: input.whichKey ?? DEFAULT_WHICH_KEY,
    listContinuation: input.listContinuation ?? DEFAULT_LIST_CONTINUATION,
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
    modeIndicator:
      source.modeIndicator === "full" || source.modeIndicator === "none" ? source.modeIndicator : undefined,
    keymapTimeout: readNumber(source.keymapTimeout),
    cursorStyles: readCursorStyles(source.cursorStyles),
    inputSource: readInputSource(source.inputSource),
    inline: readInline(source.inline),
    whichKey: readWhichKey(source.whichKey),
    listContinuation: readListContinuation(source.listContinuation),
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

function readInline(input: unknown): VimInline | undefined {
  if (!input || typeof input !== "object") return undefined
  const source = input as Record<string, unknown>
  return {
    enabled: source.enabled === true,
    timeoutMs: readNonNegative(source.timeoutMs) ?? DEFAULT_INLINE_TIMEOUT_MS,
    enterCloses: typeof source.enterCloses === "boolean" ? source.enterCloses : true,
    keepHeadSpace: typeof source.keepHeadSpace === "boolean" ? source.keepHeadSpace : false,
    keepTailSpace: typeof source.keepTailSpace === "boolean" ? source.keepTailSpace : false,
  }
}

function readWhichKey(input: unknown): VimWhichKey | undefined {
  if (!input || typeof input !== "object") return undefined
  const source = input as Record<string, unknown>
  return { enabled: source.enabled === true }
}

function readListContinuation(input: unknown): VimListContinuation | undefined {
  if (!input || typeof input !== "object") return undefined
  const source = input as Record<string, unknown>
  return { enabled: typeof source.enabled === "boolean" ? source.enabled : true }
}

function readString(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined
  const value = input.trim()
  return value.length > 0 ? value : undefined
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
  if (typeof value === "string" || Array.isArray(value)) return readMappedActionValue(value)
  if (!value || typeof value !== "object") return undefined
  const source = value as Record<string, unknown>
  const action = readMappedActionValue(source.action)
  if (!action) return undefined
  const description = readString(source.description)
  return description ? { action, description } : { action }
}

function readMappedActionValue(value: unknown): string | readonly string[] | undefined {
  if (typeof value === "string") return value.length > 0 ? value : undefined
  if (!Array.isArray(value)) return undefined
  const steps = value.filter((step): step is string => typeof step === "string" && step.length > 0)
  return steps.length > 0 ? steps : undefined
}

export function mappedActionValue(action: VimMappedAction): string | readonly string[] {
  return isMappedActionObject(action) ? action.action : action
}

export function mappedActionDescription(action: VimMappedAction): string | undefined {
  return isMappedActionObject(action) ? action.description : undefined
}

function isMappedActionObject(action: VimMappedAction): action is VimMappedActionObject {
  return typeof action === "object" && "action" in action
}

function readNumber(value: unknown) {
  return typeof value === "number" ? value : undefined
}
