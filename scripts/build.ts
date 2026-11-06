import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import { runtimeModuleIdForSpecifier } from "@opentui/core/runtime-plugin"

// npm sources live under node_modules, where the host's Solid source transform
// does not run. Compile JSX here and explicitly use the host's shared modules.
const shared = new Set(["@opencode/plugin/tui", "@opentui/core", "@opentui/solid", "solid-js", "solid-js/store"])

const tui = await Bun.build({
  entrypoints: ["./tui.tsx"],
  outdir: "./dist",
  target: "bun",
  format: "esm",
  packages: "external",
  external: ["opentui:*"],
  plugins: [
    createSolidTransformPlugin({
      moduleName: runtimeModuleIdForSpecifier("@opentui/solid"),
      resolvePath(specifier) {
        if (shared.has(specifier)) return runtimeModuleIdForSpecifier(specifier)
        return null
      },
    }),
  ],
})

// The server and RPC parts run in the OpenCode server. They do not use Solid
// or OpenTUI, so a plain Bun build keeps the bundles small.
const server = await Bun.build({
  entrypoints: ["./src/server.ts", "./src/rpc.ts"],
  outdir: "./dist",
  target: "bun",
  format: "esm",
  packages: "external",
})

for (const result of [tui, server]) {
  if (!result.success) {
    for (const log of result.logs) console.error(log)
    process.exit(1)
  }
}
