import { describe, expect, test } from "bun:test"
import { RGBA, type KeyEvent } from "@opentui/core"
import type { EditorContext } from "../../src/vim/editor"
import { createVimConfig, type VimOptions } from "../../src/vim/config"
import type { VimLog } from "../../src/vim/log"
import { createVimState, type VimMode } from "../../src/vim/state"
import { displayToChar, displayWidth } from "../../src/vim/map"
import { createVimeeAdapter } from "../../src/vim/vimee"

describe("vim command keymaps", () => {
  test("dispatches commands in insert mode", () => {
    const fixture = createFixture("insert", "command:test.run")

    expect(fixture.handle()).toBe(true)
    expect(fixture.commands).toEqual(["test.run"])
  })

  test("rejects an empty command name", () => {
    const logs: Array<[string, unknown]> = []
    createFixture("normal", "command:   ", "", (event, data) => logs.push([event, data]))

    expect(logs.some(([event]) => event === "vimee.keymap.invalid")).toBe(true)
  })
})

describe("vim enter keymaps", () => {
  test("submits unmapped Enter in normal mode without moving the cursor", () => {
    const fixture = createFixture("normal", undefined, "中")
    fixture.input.cursorOffset = 2

    expect(fixture.handle("<CR>")).toBe(true)
    expect(fixture.submissions).toHaveLength(1)
    expect(fixture.input.cursorOffset).toBe(2)
  })

  test("passes unmapped Enter through in insert mode", () => {
    const fixture = createFixture("insert", undefined)

    expect(fixture.handle("<CR>")).toBe(false)
    expect(fixture.submissions).toHaveLength(0)
  })

  test("does not submit a matched mapping with no immediate actions", () => {
    const fixture = createFixture("normal", "d", "text", () => {}, "<CR>")

    expect(fixture.handle("<CR>")).toBe(true)
    expect(fixture.submissions).toHaveLength(0)
  })

  test("runs an Enter command mapping", () => {
    const fixture = createFixture("normal", "command:test.run", "", () => {}, "<CR>")

    expect(fixture.handle("<CR>")).toBe(true)
    expect(fixture.commands).toEqual(["test.run"])
    expect(fixture.submissions).toHaveLength(0)
  })

  test("applies mode and submit mappings", () => {
    const normal = createFixture("normal", "insert", "", () => {}, "<CR>")
    const insert = createFixture("insert", "submit", "", () => {}, "<CR>")

    expect(normal.handle("<CR>")).toBe(true)
    expect(normal.handle("a")).toBe(false)
    expect(insert.handle("<CR>")).toBe(true)
    expect(insert.submissions).toHaveLength(1)
  })

  test("allows Enter to finish a multi-key mapping", () => {
    const fixture = createFixture("normal", "command:test.run", "", () => {}, "g<CR>")

    expect(fixture.handle("g")).toBe(true)
    expect(fixture.handle("<CR>")).toBe(true)
    expect(fixture.commands).toEqual(["test.run"])
    expect(fixture.submissions).toHaveLength(0)
  })

  test("rejects mappings that defer Enter", () => {
    const logs: Array<[string, unknown]> = []
    const fixture = createFixture("normal", "command:test.run", "", (event, data) => logs.push([event, data]), "<CR>x")

    expect(fixture.handle("<CR>")).toBe(true)
    expect(fixture.submissions).toHaveLength(1)
    expect(logs.some(([event]) => event === "vimee.keymap.invalid")).toBe(true)
  })
})

describe("vim prompt history", () => {
  test("keeps normal movement for a nonempty prompt", () => {
    const fixture = createFixture("normal", undefined, "text")

    expect(fixture.handle("k")).toBe(true)
    expect(fixture.handle("j")).toBe(true)
    expect(fixture.commands).toEqual([])
  })

  test("prefers configured keymaps", () => {
    const fixture = createFixture("normal", "command:test.run", "", () => {}, "k")

    expect(fixture.handle()).toBe(true)
    expect(fixture.commands).toEqual(["test.run"])
  })

  test("completes a pending keymap before history navigation", () => {
    const fixture = createFixture("normal", "command:test.run", "", () => {}, "gk")

    expect(fixture.handle("g")).toBe(true)
    expect(fixture.handle("k")).toBe(true)
    expect(fixture.commands).toEqual(["test.run"])
  })
})

