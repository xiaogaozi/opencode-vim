import type { Context } from "@opencode/plugin/tui/context"
import type { TextareaRenderable } from "@opentui/core"
import { createReaderSyntax, highlightCode } from "../readers/syntax"

export const PROMPT_MARKDOWN_HL_REF = 0x6d64
const DEFAULT_DELAY = 150

export function createPromptMarkdown(context: Context, options: { delay?: number } = {}) {
  const syntax = createReaderSyntax(context)
  const delay = options.delay ?? DEFAULT_DELAY
  let input: TextareaRenderable | undefined
  const attached = new Set<TextareaRenderable>()
  let highlighted = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let controller: AbortController | undefined

  function attach(next: TextareaRenderable | undefined) {
    if (next === input) return
    detach()
    if (
      !next ||
      next.isDestroyed ||
      !next.editBuffer ||
      typeof next.addHighlightByCharRange !== "function" ||
      typeof next.removeHighlightsByRef !== "function"
    )
      return
    input = next
    attached.add(next)
    highlighted = false
    safe(() => next.editBuffer.on("content-changed", onChange))
    schedule(0)
  }

  function detach() {
    if (timer) clearTimeout(timer)
    timer = undefined
    controller?.abort()
    controller = undefined
    const current = input
    input = undefined
    if (!current) return
    highlighted = false
    safe(() => current.editBuffer.off("content-changed", onChange))
    if (!current.isDestroyed) {
      safe(() => current.removeHighlightsByRef(PROMPT_MARKDOWN_HL_REF))
      safe(() => current.requestRender())
      // OpenCode 2.1 treats a style change during focus transfer as a prompt
      // update and can swallow the plugin-manager dialog. Drop our style once
      // the new focus has settled instead.
      setTimeout(() => {
        if (input !== current && !current.isDestroyed) {
          safe(() => current.editBuffer.setSyntaxStyle(null))
          safe(() => current.requestRender())
        }
      }, 0)
    }
  }

  function onChange() {
    schedule()
  }

  function schedule(wait = delay) {
    if (!input) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      void refresh()
    }, wait)
  }

  async function refresh() {
    const current = input
    if (!current || current.isDestroyed) return
    const text = current.plainText
    const markdown = looksLikeMarkdown(text)
    if (!highlighted && !markdown) return
    controller?.abort()
    const next = new AbortController()
    controller = next
    try {
      await highlightCode(current, syntax, "markdown", next.signal, context.renderer.widthMethod, {
        hlRef: PROMPT_MARKDOWN_HL_REF,
      })
      if (current === input && current.plainText === text) highlighted = markdown
    } catch {}
  }

  function dispose() {
    detach()
    // Release the style before its owner is destroyed, even if a focus
    // transfer is still settling.
    for (const editor of attached) {
      if (editor.isDestroyed) continue
      safe(() => editor.editBuffer.removeHighlightsByRef(PROMPT_MARKDOWN_HL_REF))
      safe(() => editor.editBuffer.setSyntaxStyle(null))
    }
    attached.clear()
  }

  return { attach, current: () => input, dispose }
}

function safe(operation: () => void) {
  try {
    operation()
  } catch {}
}

/** Cheap guard so ordinary prose does not trigger tree-sitter on every pause. */
function looksLikeMarkdown(text: string) {
  return (
    /[#*_`~|><\[\]]/.test(text) ||
    /(^|\n)[ \t]*(?:[-+]|\d+[.)])(?=\s)/m.test(text) ||
    /(^|\n)[ \t]*(?:-{3,}|={2,})[ \t]*$/m.test(text) ||
    /(^|\n) {4}\S/m.test(text)
  )
}
