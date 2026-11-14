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

type ReaderTheme = ReturnType<Context["theme"]["surface"]>

function readerSyntaxTokens(theme: ReaderTheme): Record<string, StyleDefinitionInput> {
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
  return tokens
}

/**
 * Adds only the Markdown scopes the host style does not already define.
 * Prompt highlighting must never replace the host's SyntaxStyle: its file
 * references rely on host-only scopes such as `extmark.file`.
 */
export function ensureReaderSyntaxTokens(style: SyntaxStyle, theme: ReaderTheme) {
  for (const [name, token] of Object.entries(readerSyntaxTokens(theme))) {
    if (style.getStyle(name) !== undefined) continue
    style.registerStyle(name, token)
  }
}

export function createReaderSyntax(context: Context) {
  const style = createSyntaxStyle(context)
  createEffect(() => {
    const tokens = readerSyntaxTokens(context.theme.surface("dialog"))
    for (const [name, token] of Object.entries(tokens)) style.registerStyle(name, token)
    context.renderer.requestRender()
  })
  onCleanup(() => style.destroy())
  return style
}

export type HighlightOptions = {
  /** Keeps highlight ownership separate from the host's own ranges. */
  hlRef?: number
  /** Leaves the editor's host-owned syntax style untouched. */
  applyStyle?: boolean
  /** Buffer ranges owned by the host, such as prompt extmarks. */
  exclude?: ReadonlyArray<{ start: number; end: number }>
}

export async function highlightCode(
  input: TextareaRenderable,
  style: SyntaxStyle,
  filetype: string,
  signal: AbortSignal,
  widthMethod: WidthMethod,
  options: HighlightOptions = {},
) {
  const text = input.plainText
  let result
  try {
    result = await getTreeSitterClient().highlightOnce(text, filetype)
  } catch {
    return
  }
  if (signal.aborted || input.isDestroyed || input.plainText !== text) return
  if (!result.highlights?.length) {
    if (options.hlRef !== undefined) {
      input.editBuffer.removeHighlightsByRef(options.hlRef)
      input.requestRender()
    }
    return
  }
  const map = createPromptMap(text, undefined, widthMethod)
  const excluded = options.exclude?.map((range) => ({
    start: highlightOffset(clampOffset(range.start, text.length)),
    end: highlightOffset(clampOffset(range.end, text.length)),
  }))
  const ranges: Array<{ start: number; end: number; styleId: number; priority: number }> = []
  for (const [start, end, scope] of result.highlights) {
    if (ignoredScope(scope)) continue
    const styleId = style.getStyleId(scope)
    if (styleId === null) continue
    const startOffset = highlightOffset(start)
    const endOffset = highlightOffset(end)
    if (endOffset <= startOffset) continue
    for (const part of clipRange({ start: startOffset, end: endOffset }, excluded)) {
      ranges.push({ ...part, styleId, priority: 0 })
    }
  }
  // Markdown headings and fenced blocks contain nested inline/code ranges.
  // The editor resolves overlapping highlights by priority, so deeper ranges
  // must outrank their containers to keep their own colors.
  ranges.sort((a, b) => a.start - b.start || b.end - a.end)
  const active: typeof ranges = []
  for (const range of ranges) {
    while (active.length > 0 && active[active.length - 1].end <= range.start) active.pop()
    range.priority = Math.min(255, active.length)
    active.push(range)
  }

  // Compute everything first, then change the buffer without requesting a
  // render per range. The editor should repaint once with the final state.
  const buffer = input.editBuffer
  if (options.hlRef !== undefined) buffer.removeHighlightsByRef(options.hlRef)
  if (ranges.length === 0) {
    if (options.hlRef !== undefined) input.requestRender()
    return
  }
  if (options.applyStyle !== false && buffer.getSyntaxStyle() !== style) buffer.setSyntaxStyle(style)
  for (const range of ranges) buffer.addHighlightByCharRange({ ...range, hlRef: options.hlRef })
  input.requestRender()

  function highlightOffset(index: number) {
    // Tree-sitter may point past the text when it appends a streaming newline.
    const offset = map.vimToDisplay[map.hostToVim[clampOffset(index, text.length)]]
    // Highlight ranges exclude newlines; editor cursor offsets include them.
    return offset - hostPosition(map, offset).line
  }
}

/** Spelling and conceal scopes carry no visible Markdown style. */
function ignoredScope(scope: string) {
  return scope === "spell" || scope === "nospell" || scope === "conceal" || scope.startsWith("conceal.")
}

function clampOffset(offset: number, length: number) {
  return Math.max(0, Math.min(offset, length))
}

function clipRange(
  range: { start: number; end: number },
  excluded: ReadonlyArray<{ start: number; end: number }> | undefined,
) {
  let parts = [range]
  for (const block of excluded ?? []) {
    if (block.end <= block.start) continue
    parts = parts.flatMap((part) => {
      if (block.end <= part.start || part.end <= block.start) return [part]
      const next: Array<{ start: number; end: number }> = []
      if (part.start < block.start) next.push({ start: part.start, end: block.start })
      if (block.end < part.end) next.push({ start: block.end, end: part.end })
      return next
    })
  }
  return parts
}
