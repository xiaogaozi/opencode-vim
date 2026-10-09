import { describe, expect, test } from "bun:test"
import { TextBuffer } from "@vimee/core"
import type { CursorPosition } from "@vimee/core"
import {
  WordClass,
  backwardWord,
  charClass,
  endWord,
  forwardWord,
  wordMotion,
  wordTextObject,
} from "../../src/vim/word-motions"

describe("word character classes", () => {
  test("separates whitespace, punctuation and words", () => {
    expect(charClass(undefined, false)).toBe(WordClass.blank)
    expect(charClass(" ", false)).toBe(WordClass.blank)
    expect(charClass("\t", false)).toBe(WordClass.blank)
    expect(charClass("\u00a0", false)).toBe(WordClass.blank)
    expect(charClass("\u3000", false)).toBe(WordClass.blank)
    expect(charClass("a", false)).toBe(WordClass.word)
    expect(charClass("Z", false)).toBe(WordClass.word)
    expect(charClass("7", false)).toBe(WordClass.word)
    expect(charClass("_", false)).toBe(WordClass.word)
    expect(charClass(",", false)).toBe(WordClass.punctuation)
    expect(charClass("-", false)).toBe(WordClass.punctuation)
  })

  test("gives each CJK script its own class", () => {
    expect(charClass("你", false)).toBe(WordClass.han)
    expect(charClass("好", false)).toBe(WordClass.han)
    expect(charClass("，", false)).toBe(WordClass.punctuation)
    expect(charClass("。", false)).toBe(WordClass.punctuation)
    expect(charClass("！", false)).toBe(WordClass.punctuation)
    expect(charClass("、", false)).toBe(WordClass.punctuation)
    expect(charClass("（", false)).toBe(WordClass.punctuation)
    expect(charClass("《", false)).toBe(WordClass.punctuation)
    expect(charClass("…", false)).toBe(WordClass.punctuation)
    expect(charClass("—", false)).toBe(WordClass.punctuation)
    expect(charClass("こ", false)).toBe(WordClass.hiragana)
    expect(charClass("カ", false)).toBe(WordClass.katakana)
    expect(charClass("한", false)).toBe(WordClass.hangul)
    expect(charClass("Ａ", false)).toBe(WordClass.word)
    expect(charClass("😀", false)).toBe(WordClass.emoji)
  })

  test("collapses classes for big words", () => {
    expect(charClass("a", true)).toBe(WordClass.punctuation)
    expect(charClass("你", true)).toBe(WordClass.punctuation)
    expect(charClass("，", true)).toBe(WordClass.punctuation)
    expect(charClass(" ", true)).toBe(WordClass.blank)
  })

  test("decodes encoded graphemes before classifying", () => {
    const decode = (value: string) => ({ "\ue000": "👩‍💻", "\ue001": "你", "\ue002": "e\u0301" })[value] ?? value
    expect(charClass("\ue000", false, decode)).toBe(WordClass.emoji)
    expect(charClass("\ue001", false, decode)).toBe(WordClass.han)
    expect(charClass("\ue002", false, decode)).toBe(WordClass.word)
  })
})

