/** @jsxImportSource @opentui/solid */
import type { Context } from "@opencode/plugin/tui/context"
import { BoxRenderable, type KeyEvent, type PasteEvent } from "@opentui/core"
import { createEffect, createSignal, onCleanup, onMount, untrack } from "solid-js"
import type { VimConfig } from "../vim/config"
import { keyNotation } from "../vim/keys"
import { YANK_FLASH_MS } from "../vim/vimee"
import { Reader } from "../readers"
import { createSessionKeymaps, pageCommand, sessionModeKey } from "./session-keys"
import { createTranscriptSelection, type TranscriptSearch } from "../transcript"
import type { TranscriptItem } from "../transcript-items"
import type { VimClipboard } from "../clipboard"
import { appendSearchText, backspaceSearchText, deleteWordSearchText, type SearchDirection } from "./search"

export const SESSION_MODE = "opencode-vim.session"

type SearchInput = {
  direction: SearchDirection
  prefix: "/" | "?"
  text: string
}

type SearchInfo = TranscriptSearch & { status: "found" }

export function createSessionMode(context: Context, config: VimConfig, clipboard: VimClipboard) {
  const mappings = createSessionKeymaps(config, false)
  const [active, setActive] = createSignal(false)
  const [reading, setReading] = createSignal<TranscriptItem>()
  const [notice, setNotice] = createSignal("")
  const [searchInput, setSearchInput] = createSignal<SearchInput>()
  const [searchBusy, setSearchBusy] = createSignal(false)
  const [searchInfo, setSearchInfo] = createSignal<SearchInfo>()
  const positions = new Map<string, number>()
  let sessionID = ""
  let selectedID: string | undefined
  let prompt: Context["renderer"]["currentFocusedEditor"] = null
  let focusTarget: BoxRenderable | undefined
  let transcript: ReturnType<typeof createTranscriptSelection> | undefined
  let popMode: (() => void) | undefined
  let prefix = ""
  let count = ""
  let disposed = false
  let noticeTimer: ReturnType<typeof setTimeout> | undefined
  let yankTimer: ReturnType<typeof setTimeout> | undefined
  let yankID: string | undefined
  let searchAbort: AbortController | undefined
  let lastPattern = ""
  let lastDirection: SearchDirection = 1

  context.keymap.layer(() => ({
    mode: SESSION_MODE,
    bindings: ["agent.cycle", "agent.cycle.reverse"],
  }))

  function selected() {
    return transcript?.get(selectedID)
  }

  function clearYankFlash() {
    if (yankTimer) clearTimeout(yankTimer)
    yankTimer = undefined
    if (!yankID) return
    yankID = undefined
    context.renderer.requestRender()
  }

  function searchNotice(message: string) {
    if (noticeTimer) clearTimeout(noticeTimer)
    noticeTimer = undefined
    setNotice(message)
  }

  function resetSearch() {
    searchAbort?.abort()
    searchAbort = undefined
    lastPattern = ""
    lastDirection = 1
    setSearchBusy(false)
    setSearchInput(undefined)
    setSearchInfo(undefined)
  }

  function beginSearch(direction: SearchDirection) {
    prefix = count = ""
    mappings.cancel()
    clearYankFlash()
    setNotice("")
    setSearchInput({ direction, prefix: direction === 1 ? "/" : "?", text: "" })
  }

  function handleSearchKey(event: KeyEvent, key: string) {
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
      void runSearch(current.text || lastPattern, current.direction)
      return
    }
    let text = current.text
    if (key === "<BS>") text = backspaceSearchText(text)
    else if (key === "<C-u>") text = ""
    else if (key === "<C-w>") text = deleteWordSearchText(text)
    else text = appendSearchText(text, key)
    setSearchInput({ ...current, text })
  }

  function handleBusyKey(event: KeyEvent, key: string) {
    event.preventDefault()
    event.stopPropagation()
    if (key !== "<Esc>" && key !== "<C-[>") return
    searchAbort?.abort()
    searchAbort = undefined
    setSearchBusy(false)
    setSearchInput(undefined)
    searchNotice("Search cancelled")
  }

  async function runSearch(pattern: string, direction: SearchDirection) {
    if (!pattern) {
      searchNotice("No previous search")
      return
    }
    searchAbort?.abort()
    const controller = new AbortController()
    searchAbort = controller
    lastPattern = pattern
    lastDirection = direction
    setSearchInfo(undefined)
    setNotice("")
    setSearchBusy(true)
    try {
      const outcome = await transcript?.search(pattern, direction, controller.signal)
      if (disposed || controller.signal.aborted || !outcome || outcome.status === "cancelled") return
      if (outcome.status === "not-found") {
        searchNotice(`Pattern not found: ${pattern}`)
        return
      }
      setSearchInfo(outcome as SearchInfo)
    } finally {
      if (searchAbort === controller) {
        searchAbort = undefined
        setSearchBusy(false)
      }
    }
  }

  async function repeatSearch(direction: SearchDirection, count: number) {
    if (!lastPattern) {
      searchNotice("No previous search")
      return
    }
    const outcome = await transcript?.next(direction, count)
    if (!outcome) return
    if (outcome.status === "not-found") {
      setSearchInfo(undefined)
      searchNotice(`Pattern not found: ${lastPattern}`)
      return
    }
    setNotice("")
    setSearchInfo({ ...outcome, direction: lastDirection } as SearchInfo)
  }

  function close(restoreFocus = true) {
    if (!active()) return
    searchAbort?.abort()
    searchAbort = undefined
    setSearchBusy(false)
    setSearchInput(undefined)
    setSearchInfo(undefined)
    clearYankFlash()
    transcript?.clearSearch()
    if (reading()) context.ui.dialog.clear()
    setActive(false)
    context.renderer.removePostProcessFn(draw)
    popMode?.()
    popMode = undefined
    focusTarget?.destroy()
    focusTarget = undefined
    transcript = undefined
    const route = context.ui.router.current()
    if (
      restoreFocus &&
      context.keymap.mode.current() === "base" &&
      route.type === "session" &&
      route.sessionID === sessionID &&
      prompt &&
      !prompt.isDestroyed
    )
      prompt.focus()
    prompt = null
    context.renderer.requestRender()
  }

  function enter() {
    const route = context.ui.router.current()
    if (route.type !== "session") return false
    sessionID = route.sessionID
    prompt = context.renderer.currentFocusedEditor
    prefix = count = ""
    positions.clear()
    resetSearch()
    setNotice("")
    popMode = context.keymap.mode.push(SESSION_MODE)
    transcript = createTranscriptSelection(context, sessionID, (id) => {
      selectedID = id
    })
    setActive(true)
    prompt?.blur()
    // Dialogs remember their previous focus, even after they close. Own that
    // target so destroying it on exit prevents a later refocus from stealing input.
    focusTarget = new BoxRenderable(context.renderer, {
      id: "vim-session-focus",
      position: "absolute",
      width: 0,
      height: 0,
      focusable: true,
    })
    context.renderer.root.add(focusTarget)
    focusTarget.focus()
    transcript.latest()
    context.renderer.addPostProcessFn(draw)
    context.renderer.requestRender()
    return true
  }

  const draw: Parameters<Context["renderer"]["addPostProcessFn"]>[0] = (buffer) => {
    if (active() && !reading() && context.keymap.mode.current() === SESSION_MODE) transcript?.draw(buffer, yankID)
  }

  async function copy(text: string) {
    const copied = await clipboard.write(text)
    if (disposed) return
    if (noticeTimer) clearTimeout(noticeTimer)
    setNotice(copied ? "Copied" : "Yanked · clipboard unavailable")
    noticeTimer = setTimeout(() => setNotice(""), 1500)
  }

  function openMessage(message: TranscriptItem) {
    focusTarget?.focus()
    setReading(message)
    context.ui.dialog.show(
      () => (
        <Reader
          context={context}
          config={config}
          sessionID={sessionID}
          message={message}
          offset={positions.get(message.id) ?? 0}
          copy={copy}
          notice={notice}
          remember={(offset) => positions.set(message.id, offset)}
          back={() => context.ui.dialog.clear()}
          close={close}
        />
      ),
      () => {
        setReading(undefined)
        setNotice("")
      },
    )
  }

  const onKey = (event: KeyEvent) => {
    if (!active() || reading() || event.defaultPrevented) return
    const key = keyNotation(event)
    if (!key) return
    if (searchBusy()) {
      handleBusyKey(event, key)
      return
    }
    if (searchInput()) {
      handleSearchKey(event, key)
      return
    }
    if ((key === "<Esc>" || key === "<C-[>") && searchInfo()) {
      event.preventDefault()
      event.stopPropagation()
      prefix = count = ""
      clearYankFlash()
      transcript?.dismissSearch()
      setSearchInfo(undefined)
      setNotice("")
      return
    }
    if (event.super || event.meta) return
    if (key === "/" || key === "?") {
      event.preventDefault()
      event.stopPropagation()
      beginSearch(key === "/" ? 1 : -1)
      return
    }
    const sessionKey = sessionModeKey(context, event, config.sessionKey, SESSION_MODE, mappings.accepts)
    if (!sessionKey) return
    if (mappings.resolve(sessionKey) === "passthrough") return
    event.preventDefault()
    event.stopPropagation()
    clearYankFlash()
    setNotice("")
    if (sessionKey === config.sessionKey || sessionKey === "<Esc>" || sessionKey === "<C-[>") {
      close()
      return
    }
    if (/^[0-9]$/.test(sessionKey) && (count || sessionKey !== "0")) {
      count = (count + sessionKey).slice(0, 6)
      return
    }
    const amount = Number(count) || 1
    count = ""
    const previous = prefix
    prefix = ""
    let command = pageCommand(sessionKey)
    if (sessionKey === "n" || sessionKey === "N") {
      void repeatSearch(sessionKey === "n" ? lastDirection : lastDirection === 1 ? -1 : 1, amount)
      return
    } else if (sessionKey === "j" || sessionKey === "<Down>") {
      transcript?.move("next", amount)
      return
    } else if (sessionKey === "k" || sessionKey === "<Up>") {
      transcript?.move("previous", amount)
      return
    } else if (sessionKey === "G") {
      transcript?.latest()
      return
    } else if (sessionKey === "g" && previous === "g") command = "session.first"
    else if (sessionKey === "y" && previous === "y") {
      const message = selected()
      if (message) {
        yankID = message.id
        yankTimer = setTimeout(clearYankFlash, YANK_FLASH_MS)
        context.renderer.requestRender()
        void copy(message.text)
      }
    } else if (sessionKey === "g" || sessionKey === "y") prefix = sessionKey
    else if (sessionKey === "<CR>") {
      transcript?.sync()
      if (transcript?.toggle()) return
      const message = selected()
      if (message) openMessage(message)
    }
    if (command) {
      transcript?.followViewport()
      for (let index = 0; index < amount; index++) context.keymap.dispatch(command)
    }
  }

  const onPaste = (event: PasteEvent) => {
    if (!active() || reading() || searchBusy()) return
    const current = searchInput()
    if (!current) return
    const text = new TextDecoder().decode(event.bytes).replace(/\s+/g, " ")
    if (!text) return
    event.preventDefault()
    event.stopPropagation()
    setSearchInput({ ...current, text: (current.text + text).slice(0, 200) })
  }

  createEffect(() => {
    const route = context.ui.router.current()
    if (active() && (route.type !== "session" || route.sessionID !== sessionID)) untrack(close)
  })
  const onFocus = () =>
    untrack(() => {
      const focused = context.renderer.currentFocusedRenderable
      // Dialog disposal briefly focuses the saved prompt before restoring our
      // target. Both belong to the session pane, so neither is a pane switch.
      if (
        active() &&
        !reading() &&
        context.keymap.mode.current() === SESSION_MODE &&
        focused &&
        focused !== focusTarget &&
        focused !== prompt
      )
        close(false)
    })
  onMount(() => {
    context.renderer.keyInput.prependListener("keypress", onKey)
    context.renderer.keyInput.prependListener("paste", onPaste)
    context.renderer.on("focused_renderable", onFocus)
  })
  onCleanup(() => {
    disposed = true
    close()
    if (noticeTimer) clearTimeout(noticeTimer)
    context.renderer.keyInput.off("keypress", onKey)
    context.renderer.keyInput.off("paste", onPaste)
    context.renderer.off("focused_renderable", onFocus)
  })

  function searchHint() {
    const input = searchInput()
    if (input) return `${input.prefix}${input.text}█`
    if (searchBusy()) return "Loading history… · Esc cancel"
    const info = searchInfo()
    if (!info) return ""
    const partial = info.partial ? "+" : ""
    return `${info.direction === 1 ? "/" : "?"}${info.pattern} [${info.index}/${info.total}${partial}] · n/N next`
  }

  return {
    active,
    enter,
    close,
    Status() {
      return (
        <text fg={context.theme.text.feedback.info.base} flexShrink={0} wrapMode="none">
          {searchHint() || notice() || `SESSION · Enter open · / search · yy copy · ${config.sessionKey} prompt`}
        </text>
      )
    },
  }
}
