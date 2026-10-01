/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { InputRenderable, KeyEvent, PasteEvent, RGBA, type CursorStyleOptions } from "@opentui/core"
import { createEffect, createSignal, onCleanup, untrack } from "solid-js"
import { applyVimCursorStyle, focusedInput } from "./modules/vim/actions"
import { createVimConfig } from "./modules/vim/config"
import { editInput } from "./modules/vim/edit"
import { keyNotation } from "./modules/vim/keys"
import { createVimLog } from "./modules/vim/log"
import { charToDisplay, displayToChar } from "./modules/vim/map"
import { createVimState } from "./modules/vim/state"
import { createVimeeAdapter } from "./modules/vim/vimee"
import { VimStatus } from "./modules/vim/status"
import { SESSION_MODE, createSessionMode } from "./session"
import { createVimClipboard } from "./clipboard"
import { createFormMode } from "./form"
import { createInputSourceController } from "./modules/vim/input-source"
import { createInlineController, inlineKeyFor, trimInlineText } from "./modules/vim/inline"

type Context = Parameters<Parameters<typeof Plugin.define>[0]["setup"]>[0]

export default Plugin.define({
  id: "opencode-vim",
  setup(context) {
    context.ui.slot({ append: "app", render: () => <VimHost context={context} /> })
  },
})

