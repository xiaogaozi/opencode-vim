import { Rpc } from "@opencode/plugin/rpc"

const definition = {
  id: "opencode-vim.input-source",
  methods: {
    get: {
      input: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { source: { type: ["string", "null"] } },
        required: ["source"],
        additionalProperties: false,
      },
    },
  },
  events: {
    changed: {
      schema: {
        type: "object",
        properties: { source: { type: "string" } },
        required: ["source"],
        additionalProperties: false,
      },
    },
  },
} as const satisfies Rpc.PortableDefinition

export const InputSourceRpc = Rpc.define(definition) as typeof definition
