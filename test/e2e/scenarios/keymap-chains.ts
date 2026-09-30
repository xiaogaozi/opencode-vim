import assert from "node:assert/strict"
import type { Fixture } from "../support/fixture"

export async function keymapChains({ terminal, request, sessionID, stream }: Fixture) {
    const { keys, screen } = terminal
    const prompt = "chain submit"
    const response = "chain response"
    const record = async () => (await request(`/api/session/${sessionID}`)).data.agent

    // Start from Plan so the chain's agent step has something to change.
    await keys("BTab")
    await screen("plan-agent", (text) => text.includes("Plan ·") && text.includes("NORMAL"))

    // One chord enters insert mode, inserts preset text, switches the agent, and sends.
    // A pinned agent goes through the session API, so the message carries it.
    await keys("C-g", "n")
    await screen("submitted", (text) => text.includes(prompt))
    await screen("answered", (text) => text.split(response).length >= 2)
    stream?.write("", true)
    assert.equal(await record(), "build", "a pinned agent chain sends with that agent")

    // A slash payload opens the host command completion, which owns submission
    // until it is closed; the chain must still send.
    await keys("Escape")
    await screen("back-to-normal", (text) => text.includes("NORMAL"))
    await keys("C-g", "s")
    await screen("slash-submitted", (text) => text.includes("/chain-slash") && text.split(response).length >= 3)
}
