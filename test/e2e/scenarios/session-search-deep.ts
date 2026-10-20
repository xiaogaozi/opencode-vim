import type { Fixture } from "../support/fixture"
import type { Message } from "../support/fixture"

export function deepSearchMessages(): Message[] {
  return Array.from({ length: 240 }, (_, index) => ({
    id: `msg_deep_${String(index).padStart(3, "0")}`,
    type: "user" as const,
    text:
      index === 200 ? `Entry ${String(index).padStart(3, "0")} 中文 target` : `Entry ${String(index).padStart(3, "0")}`,
    time: { created: index + 1 },
  }))
}

export async function sessionSearchDeep({ terminal }: Fixture) {
  const { keys, type, screen } = terminal
  await keys("Escape")
  await type("s")
  await screen("deep-session", (text) => text.includes("SESSION"))
  await type("?中文")
  await keys("Enter")
  let firstFound = false
  await screen(
    "deep-first",
    (text) => {
      if (text.includes("?中文 [1/1")) {
        firstFound = true
        return true
      }
      return text.includes("Pattern not found: 中文")
    },
    20_000,
  )
  if (!firstFound) throw new Error("deep backward search did not find a match after loading all history")
  await type("G")
  await screen("deep-bottom", (text) => text.includes("Entry 239"))
  await type("?中文")
  await keys("Enter")
  let secondFound = false
  await screen(
    "deep-second",
    (text) => {
      if (text.includes("?中文 [1/1")) {
        secondFound = true
        return true
      }
      return text.includes("Pattern not found: 中文")
    },
    20_000,
  )
  if (!secondFound) throw new Error("deep backward search did not find a match after returning to the bottom")
}
