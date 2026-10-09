import { parseKeySequence } from "@vimee/core"
import type { CliRenderer, OptimizedBuffer, RGBA, WidthMethod } from "@opentui/core"
import { mappedActionDescription, mappedActionValue, type VimConfig, type VimMappedAction } from "./config"
import { displayWidth } from "./map"
import type { VimMode } from "./state"

export type WhichKeyOption = {
  /** Keys left to press after the pending prefix, as one display string. */
  keys: string
  /** The complete configured sequence, for direct execution. */
  sequence: string
  description: string
}

export type WhichKeyPending = {
  mode: VimMode
  tokens: readonly string[]
}

/** Mirrors the theme tokens of OpenCode's prompt completion popup. */
export type WhichKeyTheme = {
  surface: RGBA
  border: RGBA
  text: RGBA
  muted: RGBA
  selected: {
    background: RGBA
    foreground: RGBA
  }
}

const MAX_ROWS = 10
const SELECT_HINT = "↑↓/<C-n>/<C-p> 选择 · Enter 执行 · Esc 取消"
const BORDER = "┃"
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })

/**
 * Candidate mappings for the pending key prefix, sorted by their remaining
 * keys. Only sequences that are longer than the prefix and start with it are
 * listed.
 */
export function whichKeyOptions(
  keymaps: Record<string, VimMappedAction> | undefined,
  pendingTokens: readonly string[],
  commandTitle?: (id: string) => string | undefined,
): WhichKeyOption[] {
  const options: WhichKeyOption[] = []
  for (const [sequence, action] of Object.entries(keymaps ?? {})) {
    let tokens: string[]
    try {
      tokens = parseKeySequence(sequence)
    } catch {
      continue
    }
    if (tokens.length <= pendingTokens.length) continue
    if (!pendingTokens.every((token, index) => tokens[index] === token)) continue
    options.push({
      keys: tokens.slice(pendingTokens.length).join(""),
      sequence,
      description: describeMappedAction(action, commandTitle),
    })
  }
  options.sort(compareOptions)
  return options
}

function compareOptions(a: WhichKeyOption, b: WhichKeyOption) {
  const folded = a.keys.localeCompare(b.keys, "en", { sensitivity: "base" })
  if (folded !== 0) return folded
  return a.keys < b.keys ? -1 : a.keys > b.keys ? 1 : 0
}

/** Explicit description when configured, an inferred label otherwise. */
export function describeMappedAction(
  action: VimMappedAction,
  commandTitle?: (id: string) => string | undefined,
): string {
  const explicit = mappedActionDescription(action)
  if (explicit) return cleanText(explicit)

  const value = mappedActionValue(action)
  if (typeof value === "string") return describeStep(value, commandTitle)

  const text = value.find((step) => step.startsWith("text:"))
  if (text) return cleanText(text.slice("text:".length))
  return value.map((step) => describeStep(step, commandTitle)).join(" → ")
}

function describeStep(step: string, commandTitle?: (id: string) => string | undefined): string {
  if (step.startsWith("text:")) return cleanText(step.slice("text:".length))
  if (step.startsWith("command:")) {
    const id = step.slice("command:".length).trim()
    return commandTitle?.(id) ?? id
  }
  if (step.startsWith("agent:")) return `agent ${step.slice("agent:".length).trim()}`
  switch (step) {
    case "insert":
      return "insert mode"
    case "normal":
      return "normal mode"
    case "submit":
      return "submit"
    case "switch-panel":
      return "switch panel"
    case "passthrough":
      return "pass through"
    default:
      return step
  }
}

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

/** Truncates to a display width, CJK and emoji aware, with an ellipsis. */
export function truncateToWidth(text: string, width: number, method: WidthMethod = "unicode"): string {
  if (width <= 0) return ""
  if (displayWidth(text, method) <= width) return text
  let result = ""
  let used = 0
  for (const part of graphemes.segment(text)) {
    const partWidth = displayWidth(part.segment, method)
    if (used + partWidth > width - 1) break
    result += part.segment
    used += partWidth
  }
  return `${result}…`
}

type WhichKeyPanelInput = {
  config: VimConfig
  enabled: () => boolean
  renderer: CliRenderer
  theme: WhichKeyTheme
  /** Pending custom-keymap prefix from the active editor, if any. */
  pending: () => WhichKeyPending | undefined
  commandTitle?: (id: string) => string | undefined
}

type WhichKeySelection = {
  mode: VimMode
  sequence: string
}

/** What the popup owns a key press for. */
export type WhichKeyIntent = "up" | "down" | "run"

