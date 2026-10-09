import assert from "node:assert/strict"
import type { Fixture } from "../support/fixture"

export async function keymapChains({ terminal, request, sessionID, stream }: Fixture) {
  const { keys, type, screen } = terminal
  const response = "chain response"
  const record = async () => (await request(`/api/session/${sessionID}`)).data.agent

  // Start from Plan so the chain's agent step has something to change. The
  // host's own Tab switch needs its agent catalog first, which is slow on CI.
  await request(`/api/session/${sessionID}/agent`, { agent: "plan" })
  assert.equal(await record(), "plan")

  // One chord enters insert mode, inserts preset text, pins the agent, and sends.
  await keys("C-g", "n")
  await screen("submitted", (text) => text.includes("chain submit"))
  await screen("answered", (text) => text.split(response).length >= 2)
  stream?.write("", true)
  assert.equal(await record(), "build", "a pinned agent chain sends with that agent")

  // A chain without a pinned agent sends the same way, even when the slash
  // payload opens the host command completion.
  await keys("Escape")
  await screen("back-to-normal", (text) => text.includes("NORMAL"))
  await keys("C-g", "s")
  await screen("slash-submitted", (text) => text.includes("/chain-slash") && text.split(response).length >= 3)
  stream?.write("", true)

  // A single submit mapping has to close the completion the host opens for
  // slash text: dispatching prompt.submit is ignored while it shows.
  await keys("Escape")
  await screen("normal-again", (text) => text.includes("NORMAL"))
  await type("i/hand-slash")
  await screen("completion-open", (text) => text.includes("/hand-slash"))
  await keys("C-s")
  await screen("hand-submitted", (text) => text.split(response).length >= 4)
}
