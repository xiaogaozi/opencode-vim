import { createSignal } from "solid-js"
import type { Accessor } from "solid-js"
import type { VimInputSource } from "./input-source-config"
import { buildSetTokens, readInputSource, resolveCommands } from "./input-source-command"
export { splitCommand } from "./input-source-command"
import type { ContextLanguage } from "./context"
import { DEFAULT_ENGLISH_PATTERN, DEFAULT_OTHER_PATTERN, compilePattern, detectContextLanguage } from "./context"
import type { VimLog } from "./log"
import type { VimMode } from "./state"

export type InsertContext = {
  text: string
  position: number
}

export type InputSourceRunner = {
  get: () => Promise<string | undefined>
  set: (source: string) => Promise<void>
}

export type InputSourceRemote = {
  get: () => Promise<string | undefined>
  onChanged: (handler: (source: string) => void) => () => void
}

export type InputSourceController = {
  source: Accessor<string | undefined>
  sync: (mode: VimMode, context?: InsertContext) => void
  /** Switch directly to a language role, used by the inline English region. */
  setSource: (role: "normal" | "other") => void
  setActive: (active: boolean) => void
  reset: () => void
  settle: () => Promise<void>
  dispose: () => Promise<void>
}

export type InputSourceDeps = {
  log?: VimLog
  runner?: InputSourceRunner
  remote?: InputSourceRemote
  notify?: (message: string) => void
  /** Delay before verifying a CJK switch; 0 disables the check (tests). */
  confirmDelayMs?: number
}

type Job = { kind: "normal"; force?: boolean } | { kind: "insert"; language: ContextLanguage | undefined }

const MISSING_HELPER_MESSAGE =
  "Input source helper not found. Install macism: brew tap laishulu/homebrew && brew install macism"
const CONFIRM_DELAY_MS = 180

