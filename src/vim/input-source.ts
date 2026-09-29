import { execFile } from "node:child_process"
import { createSignal } from "solid-js"
import type { Accessor } from "solid-js"
import type { VimInputSource } from "./config"
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

export type InputSourceController = {
    source: Accessor<string | undefined>
    sync: (mode: VimMode, context?: InsertContext) => void
    setActive: (active: boolean) => void
    reset: () => void
    settle: () => Promise<void>
    dispose: () => Promise<void>
}

export type InputSourceDeps = {
    log?: VimLog
    runner?: InputSourceRunner
    notify?: (message: string) => void
}

type Job = { kind: "normal"; force?: boolean } | { kind: "insert"; language: ContextLanguage | undefined }

const MISSING_HELPER_MESSAGE = "Input source helper not found. Install macism: brew tap laishulu/homebrew && brew install macism"

export function createInputSourceController(config: VimInputSource, deps: InputSourceDeps = {}): InputSourceController {
    const log = deps.log ?? (() => {})
    const patterns = {
        english: compilePattern(config.englishPattern, DEFAULT_ENGLISH_PATTERN),
        other: compilePattern(config.otherPattern, DEFAULT_OTHER_PATTERN),
        aggressiveLine: config.contextAggressiveLine,
    }
    const runner = config.enabled ? deps.runner ?? createRunner(config) : undefined
    const [source, setSource] = createSignal<string | undefined>(undefined)

    let lastMode: VimMode | undefined
    let lastOther: string | undefined
    let pending: Job | undefined
    let running: Promise<void> | undefined
    let initial: Promise<void> | undefined
    let pollTimer: ReturnType<typeof setInterval> | undefined
    let notified = false

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

    return { source, sync, setActive, reset, settle, dispose }

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
            const language = config.context && context ? detectContextLanguage(context.text, context.position, patterns) : undefined
            enqueue({ kind: "insert", language })
        } else {
            enqueue({ kind: "normal" })
        }
    }

    function setActive(active: boolean) {
        if (!config.enabled || !runner || config.pollInterval <= 0) return
        if (active === (pollTimer !== undefined)) return

        if (active) {
            pollTimer = setInterval(() => {
                void poll()
            }, config.pollInterval)
        } else {
            clearInterval(pollTimer)
            pollTimer = undefined
        }
    }

    function reset() {
        if (!config.enabled || !runner) return
        lastMode = "normal"
        setActive(false)
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

    async function apply(target: string, force = false) {
        if (!runner) return
        if (!force && source() === target) return

        try {
            await runner.set(target)
            setSource(target)
            if (target !== config.normal) lastOther = target
            log("input-source.set", { source: target })
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
        const current = await readCurrent()
        if (!current) return

        if (current !== source()) setSource(current)
        if (current !== config.normal) lastOther = current
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
    const base = config.command ? splitCommand(config.command) : undefined
    const getTokens = config.getCommand ? splitCommand(config.getCommand) : base ?? detectTokens()
    const setTokens = config.setCommand ? splitCommand(config.setCommand) : base ?? detectTokens()
    if (!getTokens?.length || !setTokens?.length) return undefined

    return {
        get: () => execFileText(getTokens),
        set: async (source) => {
            await execFileText(buildSetTokens(setTokens, source, config.waitMs))
        },
    }
}

function detectTokens(): string[] | undefined {
    const command = Bun.which("macism") ?? Bun.which("im-select")
    return command ? [command] : undefined
}

function buildSetTokens(tokens: string[], source: string, waitMs?: number) {
    let replaced = false
    const args = tokens.map((token) => {
        if (!token.includes("{source}")) return token
        replaced = true
        return token.replaceAll("{source}", source)
    })
    if (!replaced) args.push(source)
    if (waitMs !== undefined) args.push(String(waitMs))
    return args
}

function execFileText(tokens: string[]): Promise<string> {
    const [command, ...args] = tokens
    return new Promise((resolve, reject) => {
        execFile(command ?? "", args, { encoding: "utf8", timeout: 5000 }, (error, stdout) => {
            if (error) reject(error)
            else resolve(stdout)
        })
    })
}

export function splitCommand(input: string): string[] {
    const tokens: string[] = []
    let current = ""
    let started = false
    let quote: "'" | '"' | undefined

    for (const char of input) {
        if (quote) {
            if (char === quote) quote = undefined
            else current += char
            continue
        }
        if (char === "'" || char === '"') {
            quote = char
            started = true
            continue
        }
        if (/\s/.test(char)) {
            if (started || current) tokens.push(current)
            current = ""
            started = false
            continue
        }
        current += char
        started = true
    }

    if (started || current) tokens.push(current)
    return tokens
}

function isMissingCommand(error: unknown) {
    return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT"
}
