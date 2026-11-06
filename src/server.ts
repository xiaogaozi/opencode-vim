import { Plugin } from "@opencode/plugin"
import { InputSourceRpc } from "./rpc"
import { acquireInputSourcePoller } from "./server/poller"
import { readInputSourceConfig } from "./vim/input-source-config"

export default Plugin.define({
  id: "opencode-vim",
  async setup(ctx) {
    const config = readInputSourceConfig(ctx.options)
    const poller = config.enabled ? acquireInputSourcePoller(config) : undefined
    const registration = await ctx.rpc.register(InputSourceRpc, {
      get: async () => ({ source: (await poller?.read()) ?? null }),
    })
    const unsubscribe = poller?.subscribe((source) => {
      void registration.events.emit("changed", { source })
    })

    return async () => {
      unsubscribe?.()
      await registration.dispose()
      poller?.release()
    }
  },
})
