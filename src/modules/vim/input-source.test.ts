import { describe, expect, test } from "bun:test"
import type { VimInputSource } from "./config"
import { DEFAULT_ENGLISH_PATTERN, DEFAULT_OTHER_PATTERN } from "./context"
import type { InputSourceRunner } from "./input-source"
import { createInputSourceController, splitCommand } from "./input-source"

function testConfig(overrides: Partial<VimInputSource> = {}): VimInputSource {
    return {
        enabled: true,
        normal: "im.us",
        context: true,
        contextAggressiveLine: true,
        englishPattern: DEFAULT_ENGLISH_PATTERN,
        otherPattern: DEFAULT_OTHER_PATTERN,
        pollInterval: 0,
        cursorColors: {},
        ...overrides,
    }
}

function createFakeRunner(initial = "im.cn") {
    const calls: string[] = []
    let current = initial
    let failure: Error | undefined
    let getGate: Promise<void> | undefined
    let releaseGet: (() => void) | undefined

    const runner: InputSourceRunner = {
        async get() {
            calls.push("get")
            if (getGate) await getGate
            if (failure) throw failure
            return current
        },
        async set(source) {
            calls.push(`set:${source}`)
            if (failure) throw failure
            current = source
        },
    }

    return {
        runner,
        calls,
        fail(error: Error) {
            failure = error
        },
        holdGet() {
            getGate = new Promise<void>((resolve) => {
                releaseGet = resolve
            })
        },
        releaseGet() {
            releaseGet?.()
            getGate = undefined
            releaseGet = undefined
        },
    }
}

describe("input source controller", () => {
    test("ignores the initial mode until a real transition happens", async () => {
        const fake = createFakeRunner()
        const controller = createInputSourceController(testConfig(), { runner: fake.runner })

        controller.sync("insert", { text: "", position: 0 })
        await controller.settle()

        expect(fake.calls).toEqual([])
    })

    test("remembers the insert source and restores it", async () => {
        const fake = createFakeRunner("im.cn")
        const controller = createInputSourceController(testConfig(), { runner: fake.runner })

        controller.sync("insert", { text: "", position: 0 })
        controller.sync("normal")
        await controller.settle()
        expect(fake.calls).toEqual(["get", "set:im.us"])

        controller.sync("insert", { text: "中文", position: 2 })
        await controller.settle()
        expect(fake.calls).toEqual(["get", "set:im.us", "set:im.cn"])
    })

    test("context english keeps the normal source", async () => {
        const fake = createFakeRunner()
        const controller = createInputSourceController(testConfig({ insert: "im.fixed" }), { runner: fake.runner })

        controller.sync("insert")
        controller.sync("normal")
        await controller.settle()
        controller.sync("insert", { text: "中文", position: 2 })
        await controller.settle()
        expect(fake.calls).toContain("set:im.fixed")

        controller.sync("normal")
        await controller.settle()
        fake.calls.length = 0

        controller.sync("insert", { text: "hello", position: 5 })
        await controller.settle()
        // context english targets "im.us", which is already active
        expect(fake.calls).toEqual([])
    })

    test("context other uses the fixed insert source", async () => {
        const fake = createFakeRunner()
        const controller = createInputSourceController(testConfig({ insert: "im.fixed" }), { runner: fake.runner })

        controller.sync("insert")
        controller.sync("normal")
        await controller.settle()
        fake.calls.length = 0

        controller.sync("insert", { text: "中文", position: 2 })
        await controller.settle()
        expect(fake.calls).toEqual(["set:im.fixed"])
    })

    test("context disabled falls back to the remembered source", async () => {
        const fake = createFakeRunner()
        const controller = createInputSourceController(testConfig({ context: false }), { runner: fake.runner })

        controller.sync("insert")
        controller.sync("normal")
        await controller.settle()
        fake.calls.length = 0

        controller.sync("insert", { text: "hello", position: 5 })
        await controller.settle()
        expect(fake.calls).toEqual(["set:im.cn"])
    })

    test("coalesces rapid transitions", async () => {
        const fake = createFakeRunner()
        const controller = createInputSourceController(testConfig(), { runner: fake.runner })

        controller.sync("insert")
        fake.holdGet()
        controller.sync("normal")
        controller.sync("insert", { text: "中文", position: 2 })
        fake.releaseGet()
        await controller.settle()

        expect(fake.calls).toEqual(["get", "set:im.cn"])
    })

    test("reset returns to the normal source", async () => {
        const fake = createFakeRunner()
        const controller = createInputSourceController(testConfig(), { runner: fake.runner })

        controller.sync("insert")
        controller.sync("normal")
        await controller.settle()
        controller.sync("insert", { text: "中文", position: 2 })
        await controller.settle()
        expect(fake.calls.at(-1)).toBe("set:im.cn")

        controller.reset()
        await controller.settle()
        expect(fake.calls.at(-1)).toBe("set:im.us")
    })

    test("notifies once when the helper is missing", async () => {
        const fake = createFakeRunner()
        fake.fail(Object.assign(new Error("spawn macism ENOENT"), { code: "ENOENT" }))
        const notifications: string[] = []
        const controller = createInputSourceController(testConfig(), {
            runner: fake.runner,
            notify: (message) => notifications.push(message),
        })

        controller.sync("insert")
        controller.sync("normal")
        await controller.settle()
        controller.sync("insert", { text: "中文", position: 2 })
        await controller.settle()

        expect(notifications).toHaveLength(1)
    })

    test("stays inert when disabled", async () => {
        const fake = createFakeRunner()
        const controller = createInputSourceController(testConfig({ enabled: false }), { runner: fake.runner })

        controller.sync("insert")
        controller.sync("normal")
        controller.reset()
        await controller.settle()

        expect(fake.calls).toEqual([])
    })
})

describe("splitCommand", () => {
    test("splits plain commands", () => {
        expect(splitCommand("macism {source}")).toEqual(["macism", "{source}"])
        expect(splitCommand("  macism   150 ")).toEqual(["macism", "150"])
    })

    test("keeps quoted arguments together", () => {
        expect(splitCommand("\"/opt/my tools/macism\" {source}")).toEqual(["/opt/my tools/macism", "{source}"])
        expect(splitCommand("im-select")).toEqual(["im-select"])
    })
})
