import assert from "node:assert/strict"
import type { Fixture } from "../support/fixture"

export async function keymapChains({ terminal, request, sessionID, stream }: Fixture) {
  const { keys, type, screen } = terminal
  const response = "chain response"
  const record = async () => (await request(`/api/session/${sessionID}`)).data.agent
  const messages = async () =>
    (await request(`/api/session/${sessionID}/message`)).data as Array<{
      type: string
      text?: string
      time?: { created?: number }
    }>
  const agentSwitches = async () => (await messages()).filter((message) => message.type === "agent-switched").length
  const lastUserText = async () =>
    (await messages())
      .filter((message) => message.type === "user")
      .sort((left, right) => (left.time?.created ?? 0) - (right.time?.created ?? 0))
      .at(-1)?.text

  // Start from Plan so the chain's agent step has something to change. The
  // host's own Tab switch needs its agent catalog first, which is slow on CI.
  await request(`/api/session/${sessionID}/agent`, { agent: "plan" })
  assert.equal(await record(), "plan")
  const switchesBefore = await agentSwitches()

  // One chord enters insert mode, inserts preset text, pins the agent, and sends.
  await keys("C-g", "n")
  await screen("submitted", (text) => text.includes("chain submit"))
  await screen("answered", (text) => text.split(response).length >= 2)
  stream?.write("", true)
  assert.equal(await record(), "build", "a pinned agent chain sends with that agent")

  // Registered slash text runs its command instead of being sent as text.
  await keys("Escape")
  await screen("back-to-normal", (text) => text.includes("NORMAL"))
  await keys("C-g", "s")
  await screen("slash-submitted", (text) => text.includes("command template ran") && text.split(response).length >= 3)
  stream?.write("", true)
  assert.equal(await lastUserText(), "command template ran", "a slash chain runs its command")

  // Unknown slash text stays a prompt, like the host's own submit path.
  await keys("Escape")
  await screen("normal-for-unknown", (text) => text.includes("NORMAL"))
  await keys("C-g", "x")
  await screen("unknown-submitted", (text) => text.split(response).length >= 4)
  stream?.write("", true)
  assert.equal(await lastUserText(), "/missing-slash", "unknown slash text is sent as a prompt")

  // Pinning an agent must not switch twice per chain (the submit step used to
  // re-switch), and a chain already on its agent must not switch at all.
  assert.equal(
    (await agentSwitches()) - switchesBefore,
    1,
    "three agent-pinned chains switch the agent only once overall",
  )

  // A single submit mapping has to close the completion the host opens for
  // slash text: dispatching prompt.submit is ignored while it shows.
  await keys("Escape")
  await screen("normal-again", (text) => text.includes("NORMAL"))
  await type("i/hand-slash")
  await screen("completion-open", (text) => text.includes("/hand-slash"))
  await keys("C-s")
  await screen("hand-submitted", (text) => text.split(response).length >= 5)
}
