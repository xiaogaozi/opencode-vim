// TSX ensures the plugin loader shares the host's OpenTUI classes.
import type { Context } from "@opencode/plugin/tui/context"
import {
  CodeRenderable,
  MouseEvent,
  ScrollBoxRenderable,
  SyntaxStyle,
  TextBufferRenderable,
  type OptimizedBuffer,
  type Renderable,
} from "@opentui/core"
import { charToDisplay } from "./vim/map"
import { createSyntaxStyle } from "./vim/syntax"
import { transcriptItems, type TranscriptRange } from "./transcript-items"
import { isWideText, literalMatches, type SearchDirection, type SearchMatch } from "./ui/search"

const SEARCH_HIGHLIGHT_LIMIT = 2000

type SearchStyle = {
  getStyleId(name: string): number | null
  registerStyle(name: string, style: { fg?: unknown; bg?: unknown; bold?: boolean }): number
}

type SearchTextBuffer = {
  getSyntaxStyle(): SearchStyle | null
  setSyntaxStyle?(style: SyntaxStyle): void
  addHighlightByCharRange(highlight: {
    start: number
    end: number
    styleId: number
    priority?: number | null
    hlRef?: number | null
  }): void
  removeHighlightsByRef(ref: number): void
}

type SearchNodeMatch = SearchMatch & {
  rangeID: string
  rangeIndex: number
  order: number
  scrollTop: number
  node: Renderable
  buffer?: SearchTextBuffer
  y: number
}

export type TranscriptSearch = {
  status: "found" | "not-found" | "cancelled"
  pattern: string
  direction: SearchDirection
  index: number
  total: number
  partial: boolean
}

type MessageStore = Context["data"]["session"]["message"] & {
  more?(sessionID: string): boolean
}

