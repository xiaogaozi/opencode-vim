import { afterEach, describe, expect, test } from "bun:test"
import { InputRenderable } from "@opentui/core"
import { DEFAULT_AUTO_PAIRS } from "../../src/vim/auto-pairs"
import { displayWidth } from "../../src/vim/map"
import { createFixture } from "../helpers/fixture"

const AUTO_PAIRS = { enabled: true, pairs: DEFAULT_AUTO_PAIRS }

let fixture: Awaited<ReturnType<typeof createFixture>> | undefined
afterEach(() => {
  fixture?.dispose()
  fixture = undefined
})

describe("auto pairs in the prompt", () => {
  test("completes every default pair and keeps the cursor inside", async () => {
    for (const [open, close] of DEFAULT_AUTO_PAIRS) {
      fixture = await createFixture("", { defaultMode: "insert", autoPairs: AUTO_PAIRS })
      await fixture.keys(open)

      expect(fixture.input.plainText).toBe(open + close)
      expect(fixture.input.cursorOffset).toBe(displayWidth(open))
      fixture.dispose()
      fixture = undefined
    }
  })

  test("keeps the display-width cursor after CJK text", async () => {
    fixture = await createFixture("中文", { defaultMode: "insert", autoPairs: AUTO_PAIRS })
    fixture.input.cursorOffset = displayWidth("中文")

    await fixture.keys("（")

    expect(fixture.input.plainText).toBe("中文（）")
    expect(fixture.input.cursorOffset).toBe(displayWidth("中文（"))
  })

  test("skips a closing character already at the cursor", async () => {
    fixture = await createFixture("", { defaultMode: "insert", autoPairs: AUTO_PAIRS })
    await fixture.keys("「")
    await fixture.keys("a")
    await fixture.keys("」")

    expect(fixture.input.plainText).toBe("「a」")
    expect(fixture.input.cursorOffset).toBe(displayWidth("「a」"))
  })

  test("does not skip a closing character that is not at the cursor", async () => {
    fixture = await createFixture("", { defaultMode: "insert", autoPairs: AUTO_PAIRS })
    await fixture.keys("「")
    await fixture.keys("」")
    await fixture.keys("」")

    expect(fixture.input.plainText).toBe("「」」")
  })

  test("undoes the pair with the insert session", async () => {
    fixture = await createFixture("", { defaultMode: "normal", autoPairs: AUTO_PAIRS })
    await fixture.keys("i「")
    fixture.mockInput.pressEscape()
    await fixture.keys("u")

    expect(fixture.input.plainText).toBe("")
  })

  test("backspace removes an empty pair", async () => {
    fixture = await createFixture("", { defaultMode: "insert", autoPairs: AUTO_PAIRS })
    await fixture.keys("『")

    fixture.mockInput.pressBackspace()
    await fixture.renderOnce()

    expect(fixture.input.plainText).toBe("")
    expect(fixture.input.cursorOffset).toBe(0)
  })

  test("backspace inside a nonempty pair deletes one character", async () => {
    fixture = await createFixture("", { defaultMode: "insert", autoPairs: AUTO_PAIRS })
    await fixture.keys("《a")

    fixture.mockInput.pressBackspace()
    await fixture.renderOnce()

    expect(fixture.input.plainText).toBe("《》")
    expect(fixture.input.cursorOffset).toBe(displayWidth("《"))
  })

  test("is disabled by default", async () => {
    fixture = await createFixture("", { defaultMode: "insert" })
    await fixture.keys("「")

    expect(fixture.input.plainText).toBe("「")
    expect(fixture.input.cursorOffset).toBe(displayWidth("「"))
  })

  test("does nothing in normal mode", async () => {
    fixture = await createFixture("", { defaultMode: "normal", autoPairs: AUTO_PAIRS })
    await fixture.keys("中")

    expect(fixture.input.plainText).toBe("")
  })

  test("treats a literal '<' as a Vim key in normal mode", async () => {
    fixture = await createFixture("abc", { defaultMode: "normal", autoPairs: AUTO_PAIRS })
    await fixture.keys("<")

    expect(fixture.input.plainText).toBe("abc")
  })

  test("gives a matching insert keymap priority over the pair", async () => {
    fixture = await createFixture("", {
      defaultMode: "insert",
      autoPairs: AUTO_PAIRS,
      keymaps: { insert: { "[": "normal" } },
    })
    await fixture.keys("[")

    expect(fixture.input.plainText).toBe("")
    expect(fixture.state.mode()).toBe("normal")
  })

  test("leaves a selection to native replacement", async () => {
    fixture = await createFixture("abc", { defaultMode: "insert", autoPairs: AUTO_PAIRS })
    fixture.input.setSelection(0, 1)

    await fixture.keys("{")

    expect(fixture.input.plainText).toBe("{bc")
  })

  test("works in a single-line dialog input", async () => {
    fixture = await createFixture("", { defaultMode: "insert", autoPairs: AUTO_PAIRS }, 80, {}, InputRenderable)

    await fixture.keys("「")

    expect(fixture.input.plainText).toBe("「」")
    expect(fixture.input.cursorOffset).toBe(displayWidth("「"))
  })
})
