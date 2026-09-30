import { describe, expect, test } from "bun:test"
import type { KeyEvent } from "@opentui/core"
import type { PromptContext } from "../../src/modules/vim/actions"
import { createVimConfig } from "../../src/modules/vim/config"
import type { VimLog } from "../../src/modules/vim/log"
import { displayToChar, displayWidth } from "../../src/modules/vim/map"
import { createVimState, type VimMode } from "../../src/modules/vim/state"
import { createVimeeAdapter } from "../../src/modules/vim/vimee"

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
        const fixture = createFixture("normal", ["agent:build", "text:go", "submit"], "", () => {}, "Q", () => true)

        const result = fixture.handle()
        if (result instanceof Promise) await result

        expect(fixture.events).toEqual(["agent:build", "submit"])
        expect(fixture.input.plainText).toBe("go")
    })

    test("sends a pinned agent through the host session API", async () => {
        const fixture = createFixture("normal", ["agent:build", "text:go", "submit"], "", () => {}, "Q", () => true, (agent: string | undefined) => {
            fixture.events.push(`send:${agent}`)
            return true
        })

        const result = fixture.handle()
        if (result instanceof Promise) await result

        expect(fixture.events).toEqual(["agent:build", "send:build"])
        expect(fixture.submissions).toHaveLength(0)
    })

    test("aborts a synchronous chain when the agent switch fails", async () => {
        const fixture = createFixture("normal", ["agent:build", "submit"], "", () => {}, "Q", () => false)

        const result = fixture.handle()
        if (result instanceof Promise) await result

        expect(fixture.agents).toEqual(["build"])
        expect(fixture.submissions).toHaveLength(0)
        expect(fixture.events).toEqual(["agent:build"])
    })

    test("aborts an asynchronous chain when the agent switch fails", async () => {
        const fixture = createFixture("normal", ["agent:build", "text:go", "submit"], "", () => {}, "Q", async () => false)

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

function createFixture(mode: VimMode, action: string | readonly string[] | undefined, text = "text", log: VimLog = () => {}, mappedKey = "Q", switchAgent?: (name: string) => boolean | Promise<boolean>, sendPrompt?: (agent: string | undefined) => boolean | Promise<boolean>) {
    const input: {
        plainText: string
        cursorOffset: number
        visualCursor: { visualRow: number; visualCol: number; offset: number }
        moveCursorLeft: () => boolean
        insertText?: (value: string) => void
    } = {
        plainText: text,
        cursorOffset: 0,
        visualCursor: { visualRow: 0, visualCol: 0, offset: 0 },
        moveCursorLeft: () => false,
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
    const prompt = {
        get current() { return { input: input.plainText, mode: "normal", parts: [] } },
        set(value: { input: string }) { input.plainText = value.input },
        submit() {
            submissions.push(true)
            events.push("submit")
        },
        blur() {},
    }
    const fixture = {
        input,
        commands,
        submissions,
        agents,
        events,
        state: createVimState(mode),
        handle(key = mappedKey, ctrl = false) {
            return adapter.handle({ name: key, ctrl } as KeyEvent, ctrl ? `<C-${key}>` : key, ctx)
        },
    }
    const ctx = {
        api: {
            renderer: { currentFocusedRenderable: input },
            keymap: {
                dispatchCommand(command: string) {
                    commands.push(command)
                    events.push(`command:${command}`)
                    return { ok: true as const }
                },
            },
        },
        prompt: () => prompt,
        requestRender() {},
        switchAgent: switchAgent && ((name: string) => {
            agents.push(name)
            events.push(`agent:${name}`)
            return switchAgent(name)
        }),
        sendPrompt,
    } as unknown as PromptContext
    const config = createVimConfig({
        defaultMode: mode,
        keymaps: action ? { [mode]: { [mappedKey]: action } } : undefined,
    })
    const adapter = createVimeeAdapter(fixture.state, config, log)
    return fixture
}