export function createTranscriptSelection(
  context: Context,
  sessionID: string,
  select: (id: string | undefined) => void,
) {
  let scroll: ScrollBoxRenderable | undefined
  let requestedID: string | undefined
  let selectedParents: string[] = []
  let searchMatches: SearchNodeMatch[] = []
  let searchKeys = new Set<string>()
  let searchSeenRanges = new Set<string>()
  let searchIndex = -1
  let searchPattern = ""
  let searchRef = 0
  let searchBuffers = new Set<SearchTextBuffer>()
  let fallbackSyntax: SyntaxStyle | undefined
  let navigation:
    | {
        from: string | undefined
        offset: number
        latest?: boolean
        loading?: { key: string; frame: number; up: boolean; height: number }
      }
    | undefined

  function items(rows: Renderable[]) {
    const pending = new Set<string>()
    for (const request of context.data.session.permission.list(sessionID) ?? []) {
      if (request.source?.type === "tool") pending.add(request.source.id)
    }
    return transcriptItems(rows, context.data.session.message.list(sessionID), pending)
  }

  function choose(range: TranscriptRange, view: NonNullable<ReturnType<typeof inspect>>, focus?: number) {
    requestedID = range.id
    select(requestedID)
    let delta = 0
    if (focus !== undefined) {
      if (focus < view.top) delta = focus - view.top
      else if (focus >= view.bottom) delta = focus - view.top - Math.floor((view.bottom - view.top) / 3)
    } else if (range.bottom <= view.top) delta = range.top - view.top
    else if (range.top >= view.bottom) {
      delta = range.top - view.top - Math.max(0, view.bottom - view.top - (range.bottom - range.top))
    }
    if (delta) {
      const slack = view.scroll.getRenderable("session-navigation-slack")?.height ?? 0
      const maximum = Math.max(0, view.scroll.scrollHeight - slack - view.scroll.viewport.height)
      const position = Math.max(0, Math.min(maximum, view.scroll.scrollTop + delta))
      if (slack) context.keymap.dispatch(delta < 0 ? "session.line.up" : "session.line.down")
      view.scroll.scrollTo(position)
    }
    context.renderer.requestRender()
  }

  function advance() {
    if (!navigation) return
    const view = inspect()
    const ranges = view?.ranges ?? []
    const from = navigation.from ? ranges.findIndex((range) => range.id === navigation!.from) : ranges.length
    if (navigation.from && from === -1) {
      navigation = undefined
      return
    }
    const target = navigation.latest ? ranges.length - 1 : from + navigation.offset
    const loading = navigation.loading
    // OpenCode compensates for prepended rows after two animation frames.
    if (loading && context.renderer.frameId < loading.frame) {
      context.renderer.requestRender()
      return
    }
    if (view && loading?.up && view.scroll.scrollHeight > loading.height) {
      const maximum = Math.max(0, view.scroll.scrollHeight - view.scroll.viewport.height)
      const compensated = Math.max(0, Math.min(maximum, view.scroll.scrollHeight - loading.height - 1))
      if (view.scroll.scrollTop < compensated) return
    }
    if (view && target >= 0 && target < ranges.length && (!navigation.latest || view.hasLatest)) {
      navigation = undefined
      choose(ranges[target], view)
      return
    }
    const up = !navigation.latest && target < 0
    const messages = context.data.session.message.list(sessionID)
    const key = `${messages[0]?.id}:${messages.length}:${ranges[0]?.id}:${ranges.at(-1)?.id}:${view?.scroll.scrollHeight}`
    if (loading?.key === key) return
    navigation.loading = { key, frame: context.renderer.frameId + 2, up, height: view?.scroll.scrollHeight ?? 0 }
    view?.scroll.scrollTo(up ? 0 : view.scroll.scrollHeight)
    context.keymap.dispatch(up ? "session.line.up" : "session.line.down")
    context.renderer.requestRender()
  }

  function latest() {
    if (!context.data.session.message.list(sessionID).length) {
      navigation = undefined
      requestedID = undefined
      select(undefined)
      return
    }
    navigation = { from: undefined, offset: 0, latest: true }
    advance()
  }

  function move(direction: "next" | "previous", count: number) {
    if (
      navigation &&
      (navigation.latest ||
        (navigation.offset < 0 && direction === "next") ||
        (navigation.offset > 0 && direction === "previous"))
    ) {
      navigation = undefined
    }
    navigation ??= { from: requestedID ?? inspect()?.selected?.id, offset: 0 }
    navigation.offset += direction === "next" ? count : -count
    if (navigation.loading) navigation.loading.key = ""
    advance()
  }

  function searchTextNodes(node: Renderable, seen: Set<Renderable>): TextBufferRenderable[] {
    if (!node.visible || node.isDestroyed) return []
    const result: TextBufferRenderable[] = []
    if (node instanceof TextBufferRenderable && !seen.has(node)) {
      seen.add(node)
      result.push(node)
    }
    for (const child of node.getChildren()) result.push(...searchTextNodes(child, seen))
    return result
  }

  function searchBuffer(node: Renderable) {
    if (!(node instanceof TextBufferRenderable)) return
    return (node as unknown as { textBuffer?: SearchTextBuffer }).textBuffer
  }

  function lineStarts(text: string) {
    const starts = [0]
    for (let index = 0; index < text.length; index++) {
      if (text.charCodeAt(index) === 10) starts.push(index + 1)
    }
    return starts
  }

  function lineAt(starts: number[], offset: number) {
    let low = 0
    let high = starts.length - 1
    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      if (starts[middle]! <= offset) low = middle + 1
      else high = middle - 1
    }
    return Math.max(0, high)
  }

  function screenY(node: TextBufferRenderable, starts: number[], start: number, range: TranscriptRange) {
    let visual = 0
    try {
      const source = lineAt(starts, start)
      const found = node.lineInfo.lineSources.indexOf(source)
      if (found !== -1) visual = found
    } catch {}
    const y = node.y + visual - node.scrollY
    return Math.max(range.top, Math.min(range.bottom - 1, y))
  }

  function collectSearchMatches(
    ranges: TranscriptRange[],
    pattern: string,
    scrollTop = 0,
    orders?: Map<string, number>,
  ) {
    const matches: SearchNodeMatch[] = []
    const seen = new Set<Renderable>()
    for (const [rangeIndex, range] of ranges.entries()) {
      const order = orders?.get(range.id) ?? rangeIndex
      let found = false
      for (const node of searchTextNodes(range.node, seen)) {
        const text = node.plainText
        if (!text) continue
        const starts = lineStarts(text)
        for (const match of literalMatches(text, pattern)) {
          found = true
          matches.push({
            ...match,
            rangeID: range.id,
            rangeIndex,
            order,
            scrollTop,
            node,
            buffer: searchBuffer(node),
            y: screenY(node, starts, match.start, range),
          })
        }
      }
      // Diffs, tables and other non-text renderables can only be located by
      // their surrounding transcript range.
      if (found) continue
      for (const match of literalMatches(range.text, pattern)) {
        matches.push({
          ...match,
          rangeID: range.id,
          rangeIndex,
          order,
          scrollTop,
          node: range.node,
          y: range.top,
        })
      }
    }
    return matches
  }

  function matchKey(match: SearchNodeMatch) {
    return `${match.rangeID}:${match.start}:${match.end}`
  }

  function clearSearchHighlights() {
    if (!searchBuffers.size) return
    for (const buffer of searchBuffers) {
      try {
        buffer.removeHighlightsByRef(searchRef)
      } catch {}
    }
    searchBuffers.clear()
  }

  function registerSearchStyle(
    syntax: SearchStyle,
    name: string,
    foreground: unknown,
    background: unknown,
    bold = false,
  ) {
    const existing = syntax.getStyleId(name)
    if (existing !== null) return existing
    return syntax.registerStyle(name, { fg: foreground, bg: background, bold })
  }

  function applyHighlights(matches: SearchNodeMatch[], currentKey: string) {
    clearSearchHighlights()
    const ref = ++searchRef
    for (const [index, match] of matches.entries()) {
      if (index >= SEARCH_HIGHLIGHT_LIMIT && matchKey(match) !== currentKey) continue
      if (!(match.node instanceof CodeRenderable)) continue
      const buffer = match.buffer
      if (!buffer) continue
      try {
        let syntax = buffer.getSyntaxStyle()
        if (!syntax) {
          fallbackSyntax ??= createSyntaxStyle(context)
          buffer.setSyntaxStyle?.(fallbackSyntax)
          syntax = fallbackSyntax
        }
        const current = matchKey(match) === currentKey
        const content = match.node instanceof TextBufferRenderable ? match.node.plainText : ""
        // Text buffer ranges count display cells and give explicit newlines no
        // width, unlike textarea offsets.
        const method = context.renderer.widthMethod
        const start = charToDisplay(content, match.start, method, 0)
        const end = charToDisplay(content, match.end, method, 0)
        // Wide glyphs are not consistently background-painted across terminal
        // emulators, so use a foreground-only style for them.
        const wide = isWideText(content.slice(match.start, match.end), method)
        const style = current
          ? wide
            ? registerSearchStyle(
                syntax,
                "opencode-vim.search.current.text",
                context.theme.text.feedback.info.base,
                undefined,
              )
            : registerSearchStyle(
                syntax,
                "opencode-vim.search.current",
                context.theme.background.base,
                context.theme.text.feedback.info.base,
              )
          : wide
            ? registerSearchStyle(
                syntax,
                "opencode-vim.search.text",
                context.theme.text.feedback.warning.base,
                undefined,
              )
            : registerSearchStyle(
                syntax,
                "opencode-vim.search",
                context.theme.background.base,
                context.theme.text.feedback.warning.base,
              )
        buffer.addHighlightByCharRange({
          start,
          end,
          styleId: style,
          priority: 255,
          hlRef: ref,
        })
        searchBuffers.add(buffer)
      } catch {}
    }
  }

  function refreshVisibleHighlights() {
    if (!searchPattern) {
      clearSearchHighlights()
      return
    }
    const view = inspect()
    if (!view) return
    const current = searchMatches[searchIndex]
    const visible = collectSearchMatches(view.ranges, searchPattern)
    applyHighlights(visible, current ? matchKey(current) : "")
  }

  function clearSearch() {
    clearSearchHighlights()
    searchMatches = []
    searchKeys = new Set()
    searchSeenRanges = new Set()
    searchIndex = -1
    searchPattern = ""
  }

  function dismissSearch() {
    clearSearchHighlights()
  }

  function restoreAnchor(
    view: NonNullable<ReturnType<typeof inspect>>,
    anchorID: string | undefined,
    scrollTop: number,
  ) {
    const range = anchorID ? view.ranges.find((item) => item.id === anchorID) : undefined
    if (range) choose(range, view)
    else if (scrollTop !== view.scroll.scrollTop) view.scroll.scrollTo(scrollTop)
  }

  async function nextFrame() {
    await new Promise<void>((resolve) => {
      const start = context.renderer.frameId
      const deadline = Date.now() + 500
      const tick = () => {
        if (context.renderer.frameId > start || context.renderer.isDestroyed || Date.now() >= deadline) resolve()
        else setTimeout(tick, 8)
      }
      context.renderer.requestRender()
      setTimeout(tick, 8)
    })
  }

  async function settleView() {
    let previous = ""
    let stable = 0
    for (let attempt = 0; attempt < 30; attempt++) {
      await nextFrame()
      const view = inspect()
      if (!view) return
      const key = `${view.ranges.length}:${view.scroll.scrollHeight}:${view.scroll.scrollTop}`
      if (key === previous) stable++
      else stable = 0
      previous = key
      if (stable >= 2) return
    }
  }

  function isPartial() {
    const store = context.data.session.message as MessageStore
    if (store.more?.(sessionID)) return true
    const messages = context.data.session.message.list(sessionID)
    if (!messages.length) return false
    const has = (id: string) => {
      for (const rangeID of searchSeenRanges) {
        if (rangeID === id || rangeID.includes(id)) return true
      }
      return false
    }
    return !has(messages[0]!.id) || !has(messages[messages.length - 1]!.id)
  }

  function addView(view: NonNullable<ReturnType<typeof inspect>>, direction: SearchDirection) {
    const current = searchMatches[searchIndex]
    const currentKey = current ? matchKey(current) : ""
    for (const range of view.ranges) searchSeenRanges.add(range.id)
    const fresh: SearchNodeMatch[] = []
    for (const match of collectSearchMatches(view.ranges, searchPattern, view.scroll.scrollTop)) {
      const key = matchKey(match)
      if (searchKeys.has(key)) continue
      searchKeys.add(key)
      fresh.push(match)
    }
    if (fresh.length) {
      if (direction === 1) searchMatches.push(...fresh)
      else searchMatches.unshift(...fresh)
    }
    if (currentKey) searchIndex = searchMatches.findIndex((match) => matchKey(match) === currentKey)
    return fresh
  }

  async function page(direction: SearchDirection) {
    const before = inspect()
    if (!before) return false
    const top = before.scroll.scrollTop
    const maximum = Math.max(0, before.scroll.scrollHeight - before.scroll.viewport.height)
    const count = context.data.session.message.list(sessionID).length
    const store = context.data.session.message as MessageStore
    if (direction === 1) {
      if (top >= maximum - 1) return false
      context.keymap.dispatch("session.page.down")
    } else if (top <= 0) {
      if (!(store.more?.(sessionID) ?? false)) return false
      context.keymap.dispatch("session.line.up")
    } else {
      context.keymap.dispatch("session.page.up")
    }
    await nextFrame()
    await settleView()
    const after = inspect()
    if (!after) return false
    const loaded = context.data.session.message.list(sessionID).length > count
    if (direction === 1) return loaded || after.scroll.scrollTop > top + 0.5
    return loaded || after.scroll.scrollTop < top - 0.5
  }

  async function revealMatch(match: SearchNodeMatch) {
    let view = inspect()
    if (!view) return false
    let range = view.ranges.find((item) => item.id === match.rangeID)
    if (!range) {
      view.scroll.scrollTo(match.scrollTop)
      context.keymap.dispatch("session.line.down")
      context.renderer.requestRender()
      await nextFrame()
      view = inspect()
      range = view?.ranges.find((item) => item.id === match.rangeID)
    }
    if (!view || !range) return false
    const visible = collectSearchMatches(view.ranges, searchPattern)
    const target = visible.find((item) => matchKey(item) === matchKey(match))
    choose(range, view, target?.y ?? match.y)
    return true
  }

  async function search(pattern: string, direction: SearchDirection, signal: AbortSignal): Promise<TranscriptSearch> {
    const before = inspect()
    const anchorID = requestedID ?? before?.selected?.id
    const scrollTop = before?.scroll.scrollTop ?? 0
    const previous = searchMatches[searchIndex]
    clearSearch()
    searchPattern = pattern
    let view = inspect()
    if (!view) return { status: "not-found", pattern, direction, index: 0, total: 0, partial: false }
    addView(view, 1)
    let index = -1
    const anchor = anchorID ? view.ranges.findIndex((range) => range.id === anchorID) : -1
    const previousInAnchor = previous && previous.rangeID === anchorID ? previous : undefined
    if (direction === 1) {
      index = searchMatches.findIndex(
        (match) =>
          anchor === -1 ||
          match.rangeIndex > anchor ||
          (match.rangeIndex === anchor && (!previousInAnchor || match.start >= previousInAnchor.start)),
      )
    } else {
      for (let position = searchMatches.length - 1; position >= 0; position--) {
        const match = searchMatches[position]!
        if (
          anchor === -1 ||
          match.rangeIndex < anchor ||
          (match.rangeIndex === anchor && (!previousInAnchor || match.end <= previousInAnchor.start))
        ) {
          index = position
          break
        }
      }
    }
    while (index === -1 && !signal.aborted && (await page(direction))) {
      view = inspect()
      if (!view) break
      const fresh = addView(view, direction)
      if (!fresh.length) continue
      index =
        direction === 1
          ? searchMatches.findIndex((match) => matchKey(match) === matchKey(fresh[0]!))
          : searchMatches.findIndex((match) => matchKey(match) === matchKey(fresh[fresh.length - 1]!))
    }
    if (signal.aborted) {
      const current = inspect()
      if (current) restoreAnchor(current, anchorID, scrollTop)
      return { status: "cancelled", pattern, direction, index: 0, total: 0, partial: false }
    }
    if (index === -1 && searchMatches.length) index = direction === 1 ? 0 : searchMatches.length - 1
    if (index === -1) {
      const current = inspect()
      if (current) restoreAnchor(current, anchorID, scrollTop)
      return { status: "not-found", pattern, direction, index: 0, total: 0, partial: isPartial() }
    }
    searchIndex = index
    await revealMatch(searchMatches[index]!)
    refreshVisibleHighlights()
    return {
      status: "found",
      pattern,
      direction,
      index: index + 1,
      total: searchMatches.length,
      partial: isPartial(),
    }
  }

  async function next(direction: SearchDirection, count = 1): Promise<TranscriptSearch | undefined> {
    if (!searchPattern) return
    if (!searchMatches.length) {
      return { status: "not-found", pattern: searchPattern, direction, index: 0, total: 0, partial: isPartial() }
    }
    let remaining = Math.max(1, count)
    let wrapped = false
    while (remaining > 0) {
      const target = searchIndex + direction
      if (target >= 0 && target < searchMatches.length) {
        searchIndex = target
        remaining--
        continue
      }
      if (await page(direction)) {
        const view = inspect()
        if (!view) break
        const fresh = addView(view, direction)
        if (fresh.length) continue
        continue
      }
      if (wrapped) break
      searchIndex = direction === 1 ? 0 : searchMatches.length - 1
      wrapped = true
      remaining--
    }
    if (searchIndex < 0) return
    await revealMatch(searchMatches[searchIndex]!)
    refreshVisibleHighlights()
    return {
      status: "found",
      pattern: searchPattern,
      direction,
      index: searchIndex + 1,
      total: searchMatches.length,
      partial: isPartial(),
    }
  }

  function inspect() {
    function findScroll(node: Renderable): ScrollBoxRenderable | undefined {
      if (!node.visible) return
      if (node instanceof ScrollBoxRenderable && items(node.getChildren()).ranges.length) return node
      for (const child of node.getChildren()) {
        const found = findScroll(child)
        if (found) return found
      }
    }
    if (!scroll || scroll.isDestroyed) scroll = findScroll(context.renderer.root)
    if (!scroll) {
      select(undefined)
      return
    }
    const { ranges, hasLatest } = items(scroll.getChildren())
    const top = scroll.viewport.y
    const bottom = top + scroll.viewport.height
    let selected = ranges.find((range) => range.id === requestedID)
    if (!selected && requestedID) {
      for (const id of selectedParents) {
        selected = ranges.find((range) => range.id === id)
        if (selected) {
          requestedID = id
          break
        }
      }
      if (!selected) requestedID = undefined
    }
    selected ??=
      ranges.find((range) => range.top <= top + 1 && range.bottom > top + 1) ??
      ranges.find((range) => range.bottom > top && range.top < bottom)
    selectedParents = []
    let parent = selected?.parentID
    while (parent) {
      selectedParents.push(parent)
      parent = ranges.find((range) => range.id === parent)?.parentID
    }
    select(selected?.id)
    return { scroll, selected, ranges, hasLatest, top, bottom }
  }

  function matchSegments(match: SearchNodeMatch, view: NonNullable<ReturnType<typeof inspect>>) {
    if (!(match.node instanceof TextBufferRenderable) || match.node.isDestroyed || !match.node.visible) return []
    const node = match.node
    const text = node.plainText
    if (!text) return []
    const starts = lineStarts(text)
    const info = node.lineInfo
    const method = context.renderer.widthMethod
    const first = lineAt(starts, match.start)
    const last = lineAt(starts, Math.max(match.start, match.end - 1))
    const segments: Array<{ x: number; y: number; width: number }> = []
    for (let line = first; line <= last; line++) {
      const lineStart = starts[line]!
      const lineEnd = line + 1 < starts.length ? starts[line + 1]! - 1 : text.length
      const from = Math.max(match.start, lineStart)
      const to = Math.min(match.end, lineEnd)
      if (from >= to) continue
      const colStart = charToDisplay(text.slice(lineStart, from), from - lineStart, method)
      const colEnd = charToDisplay(text.slice(lineStart, to), to - lineStart, method)
      const sources = info.lineSources ?? []
      const sourceStart = info.lineStartCols[sources.indexOf(line)] ?? 0
      let placed = false
      for (let visual = 0; visual < sources.length; visual++) {
        if (sources[visual] !== line) continue
        const relativeStart = (info.lineStartCols[visual] ?? 0) - sourceStart
        const visualWidth = info.lineWidthCols[visual] ?? 0
        const begin = Math.max(colStart, relativeStart)
        const end = Math.min(colEnd, relativeStart + visualWidth)
        if (begin >= end) continue
        placed = true
        segments.push({
          x: node.x + begin - relativeStart,
          y: node.y + visual - node.scrollY,
          width: end - begin,
        })
      }
      if (!placed) {
        segments.push({
          x: node.x + colStart,
          y: node.y + line - first - node.scrollY,
          width: colEnd - colStart,
        })
      }
    }
    void view
    return segments
  }

  function drawSearchCellHighlights(buffer: OptimizedBuffer, view: NonNullable<ReturnType<typeof inspect>>) {
    if (!searchPattern || !searchMatches.length) return
    const current = searchMatches[searchIndex]
    const currentKey = current ? matchKey(current) : ""
    const colors = buffer.buffers
    const method = context.renderer.widthMethod
    for (const match of searchMatches) {
      const node = match.node
      if (!(node instanceof TextBufferRenderable) || node instanceof CodeRenderable) continue
      const content = node.plainText
      if (!content) continue
      const wide = isWideText(content.slice(match.start, match.end), method)
      const isCurrent = matchKey(match) === currentKey
      const foreground = wide
        ? isCurrent
          ? context.theme.text.feedback.info.base
          : context.theme.text.feedback.warning.base
        : context.theme.background.base
      const background = isCurrent ? context.theme.text.feedback.info.base : context.theme.text.feedback.warning.base
      for (const segment of matchSegments(match, view)) {
        const top = Math.max(view.top, segment.y)
        const bottom = Math.min(view.bottom, segment.y + 1, buffer.height)
        if (top >= bottom) continue
        for (let y = top; y < bottom; y++) {
          const left = Math.max(view.scroll.viewport.x, segment.x)
          const right = Math.min(
            buffer.width,
            view.scroll.viewport.x + view.scroll.viewport.width,
            segment.x + segment.width,
          )
          for (let x = left; x < right; x++) {
            const offset = (y * buffer.width + x) * 4
            colors.fg.set(foreground.buffer, offset)
            if (!wide) colors.bg.set(background.buffer, offset)
          }
        }
      }
    }
  }

  return {
    latest,
    move,
    search,
    next,
    clearSearch,
    dismissSearch,
    get(id: string | undefined) {
      if (!scroll || scroll.isDestroyed) return
      return items(scroll.getChildren()).ranges.find((range) => range.id === id)
    },
    toggle() {
      const range = inspect()?.selected
      if (!range?.toggle) return false
      navigation = undefined
      requestedID = range.id
      const node = range.toggle
      node.processMouseEvent(
        new MouseEvent(node, {
          type: "up",
          button: 0,
          x: node.x,
          y: node.y,
          modifiers: { shift: false, alt: false, ctrl: false },
        }),
      )
      context.renderer.requestRender()
      return true
    },
    followViewport() {
      navigation = undefined
      requestedID = undefined
      selectedParents = []
    },
    sync() {
      advance()
      navigation = undefined
      return inspect()
    },
    draw(buffer: OptimizedBuffer, yankID?: string) {
      advance()
      const view = inspect()
      if (!view?.selected) return
      const top = Math.max(0, view.top, view.selected.top)
      const bottom = Math.min(buffer.height, view.bottom, view.selected.bottom)
      if (view.selected.id === yankID) {
        const node = view.selected.node
        const left = Math.max(0, view.scroll.viewport.x, node.x)
        const right = Math.min(buffer.width, view.scroll.viewport.x + view.scroll.viewport.width, node.x + node.width)
        const foreground = context.theme.background.base.buffer
        const background = context.theme.text.feedback.info.base.buffer
        const colors = buffer.buffers
        // Change only colors to preserve wide-character continuation cells.
        for (let y = top; y < bottom; y++) {
          for (let x = left; x < right; x++) {
            const offset = (y * buffer.width + x) * 4
            colors.fg.set(foreground, offset)
            colors.bg.set(background, offset)
          }
        }
      }
      const x = view.scroll.x - 1
      if (x < 0) return
      for (let y = top; y < bottom; y++) {
        buffer.drawText("▎", x, y, context.theme.text.feedback.info.base, context.theme.background.base)
      }
      drawSearchCellHighlights(buffer, view)
    },
  }
}
