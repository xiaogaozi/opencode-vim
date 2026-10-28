import { describe, expect, test } from "bun:test"
import type { LineInfo } from "@opentui/core"
import type { EditorInput } from "../../src/vim/editor"
import { createPromptMap } from "../../src/vim/map"
import { screenMotionCursor } from "../../src/vim/screen-motion"

function lineInfo(lineStartCols: number[]): LineInfo {
  return {
    lineStartCols,
    lineWidthCols: lineStartCols.map(() => 1),
    lineWidthColsMax: 1,
    lineSources: lineStartCols.map((_, index) => index),
    lineWraps: lineStartCols.map(() => 0),
  }
}

function logicalStarts(lines: string[]) {
  const starts: number[] = []
  let offset = 0
  for (const line of lines) {
    starts.push(offset)
    offset += line.length + 1
  }
  return starts
}

function input(text: string, starts: number[], scrollY: number, height: number): EditorInput {
  return {
    cursorOffset: 0,
    plainText: text,
    scrollY,
    height,
    editorView: { getLogicalLineInfo: () => lineInfo(starts) },
  }
}

function target(text: string, starts: number[], scrollY: number, height: number, key: "H" | "M" | "L", count = 0) {
  return screenMotionCursor(input(text, starts, scrollY, height), createPromptMap(text), key, count, "unicode")
}

describe("reader screen motions", () => {
  const lines = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]
  const text = lines.join("\n")
  const starts = logicalStarts(lines)

  test("H, M and L use inset visual rows while scrolled", () => {
    expect(target(text, starts, 2, 6, "H")).toEqual({ line: 3, col: 0 })
    expect(target(text, starts, 2, 6, "M")).toEqual({ line: 5, col: 0 })
    expect(target(text, starts, 2, 6, "L")).toEqual({ line: 6, col: 0 })
  })

  test("counts move H and L further inside the viewport", () => {
    expect(target(text, starts, 2, 6, "H", 2)).toEqual({ line: 4, col: 0 })
    expect(target(text, starts, 2, 6, "L", 3)).toEqual({ line: 4, col: 0 })
  })

  test("file boundaries reach the real first and last lines", () => {
    expect(target(text, starts, 0, 4, "H")).toEqual({ line: 0, col: 0 })
    expect(target(text, starts, 6, 4, "L")).toEqual({ line: 9, col: 0 })
  })

  test("targets the first non-blank character of the visual line", () => {
    const value = "  two\nthree"
    expect(target(value, logicalStarts(value.split("\n")), 0, 2, "H")).toEqual({ line: 0, col: 2 })
  })

  test("uses visual rows instead of logical lines for wrapped text", () => {
    const value = "abcdefghij\nnext\nlast"
    expect(target(value, [0, 5, 11, 16], 0, 3, "L")).toEqual({ line: 0, col: 5 })
  })
})
