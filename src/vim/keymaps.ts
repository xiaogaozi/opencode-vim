import {
  createKeybindMap,
  parseKeySequence,
  type KeybindDefinition,
  type KeybindMap,
  type ValidKeySequence,
  type VimAction,
} from "@vimee/core"
import type { VimConfig, VimMappedAction } from "./config"
import { keyToken } from "./keys"
import type { VimLog } from "./log"

type HostKeybindAction = "normal" | "submit" | "command" | "chain"
export type HostKeybindDefinition = KeybindDefinition & {
  hostAction?: HostKeybindAction
  command?: string
  steps?: readonly string[]
}

export function hasNormalKeyPrefix(config: VimConfig, key: string) {
  for (const sequence of Object.keys(config.keymaps.normal ?? {})) {
    try {
      if (keyToken(parseKeySequence(sequence)[0] ?? "") === key) return true
    } catch {}
  }
  return false
}

export function createKeybinds(config: VimConfig, log: VimLog): KeybindMap | undefined {
  const map = createKeybindMap()
  let count = 0

  for (const mode of ["insert", "normal", "visual", "visual-line"] as const) {
    const keymaps = config.keymaps[mode]
    if (!keymaps) continue
    for (const [keys, action] of Object.entries(keymaps)) {
      try {
        const tokens = parseKeySequence(keys)
        if (tokens.length > 1 && tokens[0] === "<CR>") throw new Error("<CR> cannot start a multi-key mapping")
        map.addKeybind(mode, keys as ValidKeySequence<typeof keys>, keybindAction(action))
        count++
      } catch (error) {
        log("vimee.keymap.invalid", {
          mode,
          keys,
          action,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  return count > 0 ? map : undefined
}

export function insertHostAction(definition: KeybindDefinition): HostKeybindAction | undefined {
  const action = (definition as HostKeybindDefinition).hostAction
  if (action) return action
  if ("execute" in definition) return undefined
  if (definition.keys === "<Esc>" || definition.keys === "<C-[>" || definition.keys === "Escape") return "normal"
  return undefined
}

export function mappedCommand(action: string): string | undefined {
  if (action.startsWith("command:")) {
    const command = action.slice(8).trim()
    if (!command) throw new Error("Command name is required")
    return command
  }
}

function keybindAction(action: VimMappedAction): HostKeybindDefinition {
  if (typeof action !== "string") return chainAction(action)
  const command = mappedCommand(action)
  if (command) {
    return {
      execute: () => [{ type: "command", command } as unknown as VimAction],
      hostAction: "command",
      command,
    }
  }
  switch (action) {
    case "normal":
      return { keys: "<Esc>", hostAction: "normal" }
    case "insert":
      return { keys: "i" }
    case "submit":
      return { execute: () => [{ type: "submit" } as unknown as VimAction], hostAction: "submit" }
    default:
      if (action.startsWith("agent:") || action.startsWith("text:")) return chainAction([action])
      return { keys: action }
  }
}

function chainAction(steps: readonly string[]): HostKeybindDefinition {
  if (steps.length === 0) throw new Error("Action chain must not be empty")
  for (const step of steps) validateChainStep(step)
  return { execute: () => [], hostAction: "chain", steps }
}

export function chainSteps(definition: KeybindDefinition): readonly string[] | undefined {
  return (definition as HostKeybindDefinition).steps
}

function validateChainStep(step: string) {
  if (step.startsWith("command:")) {
    if (!step.slice("command:".length).trim()) throw new Error("Command name is required")
    return
  }
  if (step.startsWith("agent:")) {
    if (!step.slice("agent:".length).trim()) throw new Error("Agent name is required")
    return
  }
  const sequence = chainSequence(step)
  if (sequence) parseKeySequence(sequence)
}

/** A chain step that is a Vim key sequence, or undefined for host actions. */
export function chainSequence(step: string): string | undefined {
  if (step === "normal" || step === "insert" || step === "submit") return undefined
  if (step.startsWith("command:") || step.startsWith("agent:") || step.startsWith("text:")) return undefined
  return step
}

export function sequenceNeedsClipboard(sequence: string) {
  try {
    return parseKeySequence(sequence).some((token) => ["p", "P", ".", "@"].includes(token))
  } catch {
    return false
  }
}
