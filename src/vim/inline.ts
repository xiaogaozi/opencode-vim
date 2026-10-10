import { createSignal } from "solid-js"
import type { VimMode } from "./state"

export type VimInline = {
  enabled: boolean
  timeoutMs: number
  enterCloses: boolean
  /** Keep the space that opened the region when it closes. */
  keepHeadSpace: boolean
  /** Keep the space typed before the cursor when Enter closes the region. */
  keepTailSpace: boolean
}

/** How the trailing whitespace run is trimmed when the region closes. */
export type InlineTailTrim = "none" | "one" | "excess"

export type InlineAction = {
  kind: "enter" | "exit"
  /** Consume the triggering key instead of letting it reach the editor/host. */
  consume: boolean
  /** Delete one space at the region head when exiting. */
  trimHead: boolean
  /** Trailing space handling: delete one space, or leave at most one. */
  trimTail: InlineTailTrim
  /** Character index where the region head space starts. */
  anchor?: number
}

export type InlineController = {
  active: () => boolean
  handleKey: (input: {
    key: string
    mode: VimMode
    role: "normal" | "other" | undefined
    cursor: number
  }) => InlineAction | undefined
  close: () => void
}

export const DEFAULT_INLINE_TIMEOUT_MS = 400

export const DEFAULT_INLINE: VimInline = {
  enabled: false,
  timeoutMs: DEFAULT_INLINE_TIMEOUT_MS,
  enterCloses: true,
  keepHeadSpace: true,
  keepTailSpace: true,
}

/**
 * The key to feed the inline controller. Enter is rewritten when it must not
 * close the region (modified keys, or the prompt completion owns it) so the
 * controller still resets its double-space timer without closing.
 */
export function inlineKeyFor(key: string, bypassEnter: boolean): string {
  return bypassEnter && key === "<CR>" ? "<CR-skip>" : key
}

/**
 * Removes one space at the region head and/or one space before the cursor.
 * Returns the new text together with the cursor kept at its old position
 * relative to the end (edit primitives would otherwise move it to the edit).
 * With `protect`, the trailing run stops before that character, so a kept
 * head space survives a trailing trim.
 */
export function trimInlineText(
  text: string,
  cursor: number,
  anchor: number | undefined,
  trimHead: boolean,
  trimTail: InlineTailTrim,
  protect?: number,
): { text: string; cursor: number } {
  let next = text
  let nextCursor = cursor

  if (trimTail !== "none" && nextCursor > 0) {
    let run = 0
    while (run < nextCursor && next[nextCursor - 1 - run] === " ") run++
    let remove = trimTail === "one" ? Math.min(run, 1) : Math.max(0, run - 1)
    if (protect !== undefined) remove = Math.min(remove, Math.max(0, nextCursor - 1 - protect))
    if (remove > 0) {
      next = next.slice(0, nextCursor - remove) + next.slice(nextCursor)
      nextCursor -= remove
    }
  }
  if (trimHead && anchor !== undefined && anchor >= 0 && anchor < next.length && next[anchor] === " ") {
    next = next.slice(0, anchor) + next.slice(anchor + 1)
    if (anchor < nextCursor) nextCursor--
  }

  return { text: next, cursor: nextCursor }
}

export type InlineTrimStep = { text: string; cursor: number }

/**
 * The trim edits to apply in order when the region closes. The tail goes
 * first and the head second, each as its own minimal edit: a single edit
 * spanning both ends would mark everything in between as replaced, which
 * drops host extmarks (file references) that live there.
 */
export function trimInlineSteps(
  text: string,
  cursor: number,
  anchor: number | undefined,
  trimHead: boolean,
  trimTail: InlineTailTrim,
): InlineTrimStep[] {
  const steps: InlineTrimStep[] = []

  // A kept head space must survive the tail trim as well: a space inserted
  // into existing text leaves the cursor right after the trigger space.
  const tail = trimInlineText(text, cursor, undefined, false, trimTail, trimHead ? undefined : anchor)
  if (tail.text !== text) steps.push(tail)

  if (trimHead) {
    const head = trimInlineText(tail.text, tail.cursor, anchor, true, "none")
    if (head.text !== tail.text) steps.push(head)
  }

  return steps
}

/**
 * Inline English region, following emacs-smart-input-source's inline mode: a
 * space typed while the other input source is active opens an English region
 * that two spaces or Enter close again. By default the head space and the
 * tail space typed before a closing Enter survive the close, matching
 * `sis-inline-tighten-head-rule`/`-tail-rule`'s `'one` default; set
 * `keepHeadSpace`/`keepTailSpace` to `false` for the tight behavior.
 */
export function createInlineController(config: VimInline): InlineController {
  const [active, setActive] = createSignal(false)
  let anchor: number | undefined
  let lastSpace: number | undefined

  return { active, handleKey, close }

  function handleKey(input: {
    key: string
    mode: VimMode
    role: "normal" | "other" | undefined
    cursor: number
  }): InlineAction | undefined {
    if (!config.enabled) return undefined
    if (input.mode !== "insert") {
      close()
      return undefined
    }

    if (input.key === "<Space>") {
      if (!active()) {
        if (input.role !== "other") return undefined
        setActive(true)
        anchor = input.cursor
        lastSpace = undefined
        return { kind: "enter", consume: false, trimHead: false, trimTail: "none" }
      }

      const now = Date.now()
      const double = lastSpace !== undefined && now - lastSpace <= config.timeoutMs
      if (!double) {
        lastSpace = now
        return undefined
      }

      const exitAnchor = anchor
      close()
      return {
        kind: "exit",
        consume: true,
        trimHead: !config.keepHeadSpace,
        trimTail: "excess",
        anchor: exitAnchor,
      }
    }

    lastSpace = undefined
    if (input.key === "<CR>" && active()) {
      const trims = config.enterCloses
      const exitAnchor = anchor
      close()
      return {
        kind: "exit",
        consume: trims,
        trimHead: trims && !config.keepHeadSpace,
        trimTail: trims ? (config.keepTailSpace ? "none" : "one") : "none",
        anchor: exitAnchor,
      }
    }
    return undefined
  }

  function close() {
    setActive(false)
    anchor = undefined
    lastSpace = undefined
  }
}
