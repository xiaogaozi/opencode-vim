import { coloredRuns } from "../support/colors"
import type { Fixture } from "../support/fixture"

export async function promptPastePlaceholder({ terminal, probe }: Fixture) {
  const colors = (await probe()).colors
  const text = Array.from({ length: 21 }, (_, index) => `line ${index + 1}`).join("\n")
  await terminal.paste(text)
  await terminal.screen("paste-placeholder", (screen) => screen.includes("[Pasted ~21 lines]"))
  await terminal.screen("paste-placeholder-style", (_text, ansi) => {
    const links = coloredRuns(ansi, [colors.markdownLink], "foreground")
    return !links.some((run) => run === "[" || run === "]" || run.includes("Pasted"))
  })
}