describe("vim which-key pending keybinds", () => {
  test("tracks and clears a pending normal-mode prefix", () => {
    const fixture = createFixture("normal", "insert", "", () => {}, "<C-g>n")

    expect(fixture.handle("g", true)).toBe(true)
    expect(fixture.pendingKeybind()).toEqual({ mode: "normal", tokens: ["<C-g>"] })
    expect(fixture.handle("n")).toBe(true)
    expect(fixture.pendingKeybind()).toBeUndefined()
    expect(fixture.state.mode()).toBe("insert")
  })

  test("tracks an insert-mode prefix", () => {
    const fixture = createFixture("insert", "normal", "", () => {}, "kj")

    expect(fixture.handle("k")).toBe(true)
    expect(fixture.pendingKeybind()).toEqual({ mode: "insert", tokens: ["k"] })
    expect(fixture.handle("j")).toBe(true)
    expect(fixture.pendingKeybind()).toBeUndefined()
    expect(fixture.state.mode()).toBe("normal")
  })

  test("holds the prefix past keymapTimeout when which-key is enabled", async () => {
    const fixture = createFixture("normal", "insert", "", () => {}, "<C-g>n", undefined, undefined, {
      whichKey: { enabled: true },
      keymapTimeout: 10,
    })

    expect(fixture.handle("g", true)).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(fixture.pendingKeybind()).toEqual({ mode: "normal", tokens: ["<C-g>"] })
    expect(fixture.handle("n")).toBe(true)
    expect(fixture.state.mode()).toBe("insert")
  })

  test("keeps the keymapTimeout when which-key is disabled", async () => {
    const fixture = createFixture("normal", "insert", "", () => {}, "<C-g>n", undefined, undefined, {
      keymapTimeout: 10,
    })

    expect(fixture.handle("g", true)).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(fixture.pendingKeybind()).toBeUndefined()
  })

  test("falls through an unmatched key after a held insert prefix", () => {
    const fixture = createFixture("insert", "normal", "abc", () => {}, "kj", undefined, undefined, {
      whichKey: { enabled: true },
    })

    expect(fixture.handle("k")).toBe(true)
    expect(fixture.handle("z")).toBe(false)
    expect(fixture.input.plainText).toBe("kabc")
    expect(fixture.pendingKeybind()).toBeUndefined()
  })

  test("executes a selected mapping by its full sequence", () => {
    const fixture = createFixture("normal", ["insert", "text:go", "submit"], "", () => {}, "<C-g>n")

    expect(fixture.handle("g", true)).toBe(true)
    expect(fixture.execute("<C-g>n")).toBe(true)
    expect(fixture.pendingKeybind()).toBeUndefined()
    expect(fixture.input.plainText).toBe("go")
    expect(fixture.submissions).toHaveLength(1)
    expect(fixture.state.mode()).toBe("insert")
  })

  test("discards a held insert prefix instead of inserting it", () => {
    const fixture = createFixture("insert", "normal", "abc", () => {}, "kj")

    expect(fixture.handle("k")).toBe(true)
    expect(fixture.execute("kj")).toBe(true)
    expect(fixture.input.plainText).toBe("abc")
    expect(fixture.state.mode()).toBe("normal")
  })

  test("rejects a sequence that is not configured", () => {
    const fixture = createFixture("normal", "insert")

    expect(fixture.execute("zz")).toBe(false)
  })
})

