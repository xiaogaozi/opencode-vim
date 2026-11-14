import assert from "node:assert/strict"
import type { Fixture } from "../support/fixture"

export async function promptInput({ terminal }: Fixture) {
  const { keys, type, screen } = terminal
  // This scenario starts NORMAL, so the already-focused native prompt must be intercepted.
  await type("x")
  await screen("startup-intercepted", (text) => text.includes("NORMAL") && promptLine(text, terminal.cursor().y) === "")
  await type("ihello")
  await screen("native-insert", (text) => text.includes("hello") && text.includes("INSERT"))
  await type("kj")
  await screen("mapped-normal", (text) => text.includes("NORMAL") && text.includes("hello") && !text.includes("hellok"))
  await type("0")
  await keys("Tab")
  await screen("mapped-tab", (text) => text.includes("ello") && !text.includes("hello"))
  await type("u")
  await screen("mapped-tab-undone", (text) => text.includes("hello"))
  const cursor = terminal.cursor()
  await type("d")
  await screen("pending-operator", (text) => text.includes("NORMAL") && text.includes("hello"))
  await keys("Escape")
  assert.deepEqual(terminal.cursor(), cursor)
  // The host's leader sequence must survive even when its suffix is a Vim command.
  await keys("C-x", "l")
  await screen("host-leader-dialog", (text) => text.includes("Sessions") && text.includes("NORMAL"))
  await keys("Escape")
  await type("A restored")
  await screen("focus-restored", (text) => text.includes("hello restored") && text.includes("INSERT"))
}

export async function promptClipboard({ terminal }: Fixture) {
  const { keys, type, screen } = terminal
  await type("hello")
  await keys("Escape")
  await type("0ddp")
  await screen("rapid-cut-put", (text) => promptLine(text, terminal.cursor().y) === "hello" && text.includes("NORMAL"))
  assert.equal(terminal.clipboard(), "hello\n")
  await type("0xxp")
  await screen("ordered-cuts", (text) => promptLine(text, terminal.cursor().y) === "lelo")
  assert.equal(terminal.clipboard(), "e")

  await type("i")
  await keys("C-c")
  await type("A")
  await keys("Escape")
  await type("yiw")
  await screen("seed-register", () => terminal.clipboard() === "A")
  await type("i")
  await keys("C-c", "Escape")
  // Wait for the cancelled insert to settle before exercising the async queue.
  await screen("queued-input-ready", (text) => promptLine(text, terminal.cursor().y) === "")
  // One input batch exercises the plugin's async queue, including native paste.
  await type("ppiB\x1b[200~C\x1b[201~")
  await screen(
    "queued-native-input",
    (text) => promptLine(text, terminal.cursor().y) === "ABCA" && text.includes("INSERT"),
  )
  // OpenCode resolves pasted attachments asynchronously before inserting text.
  await keys("Escape")

  await type("i")
  await keys("C-c")
  await type("hello")
  await keys("Escape")
  await type('0"ayiw$"ap')
  await screen("named-register", (text) => promptLine(text, terminal.cursor().y) === "hellohello")
  assert.equal(terminal.clipboard(), "A")
  await type("p")
  await screen("unnamed-register", (text) => promptLine(text, terminal.cursor().y) === "hellohelloA")
  await type("0Q")
  await screen("mapped-yank-put", (text) => promptLine(text, terminal.cursor().y) === "hellohelloAhellohelloA")

  // A native dialog and the prompt use separate editors but share clipboard fallback.
  await type("i")
  await keys("C-c", "Escape", "C-p")
  await screen("clipboard-dialog", (text) => text.includes("Commands") && text.includes("NORMAL"))
  await type("iOpen settings")
  await keys("Escape")
  await type("0yiw")
  await screen("dialog-yank", () => terminal.clipboard() === "Open")
  await keys("Escape")
  await type("p")
  await screen(
    "dialog-to-prompt",
    (text) => !text.includes("Commands") && promptLine(text, terminal.cursor().y) === "Open",
  )
  await type("A shared")
  await keys("Escape")
  await type("0y$")
  await screen("prompt-yank", () => terminal.clipboard() === "Open shared")
  await keys("C-p")
  await screen("clipboard-dialog-again", (text) => text.includes("Commands") && text.includes("NORMAL"))
  await type("p")
  await screen("prompt-to-dialog", (text) => text.includes("Commands") && /^\s+Open shared\s*$/m.test(text))
}

export async function promptPaging(fixture: Fixture) {
  const { terminal, probe } = fixture
  const { keys, paste, screen, cursor } = terminal
  const text = Array.from({ length: 80 }, (_, index) => `line ${index + 1}`).join("\n")

  await keys("i")
  await paste(text)
  await screen("pasted", (screen) => screen.includes("line 80"))
  await keys("Escape", "gg")
  await screen("page-top", (screen) => lineNumber(promptLine(screen, cursor().y)) === 1)
  const top = await waitForEditor(probe, (editor) => editor?.scrollY === 0 && editor?.cursor === 0)

  await keys("C-f")
  await screen("page-down", (screen) => lineNumber(promptLine(screen, cursor().y)) > 1)
  const down = await waitForEditor(probe, (editor) => (editor?.scrollY ?? 0) > (top?.scrollY ?? 0))

  await keys("C-b")
  await screen("page-up", (screen) => screen.includes("line 1"))
  await waitForEditor(
    probe,
    (editor) => editor?.scrollY === 0 && (editor?.cursor ?? Number.MAX_SAFE_INTEGER) < (down?.cursor ?? 0),
  )

  await keys("PageDown")
  await waitForEditor(probe, (editor) => (editor?.scrollY ?? 0) > 0)
  await keys("PageUp")
  await waitForEditor(probe, (editor) => editor?.scrollY === 0)
}

