import assert from "node:assert/strict"
import type { Fixture } from "../support/fixture"

export async function completionScroll({ terminal, stream }: Fixture) {
  assert(stream)
  const { keys, type, screen } = terminal
  await type("read the answer")
  await keys("Enter")
  await screen("reply-streaming", (text) => text.includes("Reply line 79") && !text.includes("Reply line 0"), 15_000)
  stream.write("", true)
  await screen(
    "reply-start",
    (text) => {
      const lines = text.split("\n")
      const index = lines.findIndex((line) => line.includes("Reply line 0"))
      return index >= 0 && index <= 8 && !text.includes("Reply line 79")
    },
    15_000,
  )
}
