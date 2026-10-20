import type { Fixture } from "../support/fixture"
import { coloredRuns } from "../support/colors"

export async function sessionSearchUnicode({ terminal, probe }: Fixture) {
  const { keys, type, screen } = terminal
  await keys("Escape")
  await type("s")
  await screen("search-unicode-session", (text) => text.includes("SESSION"))
  const state = await probe()
  const colors = [state.colors.search, state.colors.searchCurrent]
  await type("/session")
  await keys("Enter")
  await screen(
    "search-unicode",
    (text, ansi) => text.includes("/session [3/3") && coloredRuns(ansi, colors).join("|") === "session|session|session",
  )
}
