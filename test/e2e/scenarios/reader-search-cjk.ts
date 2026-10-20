import type { Fixture } from "../support/fixture"
import { coloredRuns } from "../support/colors"

export async function readerSearchCjk({ terminal, probe }: Fixture) {
  const { keys, type, screen } = terminal
  await keys("Escape")
  await type("s")
  await screen("reader-cjk-session", (text) => text.includes("SESSION"))
  await keys("Enter")
  await screen("reader-cjk-opened", (text) => text.includes("退出"))
  await type("/退出")
  await keys("Enter")
  await screen("reader-cjk-found", (text) => text.includes("/退出 [1/1]"))
  const state = await probe()
  const colors = [state.colors.searchCurrent]
  await screen("reader-cjk-colors", (_text, ansi) => {
    const runs = coloredRuns(ansi, colors, "foreground")
    return runs.some((run) => run.trim() === "退出")
  })
}
