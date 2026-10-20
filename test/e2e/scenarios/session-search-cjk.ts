import type { Fixture } from "../support/fixture"
import { coloredRuns } from "../support/colors"

export async function sessionSearchCjk({ terminal, probe }: Fixture) {
  const { keys, type, screen } = terminal
  await keys("Escape")
  await type("s")
  await screen("search-cjk-session", (text) => text.includes("SESSION"))
  const state = await probe()
  const colors = [state.colors.search, state.colors.searchCurrent]
  await type("/搜索")
  await keys("Enter")
  await screen("search-cjk", (text, ansi) => {
    if (!text.includes("/搜索 [1/1")) return false
    const foreground = coloredRuns(ansi, colors, "foreground").filter((run) => run.trim() === "搜索")
    const background = coloredRuns(ansi, colors)
    return foreground.length === 1 && background.length === 0
  })
}