describe("word motions", () => {
  test("moves between CJK words and punctuation", () => {
    const buffer = new TextBuffer("你好，世界。测试")
    expect(forwardWord(at(0, 0), 1, false, buffer, false).cursor).toEqual(at(0, 2))
    expect(forwardWord(at(0, 0), 2, false, buffer, false).cursor).toEqual(at(0, 3))
    expect(forwardWord(at(0, 0), 4, false, buffer, false).cursor).toEqual(at(0, 6))
    expect(forwardWord(at(0, 0), 1, false, buffer, true).cursor).toEqual(at(0, 2))
    expect(endWord(at(0, 0), 1, false, false, false, buffer).cursor).toEqual(at(0, 1))
    expect(endWord(at(0, 2), 1, false, false, false, buffer).cursor).toEqual(at(0, 4))
    expect(backwardWord(at(0, 2), 1, false, buffer).cursor).toEqual(at(0, 0))
    expect(backwardWord(at(0, 4), 1, false, buffer).cursor).toEqual(at(0, 3))
    expect(backwardWord(at(0, 6), 1, false, buffer).cursor).toEqual(at(0, 5))
    expect(backwardWord(at(0, 6), 2, false, buffer).cursor).toEqual(at(0, 3))
  })

  test("stops at the end of the line while an operator is pending", () => {
    const buffer = new TextBuffer("你好世界\n测试")
    expect(forwardWord(at(0, 0), 1, false, buffer, true).cursor).toEqual(at(0, 4))
    expect(forwardWord(at(0, 0), 1, false, buffer, false).cursor).toEqual(at(1, 0))
  })

  test("crosses blank lines", () => {
    const buffer = new TextBuffer("one\n\ntwo")
    expect(forwardWord(at(0, 0), 1, false, buffer, false).cursor).toEqual(at(1, 0))
    expect(backwardWord(at(2, 0), 1, false, buffer).cursor).toEqual(at(1, 0))
  })

  test("keeps a word from jumping to the last character of the buffer", () => {
    const buffer = new TextBuffer("one")
    expect(forwardWord(at(0, 0), 1, false, buffer, false).cursor).toEqual(at(0, 3))
    expect(forwardWord(at(0, 2), 1, false, buffer, false)).toEqual({ cursor: at(0, 3), failed: true })
  })

  test("changes to the end of word like Vim's cw", () => {
    const buffer = new TextBuffer("你好，世界")
    expect(wordMotion("w", at(0, 0), 1, buffer, "c").range).toEqual({
      start: at(0, 0),
      end: at(0, 1),
      linewise: false,
      inclusive: true,
    })
    expect(wordMotion("w", at(0, 0), 1, buffer, "d").range).toEqual({
      start: at(0, 0),
      end: at(0, 2),
      linewise: false,
      inclusive: false,
    })
    expect(wordMotion("w", at(0, 2), 1, buffer, "c").range).toEqual({
      start: at(0, 2),
      end: at(0, 2),
      linewise: false,
      inclusive: true,
    })
    expect(wordMotion("e", at(0, 0), 1, buffer, "d").range).toEqual({
      start: at(0, 0),
      end: at(0, 1),
      linewise: false,
      inclusive: true,
    })
  })

  test("moves backwards without leaving the buffer", () => {
    const buffer = new TextBuffer("one two")
    expect(backwardWord(at(0, 0), 1, false, buffer).cursor).toEqual(at(0, 0))
    expect(backwardWord(at(0, 0), 1, false, buffer).failed).toBe(true)
    expect(backwardWord(at(0, 6), 2, false, buffer).cursor).toEqual(at(0, 0))
  })
})

describe("word text objects", () => {
  test("selects CJK words and punctuation", () => {
    const buffer = new TextBuffer("你好，世界。测试")
    expect(wordTextObject("i", at(0, 1), false, buffer)).toEqual({
      start: at(0, 0),
      end: at(0, 1),
      linewise: false,
      inclusive: true,
    })
    expect(wordTextObject("a", at(0, 0), false, buffer)).toEqual({
      start: at(0, 0),
      end: at(0, 1),
      linewise: false,
      inclusive: true,
    })
    expect(wordTextObject("i", at(0, 2), false, buffer)).toEqual({
      start: at(0, 2),
      end: at(0, 2),
      linewise: false,
      inclusive: true,
    })
  })

  test("includes surrounding whitespace for aw", () => {
    const buffer = new TextBuffer("one two three")
    expect(wordTextObject("i", at(0, 4), false, buffer)).toEqual({
      start: at(0, 4),
      end: at(0, 6),
      linewise: false,
      inclusive: true,
    })
    expect(wordTextObject("a", at(0, 4), false, buffer)).toEqual({
      start: at(0, 4),
      end: at(0, 7),
      linewise: false,
      inclusive: true,
    })
    expect(wordTextObject("a", at(0, 8), false, buffer)).toEqual({
      start: at(0, 7),
      end: at(0, 12),
      linewise: false,
      inclusive: true,
    })
  })

  test("selects a whitespace run for iw", () => {
    const buffer = new TextBuffer("one  two")
    expect(wordTextObject("i", at(0, 4), false, buffer)).toEqual({
      start: at(0, 3),
      end: at(0, 4),
      linewise: false,
      inclusive: true,
    })
  })
})

function at(line: number, col: number): CursorPosition {
  return { line, col }
}