/** Draws the pending keymap candidates above the focused editor. */
export function createWhichKeyPanel(input: WhichKeyPanelInput) {
  let selected = 0
  let signature = ""

  const draw: Parameters<CliRenderer["addPostProcessFn"]>[0] = (buffer) => {
    const state = current()
    if (!state) return
    render(buffer, state.options, state.pending, selected, input)
  }
  input.renderer.addPostProcessFn(draw)

  function current() {
    if (!input.enabled() || !input.config.whichKey.enabled) return undefined
    const pending = input.pending()
    if (!pending) return undefined
    const options = whichKeyOptions(input.config.keymaps[pending.mode], pending.tokens, input.commandTitle)
    if (!options.length) return undefined
    const next = `${pending.mode}\n${pending.tokens.join(" ")}`
    if (next !== signature) {
      signature = next
      selected = 0
    }
    // Only the rows the popup can display are selectable.
    selected = Math.max(0, Math.min(selected, popupLayout(input, options.length).visible - 1))
    return { pending, options }
  }

  function select(): WhichKeySelection | undefined {
    const state = current()
    if (!state) return undefined
    const option = state.options[selected]
    return option ? { mode: state.pending.mode, sequence: option.sequence } : undefined
  }

  return {
    dispose() {
      input.renderer.removePostProcessFn(draw)
    },
    /** Whether the popup has candidates to show right now. */
    visible: () => current() !== undefined,
    /** Moves the highlighted candidate; stops at either end. */
    move(delta: number) {
      const state = current()
      if (!state) return false
      const max = popupLayout(input, state.options.length).visible - 1
      const next = Math.max(0, Math.min(selected + delta, max))
      if (next === selected) return false
      selected = next
      input.renderer.requestRender()
      return true
    },
    /** The highlighted candidate, if the popup is visible. */
    selection: select,
    /** The action the popup owns for a key press, if any. */
    owns(key: string, mapped: boolean): WhichKeyIntent | undefined {
      if (mapped || !current()) return undefined
      if (key === "<Up>" || key === "<C-p>") return "up"
      if (key === "<Down>" || key === "<C-n>") return "down"
      if (key === "<CR>" && select()) return "run"
      return undefined
    },
  }
}

/** Option rows to show, reserving the separator and hint rows. */
function popupLayout(input: WhichKeyPanelInput, count: number) {
  const budget = Math.max(1, Math.min(MAX_ROWS, input.renderer.height - 2))
  if (count <= budget) return { visible: count, more: false }
  return { visible: Math.max(1, budget - 1), more: true }
}

function render(
  buffer: OptimizedBuffer,
  options: WhichKeyOption[],
  pending: WhichKeyPending,
  selected: number,
  input: WhichKeyPanelInput,
) {
  const method = input.renderer.widthMethod
  const anchor = editorAnchor(input.renderer)
  const left = clamp(anchor.x, 0, Math.max(0, buffer.width - 4))
  const width = Math.max(8, Math.min(anchor.width ?? buffer.width - left, buffer.width - left))
  const textX = left + 3
  const textWidth = Math.max(0, width - (textX - left) - 2)
  const keyWidth = Math.max(...options.map((option) => displayWidth(option.keys, method)))
  const { visible, more } = popupLayout(input, options.length)
  const contentRows = visible + (more ? 1 : 0)
  const height = contentRows + 2
  const top = clamp(anchor.y - height, 0, Math.max(0, buffer.height - height))
  const colors = input.theme

  // Like the host's prompt completion: a raised surface with side borders only.
  buffer.fillRect(left + 1, top, Math.max(0, width - 2), height, colors.surface)
  for (let y = top; y < top + height; y++) {
    buffer.drawText(BORDER, left, y, colors.border)
    buffer.drawText(BORDER, left + width - 1, y, colors.border)
  }

  for (let index = 0; index < contentRows; index++) {
    const y = top + index
    if (index < visible) {
      drawOption(buffer, options[index], left, y, width, keyWidth, index === selected, method, colors)
    } else {
      buffer.drawText(
        truncateToWidth(`… +${options.length - visible} more`, textWidth, method),
        textX,
        y,
        colors.muted,
        colors.surface,
      )
    }
  }

  // A blank row separates the candidates from the key hints below them.
  const hint = truncateToWidth(`${pending.tokens.join("")} · ${SELECT_HINT}`, textWidth, method)
  buffer.drawText(hint, textX, top + contentRows + 1, colors.muted, colors.surface)
}

function drawOption(
  buffer: OptimizedBuffer,
  option: WhichKeyOption,
  left: number,
  y: number,
  width: number,
  keyWidth: number,
  highlighted: boolean,
  method: WidthMethod,
  colors: WhichKeyTheme,
) {
  const textX = left + 3
  const textWidth = Math.max(0, width - (textX - left) - 2)
  if (highlighted) buffer.fillRect(left + 2, y, Math.max(0, width - 4), 1, colors.selected.background)
  const background = highlighted ? colors.selected.background : colors.surface
  buffer.drawText(
    option.keys.padEnd(keyWidth, " "),
    textX,
    y,
    highlighted ? colors.selected.foreground : colors.text,
    background,
  )
  buffer.drawText(
    truncateToWidth(option.description, textWidth - keyWidth - 2, method),
    textX + keyWidth + 2,
    y,
    highlighted ? colors.selected.foreground : colors.muted,
    background,
  )
}

type EditorAnchorNode = {
  screenX?: number
  screenY?: number
  width?: number
  parent?: EditorAnchorNode | null
  border?: boolean | readonly string[]
}

/**
 * The host anchors its completion popup to the input box (border included), not
 * to the textarea. Walk up to the nearest container with side borders so the
 * popup spans the same box.
 */
function editorAnchor(renderer: CliRenderer) {
  const editor = renderer.currentFocusedEditor as EditorAnchorNode | null | undefined
  if (!editor) return { x: 2, y: renderer.height, width: undefined }

  let node = editor.parent
  while (node) {
    const border = node.border
    const bordered = border === true || (Array.isArray(border) && border.length > 0)
    if (bordered && typeof node.screenX === "number" && typeof node.width === "number" && node.width > 0) {
      return { x: node.screenX, y: node.screenY ?? editor.screenY ?? renderer.height, width: node.width }
    }
    node = node.parent
  }

  return { x: editor.screenX ?? 2, y: editor.screenY ?? renderer.height, width: editor.width }
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
}
