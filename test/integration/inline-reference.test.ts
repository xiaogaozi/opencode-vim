import { expect, test } from "bun:test"
import { TextareaRenderable, type WidthMethod } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { editInput } from "../../src/vim/edit"
import { trimInlineSteps } from "../../src/vim/inline"

// The host prompt tracks selected file references with virtual extmarks
// ("@xxx" plus a part in the prompt store). Closing the inline region must
// keep them alive: one combined edit would span the reference together with
// the head and tail spaces and drop the extmark, turning the reference into
// plain text.
function applyInlineTrim(
  input: TextareaRenderable,
  text: string,
  cursor: number,
  anchor: number | undefined,
  trimHead: boolean,
  trimTail: "none" | "one" | "excess",
  widthMethod: WidthMethod,
) {
  for (const step of trimInlineSteps(text, cursor, anchor, trimHead, trimTail)) {
    editInput(input, step.text, widthMethod)
  }
}

test("a double-space close keeps a reference extmark alive", async () => {
  const screen = await createTestRenderer({ width: 60, height: 8 })
  try {
    const input = new TextareaRenderable(screen.renderer, { id: "prompt", width: 40, height: 3, initialValue: "" })
    screen.renderer.root.add(input)
    const extmarks = input.extmarks
    const typeId = extmarks.registerType("prompt-part")
    const part = () => extmarks.getAllForTypeId(typeId).map((mark) => [mark.start, mark.end])

    // Completion accepted: "X @xxx " with "@xxx" carried by a virtual extmark,
    // then a typed space and the closing double space.
    input.setText("X @xxx  ")
    extmarks.create({ start: 2, end: 6, virtual: true, styleId: 1, typeId })
    applyInlineTrim(input, "X @xxx  ", 8, 1, true, "excess", screen.renderer.widthMethod)

    expect(input.plainText).toBe("X@xxx ")
    expect(part()).toEqual([[1, 5]])
  } finally {
    screen.renderer.destroy()
  }
})

test("an Enter close keeps a reference extmark alive", async () => {
  const screen = await createTestRenderer({ width: 60, height: 8 })
  try {
    const input = new TextareaRenderable(screen.renderer, { id: "prompt", width: 40, height: 3, initialValue: "" })
    screen.renderer.root.add(input)
    const extmarks = input.extmarks
    const typeId = extmarks.registerType("prompt-part")
    const part = () => extmarks.getAllForTypeId(typeId).map((mark) => [mark.start, mark.end])

    input.setText("X @xxx ")
    extmarks.create({ start: 2, end: 6, virtual: true, styleId: 1, typeId })
    applyInlineTrim(input, "X @xxx ", 7, 1, true, "one", screen.renderer.widthMethod)

    expect(input.plainText).toBe("X@xxx")
    expect(part()).toEqual([[1, 5]])
  } finally {
    screen.renderer.destroy()
  }
})

test("the keepHeadSpace close keeps the head space and the reference extmark", async () => {
  const screen = await createTestRenderer({ width: 60, height: 8 })
  try {
    const input = new TextareaRenderable(screen.renderer, { id: "prompt", width: 40, height: 3, initialValue: "" })
    screen.renderer.root.add(input)
    const extmarks = input.extmarks
    const typeId = extmarks.registerType("prompt-part")
    const part = () => extmarks.getAllForTypeId(typeId).map((mark) => [mark.start, mark.end])

    // Default close (`keepHeadSpace`): the head space stays, only the tail
    // run collapses, and the reference extmark is untouched.
    input.setText("X @xxx  ")
    extmarks.create({ start: 2, end: 6, virtual: true, styleId: 1, typeId })
    applyInlineTrim(input, "X @xxx  ", 8, 1, false, "excess", screen.renderer.widthMethod)

    expect(input.plainText).toBe("X @xxx ")
    expect(part()).toEqual([[2, 6]])
  } finally {
    screen.renderer.destroy()
  }
})

test("the head trim shifts a reference that follows wide characters", async () => {
  const screen = await createTestRenderer({ width: 60, height: 8 })
  try {
    const input = new TextareaRenderable(screen.renderer, { id: "prompt", width: 40, height: 3, initialValue: "" })
    screen.renderer.root.add(input)
    const extmarks = input.extmarks
    const typeId = extmarks.registerType("prompt-part")
    const part = () => extmarks.getAllForTypeId(typeId).map((mark) => [mark.start, mark.end])

    // Host extmarks use display offsets: "中文 " is 5 columns wide.
    input.setText("中文 @xxx  ")
    extmarks.create({ start: 5, end: 9, virtual: true, styleId: 1, typeId })
    applyInlineTrim(input, "中文 @xxx  ", 9, 2, true, "excess", screen.renderer.widthMethod)

    expect(input.plainText).toBe("中文@xxx ")
    expect(part()).toEqual([[4, 8]])
  } finally {
    screen.renderer.destroy()
  }
}, 15_000)
