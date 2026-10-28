import { describe, expect, test } from "bun:test"
import { inFencedCode, listLine, orderedLine, renumberOrderedSiblings } from "../../src/vim/lists"

describe("markdown list continuation", () => {
  test("keeps unordered markers", () => {
    expect(listLine("- item")).toEqual({ indent: "", next: "- ", prefixLength: 2, empty: false })
    expect(listLine("* item")).toEqual({ indent: "", next: "* ", prefixLength: 2, empty: false })
    expect(listLine("+ item")).toEqual({ indent: "", next: "+ ", prefixLength: 2, empty: false })
  })

  test("keeps indentation", () => {
    expect(listLine("  - item")).toEqual({ indent: "  ", next: "- ", prefixLength: 4, empty: false })
    expect(listLine("\t* item")).toEqual({ indent: "\t", next: "* ", prefixLength: 3, empty: false })
  })

  test("increments ordered lists", () => {
    expect(listLine("1. item")?.next).toBe("2. ")
    expect(listLine("9) item")?.next).toBe("10) ")
    expect(listLine("009. item")?.next).toBe("010. ")
    expect(listLine("  3. item")).toEqual({ indent: "  ", next: "4. ", prefixLength: 5, empty: false })
  })

  test("continues task lists as unchecked", () => {
    expect(listLine("- [ ] todo")).toEqual({ indent: "", next: "- [ ] ", prefixLength: 6, empty: false })
    expect(listLine("- [x] done")).toEqual({ indent: "", next: "- [ ] ", prefixLength: 6, empty: false })
    expect(listLine("1. [X] done")?.next).toBe("2. [ ] ")
    expect(listLine("- [ ]  spaced")?.next).toBe("- [ ]  ")
  })

  test("marks empty items", () => {
    expect(listLine("- ")).toEqual({ indent: "", next: "- ", prefixLength: 2, empty: true })
    expect(listLine("- [ ]")).toEqual({ indent: "", next: "- [ ] ", prefixLength: 5, empty: true })
    expect(listLine("- [ ] ")).toEqual({ indent: "", next: "- [ ] ", prefixLength: 6, empty: true })
    expect(listLine("1. ")).toEqual({ indent: "", next: "2. ", prefixLength: 3, empty: true })
  })

  test("ignores non-list lines", () => {
    expect(listLine("text")).toBeUndefined()
    expect(listLine("-item")).toBeUndefined()
    expect(listLine("1.item")).toBeUndefined()
    expect(listLine("> - item")).toBeUndefined()
    expect(listLine("---")).toBeUndefined()
    expect(listLine("* * *")).toBeUndefined()
    expect(listLine("- - -")).toBeUndefined()
    expect(listLine("___")).toBeUndefined()
  })
})

describe("ordered list renumbering", () => {
  test("reads ordered markers and their digit positions", () => {
    expect(orderedLine("  3) item")).toEqual({
      indent: "  ",
      digits: "3",
      delimiter: ")",
      gap: " ",
      content: "item",
      digitsStart: 2,
      digitsEnd: 3,
    })
    expect(orderedLine("1. item")?.digitsStart).toBe(0)
    expect(orderedLine("- item")).toBeUndefined()
  })

  test("increments following items at the same level", () => {
    expect(renumberOrderedSiblings(["1. one", "2. two", "3. three"], 1, "", ".")).toEqual([
      { line: 2, start: 0, end: 1, value: "4" },
    ])
    expect(renumberOrderedSiblings(["1. one", "2. two", "5. five"], 1, "", ".")).toEqual([
      { line: 2, start: 0, end: 1, value: "6" },
    ])
  })

  test("preserves leading zeros", () => {
    expect(renumberOrderedSiblings(["001. one", "002. two", "003. three"], 1, "", ".")).toEqual([
      { line: 2, start: 0, end: 3, value: "004" },
    ])
  })

  test("skips nested lines and keeps scanning", () => {
    const lines = ["1. one", "2. new", "   1. child", "   continuation", "3. three"]
    expect(renumberOrderedSiblings(lines, 1, "", ".")).toEqual([{ line: 4, start: 0, end: 1, value: "4" }])
  })

  test("stops at a blank, non-list, dedented, or different list", () => {
    expect(renumberOrderedSiblings(["1. one", "2. new", "", "3. three"], 1, "", ".")).toEqual([])
    expect(renumberOrderedSiblings(["1. one", "2. new", "paragraph", "3. three"], 1, "", ".")).toEqual([])
    expect(renumberOrderedSiblings(["1. one", "  2. new", "3. three"], 1, "  ", ".")).toEqual([])
    expect(renumberOrderedSiblings(["1. one", "2. new", "3) other", "4. four"], 1, "", ".")).toEqual([])
    expect(renumberOrderedSiblings(["1. one", "2. new", "- item", "3. three"], 1, "", ".")).toEqual([])
  })
})

describe("fenced code detection", () => {
  test("tracks backtick fences", () => {
    const lines = ["```", "- item", "```", "text"]
    expect(inFencedCode(lines, 0)).toBe(false)
    expect(inFencedCode(lines, 1)).toBe(true)
    expect(inFencedCode(lines, 2)).toBe(true)
    expect(inFencedCode(lines, 3)).toBe(false)
  })

  test("tracks tilde fences and ignores other markers", () => {
    const lines = ["~~~", "```", "- item", "~~~"]
    expect(inFencedCode(lines, 1)).toBe(true)
    expect(inFencedCode(lines, 2)).toBe(true)
    expect(inFencedCode(lines, 3)).toBe(true)
    expect(inFencedCode([...lines, "text"], 4)).toBe(false)
  })

  test("ignores a closing fence with an info string", () => {
    const lines = ["```", "``` not a close", "- item"]
    expect(inFencedCode(lines, 2)).toBe(true)
  })
})
