import assert from "node:assert/strict"
import type { Fixture } from "../support/fixture"

function replyStartVisible(text: string) {
  const lines = text.split("\n")
  const index = lines.findIndex((line) => line.includes("Reply line 0"))
  return index >= 0 && index <= 8 && !text.includes("Reply line 79")
}

export async function completionScrollBackground({ terminal, request, sessionID, stream, probe, workspace }: Fixture) {
  assert(stream)
  const { keys, type, screen, settle } = terminal
  await type("read the answer")
  await keys("Enter")
  await screen(
    "background-streaming",
    (text) => text.includes("Reply line 79") && !text.includes("Reply line 0"),
    15_000,
  )

  const other = (await request("/api/session", { title: "Other session", location: { directory: workspace } })).data
  await probe("route", { type: "session", sessionID: other.id })
  await screen("other-session", async () => (await probe()).route?.sessionID === other.id)

  // Finish the first reply while another session owns the TUI.
  stream.write("", true)
  await screen(
    "background-completed",
    async () => {
      const exported = await request(`/api/experimental/session/${sessionID}/export`)
      const assistant = exported.data.messages.filter((message: any) => message.type === "assistant").at(-1)
      return !!assistant?.time.completed
    },
    15_000,
  )

  await probe("route", { type: "session", sessionID })
  await screen("background-aligned", replyStartVisible, 15_000)
  await settle()

  // The host's saved scroll anchor should keep the aligned position after another round trip.
  await probe("route", { type: "session", sessionID: other.id })
  await screen("other-session-again", async () => (await probe()).route?.sessionID === other.id)
  await probe("route", { type: "session", sessionID })
  await screen("background-restored", replyStartVisible, 15_000)
}