async function waitForEditor(
  probe: Fixture["probe"],
  check: (editor: { scrollY?: number; cursor?: number } | null) => boolean,
) {
  const deadline = Date.now() + 5_000
  while (true) {
    const editor = (await probe()).editor
    if (check(editor)) return editor
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for editor state: ${JSON.stringify(editor)}`)
    await Bun.sleep(50)
  }
}

export async function promptVisualBlock({ terminal }: Fixture) {
  const { keys, paste, type, screen } = terminal

  await keys("i")
  await paste("abcd\nefgh\nijkl")
  await screen("pasted", (screen) => screen.includes("ijkl"))
  await keys("Escape", "gg")
  await screen("top", (screen) => screen.includes("abcd") && screen.includes("NORMAL"))

  await keys("C-v")
  await screen("visual-block", (screen) => screen.includes("VISUAL BLOCK"))
  await type("ljj")
  await type("y")
  await screen(
    "block-yank",
    (screen) => screen.includes("NORMAL") && !screen.includes("VISUAL BLOCK") && terminal.clipboard() === "ab\nef\nij",
  )

  await keys("C-v")
  await screen("visual-block-again", (screen) => screen.includes("VISUAL BLOCK"))
  await type("ljj")
  await type("d")
  await screen(
    "block-delete",
    (screen) =>
      screen.includes("NORMAL") &&
      !screen.includes("VISUAL BLOCK") &&
      screen.includes("cd") &&
      screen.includes("gh") &&
      screen.includes("kl"),
  )
}

export async function promptHistory(fixture: Fixture) {
  const { terminal } = fixture
  const { keys, type, screen } = terminal
  await seedHistory(fixture)
  const start = terminal.cursor()
  await type("k")
  await screen("history-older", (text) => promptLine(text, terminal.cursor().y) === "older 中中")
  await type("j")
  await screen("history-forward", (text) => promptLine(text, terminal.cursor().y) === "newer 文文")
  assert.equal(terminal.cursor().x, start.x + 10, "History forward restores display-width cursor offsets")
  await type("j")
  await screen("history-empty", (text) => promptLine(text, terminal.cursor().y) === "")
  await type("k")
  await screen("history-recalled", (text) => promptLine(text, terminal.cursor().y) === "newer 文文")
  // Movement alone must end history navigation. Edit only after the second k
  // so the edit cannot hide a missing reset, and wait for all keys to finish.
  await type("hkiX")
  await screen(
    "movement-ended-history",
    (text) => promptLine(text, terminal.cursor().y) === "Xnewer 文文" && text.includes("INSERT"),
  )
  await keys("Escape")
  await type("k")
  await screen(
    "edited-history-is-draft",
    (text) => promptLine(text, terminal.cursor().y) === "Xnewer 文文" && text.includes("NORMAL"),
  )
}

export async function promptCommandCursor(fixture: Fixture) {
  const { terminal } = fixture
  const { type, screen } = terminal
  await seedHistory(fixture)
  await type("k")
  await screen("history-older", (text) => promptLine(text, terminal.cursor().y) === "older 中中")
  // Q dispatches history-next. The adapter must retain the host's new cursor,
  // including the display width of Unicode text, instead of restoring its old one.
  await type("QiX")
  await screen(
    "mapped-command-retained-cursor",
    (text) => promptLine(text, terminal.cursor().y) === "newer 文文X" && text.includes("INSERT"),
  )
}

export async function promptHiddenMode({ terminal }: Fixture) {
  const { keys, type, screen } = terminal
  // With the label hidden, the configured cursor styles are the only mode cue.
  const hidden = (text: string, style: number) =>
    !text.includes("INSERT") && !text.includes("NORMAL") && cursorStyle(terminal) === style
  await type("hidden mode")
  await screen("hidden-insert", (text) => promptLine(text, terminal.cursor().y) === "hidden mode" && hidden(text, 4))
  await keys("Escape")
  await type("0x")
  await screen("hidden-normal", (text) => promptLine(text, terminal.cursor().y) === "idden mode" && hidden(text, 1))
  await type("i")
  await screen("hidden-insert-again", (text) => hidden(text, 4))
}

function cursorStyle(terminal: Fixture["terminal"]) {
  try {
    return terminal.cursorStyle()
  } catch {
    return undefined
  }
}

async function seedHistory({ terminal, stream }: Fixture) {
  assert(stream)
  const { keys, type, screen } = terminal
  for (const [index, value] of ["older 中中", "newer 文文"].entries()) {
    await type(value)
    await keys("Enter")
    await screen(`submitted-${index}`, (text) => text.split("history response").length === index + 2)
    stream.write("", true)
  }
  await keys("Escape")
  await type("k")
  await screen("history-newest", (text) => promptLine(text, terminal.cursor().y) === "newer 文文")
}

function promptLine(text: string, row: number) {
  return (text.split("\n")[row] ?? "").replace(/^\s*┃\s?/, "").trim()
}

function lineNumber(line: string) {
  return Number(/line (\d+)/.exec(line)?.[1] ?? 0)
}
