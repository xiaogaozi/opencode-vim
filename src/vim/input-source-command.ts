import { execFile } from "node:child_process"
import type { VimInputSource } from "./input-source-config"

export type InputSourceCommands = {
  getTokens: string[]
  setTokens: string[]
}

export function resolveCommands(config: VimInputSource): InputSourceCommands | undefined {
  const base = config.command ? splitCommand(config.command) : undefined
  const getTokens = config.getCommand ? splitCommand(config.getCommand) : (base ?? detectTokens())
  const setTokens = config.setCommand ? splitCommand(config.setCommand) : (base ?? detectTokens())
  if (!getTokens?.length || !setTokens?.length) return undefined
  return { getTokens, setTokens }
}

/** Run the helper's read command. The caller is responsible for trimming. */
export function readInputSource(tokens: string[]): Promise<string> {
  return execFileText(tokens)
}

export function buildSetTokens(tokens: string[], source: string, waitMs?: number) {
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

function detectTokens(): string[] | undefined {
  const command = Bun.which("macism") ?? Bun.which("im-select")
  return command ? [command] : undefined
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
