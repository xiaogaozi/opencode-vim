import { describe, expect, test } from "bun:test"
import { DEFAULT_INPUT_SOURCE } from "../../src/vim/config"
import type { VimInputSource } from "../../src/vim/config"
import { acquireInputSourcePoller } from "../../src/server/poller"

let sequence = 0

function testConfig(overrides: Partial<VimInputSource> = {}): VimInputSource {
  return {
    ...DEFAULT_INPUT_SOURCE,
    enabled: true,
    normal: "im.us",
    command: `fake-helper-${++sequence}`,
    pollInterval: 0,
    ...overrides,
  }
}

describe("input source poller", () => {
  test("reads once and serves the cached value on demand", async () => {
    let reads = 0
    const poller = acquireInputSourcePoller(testConfig(), {
      read: async () => {
        reads++
        return " im.cn\n"
      },
    })

    expect(poller).toBeDefined()
    expect(await poller!.read()).toBe("im.cn")
    expect(await poller!.read()).toBe("im.cn")
    expect(reads).toBe(1)
    poller!.release()
  })

  test("notifies subscribers only when the source changes", async () => {
    let current = "im.us"
    const poller = acquireInputSourcePoller(testConfig(), {
      read: async () => current,
    })
    const seen: string[] = []
    const unsubscribe = poller!.subscribe((source) => seen.push(source))

    await poller!.read()
    expect(seen).toEqual(["im.us"])

    current = "im.cn"
    await Bun.sleep(250)
    await poller!.read()
    expect(seen).toEqual(["im.us", "im.cn"])

    unsubscribe()
    poller!.release()
  })

  test("shares one timer across references and stops after release", async () => {
    let reads = 0
    const config = testConfig({ pollInterval: 20 })
    const read = async () => {
      reads++
      return "im.cn"
    }

    const first = acquireInputSourcePoller(config, { read })
    const second = acquireInputSourcePoller(config, { read })
    expect(first).toBeDefined()
    expect(second).toBeDefined()

    await Bun.sleep(90)
    // One shared 20ms timer runs roughly 4-5 times. Two independent timers
    // would run roughly twice as often.
    expect(reads).toBeLessThanOrEqual(6)

    first!.release()
    second!.release()
    await Bun.sleep(40)
    const stopped = reads
    await Bun.sleep(60)
    expect(reads).toBe(stopped)
  })
})
