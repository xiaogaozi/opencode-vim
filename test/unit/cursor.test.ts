import { describe, expect, test } from "bun:test"
import type { CursorStyleOptions } from "@opentui/core"
import { createCursorStylePin } from "../../src/vim/cursor"

class FakeEditor {
  isDestroyed = false
  writes: Array<CursorStyleOptions | undefined> = []
  private current: CursorStyleOptions | undefined

  constructor(style?: CursorStyleOptions) {
    this.current = style
  }

  get cursorStyle() {
    return this.current
  }

  set cursorStyle(value) {
    this.current = value
    this.writes.push(value)
  }
}

describe("cursor style pin", () => {
  test("keeps the vim style when the host writes its default", () => {
    const editor = new FakeEditor({ style: "block", blinking: true })
    const pin = createCursorStylePin()

    expect(pin.attach(editor)).toBe(true)
    expect(pin.set({ style: "line", blinking: true })).toBe(true)
    expect(editor.cursorStyle).toEqual({ style: "line", blinking: true })

    editor.cursorStyle = { style: "block", blinking: true }

    expect(editor.cursorStyle).toEqual({ style: "line", blinking: true })
    expect(editor.writes).toEqual([{ style: "line", blinking: true }])

    pin.detach()

    expect(editor.cursorStyle).toEqual({ style: "block", blinking: true })
    expect(Object.hasOwn(editor, "cursorStyle")).toBe(false)
  })

  test("restores the latest host style on detach", () => {
    const editor = new FakeEditor({ style: "block", blinking: true })
    const pin = createCursorStylePin()

    pin.attach(editor)
    pin.set({ style: "line", blinking: true })
    editor.cursorStyle = { style: "underline", blinking: false }
    pin.detach()

    expect(editor.cursorStyle).toEqual({ style: "underline", blinking: false })
  })

  test("falls back to assignment when the target has no accessor", () => {
    const target = { cursorStyle: { style: "block" } as CursorStyleOptions, isDestroyed: false }
    const pin = createCursorStylePin()

    expect(pin.attach(target)).toBe(false)
    expect(pin.set({ style: "line" })).toBe(true)
    expect(target.cursorStyle).toEqual({ style: "line" })

    pin.detach()

    expect(target.cursorStyle).toEqual({ style: "block" })
  })

  test("leaves destroyed editors alone on detach", () => {
    const editor = new FakeEditor({ style: "block" })
    const pin = createCursorStylePin()

    pin.attach(editor)
    pin.set({ style: "line" })
    editor.isDestroyed = true
    pin.detach()

    expect(editor.writes).toEqual([{ style: "line" }])
    expect(Object.hasOwn(editor, "cursorStyle")).toBe(false)
  })
})
