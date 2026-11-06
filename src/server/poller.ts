import type { VimInputSource } from "../vim/input-source-config"
import { readInputSource, resolveCommands } from "../vim/input-source-command"

export type InputSourcePoller = {
  /** Cached current input source. Never starts a process while polling is active. */
  read: () => Promise<string | undefined>
  subscribe: (listener: (source: string) => void) => () => void
  release: () => void
}

export type InputSourcePollerDeps = {
  /** Test seam; defaults to running the configured helper command. */
  read?: (tokens: string[]) => Promise<string>
}

type State = {
  /** Reference token -> requested poll interval in ms. A value of 0 means "read on demand". */
  refs: Map<object, number>
  tokens: string[]
  interval: number
  timer?: ReturnType<typeof setInterval>
  value?: string
  fetchedAt: number
  inflight?: Promise<string | undefined>
  listeners: Set<(source: string) => void>
  read: (tokens: string[]) => Promise<string>
}

const REGISTRY_KEY = "__opencodeVimInputSourcePollers__"
const globals = globalThis as typeof globalThis & {
  [REGISTRY_KEY]?: Map<string, State>
}
const pollers = (globals[REGISTRY_KEY] ??= new Map<string, State>())

const ON_DEMAND_CACHE_TTL_MS = 200

export function acquireInputSourcePoller(
  config: VimInputSource,
  deps: InputSourcePollerDeps = {},
): InputSourcePoller | undefined {
  const commands = resolveCommands(config)
  if (!commands) return undefined

  const key = commands.getTokens.join("\u0000")
  let state = pollers.get(key)
  if (!state) {
    state = {
      refs: new Map(),
      tokens: commands.getTokens,
      interval: 0,
      fetchedAt: 0,
      listeners: new Set(),
      read: deps.read ?? readInputSource,
    }
    pollers.set(key, state)
  }

  const current = state
  const ref = {}
  current.refs.set(ref, config.pollInterval)
  recomputeInterval(current)

  return {
    read: () => read(current),
    subscribe: (listener) => {
      current.listeners.add(listener)
      return () => current.listeners.delete(listener)
    },
    release: () => {
      current.refs.delete(ref)
      if (current.refs.size === 0) {
        stopTimer(current)
        pollers.delete(key)
        return
      }
      recomputeInterval(current)
    },
  }
}

function recomputeInterval(state: State) {
  const intervals = [...state.refs.values()].filter((value) => value > 0)
  const next = intervals.length > 0 ? Math.min(...intervals) : 0
  if (next === state.interval) {
    startTimer(state)
    return
  }
  state.interval = next
  stopTimer(state)
  startTimer(state)
}

function startTimer(state: State) {
  if (state.timer || state.interval <= 0) return
  const timer = setInterval(() => {
    void fetchInputSource(state)
  }, state.interval)
  ;(timer as unknown as { unref?: () => void }).unref?.()
  state.timer = timer
}

function stopTimer(state: State) {
  if (!state.timer) return
  clearInterval(state.timer)
  state.timer = undefined
}

async function read(state: State): Promise<string | undefined> {
  if (state.value !== undefined && (state.interval > 0 || Date.now() - state.fetchedAt < ON_DEMAND_CACHE_TTL_MS)) {
    return state.value
  }
  return fetchInputSource(state)
}

async function fetchInputSource(state: State): Promise<string | undefined> {
  if (state.inflight) return state.inflight

  const task = Promise.resolve()
    .then(() => state.read(state.tokens))
    .then((raw) => {
      const value = raw.trim()
      if (!value) return state.value

      const previous = state.value
      state.value = value
      state.fetchedAt = Date.now()
      if (value !== previous) {
        for (const listener of state.listeners) listener(value)
      }
      return value
    })
    .catch(() => state.value)

  state.inflight = task
  void task.finally(() => {
    if (state.inflight === task) state.inflight = undefined
  })
  return task
}
