import { afterEach, expect, spyOn, test } from "bun:test"
import type { Context } from "@opencode/plugin/tui/context"
import { SyntaxStyle, TextareaRenderable, getTreeSitterClient } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { createRoot } from "solid-js"
import { createPromptMarkdown, PROMPT_MARKDOWN_HL_REF } from "../../src/ui/prompt-markdown"
import { testTheme } from "../helpers/theme"

let destroy: (() => void) | undefined
afterEach(() => {
  destroy?.()
  destroy = undefined
})

test("prompt Markdown highlighting keeps text, cursor and host highlights intact", async () => {
  const screen = await createTestRenderer({ width: 80, height: 20 })
  destroy = () => screen.renderer.destroy()
  const text = "# title\n\n**bold** and `code`"
  const input = new TextareaRenderable(screen.renderer, {
    id: "prompt",
    initialValue: text,
    width: 76,
    height: 8,
    wrapMode: "word",
    showCursor: true,
  })
  screen.renderer.root.add(input)
  input.focus()
  input.cursorOffset = 4
  const hostStyle = SyntaxStyle.fromStyles(
    { default: { fg: "#ffffff" }, host: { fg: "#ff0000" } },
    screen.renderer.nativeScene,
  )
  input.syntaxStyle = hostStyle
  input.addHighlightByCharRange({
    start: 0,
    end: 3,
    styleId: hostStyle.getStyleId("host")!,
    hlRef: 1,
  })
  await screen.renderOnce()

  const highlighting = spyOn(getTreeSitterClient(), "highlightOnce").mockResolvedValue({
    highlights: [[0, 7, "markup.heading.1"]],
  })
  let disposeRoot!: () => void
  let manager!: ReturnType<typeof createPromptMarkdown>
  createRoot((dispose) => {
    disposeRoot = dispose
    manager = createPromptMarkdown({ renderer: screen.renderer, theme: testTheme() } as unknown as Context, {
      delay: 0,
    })
  })
  try {
    manager.attach(input)
    await Bun.sleep(10)
    expect(highlighting).toHaveBeenCalledWith(text, "markdown")
    expect(input.plainText).toBe(text)
    expect(input.cursorOffset).toBe(4)
    expect(input.editBuffer.getLineHighlights(0).some((highlight) => highlight.hlRef === 1)).toBe(true)
    expect(input.editBuffer.getLineHighlights(0).some((highlight) => highlight.hlRef === PROMPT_MARKDOWN_HL_REF)).toBe(
      true,
    )

    input.editBuffer.insertText("x")
    const edited = input.plainText
    await Bun.sleep(10)
    expect(highlighting).toHaveBeenCalledWith(edited, "markdown")
    expect(input.editBuffer.getLineHighlights(0).some((highlight) => highlight.hlRef === 1)).toBe(true)
    expect(input.editBuffer.getLineHighlights(0).some((highlight) => highlight.hlRef === PROMPT_MARKDOWN_HL_REF)).toBe(
      true,
    )

    manager.attach(undefined)
    expect(input.editBuffer.getLineHighlights(0).some((highlight) => highlight.hlRef === 1)).toBe(true)
    expect(input.editBuffer.getLineHighlights(0).some((highlight) => highlight.hlRef === PROMPT_MARKDOWN_HL_REF)).toBe(
      false,
    )
    expect(input.syntaxStyle).toBe(hostStyle)
    expect(input.plainText).toBe(edited)
  } finally {
    manager.dispose()
    disposeRoot()
    highlighting.mockRestore()
    hostStyle.destroy()
  }
})
