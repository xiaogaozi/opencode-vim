import { coloredRuns } from "../support/colors"
import type { Fixture } from "../support/fixture"

export async function promptMarkdown({ terminal, probe }: Fixture) {
  const { paste, screen } = terminal
  const colors = (await probe()).colors
  await paste("# heading\n\n**bold** and `code`")
  await screen("prompt-markdown", (text, ansi) => {
    if (!text.includes("# heading") || !text.includes("**bold**")) return false
    const heading = coloredRuns(ansi, [colors.markdownHeading], "foreground")
    const strong = coloredRuns(ansi, [colors.markdownStrong], "foreground")
    return heading.some((run) => run.includes("heading")) && strong.some((run) => run.includes("bold"))
  })
}
