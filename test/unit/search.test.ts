import { expect, test } from "bun:test"
import {
  appendSearchText,
  backspaceSearchText,
  deleteWordSearchText,
  isWideText,
  literalMatches,
  pickSearchIndex,
  stepSearchIndex,
} from "../../src/ui/search"

test("literal matches use smartcase and preserve positions", () => {
  const text = "Foo foo FOO food"
  expect(literalMatches(text, "foo")).toEqual([
    { start: 0, end: 3 },
    { start: 4, end: 7 },
    { start: 8, end: 11 },
    { start: 12, end: 15 },
  ])
  expect(literalMatches(text, "Foo")).toEqual([{ start: 0, end: 3 }])
  expect(literalMatches(text, "FOO")).toEqual([{ start: 8, end: 11 }])
  expect(literalMatches(text, ".")).toEqual([])
  expect(literalMatches("a.b", ".")).toEqual([{ start: 1, end: 2 }])
  expect(literalMatches(text, "")).toEqual([])
})

test("match picking and stepping wrap in both directions", () => {
  const matches = literalMatches("one two one two", "one")
  expect(pickSearchIndex(matches, 0, 1)).toBe(0)
  expect(pickSearchIndex(matches, 1, 1)).toBe(1)
  expect(pickSearchIndex(matches, 99, 1)).toBe(0)
  expect(pickSearchIndex(matches, 99, -1)).toBe(1)
  expect(pickSearchIndex(matches, 0, -1)).toBe(1)
  expect(stepSearchIndex(matches.length, 1, 1)).toBe(0)
  expect(stepSearchIndex(matches.length, 0, -1)).toBe(1)
  expect(stepSearchIndex(matches.length, 0, 1, 2)).toBe(0)
  expect(stepSearchIndex(0, 0, 1)).toBe(-1)
})

test("wide text detection covers CJK and emoji but not ASCII or combining marks", () => {
  expect(isWideText("退出")).toBe(true)
  expect(isWideText("搜索")).toBe(true)
  expect(isWideText("👩‍💻")).toBe(true)
  expect(isWideText("session")).toBe(false)
  expect(isWideText("e\u0301")).toBe(false)
  expect(isWideText("")).toBe(false)
})

test("search input editing handles graphemes and words", () => {
  expect(appendSearchText("", "a")).toBe("a")
  expect(appendSearchText("a", "<Space>")).toBe("a ")
  expect(appendSearchText("a", "<CR>")).toBe("a")
  expect(appendSearchText("a", "<")).toBe("a<")
  expect(appendSearchText("a", "👩‍💻")).toBe("a👩‍💻")
  expect(backspaceSearchText("abc")).toBe("ab")
  expect(backspaceSearchText("ab👩‍💻")).toBe("ab")
  expect(backspaceSearchText("")).toBe("")
  expect(deleteWordSearchText("one two three")).toBe("one two ")
  expect(deleteWordSearchText("one two   ")).toBe("one ")
  expect(deleteWordSearchText("")).toBe("")
})