export function createInputSourceController(config: VimInputSource, deps: InputSourceDeps = {}): InputSourceController {
  const log = deps.log ?? (() => {})
  const patterns = {
    english: compilePattern(config.englishPattern, DEFAULT_ENGLISH_PATTERN),
    other: compilePattern(config.otherPattern, DEFAULT_OTHER_PATTERN),
    aggressiveLine: config.contextAggressiveLine,
  }
  const runner = config.enabled ? (deps.runner ?? createRunner(config)) : undefined
  const [source, setCurrent] = createSignal<string | undefined>(undefined)

  let lastMode: VimMode | undefined
  let lastOther: string | undefined
  let pending: Job | undefined
  let running: Promise<void> | undefined
  let initial: Promise<void> | undefined
  let pollTimer: ReturnType<typeof setInterval> | undefined
  let unsubscribeRemote: (() => void) | undefined
  let remoteDisabled = false
  let remoteToken = 0
  let confirmTimer: ReturnType<typeof setTimeout> | undefined
  let applyToken = 0
  let notified = false
  const confirmDelayMs = deps.confirmDelayMs ?? CONFIRM_DELAY_MS

  if (config.enabled && !runner) notifyOnce(MISSING_HELPER_MESSAGE)
  if (config.enabled && runner) {
    const task = poll()
    initial = task
    void task
      .catch(() => {})
      .finally(() => {
        if (initial === task) initial = undefined
      })
  }

  return { source, sync, setSource, setActive, reset, settle, dispose }

  function sync(mode: VimMode, context?: InsertContext) {
    if (!config.enabled || !runner) return

    const previous = lastMode
    lastMode = mode
    if (previous === undefined) {
      log("input-source.skip", { reason: "initial", mode })
      return
    }
    if (previous === mode) return

    if (mode === "insert") {
      let language =
        config.context && context ? detectContextLanguage(context.text, context.position, patterns) : undefined
      // A non-blank prompt without a clear language (ASCII punctuation,
      // digits) keeps English, matching emacs-smart-input-source's
      // inconclusive-context behavior. Only a blank prompt falls back to
      // the configured insert source.
      if (language === undefined && config.context && context && context.text.trim() !== "") {
        language = "english"
      }
      enqueue({ kind: "insert", language })
    } else {
      enqueue({ kind: "normal" })
    }
  }

  function setSource(role: "normal" | "other") {
    if (!config.enabled || !runner) return
    if (role === "normal") enqueue({ kind: "normal" })
    else enqueue({ kind: "insert", language: "other" })
  }

  function setActive(active: boolean) {
    if (!config.enabled || !runner || config.pollInterval <= 0) return

    if (deps.remote && !remoteDisabled) {
      if (active === (unsubscribeRemote !== undefined)) return
      if (active) {
        const token = ++remoteToken
        let off: (() => void) | undefined
        try {
          off = deps.remote.onChanged(onPolled)
        } catch (error) {
          fail("get", error)
          remoteDisabled = true
          startLocalPolling()
          return
        }
        unsubscribeRemote = off
        void deps.remote
          .get()
          .then((current) => {
            if (token !== remoteToken) return
            if (current) {
              onPolled(current)
              return
            }
            off?.()
            unsubscribeRemote = undefined
            remoteDisabled = true
            startLocalPolling()
          })
          .catch((error) => {
            if (token !== remoteToken) return
            fail("get", error)
            off?.()
            unsubscribeRemote = undefined
            remoteDisabled = true
            startLocalPolling()
          })
      } else {
        remoteToken++
        unsubscribeRemote?.()
        unsubscribeRemote = undefined
      }
      return
    }

    if (active === (pollTimer !== undefined)) return
    if (active) startLocalPolling()
    else stopLocalPolling()
  }

  function startLocalPolling() {
    if (pollTimer) return
    pollTimer = setInterval(() => {
      void poll()
    }, config.pollInterval)
  }

  function stopLocalPolling() {
    if (!pollTimer) return
    clearInterval(pollTimer)
    pollTimer = undefined
  }

  function reset() {
    if (!config.enabled || !runner) return
    lastMode = "normal"
    setActive(false)
    cancelConfirm()
    enqueue({ kind: "normal", force: true })
  }

  async function settle() {
    while (running || initial) {
      if (running) await running
      else if (initial) await initial
    }
  }

  async function dispose() {
    setActive(false)
    reset()
    await settle()
  }

  function enqueue(job: Job) {
    pending = job
    log("input-source.request", { kind: job.kind, language: job.kind === "insert" ? job.language : undefined })
    if (running) return

    const task = flush()
    running = task
    void task
      .catch(() => {})
      .finally(() => {
        if (running === task) running = undefined
      })
  }

  async function flush() {
    while (pending) {
      const job = pending
      pending = undefined

      if (job.kind === "normal") {
        const force = job.force === true ? true : await rememberCurrent()
        // A newer request arrived while reading the current source: skip
        // this switch instead of flashing the normal source.
        if (pending) continue
        await apply(config.normal, force)
      } else {
        await apply(insertTarget(job.language))
      }
    }
  }

  async function rememberCurrent(): Promise<boolean> {
    const current = await readCurrent()
    if (!current || current === config.normal) return false
    lastOther = current
    log("input-source.remember", { source: current })
    return true
  }

  function insertTarget(language: ContextLanguage | undefined) {
    if (language === "english") return config.normal
    return config.insert ?? lastOther ?? config.normal
  }

  async function apply(target: string, force = false, confirmable = true) {
    if (!runner) return
    if (!force && source() === target) return

    const token = ++applyToken
    cancelConfirm()

    try {
      await runner.set(target)
      setCurrent(target)
      if (target !== config.normal) lastOther = target
      log("input-source.set", { source: target })
      if (confirmable && target !== config.normal && confirmDelayMs > 0) scheduleConfirm(target, token)
    } catch (error) {
      fail("set", error)
    }
  }

  async function readCurrent(): Promise<string | undefined> {
    if (!runner) return undefined

    try {
      const value = await runner.get()
      const trimmed = value?.trim()
      return trimmed ? trimmed : undefined
    } catch (error) {
      fail("get", error)
      return undefined
    }
  }

  async function poll() {
    if (deps.remote && !remoteDisabled) {
      try {
        const current = await deps.remote.get()
        if (current) {
          onPolled(current)
          return
        }
        remoteDisabled = true
      } catch (error) {
        fail("get", error)
        remoteDisabled = true
      }
    }

    const current = await readCurrent()
    if (current) onPolled(current)
  }

  function onPolled(current: string) {
    if (current !== source()) setCurrent(current)
    if (current !== config.normal) lastOther = current
  }

  function cancelConfirm() {
    if (!confirmTimer) return
    clearTimeout(confirmTimer)
    confirmTimer = undefined
  }

  function scheduleConfirm(target: string, token: number) {
    confirmTimer = setTimeout(() => {
      confirmTimer = undefined
      void confirmSwitch(target, token)
    }, confirmDelayMs)
  }

  // macOS can drop a CJK switch after the system-wide commit: the menu bar and
  // TIS report the target while the focused app still types latin, and it can
  // also restore the previous source right after the switch (the same focus
  // quirk macism's workaround targets). Re-apply once in both cases; macism's
  // focused-app path re-requests the switch and can make it stick.
  async function confirmSwitch(target: string, token: number) {
    if (token !== applyToken || lastMode !== "insert") return

    const current = await readCurrent()
    if (token !== applyToken || lastMode !== "insert") return
    if (!current || (current !== target && current !== config.normal)) return

    log("input-source.confirm", { result: current === target ? "reapply" : "reverted", target })
    await apply(target, true, false)
  }

  function fail(action: string, error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    log("input-source.error", { action, error: message })
    if (isMissingCommand(error)) notifyOnce(MISSING_HELPER_MESSAGE)
  }

  function notifyOnce(message: string) {
    if (notified) return
    notified = true
    deps.notify?.(message)
  }
}

function createRunner(config: VimInputSource): InputSourceRunner | undefined {
  const commands = resolveCommands(config)
  if (!commands) return undefined

  return {
    get: () => readInputSource(commands.getTokens),
    set: async (source) => {
      await readInputSource(buildSetTokens(commands.setTokens, source, config.waitMs))
    },
  }
}

function isMissingCommand(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT"
}
