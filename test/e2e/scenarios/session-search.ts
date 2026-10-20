import type { Fixture } from "../support/fixture"
import { selected } from "../support/screens"

export async function sessionSearch({ terminal }: Fixture) {
  const { keys, type, screen } = terminal
  await keys("Escape")
  await type("s")
  await screen("search-session", (text) => text.includes("SESSION"))

  // Loading the whole history happens on the first search, so an entry from
  // the beginning of the session is reachable from the natural bottom.
  await type("?History entry 000")
  await keys("Enter")
  await screen(
    "search-oldest",
    (text) => text.includes("?History entry 000 [1/1") && selected(text, "History entry 000"),
    20_000,
  )

  await type("/History entry 00")
  await keys("Enter")
  await screen(
    "search-many",
    (text) => text.includes("/History entry 00 [1/10") && selected(text, "History entry 000"),
    20_000,
  )
  await type("n")
  await screen(
    "search-next",
    (text) => text.includes("/History entry 00 [2/10") && selected(text, "History entry 001"),
    20_000,
  )
  await type("N")
  await screen(
    "search-previous",
    (text) => text.includes("/History entry 00 [1/10") && selected(text, "History entry 000"),
    20_000,
  )

  await type("?History entry 00")
  await keys("Enter")
  await screen(
    "search-backward-wrap",
    (text) => text.includes("?History entry 00 [10/10") && selected(text, "History entry 009"),
    20_000,
  )

  await type("/")
  await keys("Escape")
  await screen("search-cancel-restores", (text) => !text.includes("/█") && text.includes("?History entry 00 [10/10"))

  await keys("Escape")
  await screen("search-cleared", (text) => text.includes("SESSION") && !text.includes("?History entry 00 [10/10"))
  await keys("Escape")
  await screen("search-closed", (text) => !text.includes("SESSION"))
}
