import {
  getTreeSitterClient,
  SyntaxStyle,
  type StyleDefinitionInput,
  type TextareaRenderable,
  type WidthMethod,
} from "@opentui/core"
import type { Context } from "@opencode/plugin/tui/context"
import { createEffect, onCleanup } from "solid-js"
import { createPromptMap, hostPosition } from "../vim/map"
import { createSyntaxStyle } from "../vim/syntax"

export function createReaderSyntax(context: Context) {
  const style = createSyntaxStyle(context)
  createEffect(() => {
    const theme = context.theme.surface("dialog")
    const tokens: Record<string, StyleDefinitionInput> = { default: { fg: theme.text.base } }
    for (const [name, color] of Object.entries(theme.syntax)) tokens[name] = { fg: color }
    tokens["diff.plus"] = { fg: theme.diff.text.added }
    tokens["diff.minus"] = { fg: theme.diff.text.removed }
    tokens["diff.header"] = { fg: theme.diff.text.hunkHeader }
    tokens["markup.heading"] = { fg: theme.markdown.heading, bold: true }
    for (let level = 1; level <= 6; level++)
      tokens[`markup.heading.${level}`] = {
        fg: theme.markdown.heading,
        bold: true,
        underline: level === 1,
      }
    tokens["markup.strong"] = { fg: theme.markdown.strong, bold: true }
    tokens["markup.italic"] = { fg: theme.markdown.emphasis, italic: true }
    tokens["markup.strikethrough"] = { fg: theme.text.muted }
    tokens["markup.raw"] = { fg: theme.markdown.code }
    tokens["markup.raw.block"] = { fg: theme.markdown.code }
    tokens["markup.raw.inline"] = { fg: theme.markdown.code }
    tokens["markup.link"] = { fg: theme.markdown.link, underline: true }
    tokens["markup.link.url"] = { fg: theme.markdown.link, underline: true }
    tokens["markup.link.label"] = { fg: theme.markdown.linkText, underline: true }
    tokens["markup.quote"] = { fg: theme.markdown.blockQuote, italic: true }
    tokens["markup.list"] = { fg: theme.markdown.listItem }
    tokens["markup.list.unchecked"] = { fg: theme.text.muted }
    tokens["markup.list.checked"] = { fg: theme.text.feedback.success.base }
    tokens["markup.underline"] = { fg: theme.text.base, underline: true }
    tokens["label"] = { fg: theme.markdown.linkText }
    tokens["punctuation.special"] = { fg: theme.syntax.operator }
    tokens["string.escape"] = { fg: theme.syntax.string }
    tokens["keyword.directive"] = { fg: theme.syntax.keyword }
    for (const [name, token] of Object.entries(tokens)) style.registerStyle(name, token)
    context.renderer.requestRender()
  })
  onCleanup(() => style.destroy())
  return style
}

export async function highlightCode(
  input: TextareaRenderable,
  style: SyntaxStyle,
  filetype: string,
  signal: AbortSignal,
  widthMethod: WidthMethod,
) {
  const text = input.plainText
  let result
  try {
    result = await getTreeSitterClient().highlightOnce(text, filetype)
  } catch {
    return
  }
  if (signal.aborted || input.isDestroyed || !result.highlights?.length) return
  input.syntaxStyle = style
  const map = createPromptMap(text, undefined, widthMethod)
  const ranges: Array<{ start: number; end: number; styleId: number }> = []
  for (const [start, end, scope] of result.highlights) {
    const styleId = style.getStyleId(scope)
    if (styleId === null) continue
    const range = { start: highlightOffset(start), end: highlightOffset(end), styleId }
    if (range.end > range.start) ranges.push(range)
  }
  // Markdown headings and fenced blocks contain nested inline/code ranges.
  // The editor resolves overlapping highlights by priority, so deeper ranges
  // must outrank their containers to keep their own colors.
  ranges.sort((a, b) => a.start - b.start || b.end - a.end)
  const active: typeof ranges = []
  for (const range of ranges) {
    while (active.length > 0 && active[active.length - 1].end <= range.start) active.pop()
    input.addHighlightByCharRange({ ...range, priority: Math.min(255, active.length) })
    active.push(range)
  }
  input.requestRender()

  function highlightOffset(index: number) {
    const offset = map.vimToDisplay[map.hostToVim[index]]
    // Highlight ranges exclude newlines; editor cursor offsets include them.
    return offset - hostPosition(map, offset).line
  }
}
