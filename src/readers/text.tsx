/** @jsxImportSource @opentui/solid */
import {
  LineNumberRenderable,
  type KeyEvent,
  type LineNumberOptions,
  type PasteEvent,
  type TextareaRenderable,
} from "@opentui/core"
import { useTerminalDimensions, type JSX } from "@opentui/solid"
import { createEffect, createSignal, onCleanup, onMount, Show, untrack } from "solid-js"
import type { EditorContext } from "../vim/editor"
import { charToDisplay, displayToChar, displayWidth } from "../vim/map"
import { keyNotation } from "../vim/keys"
import { createVimState } from "../vim/state"
import { createVimeeAdapter } from "../vim/vimee"
import { createSessionKeymaps, pageCommand, sessionModeKey } from "../ui/session-keys"
import {
  appendSearchText,
  backspaceSearchText,
  deleteWordSearchText,
  literalMatches,
  pickSearchIndex,
  stepSearchIndex,
  type SearchDirection,
  type SearchMatch,
} from "../ui/search"
import type { ReaderProps } from "./types"

type ReaderSearchInput = {
  direction: SearchDirection
  prefix: "/" | "?"
  text: string
}

type ReaderSearchInfo = {
  pattern: string
  direction: SearchDirection
  index: number
  total: number
}

export function TextReader(
  props: ReaderProps & {
    title: string
    text: string
    status?: string
    details?: JSX.Element
    label?: string
    maxHeight?: number
    highlight?: (input: TextareaRenderable) => void
    switchLabel?: string
    leading?: () => TextareaRenderable
    firstLine?: number
    gutter?: Pick<LineNumberOptions, "lineNumbers" | "lineSigns" | "hideLineNumbers" | "lineColors">
    change?: { run: () => void; controls: () => JSX.Element }
  },
) {
  const context = props.context
  const dimensions = useTerminalDimensions()
  const theme = () => context.theme.surface("dialog")
  const background = () => (props.label ? theme().background.base : theme().background.raised.high)
  const editorBackground = () => (props.gutter?.lineColors ? "transparent" : background())
  const state = createVimState("normal")
  const mappings = createSessionKeymaps(props.config, !!props.leading || !!props.change)
  const [searchInput, setSearchInput] = createSignal<ReaderSearchInput>()
  const [searchInfo, setSearchInfo] = createSignal<ReaderSearchInfo>()
  const [searchNote, setSearchNote] = createSignal("")
  let searchMatches: SearchMatch[] = []
  let searchIndex = -1
  let searchPattern = ""
  let searchDirection: SearchDirection = 1
  let searchNoticeTimer: ReturnType<typeof setTimeout> | undefined
  let selectionColorsSaved = false
  let savedSelectionFg: TextareaRenderable["selectionFg"]
  let savedSelectionBg: TextareaRenderable["selectionBg"]
  let input!: TextareaRenderable
  let output!: TextareaRenderable
  const adapter = createVimeeAdapter(state, props.config, () => {}, { readOnly: true, onYank: props.copy })
  const editorContext: EditorContext = {
    input: () => input,
    get widthMethod() {
      return context.renderer.widthMethod
    },
    get colors() {
      return {
        selection: theme().text.feedback.warning.base,
        yank: theme().text.feedback.info.base,
        background: background(),
      }
    },
    setText() {},
    submit() {},
    blur() {},
    dispatchCommand: () => ({ ok: false }),
    requestRender: () => context.renderer.requestRender(),
  }

  function readerSearchNotice(message: string) {
    if (searchNoticeTimer) clearTimeout(searchNoticeTimer)
    setSearchNote(message)
    searchNoticeTimer = message ? setTimeout(() => setSearchNote(""), 3000) : undefined
  }

  function clearReaderSearch(keepPattern = true) {
    setSearchInput(undefined)
    setSearchInfo(undefined)
    setSearchNote("")
    if (searchNoticeTimer) clearTimeout(searchNoticeTimer)
    searchNoticeTimer = undefined
    if (keepPattern) return
    searchPattern = ""
    searchMatches = []
    searchIndex = -1
  }

  function useSearchSelectionColors() {
    if (!input || input.isDestroyed) return
    if (!selectionColorsSaved) {
      savedSelectionFg = input.selectionFg
      savedSelectionBg = input.selectionBg
      selectionColorsSaved = true
    }
    input.selectionFg = theme().text.feedback.info.base
    input.selectionBg = editorBackground() === "transparent" ? background() : editorBackground()
  }

  function restoreSearchSelectionColors() {
    if (!selectionColorsSaved) return
    if (input && !input.isDestroyed) {
      input.selectionFg = savedSelectionFg
      input.selectionBg = savedSelectionBg
    }
    selectionColorsSaved = false
    savedSelectionFg = undefined
    savedSelectionBg = undefined
  }

  function showReaderMatch(index: number) {
    const match = searchMatches[index]
    if (!match || !input || input.isDestroyed) return
    searchIndex = index
    const text = input.plainText
    const method = context.renderer.widthMethod
    const start = charToDisplay(text, match.start, method)
    const end = charToDisplay(text, match.end, method)
    useSearchSelectionColors()
    input.cursorOffset = start
    input.setSelection(start, end)
    context.renderer.requestRender()
  }

  function runReaderSearch(pattern: string, direction: SearchDirection) {
    if (!pattern) {
      setSearchInfo(undefined)
      readerSearchNotice("No previous search")
      return
    }
    const text = input.plainText
    const matches = literalMatches(text, pattern)
    searchPattern = pattern
    searchDirection = direction
    searchMatches = matches
    if (!matches.length) {
      input.clearSelection()
      restoreSearchSelectionColors()
      setSearchInfo(undefined)
      readerSearchNotice(`Pattern not found: ${pattern}`)
      return
    }
    const cursor = displayToChar(text, Math.max(0, input.cursorOffset ?? 0))
    const index = pickSearchIndex(matches, cursor, direction)
    showReaderMatch(index)
    setSearchInfo({ pattern, direction, index: index + 1, total: matches.length })
    setSearchNote("")
  }

  function repeatReaderSearch(direction: SearchDirection, count: number) {
    if (!searchPattern) {
      readerSearchNotice("No previous search")
      return
    }
    if (!searchMatches.length) {
      readerSearchNotice(`Pattern not found: ${searchPattern}`)
      return
    }
    const index = stepSearchIndex(searchMatches.length, searchIndex, direction, count)
    if (index === -1) return
    showReaderMatch(index)
    setSearchInfo({
      pattern: searchPattern,
      direction: searchDirection,
      index: index + 1,
      total: searchMatches.length,
    })
    setSearchNote("")
  }

  function beginReaderSearch(direction: SearchDirection) {
    mappings.cancel()
    setSearchNote("")
    if (searchNoticeTimer) clearTimeout(searchNoticeTimer)
    searchNoticeTimer = undefined
    setSearchInput({ direction, prefix: direction === 1 ? "/" : "?", text: "" })
  }

  function handleReaderSearchKey(event: KeyEvent, key: string) {
    const current = searchInput()
    if (!current) return
    event.preventDefault()
    event.stopPropagation()
    if (key === "<Esc>" || key === "<C-[>") {
      setSearchInput(undefined)
      return
    }
    if (key === "<CR>") {
      setSearchInput(undefined)
      runReaderSearch(current.text || searchPattern, current.direction)
      return
    }
    let text = current.text
    if (key === "<BS>") text = backspaceSearchText(text)
    else if (key === "<C-u>") text = ""
    else if (key === "<C-w>") text = deleteWordSearchText(text)
    else text = appendSearchText(text, key)
    setSearchInput({ ...current, text })
  }

  const onKey = (event: KeyEvent) => {
    if (context.renderer.currentFocusedEditor !== input) return
    if (event.defaultPrevented) return
    const raw = keyNotation(event)
    if (raw) {
      if (searchInput()) {
        handleReaderSearchKey(event, raw)
        return
      }
      if ((raw === "<Esc>" || raw === "<C-[>") && searchInfo()) {
        event.preventDefault()
        event.stopPropagation()
        input.clearSelection()
        restoreSearchSelectionColors()
        setSearchInfo(undefined)
        setSearchNote("")
        return
      }
      if (state.mode() === "normal" && !adapter.isPending()) {
        if (raw === "/" || raw === "?") {
          event.preventDefault()
          event.stopPropagation()
          beginReaderSearch(raw === "/" ? 1 : -1)
          return
        }
        if (raw === "y" && searchInfo()) {
          const text = input.getSelectedText()
          if (text) {
            event.preventDefault()
            event.stopPropagation()
            props.copy(text)
            readerSearchNotice("Copied")
            return
          }
        }
        if ((raw === "n" || raw === "N") && searchPattern) {
          event.preventDefault()
          event.stopPropagation()
          repeatReaderSearch(raw === "n" ? searchDirection : searchDirection === 1 ? -1 : 1, 1)
          return
        }
      }
      // A normal Vim action ends the visible search result but keeps the
      // pattern so n/N can bring it back.
      if (raw !== "y" && (searchInfo() || searchNote())) {
        input.clearSelection()
        restoreSearchSelectionColors()
        setSearchInfo(undefined)
        setSearchNote("")
      }
    }
    const key = sessionModeKey(context, event, props.config.sessionKey, "modal", mappings.accepts)
    if (!key) {
      mappings.cancel()
      return
    }
    if (key === "<Esc>" || key === "<C-[>") mappings.cancel()
    const action = !adapter.isPending() ? mappings.resolve(key) : undefined
    if (action === "passthrough") return
    event.preventDefault()
    event.stopPropagation()
    if (action === "pending") return
    if (action === "switch-panel") {
      if (props.change) {
        adapter.suspend()
        props.change.run()
      } else {
        const next = input === output ? props.leading!() : output
        next.focus()
      }
      return
    }
    if (key === props.config.sessionKey && state.mode() === "normal" && !adapter.isPending()) {
      props.close()
      return
    }
    // The host's Ctrl+C clears the editor unless we intercept it.
    if (key === "<C-c>") {
      props.back()
      return
    }
    if ((key === "<Esc>" || key === "<C-[>") && state.mode() === "normal" && !adapter.isPending()) {
      props.back()
      return
    }
    if (pageCommand(key)) {
      const down = key === "<C-d>" || key === "<C-f>" || key === "<PageDown>"
      const half = key === "<C-d>" || key === "<C-u>"
      const rows = Math.max(1, Math.floor(input.height / (half ? 2 : 1)))
      for (let row = 0; row < rows; row++)
        adapter.handle({ ...event, ctrl: false } as KeyEvent, down ? "j" : "k", editorContext)
    } else adapter.handle(event, key, editorContext)
  }

  const onPaste = (event: PasteEvent) => {
    const current = searchInput()
    if (!current) return
    const text = new TextDecoder().decode(event.bytes).replace(/\s+/g, " ")
    if (!text) return
    event.preventDefault()
    event.stopPropagation()
    setSearchInput({ ...current, text: (current.text + text).slice(0, 200) })
  }
  const onFocus = () =>
    untrack(() => {
      mappings.cancel()
      const focused = context.renderer.currentFocusedEditor
      if (focused !== output && focused !== props.leading?.()) return
      if (input && input !== focused) {
        input.clearSelection()
        restoreSearchSelectionColors()
        clearReaderSearch(false)
      }
      input = focused as TextareaRenderable
      adapter.attach(editorContext)
    })
  onMount(() => {
    props.highlight?.(output)
    output.cursorOffset = Math.min(props.offset, displayWidth(output.plainText, context.renderer.widthMethod))
    input = props.leading?.() ?? output
    input.handleKeyPress = () => true
    input.handlePaste = () => {}
    adapter.attach(editorContext)
    context.renderer.on("focused_editor", onFocus)
    input.focus()
    context.renderer.keyInput.prependListener("keypress", onKey)
    context.renderer.keyInput.prependListener("paste", onPaste)
  })
  onCleanup(() => {
    props.remember(output.cursorOffset)
    if (input && !input.isDestroyed) input.clearSelection()
    restoreSearchSelectionColors()
    if (searchNoticeTimer) clearTimeout(searchNoticeTimer)
    context.renderer.off("focused_editor", onFocus)
    context.renderer.keyInput.off("keypress", onKey)
    context.renderer.keyInput.off("paste", onPaste)
    adapter.cleanup()
  })

  function modeLabel() {
    if (state.mode() === "visual") return "VISUAL"
    if (state.mode() === "visual-line") return "VISUAL LINE"
    return ""
  }
  const height = () => props.maxHeight ?? Math.max(1, Math.min(20, dimensions().height - 10))
  const editor = (
    <textarea
      id="vim-session-message"
      ref={(value: TextareaRenderable) => {
        output = value
        output.handleKeyPress = () => true
        output.handlePaste = () => {}
      }}
      initialValue={props.text}
      minHeight={1}
      maxHeight={height()}
      flexGrow={props.firstLine === undefined && !props.gutter ? undefined : 1}
      minWidth={0}
      wrapMode="word"
      showCursor
      cursorStyle={props.config.cursorStyles.normal}
      textColor={theme().text.base}
      backgroundColor={editorBackground()}
      focusedBackgroundColor={editorBackground()}
      focusedTextColor={theme().text.base}
    />
  )
  let body = editor
  if (props.firstLine !== undefined || props.gutter) {
    let lastLine = (props.firstLine ?? 1) + props.text.split("\n").length - 1
    for (const line of props.gutter?.lineNumbers?.values() ?? []) lastLine = Math.max(lastLine, line)
    const gutter = new LineNumberRenderable(context.renderer, {
      id: "vim-file-lines",
      lineNumberOffset: (props.firstLine ?? 1) - 1,
      minWidth: String(lastLine).length + 2,
      ...props.gutter,
    })
    gutter.add(output)
    createEffect(() => {
      gutter.fg = theme().text.muted
      gutter.bg = background()
      gutter.maxHeight = height()
      if (props.gutter?.lineColors) gutter.setLineColors(props.gutter.lineColors)
    })
    body = gutter as unknown as JSX.Element
  }
  function searchHint() {
    const current = searchInput()
    if (current) return `${current.prefix}${current.text}█`
    const note = searchNote()
    if (note) return note
    const info = searchInfo()
    if (info) return `${info.direction === 1 ? "/" : "?"}${info.pattern} [${info.index}/${info.total}] · n/N`
    return ""
  }
  return (
    <box id="vim-message-reader" gap={1}>
      <ReaderHeader context={context} title={props.title} back={props.back} />
      {props.change?.controls()}
      {props.details}
      <box
        paddingLeft={2}
        paddingRight={2}
        paddingTop={props.label ? 0 : 1}
        paddingBottom={props.label ? 0 : 1}
        backgroundColor={background()}
      >
        <Show when={props.label}>
          <box flexDirection="row" gap={2}>
            <text fg={theme().text.muted}>
              <b>{props.label}</b>
            </text>
            <Show when={props.status}>
              <text fg={theme().text.muted}>{props.status}</text>
            </Show>
          </box>
        </Show>
        {body}
      </box>
      <box paddingLeft={2} paddingRight={2} paddingBottom={1} flexDirection="row" flexWrap="wrap" columnGap={3}>
        <Show when={modeLabel()}>
          <text fg={theme().text.muted}>{modeLabel()}</text>
        </Show>
        <text fg={theme().text.muted}>
          {searchHint() ||
            props.notice() ||
            (state.mode() !== "normal"
              ? "y copy · Esc cancel"
              : `v select · / search${mappings.hint && props.switchLabel ? ` · ${mappings.hint} ${props.switchLabel}` : ""} · ${props.config.sessionKey} prompt`)}
        </text>
      </box>
    </box>
  )
}

export function ReaderHeader(props: Pick<ReaderProps, "context" | "back"> & { title: string }) {
  const theme = () => props.context.theme.surface("dialog")
  return (
    <box paddingLeft={2} paddingRight={2} flexDirection="row" gap={2}>
      <text fg={theme().text.base} flexGrow={1} flexShrink={1} minWidth={0} truncate>
        <b>{props.title}</b>
      </text>
      <text id="vim-message-close" fg={theme().text.muted} onMouseUp={props.back}>
        esc
      </text>
    </box>
  )
}
