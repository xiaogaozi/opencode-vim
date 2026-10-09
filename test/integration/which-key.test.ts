import { afterEach, describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { createWhichKeyPanel } from "../../src/vim/which-key"
import { createFixture } from "../helpers/fixture"

let fixture: Awaited<ReturnType<typeof createFixture>> | undefined
afterEach(() => {
  fixture?.dispose()
  fixture = undefined
})

const theme = {
  surface: RGBA.fromHex("#131313"),
  border: RGBA.fromHex("#484848"),
  text: RGBA.fromHex("#eeeeee"),
  muted: RGBA.fromHex("#808080"),
  selected: {
    background: RGBA.fromHex("#264f78"),
    foreground: RGBA.fromHex("#ffffff"),
  },
}

const keymaps = {
  normal: {
    "<C-g>n": ["insert", "text:first", "submit"],
    "<C-g>go": ["insert", "text:second", "submit"],
  },
}

function createPanel() {
  if (!fixture) throw new Error("fixture is not set")
  return createWhichKeyPanel({
    config: fixture.config,
    enabled: () => true,
    renderer: fixture.renderer,
    theme,
    pending: () => fixture?.adapter.pendingKeybind(),
    commandTitle: () => undefined,
  })
}

function rowBackground(text: string) {
  if (!fixture) throw new Error("fixture is not set")
  const spans = fixture.captureSpans().lines.flatMap((line) => line.spans)
  return spans.find((span) => span.text.includes(text))?.bg
}

describe("which-key popup", () => {
  test("shows candidates for a pending prefix and hides after a match", async () => {
    fixture = await createFixture("", { defaultMode: "normal", keymaps, whichKey: { enabled: true } })
    const panel = createPanel()

    fixture.mockInput.pressKey("g", { ctrl: true })
    await fixture.renderOnce()
    const frame = fixture.captureCharFrame()
    expect(frame).toContain("first")
    expect(frame).toContain("second")
    // The prefix and the key hints share the last row, like the host popup's surface.
    expect(frame).toContain("<C-g> · ↑↓/<C-n>/<C-p> 选择 · Enter 执行 · Esc 取消")
    // A blank row separates the candidates from the key hints.
    const rows = frame.split("\n")
    const hintRow = rows.findIndex((row) => row.includes("Enter 执行"))
    expect(hintRow).toBeGreaterThan(0)
    expect(rows[hintRow - 1].replaceAll("┃", "").trim()).toBe("")
    expect(panel.visible()).toBe(true)

    await fixture.keys("n")
    await fixture.renderOnce()
    expect(fixture.captureCharFrame()).not.toContain("Enter 执行")
    expect(panel.visible()).toBe(false)
    expect(fixture.input.plainText).toBe("first")
    expect(fixture.submissions).toBe(1)

    panel.dispose()
  })

  test("owns arrows and Enter only while visible", async () => {
    fixture = await createFixture("", { defaultMode: "normal", keymaps, whichKey: { enabled: true } })
    const panel = createPanel()

    expect(panel.owns("<Down>", false)).toBeUndefined()

    fixture.mockInput.pressKey("g", { ctrl: true })
    await fixture.renderOnce()
    expect(panel.owns("<Up>", false)).toBe("up")
    expect(panel.owns("<Down>", false)).toBe("down")
    expect(panel.owns("<C-p>", false)).toBe("up")
    expect(panel.owns("<C-n>", false)).toBe("down")
    expect(panel.owns("<CR>", false)).toBe("run")
    expect(panel.owns("<CR>", true)).toBeUndefined()
    expect(panel.owns("<C-n>", true)).toBeUndefined()
    expect(panel.owns("x", false)).toBeUndefined()

    panel.dispose()
  })

  test("moves the highlight alphabetically with clamps and runs the selection", async () => {
    fixture = await createFixture("", { defaultMode: "normal", keymaps, whichKey: { enabled: true } })
    const panel = createPanel()

    fixture.mockInput.pressKey("g", { ctrl: true })
    await fixture.renderOnce()
    // Sorted: "go" (second) before "n" (first).
    expect(rowBackground("second")?.equals(theme.selected.background)).toBe(true)
    expect(rowBackground("first")?.equals(theme.surface)).toBe(true)
    expect(panel.selection()?.sequence).toBe("<C-g>go")

    expect(panel.move(-1)).toBe(false)
    expect(panel.move(1)).toBe(true)
    await fixture.renderOnce()
    expect(rowBackground("first")?.equals(theme.selected.background)).toBe(true)
    expect(rowBackground("second")?.equals(theme.surface)).toBe(true)

    expect(panel.move(1)).toBe(false)
    await fixture.renderOnce()
    expect(rowBackground("first")?.equals(theme.selected.background)).toBe(true)

    const target = panel.selection()
    expect(target?.sequence).toBe("<C-g>n")
    expect(fixture.execute(target!.sequence)).toBe(true)
    await fixture.renderOnce()
    expect(fixture.input.plainText).toBe("first")
    expect(fixture.submissions).toBe(1)
    expect(fixture.captureCharFrame()).not.toContain("Enter 执行")

    panel.dispose()
  })

  test("runs the alphabetically first candidate on Enter without moving", async () => {
    fixture = await createFixture("", { defaultMode: "normal", keymaps, whichKey: { enabled: true } })
    const panel = createPanel()

    fixture.mockInput.pressKey("g", { ctrl: true })
    await fixture.renderOnce()
    const target = panel.selection()
    expect(target?.sequence).toBe("<C-g>go")
    expect(fixture.execute(target!.sequence)).toBe(true)
    await fixture.renderOnce()

    expect(fixture.input.plainText).toBe("second")
    expect(fixture.submissions).toBe(1)

    panel.dispose()
  })

  test("caps selection at the displayed rows", async () => {
    const many: Record<string, readonly string[]> = {}
    for (let index = 0; index < 14; index++) {
      many[`<C-g>k${index.toString(36)}`] = ["insert", `text:m${index}`, "submit"]
    }
    fixture = await createFixture("", { defaultMode: "normal", keymaps: { normal: many }, whichKey: { enabled: true } })
    const panel = createPanel()

    fixture.mockInput.pressKey("g", { ctrl: true })
    await fixture.renderOnce()
    expect(fixture.captureCharFrame()).toContain("… +5 more")

    for (let index = 0; index < 20; index++) panel.move(1)
    expect(panel.selection()?.sequence).toBe("<C-g>k8")

    panel.dispose()
  })

  test("does not draw or own keys when the feature is disabled", async () => {
    fixture = await createFixture("", {
      defaultMode: "normal",
      keymaps: { normal: { "<C-g>n": ["insert", "text:go", "submit"] } },
    })
    const panel = createPanel()

    fixture.mockInput.pressKey("g", { ctrl: true })
    await fixture.renderOnce()
    expect(fixture.captureCharFrame()).not.toContain("Enter 执行")
    expect(panel.visible()).toBe(false)
    expect(panel.owns("<CR>", false)).toBeUndefined()

    panel.dispose()
  })
})
