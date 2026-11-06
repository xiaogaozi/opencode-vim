import { expect, test } from "bun:test"
import type { Context } from "@opencode/plugin/promise/plugin"
import server from "../../src/server"

type Handler = (input: unknown, context: unknown) => Promise<unknown>

test("registers the input source RPC and reads through it", async () => {
  const events: Array<{ name: string; data: unknown }> = []
  let get: Handler | undefined
  let disposed = false

  const ctx = {
    options: {
      vim: {
        inputSource: {
          enabled: true,
          normal: "im.us",
          getCommand: "echo im.cn",
          setCommand: "echo {source}",
          pollInterval: 0,
        },
      },
    },
    rpc: {
      register: async (_definition: unknown, handlers: { get: Handler }) => {
        get = handlers.get
        return {
          events: {
            emit: async (name: string, data: unknown) => {
              events.push({ name, data })
            },
          },
          dispose: async () => {
            disposed = true
          },
        }
      },
    },
  } as unknown as Context

  const cleanup = await server.setup(ctx)
  expect(get).toBeDefined()

  const result = await get!({}, {})
  expect(result).toEqual({ source: "im.cn" })
  expect(events).toEqual([{ name: "changed", data: { source: "im.cn" } }])

  await cleanup?.()
  expect(disposed).toBe(true)
})