function VimHost(props: { context: Context }) {
  const config = createVimConfig(props.context.options)
  const normalMappings = Object.keys(config.keymaps.normal ?? {})
  const log = createVimLog(config)
  const clipboard = createVimClipboard(props.context.renderer)
  const clipboardOptions = { onYank: (text: string) => { void clipboard.write(text) }, readClipboard: clipboard.read }
  const state = createVimState(config.defaultMode, log)
  const vimee = createVimeeAdapter(state, config, log, clipboardOptions)
  const dialogState = createVimState(config.defaultMode, log)
  const dialogVimee = createVimeeAdapter(dialogState, config, log, clipboardOptions)
  const [dialogFocused, setDialogFocused] = createSignal(false)
  const promptVim = { state, vimee }
  const dialogVim = { state: dialogState, vimee: dialogVimee }
  let dialogInput: typeof props.context.renderer.currentFocusedEditor = null
  const [saved, setSaved] = props.context.storage.store("state", { initial: { enabled: true } })
  const enabled = () => saved.enabled
  const form = createFormMode(props.context, config, log, enabled)
  const ctx = createCompatContext(props.context, log)
  let cursorMode = ""
  let cursorColor: string | undefined
  let cursorInput: typeof props.context.renderer.currentFocusedEditor = null
  let originalCursorStyle: CursorStyleOptions | undefined
  const session = createSessionMode(props.context, config, clipboard)
  const inputSource = createInputSourceController(config.inputSource, {
    log,
    notify: (message) => props.context.ui.toast.show({ message, variant: "warning" }),
  })
  const inline = createInlineController(config.inline)
  let pendingKeys: Array<KeyEvent | PasteEvent> | undefined

  const removeStatus = props.context.ui.slot({
    prepend: "prompt.footer",
    render: (footer) =>
      footer.mode === "normal" ? session.active() && !dialogFocused() ? <session.Status /> : (
        <VimStatus
          mode={() => dialogFocused() ? dialogState.mode() : state.mode()}
          enabled={enabled}
          inline={inline.active}
          source={inputSource.source}
          inputSource={config.inputSource}
          theme={compatTheme(props.context)}
        />
      ) : null,
  })

  props.context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "opencode-vim.toggle",
        title: "Toggle Vim Mode",
        description: "Enable or disable Vim key handling",
        group: "Vim",
        palette: true,
        slash: { name: "vim" },
        run() {
          const next = !enabled()
          void setSaved((draft) => {
            draft.enabled = next
          })
          if (!next) {
            pendingKeys = undefined
            session.close()
            vimee.suspend()
            dialogVimee.suspend()
          }
          props.context.ui.toast.show({ message: `Vim mode ${next ? "enabled" : "disabled"}`, variant: "info" })
          props.context.renderer.requestRender()
        },
      },
    ],
  }))

  const onKey = (event: KeyEvent) => {
    if (!enabled() || event.defaultPrevented) return
    if (form.handle(event)) return
    if (pendingKeys) {
      pendingKeys.push(new KeyEvent(event))
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (props.context.keymap.mode.current() === SESSION_MODE) return
    const kind = inputKind(props.context)
    if (!kind) return
    if (props.context.keymap.pending().length) return
    const { state, vimee } = kind === "dialog" ? dialogVim : promptVim
    const key = keyNotation(event as never)
    if (!key) return
    const mapped = normalMappings.some((sequence) => sequence.startsWith(key))

    if (kind === "prompt") {
      const modified = event.shift || event.ctrl || event.option || event.meta || event.super
      // The prompt completion owns Enter while it is showing; let it select the
      // item instead of closing the inline region.
      const bypassEnter = key === "<CR>" && (modified || completionVisible())
      const action = inline.handleKey({
        key: inlineKeyFor(key, bypassEnter),
        mode: state.mode(),
        role: sourceRole(),
        cursor: cursorIndex(),
      })
      if (action) {
        if (action.consume) {
          event.preventDefault()
          event.stopPropagation()
        }
        if (action.kind === "enter") {
          inputSource.setSource("normal")
        } else {
          if (action.trimHead || action.trimTail) trimInlineSpaces(action.anchor, action.trimHead, action.trimTail)
          inputSource.setSource("other")
        }
        syncCursor(true)
        if (action.consume) return
      }
    }

    if (kind === "prompt" && key === config.sessionKey && !mapped && state.mode() === "normal" && !vimee.isPending()) {
      if (session.enter()) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
    }
    if (passThroughKey(event, key, state.mode(), vimee.isPending(), mapped)) return
    if (key === "<Esc>" && state.mode() === "normal" && !vimee.isPending()) return

    if (kind === "dialog" && !vimee.isPending() && !mapped && state.mode() === "normal") {
      if (key === "<Tab>" || key === "<Home>" || key === "<End>" || key === "<PageUp>" || key === "<PageDown>") return
      const command = key === "j" ? "dialog.select.next" : key === "k" ? "dialog.select.prev" : undefined
      if (command && props.context.keymap.commands().some((item) => item.id === command)) {
        event.preventDefault()
        event.stopPropagation()
        props.context.keymap.dispatch(command)
        return
      }
    }

    if (kind === "prompt" && !vimee.isPending() && sendCompletionKey(event, props.context, key, state.mode())) {
      syncCursor(true)
      return
    }

    const before = state.mode()
    let consumed = false
    try {
      const result = vimee.handle(event as never, key, ctx as never)
      if (typeof result === "boolean") consumed = result
      else {
        consumed = true
        const queued: Array<KeyEvent | PasteEvent> = []
        pendingKeys = queued
        const input = props.context.renderer.currentFocusedEditor
        void result.then((handled) => {
          if (pendingKeys !== queued) return
          pendingKeys = undefined
          if (!handled) return
          syncCursor(true)
          // Replay through the host too: a queued i may be followed by native typing.
          for (const event of queued) {
            if (!enabled() || props.context.renderer.currentFocusedEditor !== input) break
            if (event instanceof PasteEvent) props.context.renderer.keyInput.emit("paste", event)
            else props.context.renderer.keyInput.emit("keypress", event)
          }
        }).catch((error) => {
          if (pendingKeys === queued) pendingKeys = undefined
          log("vim.clipboard.paste.error", { error: String(error) })
        })
      }
    } finally {
      if (consumed || state.mode() !== before) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    if (consumed) syncCursor(true)
  }

  // Focus events can fire inside the host's prompt effects. Do not subscribe
  // those effects to Vim state or the keymap registry while syncing the editor.
  const onFocus = () => untrack(() => {
    pendingKeys = undefined
    vimee.suspend()
    dialogVimee.suspend()
    inputSource.setActive(enabled() && inputKind(props.context) !== undefined)
    syncCursor()
    form.focus()
  })
  const onPaste = (event: PasteEvent) => {
    if (event.defaultPrevented) return
    if (!pendingKeys) {
      form.paste(event)
      return
    }
    pendingKeys.push(new PasteEvent(event.bytes, event.metadata))
    event.preventDefault()
    event.stopPropagation()
  }
  props.context.renderer.keyInput.prependListener("keypress", onKey)
  props.context.renderer.keyInput.prependListener("paste", onPaste)
  props.context.renderer.on("focused_editor", onFocus)
  createEffect(() => syncCursor())
  createEffect(() => {
    if (!enabled()) {
      inputSource.setActive(false)
      inputSource.reset()
      inline.close()
      return
    }
    inputSource.setActive(inputKind(props.context) !== undefined)
    const mode = dialogFocused() ? dialogState.mode() : state.mode()
    if (mode !== "insert") inline.close()
    inputSource.sync(mode, readInsertContext())
  })
  let route = props.context.ui.router.current()
  createEffect(() => {
    const next = props.context.ui.router.current()
    if (next !== route && pendingKeys) onFocus()
    route = next
  })
  onCleanup(() => {
    pendingKeys = undefined
    removeStatus()
    session.close()
    inline.close()
    props.context.renderer.keyInput.off("keypress", onKey)
    props.context.renderer.keyInput.off("paste", onPaste)
    props.context.renderer.off("focused_editor", onFocus)
    vimee.cleanup()
    dialogVimee.cleanup()
    void clipboard.dispose()
    void inputSource.dispose()
    restoreCursor()
  })

  return null

  function syncCursor(force = false) {
    const input = props.context.renderer.currentFocusedEditor
    const kind = inputKind(props.context)
    setDialogFocused(kind === "dialog")
    if (!enabled() || !kind || !input) {
      restoreCursor()
      return
    }
    const { state, vimee } = kind === "dialog" ? dialogVim : promptVim
    if (kind === "dialog" && dialogInput !== input) {
      dialogInput = input
      dialogVimee.suspend()
      dialogState.setMode(promptVim.state.mode())
    }
    const mode = state.mode()
    vimee.attach(ctx)
    const inputChanged = cursorInput !== input
    if (inputChanged) {
      restoreCursor()
      cursorInput = input
      originalCursorStyle = input.cursorStyle
    }
    if (force || inputChanged || cursorMode !== mode) {
      if (applyVimCursorStyle(ctx as never, config.cursorStyles[mode])) {
        cursorMode = mode
        props.context.renderer.requestRender()
      }
    }
    syncCursorColor()
  }

  function restoreCursor() {
    if (cursorInput && !cursorInput.isDestroyed && originalCursorStyle) cursorInput.cursorStyle = originalCursorStyle
    cursorInput = null
    cursorMode = ""
    if (cursorColor !== undefined) {
      resetCursorColor(props.context.renderer)
      cursorColor = undefined
    }
  }

  function readInsertContext() {
    const input = props.context.renderer.currentFocusedEditor
    if (!input) return undefined
    const text = input.plainText ?? ""
    return { text, position: displayToChar(text, Math.max(0, input.cursorOffset ?? 0)) }
  }

  function sourceRole(): "normal" | "other" | undefined {
    const source = inputSource.source()
    if (source === undefined) return undefined
    return source === config.inputSource.normal ? "normal" : "other"
  }

  // The host exposes `prompt.autocomplete.hide` only while the prompt
  // completion is visible; Enter selects an item then.
  function completionVisible() {
    return props.context.keymap.commands().some((item) => item.id === "prompt.autocomplete.hide")
  }

  function trimInlineSpaces(anchor: number | undefined, trimHead: boolean, trimTail: boolean) {
    const input = props.context.renderer.currentFocusedEditor
    if (!input) return
    const before = input.plainText ?? ""
    const cursor = cursorIndex()
    const result = trimInlineText(before, cursor, anchor, trimHead, trimTail)
    if (result.text === before) return

    editInput(input, result.text, props.context.renderer.widthMethod)
    // editInput leaves the cursor at the edit point; keep it at its old
    // position relative to the end of the text instead.
    input.cursorOffset = charToDisplay(result.text, result.cursor, props.context.renderer.widthMethod)
  }

  function cursorIndex() {
    const input = props.context.renderer.currentFocusedEditor
    if (!input) return 0
    const text = input.plainText ?? ""
    return displayToChar(text, Math.max(0, input.cursorOffset ?? 0))
  }

  function syncCursorColor() {
    const colors = config.inputSource.cursorColors
    if (!config.inputSource.enabled || (!colors.english && !colors.other)) return

    const renderer = props.context.renderer as unknown as {
      setCursorColor?: (color: RGBA) => void
      writeOut?: (text: string) => void
    }
    if (typeof renderer.setCursorColor !== "function") return

    const source = inputSource.source()
    const next = source === undefined || source === config.inputSource.normal ? colors.english : colors.other
    if (next === cursorColor) return

    try {
      if (next !== undefined) renderer.setCursorColor(RGBA.fromHex(next))
      else resetCursorColor(renderer)
      cursorColor = next
    } catch (error) {
      log("cursor.color.error", { error: error instanceof Error ? error.message : String(error) })
    }
  }
}

function resetCursorColor(target: unknown) {
  const renderer = target as { writeOut?: (text: string) => void }
  if (typeof renderer.writeOut !== "function") return
  try {
    renderer.writeOut("\u001B]112\u0007")
    renderer.writeOut("\u001B]12;default\u0007")
  } catch {}
}

function createCompatContext(context: Context, log: ReturnType<typeof createVimLog>) {
  const prompt = {
    get current() {
      return { input: focusedInputValue(context), mode: "normal", parts: [] }
    },
    get focused() {
      return inputKind(context) !== undefined
    },
    set(value: { input: string }) {
      const input = context.renderer.currentFocusedEditor
      if (input instanceof InputRenderable) input.value = value.input
      else if (input) editInput(input, value.input, context.renderer.widthMethod)
    },
    submit() {
      if (inputKind(context) === "dialog") {
        const command = context.keymap.commands().some((item) => item.id === "dialog.select.submit")
          ? "dialog.select.submit"
          : "dialog.prompt.submit"
        context.keymap.dispatch(command)
        return
      }
      submitPrompt(context, log)
    },
    blur() {
      context.renderer.currentFocusedEditor?.blur()
    },
  }

  return {
    api: {
      renderer: context.renderer,
      keymap: {
        dispatchCommand(command: string) {
          const ok = context.keymap.commands().some((item) => item.id === command)
          if (ok) context.keymap.dispatch(command)
          return { ok }
        },
      },
      theme: { current: compatTheme(context) },
    },
    kind: context.ui.router.current().type === "session" ? "session" : "home",
    prompt: () => (inputKind(context) ? prompt : undefined),
    requestRender: () => context.renderer.requestRender(),
    switchAgent: (name: string) => switchAgent(context, name, log),
    sendPrompt: (agent: string | undefined) => sendPrompt(context, agent, log),
  }
}

/**
 * The prompt completion owns submission while it is showing: dispatching
 * `prompt.submit` is ignored in that mode, so close the completion and retry on
 * the next ticks until the prompt accepts the submit again.
 */
function submitPrompt(context: Context, log: ReturnType<typeof createVimLog>, attempt = 0) {
  const completing = context.keymap.commands().some((item) => item.id === "prompt.autocomplete.hide")
  if (!completing || attempt >= SUBMIT_RETRY_LIMIT) {
    context.keymap.dispatch("prompt.submit")
    return
  }
  if (attempt === 0) context.keymap.dispatch("prompt.autocomplete.hide")
  setTimeout(() => submitPrompt(context, log, attempt + 1), 0)
}

const SUBMIT_RETRY_LIMIT = 10

/**
 * Keymap `agent:` steps switch the session agent; the home screen has none yet.
 *
 * Prompts are submitted with the host's own client-side agent selection, so this
 * only records the switch; a chain that pinned an agent sends through the
 * session API instead (see `sendPrompt`).
 */
async function switchAgent(context: Context, name: string, log: ReturnType<typeof createVimLog>) {
  const route = context.ui.router.current()
  if (route.type !== "session") return false
  try {
    await context.client.session.switchAgent({ sessionID: route.sessionID, agent: name })
    return true
  } catch {
    return false
  }
}

/** Sends a chain's prompt to the session, like the host does for slash commands. */
async function sendPrompt(context: Context, agent: string | undefined, log: ReturnType<typeof createVimLog>) {
  const route = context.ui.router.current()
  if (route.type !== "session") return false
  if (inputKind(context) !== "prompt") return false
  const input = context.renderer.currentFocusedEditor
  const text = input?.plainText ?? focusedInputValue(context)
  if (!text.trim()) return false
  try {
    if (agent) await context.client.session.switchAgent({ sessionID: route.sessionID, agent })
    const slash = /^\/(\S+)\s*([\s\S]*)$/.exec(text)
    // Unknown slash text stays a prompt, matching the host's own submit path.
    if (slash && (await commandNames(context)).includes(slash[1])) {
      await context.client.session.command({ sessionID: route.sessionID, name: slash[1], text: slash[2] })
    } else {
      await context.client.session.prompt({ sessionID: route.sessionID, text })
    }
    clearPrompt(context, input)
    return true
  } catch (error) {
    log("vim.prompt.send.error", { error: error instanceof Error ? error.message : String(error), agent })
    return false
  }
}

async function commandNames(context: Context) {
  try {
    return ((await context.client.command.list()).data ?? []).map((item) => item.name)
  } catch {
    return []
  }
}

function clearPrompt(context: Context, input: Context["renderer"]["currentFocusedEditor"]) {
  context.keymap.dispatch("prompt.clear")
  if (!input || input.isDestroyed || input.plainText === "") return
  if (input instanceof InputRenderable) input.value = ""
  else editInput(input, "", context.renderer.widthMethod)
}

function inputKind(context: Context): "prompt" | "dialog" | undefined {
  if (context.keymap.mode.current() === SESSION_MODE) return
  if (!context.renderer.currentFocusedEditor) return
  const commands = context.keymap.commands()
  if (context.keymap.mode.current() === "modal") {
    if (commands.some((item) => item.id === "dialog.select.submit" || item.id === "dialog.prompt.submit")) return "dialog"
    return
  }
  if (commands.some(
    (item) =>
      item.id === "prompt.submit" || item.id === "prompt.autocomplete.next" || item.id === "prompt.history.previous",
  )) return "prompt"
}

function focusedInputValue(context: Context) {
  return context.renderer.currentFocusedEditor?.plainText ?? ""
}

function compatTheme(context: Context) {
  return {
    get background() { return context.theme.background.base },
    get info() { return context.theme.text.feedback.info.base },
    get success() { return context.theme.text.feedback.success.base },
    get warning() { return context.theme.text.feedback.warning.base },
    get textMuted() { return context.theme.text.muted },
  }
}

function passThroughKey(event: KeyEvent, key: string, mode: string, pending: boolean, mapped: boolean) {
  if (key === "<Tab>" && event.shift) return true
  if (mode !== "normal") return false
  if (mapped) return false
  if (event.ctrl && key !== "<C-r>" && key !== "<C-[>") return true
  return event.super === true || event.meta === true || (isArrowKey(key) && !pending)
}

function sendCompletionKey(event: KeyEvent, context: Context, key: string, mode: string) {
  if (mode !== "normal") return false
  const command = key === "j" ? "prompt.autocomplete.next" : key === "k" ? "prompt.autocomplete.prev" : undefined
  if (!command || !isCompletionToken(context) || !context.keymap.commands().some((item) => item.id === command)) return false
  event.preventDefault()
  event.stopPropagation()
  context.keymap.dispatch(command)
  return true
}

function isCompletionToken(context: Context) {
  const input = context.renderer.currentFocusedEditor
  const text = input?.plainText ?? ""
  const index = displayToChar(text, Math.max(0, input?.cursorOffset ?? 0))
  const before = text.slice(0, Math.min(index + 1, text.length))
  return /^\/\S*$/.test(before) || /(?:^|\s)@\S*$/.test(before)
}

function isArrowKey(key: string) {
  return key === "<Left>" || key === "<Down>" || key === "<Up>" || key === "<Right>"
}
