import { expect, spyOn, test } from "bun:test"
import * as OpenTUI from "@opentui/core"
import { rgbToHex } from "@opentui/core"
import { textItem, useReaderFixture } from "../../helpers/reader"

const mount = useReaderFixture()

test("message text is highlighted as Markdown", async () => {
  let finish!: (value: { highlights: Array<[number, number, string]> }) => void
  const highlighting = spyOn(OpenTUI.getTreeSitterClient(), "highlightOnce").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  try {
    const text = "# Title\n\nSome **bold** and `inline` text."
    const f = await mount(textItem(text), {}, { width: 80, height: 18 })
    expect(highlighting).toHaveBeenCalledWith(text, "markdown")
    finish({
      highlights: [
        [0, 8, "markup.heading.1"],
        [14, 22, "markup.strong"],
        [27, 35, "markup.raw.inline"],
      ],
    })
    await f.renderOnce()
    const spans = f.captureSpans().lines.flatMap((line) => line.spans)
    expect(spans.some((span) => span.text.includes("# Title") && rgbToHex(span.fg) === "#ff0000")).toBe(true)
    expect(spans.some((span) => span.text.includes("**bold**") && rgbToHex(span.fg) === "#ff8800")).toBe(true)
    expect(spans.some((span) => span.text.includes("`inline`") && rgbToHex(span.fg) === "#00ff00")).toBe(true)
    expect(f.reader().plainText).toBe(text)
  } finally {
    highlighting.mockRestore()
  }
})

test("Markdown highlighting covers fenced code and keeps the source text", async () => {
  const client = OpenTUI.getTreeSitterClient()
  const original = client.highlightOnce.bind(client)
  let finish!: () => void
  const finished = new Promise<void>((resolve) => {
    finish = resolve
  })
  const highlighting = spyOn(client, "highlightOnce").mockImplementation(async (content, filetype) => {
    const result = await original(content, filetype)
    finish()
    return result
  })
  try {
    const text = ["# Title", "", "Some **bold** and `inline` text.", "", "```ts", 'const value = "hello"', "```"].join(
      "\n",
    )
    const f = await mount(textItem(text), {}, { width: 80, height: 24 })
    await finished
    await f.renderOnce()
    const spans = f.captureSpans().lines.flatMap((line) => line.spans)
    expect(spans.some((span) => span.text === "# Title" && rgbToHex(span.fg) === "#ff0000")).toBe(true)
    expect(spans.some((span) => span.text === "**bold**" && rgbToHex(span.fg) === "#ff8800")).toBe(true)
    expect(spans.some((span) => span.text === "`inline`" && rgbToHex(span.fg) === "#00ff00")).toBe(true)
    expect(spans.some((span) => span.text === "const" && rgbToHex(span.fg) === "#ff0000")).toBe(true)
    expect(spans.some((span) => span.text === '"hello"' && rgbToHex(span.fg) === "#00ff00")).toBe(true)
    expect(f.reader().plainText).toBe(text)
    await f.keys("ggVGy")
    expect(f.copied.at(-1)).toBe(text + "\n")
  } finally {
    highlighting.mockRestore()
  }
})
