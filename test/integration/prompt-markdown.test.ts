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

test("host paste placeholders keep their own style", async () => {
  const screen = await createTestRenderer({ width: 60, height: 10 })
  destroy = () => screen.renderer.destroy()
  const text = "[Pasted ~21 lines]"
  const input = new TextareaRenderable(screen.renderer, {
    id: "prompt",
    initialValue: text,
    width: 56,
    height: 4,
    wrapMode: "word",
    showCursor: true,
  })
  screen.renderer.root.add(input)
  input.focus()
  const hostStyle = SyntaxStyle.fromStyles(
    {
      default: { fg: "#ffffff" },
      "extmark.paste": { fg: "#000000", bg: "#ffff00", bold: true },
      "markup.link": { fg: "#0000ff", underline: true },
      "markup.link.label": { fg: "#00ffff", underline: true },
    },
    screen.renderer.nativeScene,
  )
  input.syntaxStyle = hostStyle
  const typeId = input.extmarks.registerType("prompt-part")
  input.extmarks.create({
    start: 0,
    end: text.length,
    virtual: true,
    styleId: hostStyle.getStyleId("extmark.paste")!,
    typeId,
  })
  await screen.renderOnce()

  const highlighting = spyOn(getTreeSitterClient(), "highlightOnce").mockResolvedValue({
    highlights: [
      [0, 1, "markup.link"],
      [1, 17, "markup.link.label"],
      [17, 18, "markup.link"],
    ],
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
    expect(input.editBuffer.getLineHighlights(0).some((highlight) => highlight.hlRef === PROMPT_MARKDOWN_HL_REF)).toBe(
      false,
    )
    expect(input.plainText).toBe(text)
    expect(input.syntaxStyle).toBe(hostStyle)
  } finally {
    manager.dispose()
    disposeRoot()
    highlighting.mockRestore()
    input.editBuffer.setSyntaxStyle(null)
    hostStyle.destroy()
  }
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
    { default: { fg: "#ffffff" }, host: { fg: "#ff0000" }, "extmark.file": { fg: "#ffff00", bold: true } },
    screen.renderer.nativeScene,
  )
  input.syntaxStyle = hostStyle
  const referenceStyleId = hostStyle.getStyleId("extmark.file")!
  const hostTypeId = input.extmarks.registerType("host")
  const hostId = input.extmarks.create({
    start: 0,
    end: 3,
    styleId: hostStyle.getStyleId("host")!,
    typeId: hostTypeId,
  })
  const hostRef = hostId & 0xffff
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
    expect(input.syntaxStyle).toBe(hostStyle)
    expect(hostStyle.getStyleId("extmark.file")).toBe(referenceStyleId)
    expect(input.editBuffer.getLineHighlights(0).some((highlight) => highlight.hlRef === hostRef)).toBe(true)
    expect(input.editBuffer.getLineHighlights(0).some((highlight) => highlight.hlRef === PROMPT_MARKDOWN_HL_REF)).toBe(
      true,
    )

    input.editBuffer.insertText("x")
    const edited = input.plainText
    await Bun.sleep(10)
    expect(highlighting).toHaveBeenCalledWith(edited, "markdown")
    expect(input.editBuffer.getLineHighlights(0).some((highlight) => highlight.hlRef === hostRef)).toBe(true)
    expect(input.editBuffer.getLineHighlights(0).some((highlight) => highlight.hlRef === PROMPT_MARKDOWN_HL_REF)).toBe(
      true,
    )

    manager.attach(undefined)
    expect(input.editBuffer.getLineHighlights(0).some((highlight) => highlight.hlRef === hostRef)).toBe(true)
    expect(input.editBuffer.getLineHighlights(0).some((highlight) => highlight.hlRef === PROMPT_MARKDOWN_HL_REF)).toBe(
      false,
    )
    expect(input.syntaxStyle).toBe(hostStyle)
    expect(hostStyle.getStyleId("extmark.file")).toBe(referenceStyleId)
    expect(input.plainText).toBe(edited)
  } finally {
    manager.dispose()
    disposeRoot()
    highlighting.mockRestore()
    input.editBuffer.setSyntaxStyle(null)
    hostStyle.destroy()
  }
})
