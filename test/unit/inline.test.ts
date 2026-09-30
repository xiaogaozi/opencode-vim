import { describe, expect, test } from "bun:test"
import type { VimInline } from "../../src/modules/vim/inline"
import { createInlineController, trimInlineText } from "../../src/modules/vim/inline"

function testConfig(overrides: Partial<VimInline> = {}): VimInline {
    return {
        enabled: true,
        timeoutMs: 50,
        enterCloses: true,
        ...overrides,
    }
}

const space = (cursor = 3) => ({ key: "<Space>", mode: "insert" as const, role: "other" as const, cursor })
const enter = { key: "<CR>", mode: "insert" as const, role: "other" as const, cursor: 6 }

describe("inline English region", () => {
    test("enters the region on a single space from the other source", () => {
        const inline = createInlineController(testConfig())
        expect(inline.handleKey(space(4))).toEqual({ kind: "enter", consume: false, trimHead: false, trimTail: false })
        expect(inline.active()).toBe(true)
    })

    test("does not enter from the normal source", () => {
        const inline = createInlineController(testConfig())
        expect(inline.handleKey({ ...space(4), role: "normal" as const })).toBeUndefined()
        expect(inline.handleKey({ ...space(4), role: undefined })).toBeUndefined()
        expect(inline.active()).toBe(false)
    })

    test("leaves the region on a double space with the head anchor", () => {
        const inline = createInlineController(testConfig())
        inline.handleKey(space(4))
        expect(inline.handleKey(space(5))).toBeUndefined()
        expect(inline.handleKey(space(6))).toEqual({ kind: "exit", consume: true, trimHead: true, trimTail: false, anchor: 4 })
        expect(inline.active()).toBe(false)
    })

    test("a slow second space does not close the region", async () => {
        const inline = createInlineController(testConfig({ timeoutMs: 20 }))
        inline.handleKey(space(4))
        inline.handleKey(space(5))
        await Bun.sleep(40)
        expect(inline.handleKey(space(6))).toBeUndefined()
        expect(inline.active()).toBe(true)
    })

    test("closes the region on Enter and trims both spaces", () => {
        const inline = createInlineController(testConfig())
        inline.handleKey(space(4))
        expect(inline.handleKey(enter)).toEqual({ kind: "exit", consume: true, trimHead: true, trimTail: true, anchor: 4 })
        expect(inline.active()).toBe(false)
    })

    test("lets Enter through when enterCloses is disabled", () => {
        const inline = createInlineController(testConfig({ enterCloses: false }))
        inline.handleKey(space(4))
        expect(inline.handleKey(enter)).toEqual({ kind: "exit", consume: false, trimHead: false, trimTail: false, anchor: 4 })
        expect(inline.active()).toBe(false)
    })

    test("ignores Enter outside the region", () => {
        const inline = createInlineController(testConfig())
        expect(inline.handleKey(enter)).toBeUndefined()
        expect(inline.active()).toBe(false)
    })

    test("closes the region when the mode leaves insert", () => {
        const inline = createInlineController(testConfig())
        inline.handleKey(space(4))
        expect(inline.active()).toBe(true)

        expect(inline.handleKey({ key: "a", mode: "normal", role: "other", cursor: 4 })).toBeUndefined()
        expect(inline.active()).toBe(false)
    })

    test("non-space keys reset the double-space streak", () => {
        const inline = createInlineController(testConfig())
        inline.handleKey(space(4))
        inline.handleKey(space(5))
        inline.handleKey({ key: "a", mode: "insert", role: "other", cursor: 6 })
        expect(inline.handleKey(space(7))).toBeUndefined()
        expect(inline.active()).toBe(true)
    })

    test("stays inert when disabled", () => {
        const inline = createInlineController(testConfig({ enabled: false }))
        expect(inline.handleKey(space(4))).toBeUndefined()
        expect(inline.active()).toBe(false)
    })
})

describe("inline trim", () => {
    test("removes the head space and keeps the cursor at the end", () => {
        // "， abc" followed by a closing double space: the head space after the
        // comma is removed, the cursor must not jump back to it.
        expect(trimInlineText("， abc ", 6, 1, true, false)).toEqual({ text: "，abc ", cursor: 5 })
    })

    test("removes the trailing space before the cursor", () => {
        expect(trimInlineText("， abc", 5, 1, true, true)).toEqual({ text: "，abc", cursor: 4 })
    })

    test("removes one head and one tail space", () => {
        expect(trimInlineText("中文测试  abc ", 10, 4, true, true)).toEqual({ text: "中文测试 abc", cursor: 8 })
    })

    test("keeps the cursor relative to the end", () => {
        expect(trimInlineText("abc def", 6, undefined, false, false)).toEqual({ text: "abc def", cursor: 6 })
    })
})
