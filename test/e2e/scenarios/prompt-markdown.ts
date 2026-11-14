import { mkdir } from "node:fs/promises"
import { coloredRuns } from "../support/colors"
import type { Fixture } from "../support/fixture"

export async function promptMarkdown({ terminal, probe, workspace }: Fixture) {
  const { paste, type, keys, screen } = terminal
  await mkdir(`${workspace}/jfs-ee`, { recursive: true })
  await Bun.write(`${workspace}/jfs-ee/README.md`, "reference\n")
  const colors = (await probe()).colors
  await paste("# heading\n\n**bold** and `code`")
  await screen("prompt-markdown", (text, ansi) => {
    if (!text.includes("# heading") || !text.includes("**bold**")) return false
    const heading = coloredRuns(ansi, [colors.markdownHeading], "foreground")
    const strong = coloredRuns(ansi, [colors.markdownStrong], "foreground")
    return heading.some((run) => run.includes("heading")) && strong.some((run) => run.includes("bold"))
  })

  await type(" @jfs-ee")
  await screen("reference-autocomplete", (text) =>
    text.split("\n").some((line) => line.includes("jfs-ee") && !line.includes("@")),
  )
  await keys("Enter")
  await screen("reference-color", (text, ansi) => {
    if (!text.includes("@jfs-ee")) return false
    if (text.split("\n").some((line) => line.includes("jfs-ee") && !line.includes("@"))) return false
    return coloredRuns(ansi, [colors.reference], "foreground").some((run) => run.includes("jfs-ee"))
  })
}
