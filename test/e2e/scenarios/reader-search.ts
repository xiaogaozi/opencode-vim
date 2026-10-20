import type { Fixture } from "../support/fixture"
import { readerContains } from "../support/screens"

export async function readerSearch({ terminal, probe }: Fixture) {
  const { keys, type, screen } = terminal
  await keys("Escape")
  await type("s")
  await screen("reader-search-session", (text) => text.includes("SESSION"))
  await keys("Enter")
  await screen("reader-search-opened", (text) => readerContains(text, "one two"))

  await type("/second")
  await keys("Enter")
  await screen("reader-search-found", (text) => text.includes("second line") && text.includes("/second [1/1]"))
  const found = await probe()
  if (!found.editor?.selected) throw new Error("reader search did not select the match")

  await type("n")
  await screen("reader-search-repeat", (text) => text.includes("second line") && text.includes("/second [1/1]"))

  await type("?one")
  await keys("Enter")
  await screen("reader-search-backward", (text) => text.includes("?one [1/1]"))
  const backward = await probe()
  if (!backward.editor?.selected) throw new Error("reader backward search did not select the match")

  await type("/")
  await keys("Escape")
  await screen("reader-search-cancel", (text) => !text.includes("/█") && text.includes("?one [1/1]"))

  await keys("Escape")
  await screen(
    "reader-search-cleared",
    (text) => readerContains(text, "one two") && text.includes("v select") && !text.includes("?one [1/1]"),
  )
  const cleared = await probe()
  if (cleared.editor?.selected) throw new Error("reader search selection survived Escape")

  await keys("Escape")
  await screen("reader-search-closed", (text) => text.includes("SESSION") && !text.includes("v select"))
}