describe("vim keymap action chains", () => {
  test("runs mode, text, and submit steps in order", () => {
    const fixture = createFixture("normal", ["insert", "text:你好 world", "submit"], "")

    expect(fixture.handle()).toBe(true)
    expect(fixture.input.plainText).toBe("你好 world")
    expect(fixture.state.mode()).toBe("insert")
    expect(fixture.events).toEqual(["submit"])
  })

  test("inserts literal text without leaving normal mode", () => {
    const fixture = createFixture("normal", ["text:继续"], "")

    expect(fixture.handle()).toBe(true)
    expect(fixture.input.plainText).toBe("继续")
    expect(fixture.state.mode()).toBe("normal")
    expect(fixture.submissions).toHaveLength(0)
  })

  test("falls back to replacing the prompt when the editor has no insertText", () => {
    const fixture = createFixture("normal", ["text:继续"], "prefix ")
    fixture.input.cursorOffset = displayWidth("prefix ")
    delete fixture.input.insertText

    expect(fixture.handle()).toBe(true)
    expect(fixture.input.plainText).toBe("prefix 继续")
  })

  test("runs vim key sequences inside a chain", () => {
    const fixture = createFixture("normal", ["text:hello world", "0", "dw"], "")

    expect(fixture.handle()).toBe(true)
    expect(fixture.input.plainText).toBe("world")
  })

  test("switches the agent before submitting", async () => {
    const fixture = createFixture(
      "normal",
      ["agent:build", "text:go", "submit"],
      "",
      () => {},
      "Q",
      () => true,
    )

    const result = fixture.handle()
    if (result instanceof Promise) await result

    expect(fixture.events).toEqual(["agent:build", "submit"])
    expect(fixture.input.plainText).toBe("go")
  })

  test("sends a pinned agent through the host session API", async () => {
    const sends: Array<{ agent: string | undefined; agentSwitched: boolean | undefined }> = []
    const fixture = createFixture(
      "normal",
      ["agent:build", "text:go", "submit"],
      "",
      () => {},
      "Q",
      () => true,
      (agent, options) => {
        sends.push({ agent, agentSwitched: options?.agentSwitched })
        return true
      },
    )

    const result = fixture.handle()
    if (result instanceof Promise) await result

    expect(sends).toEqual([{ agent: "build", agentSwitched: true }])
    expect(fixture.events).toEqual(["agent:build"])
    expect(fixture.submissions).toHaveLength(0)
  })

  test("aborts a synchronous chain when the agent switch fails", async () => {
    const fixture = createFixture(
      "normal",
      ["agent:build", "submit"],
      "",
      () => {},
      "Q",
      () => false,
    )

    const result = fixture.handle()
    if (result instanceof Promise) await result

    expect(fixture.agents).toEqual(["build"])
    expect(fixture.submissions).toHaveLength(0)
    expect(fixture.events).toEqual(["agent:build"])
  })

  test("aborts an asynchronous chain when the agent switch fails", async () => {
    const fixture = createFixture(
      "normal",
      ["agent:build", "text:go", "submit"],
      "",
      () => {},
      "Q",
      async () => false,
    )

    const result = fixture.handle()
    expect(result).toBeInstanceOf(Promise)
    if (result instanceof Promise) await result

    expect(fixture.input.plainText).toBe("")
    expect(fixture.submissions).toHaveLength(0)
  })

  test("aborts when the host has no agent switching", () => {
    const fixture = createFixture("normal", ["agent:build", "text:go", "submit"])

    expect(fixture.handle()).toBe(true)
    expect(fixture.input.plainText).toBe("text")
    expect(fixture.submissions).toHaveLength(0)
  })

  test("runs chains from insert mode", () => {
    const fixture = createFixture("insert", ["text:片段", "submit"], "")

    expect(fixture.handle()).toBe(true)
    expect(fixture.input.plainText).toBe("片段")
    expect(fixture.submissions).toHaveLength(1)
  })

  test("matches multi-key triggers", () => {
    const fixture = createFixture("normal", ["insert", "text:ok", "submit"], "", () => {}, "<C-g>n")

    expect(fixture.handle("g", true)).toBe(true)
    expect(fixture.handle("n")).toBe(true)
    expect(fixture.input.plainText).toBe("ok")
    expect(fixture.submissions).toHaveLength(1)
  })

  test("rejects an invalid chain step", () => {
    const logs: Array<[string, unknown]> = []
    const fixture = createFixture("normal", ["insert", "<Bogus>"], "", (event, data) => logs.push([event, data]))

    expect(logs.some(([event]) => event === "vimee.keymap.invalid")).toBe(true)
    expect(fixture.handle()).toBe(true)
    expect(fixture.input.plainText).toBe("")
  })

  test("keeps single-step actions working", () => {
    const fixture = createFixture("normal", "insert")

    expect(fixture.handle()).toBe(true)
    expect(fixture.state.mode()).toBe("insert")
  })
})

