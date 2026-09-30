import { createSignal } from "solid-js"
import type { VimMode } from "./state"

export type VimInline = {
    enabled: boolean
    timeoutMs: number
    enterCloses: boolean
}

export type InlineAction = {
    kind: "enter" | "exit"
    /** Consume the triggering key instead of letting it reach the editor/host. */
    consume: boolean
    /** Delete one space at the region head when exiting. */
    trimHead: boolean
    /** Delete one space before the cursor when exiting. */
    trimTail: boolean
    /** Character index where the region head space starts. */
    anchor?: number
}

export type InlineController = {
    active: () => boolean
    handleKey: (input: { key: string; mode: VimMode; role: "normal" | "other" | undefined; cursor: number }) => InlineAction | undefined
    close: () => void
}

export const DEFAULT_INLINE_TIMEOUT_MS = 400

export const DEFAULT_INLINE: VimInline = {
    enabled: false,
    timeoutMs: DEFAULT_INLINE_TIMEOUT_MS,
    enterCloses: true,
}

/**
 * Removes one space at the region head and/or one space before the cursor.
 * Returns the new text together with the cursor kept at its old position
 * relative to the end (edit primitives would otherwise move it to the edit).
 */
export function trimInlineText(
    text: string,
    cursor: number,
    anchor: number | undefined,
    trimHead: boolean,
    trimTail: boolean,
): { text: string; cursor: number } {
    let next = text
    let nextCursor = cursor

    if (trimTail && nextCursor > 0 && next[nextCursor - 1] === " ") {
        next = next.slice(0, nextCursor - 1) + next.slice(nextCursor)
        nextCursor--
    }
    if (trimHead && anchor !== undefined && anchor >= 0 && anchor < next.length && next[anchor] === " ") {
        next = next.slice(0, anchor) + next.slice(anchor + 1)
        if (anchor < nextCursor) nextCursor--
    }

    return { text: next, cursor: nextCursor }
}

/**
 * Inline English region, following emacs-smart-input-source's inline mode: a
 * space typed while the other input source is active opens an English region
 * that two spaces or Enter close again. One head space and one tail space are
 * removed when the region closes.
 */
export function createInlineController(config: VimInline): InlineController {
    const [active, setActive] = createSignal(false)
    let anchor: number | undefined
    let lastSpace: number | undefined

    return { active, handleKey, close }

    function handleKey(input: { key: string; mode: VimMode; role: "normal" | "other" | undefined; cursor: number }): InlineAction | undefined {
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
                return { kind: "enter", consume: false, trimHead: false, trimTail: false }
            }

            const now = Date.now()
            const double = lastSpace !== undefined && now - lastSpace <= config.timeoutMs
            if (!double) {
                lastSpace = now
                return undefined
            }

            const exitAnchor = anchor
            close()
            return { kind: "exit", consume: true, trimHead: true, trimTail: false, anchor: exitAnchor }
        }

        lastSpace = undefined
        if (input.key === "<CR>" && active()) {
            const trims = config.enterCloses
            const exitAnchor = anchor
            close()
            return { kind: "exit", consume: trims, trimHead: trims, trimTail: trims, anchor: exitAnchor }
        }
        return undefined
    }

    function close() {
        setActive(false)
        anchor = undefined
        lastSpace = undefined
    }
}
