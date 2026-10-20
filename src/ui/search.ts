import type { WidthMethod } from "@opentui/core"
import { charToDisplay } from "../vim/map"

export type SearchDirection = 1 | -1

export type SearchMatch = {
  start: number
  end: number
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })
const LITERAL_SPECIAL = /[.*+?^${}()|[\]\\]/g
const MAX_PATTERN = 200

export function literalMatches(text: string, pattern: string): SearchMatch[] {
  if (!text || !pattern) return []
  const source = pattern.replace(LITERAL_SPECIAL, "\\$&")
  const expression = new RegExp(source, /[A-Z]/.test(pattern) ? "g" : "gi")
  const matches: SearchMatch[] = []
  for (const match of text.matchAll(expression)) {
    if (match.index === undefined) continue
    matches.push({ start: match.index, end: match.index + match[0].length })
  }
  return matches
}

export function stepSearchIndex(length: number, index: number, direction: SearchDirection, count = 1) {
  if (length <= 0) return -1
  if (index < 0) return direction === 1 ? 0 : length - 1
  const step = Math.max(1, count)
  return (((index + direction * step) % length) + length) % length
}

export function pickSearchIndex(matches: SearchMatch[], cursor: number, direction: SearchDirection) {
  if (!matches.length) return -1
  if (direction === 1) {
    const index = matches.findIndex((match) => match.start >= cursor)
    return index === -1 ? 0 : index
  }
  for (let index = matches.length - 1; index >= 0; index--) {
    if (matches[index]!.end <= cursor) return index
  }
  return matches.length - 1
}

export function isWideText(text: string, method: WidthMethod = "unicode") {
  let count = 0
  for (const _ of graphemes.segment(text)) count++
  return charToDisplay(text, text.length, method, 0) > count
}

export function searchTextKey(key: string) {
  if (key === "<Space>") return " "
  if (key.length > 2 && key.startsWith("<") && key.endsWith(">")) return
  return key
}

export function appendSearchText(text: string, key: string) {
  const value = searchTextKey(key)
  if (!value) return text
  return (text + value).slice(0, MAX_PATTERN)
}

export function backspaceSearchText(text: string) {
  let result = ""
  for (const part of graphemes.segment(text)) result = part.segment
  return text.slice(0, Math.max(0, text.length - result.length))
}

export function deleteWordSearchText(text: string) {
  const trimmed = text.replace(/\s+$/, "")
  const index = Math.max(0, trimmed.search(/\S+$/))
  return trimmed.slice(0, index)
}