describe("vim keymap configuration", () => {
  test("keeps action chains", () => {
    const config = createVimConfig({ keymaps: { normal: { Q: ["insert", "text:hi", "submit"] } } })

    expect(config.keymaps.normal?.Q).toEqual(["insert", "text:hi", "submit"])
  })

  test("drops empty steps and malformed actions", () => {
    const config = createVimConfig({ keymaps: { normal: { Q: ["insert", "", 5], W: [], X: 5 } } })

    expect(config.keymaps.normal?.Q).toEqual(["insert"])
    expect(config.keymaps.normal?.W).toBeUndefined()
    expect(config.keymaps.normal?.X).toBeUndefined()
  })
})

function createFixture(
  mode: VimMode,
  action: string | readonly string[] | undefined,
  text = "text",
  log: VimLog = () => {},
  mappedKey = "Q",
  switchAgent?: (name: string) => boolean | Promise<boolean>,
  sendPrompt?: (agent: string | undefined, options?: { agentSwitched?: boolean }) => boolean | Promise<boolean>,
  options: VimOptions = {},
) {
  const input: {
    plainText: string
    cursorOffset: number
    visualCursor: { visualCol: number }
    insertText?: (value: string) => void
  } = {
    plainText: text,
    cursorOffset: 0,
    visualCursor: { visualCol: 0 },
    insertText(value: string) {
      const offset = displayToChar(input.plainText, input.cursorOffset)
      input.plainText = input.plainText.slice(0, offset) + value + input.plainText.slice(offset)
      input.cursorOffset = displayWidth(input.plainText.slice(0, offset + value.length))
    },
  }
  const commands: string[] = []
  const submissions: true[] = []
  const agents: string[] = []
  const events: string[] = []
  const fixture = {
    input,
    commands,
    submissions,
    agents,
    events,
    state: createVimState(mode),
    pendingKeybind: () => adapter.pendingKeybind(),
    execute: (sequence: string) => adapter.executeKeybind(sequence, ctx),
    handle(key = mappedKey, ctrl = false) {
      return adapter.handle({ name: key, ctrl } as KeyEvent, ctrl ? `<C-${key}>` : key, ctx)
    },
  }
  const ctx: EditorContext = {
    input: () => input,
    widthMethod: "unicode",
    colors: { selection: RGBA.fromHex("#ffff00"), yank: RGBA.fromHex("#00ffff"), background: RGBA.fromHex("#000000") },
    setText(value) {
      input.plainText = value
    },
    submit() {
      submissions.push(true)
      events.push("submit")
    },
    blur() {},
    dispatchCommand(command) {
      commands.push(command)
      events.push(`command:${command}`)
      return { ok: true }
    },
    requestRender() {},
    switchAgent:
      switchAgent &&
      ((name: string) => {
        agents.push(name)
        events.push(`agent:${name}`)
        return switchAgent(name)
      }),
    sendPrompt,
  }
  const config = createVimConfig({
    defaultMode: mode,
    keymaps: action ? { [mode]: { [mappedKey]: action } } : undefined,
    ...options,
  })
  const adapter = createVimeeAdapter(fixture.state, config, log)
  return fixture
}
