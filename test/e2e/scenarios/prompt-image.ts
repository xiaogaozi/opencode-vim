import { coloredRuns } from "../support/colors"
import type { Fixture } from "../support/fixture"

const image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII="

export async function promptImagePlaceholder({ terminal, probe, workspace }: Fixture) {
  const colors = (await probe()).colors
  await Bun.write(`${workspace}/image-placeholder.png`, Buffer.from(image, "base64"))
  await terminal.paste(`${workspace}/image-placeholder.png`)
  await terminal.screen("image-placeholder", (screen) => screen.includes("[Image 1]"))
  await terminal.screen("image-placeholder-style", (_text, ansi) => {
    const links = coloredRuns(ansi, [colors.markdownLink], "foreground")
    return !links.some((run) => run === "[" || run === "]" || run.includes("Image"))
  })
}
