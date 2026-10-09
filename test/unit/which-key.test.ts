import { describe, expect, test } from "bun:test"
import { createVimConfig } from "../../src/vim/config"
import type { VimMappedAction } from "../../src/vim/config"
import { describeMappedAction, truncateToWidth, whichKeyOptions } from "../../src/vim/which-key"

const keymaps: Record<string, VimMappedAction> = {
  "<C-g>nb": [
    "insert",
    "text:请基于最新的基线分支新建分支实施，实施完以后不要立即 commit 及创建 PR。",
    "agent:build",
    "submit",
  ],
  "<C-g>gg": ["insert", "text:请实施，但不要立即 commit。", "agent:build", "submit"],
  "<C-g>go": ["insert", "text:请实施", "agent:build", "submit"],
  "<C-g>sm": ["insert", "text:请汇总实施计划", "agent:plan", "submit"],
  "<C-g>cp": ["insert", "text:/commit-and-push", "agent:build", "submit"],
}

describe("which-key options", () => {
  test("sorts the mappings under the pending prefix alphabetically", () => {
    const options = whichKeyOptions(keymaps, ["<C-g>"])

    expect(options.map((option) => option.keys)).toEqual(["cp", "gg", "go", "nb", "sm"])
    expect(options[0]?.description).toBe("/commit-and-push")
    expect(options.find((option) => option.keys === "nb")?.description).toBe(
      "请基于最新的基线分支新建分支实施，实施完以后不要立即 commit 及创建 PR。",
    )
  })

  test("sorts case-insensitively", () => {
    const options = whichKeyOptions({ Y: "insert", h: "insert", G: "insert" }, [])

    expect(options.map((option) => option.keys)).toEqual(["G", "h", "Y"])
  })

  test("narrows to the next level", () => {
    const options = whichKeyOptions(keymaps, ["<C-g>", "g"])

    expect(options.map((option) => option.keys)).toEqual(["g", "o"])
  })

  test("ignores non-prefixes, exact matches and invalid sequences", () => {
    const options = whichKeyOptions(
      {
        ...keymaps,
        n: "insert",
        "<C-g>": "insert",
        "<Bogus>": "insert",
      },
      ["<C-g>"],
    )

    expect(options.map((option) => option.keys)).toEqual(["cp", "gg", "go", "nb", "sm"])
  })
})

describe("which-key descriptions", () => {
  test("prefers an explicit description", () => {
    expect(describeMappedAction({ action: ["insert", "text:go"], description: "send go" })).toBe("send go")
  })

  test("uses the text payload of a chain", () => {
    expect(describeMappedAction(["agent:build", "text:请实施\n第二行", "submit"])).toBe("请实施 第二行")
    expect(describeMappedAction("text:/commit-and-push")).toBe("/commit-and-push")
  })

  test("resolves command titles with a fallback to the id", () => {
    const title = (id: string) => (id === "session.new" ? "Create a new session" : undefined)

    expect(describeMappedAction("command:session.new", title)).toBe("Create a new session")
    expect(describeMappedAction("command:session.new")).toBe("session.new")
  })

  test("joins chain steps without text", () => {
    expect(describeMappedAction(["agent:build", "submit"])).toBe("agent build → submit")
    expect(describeMappedAction(["insert", "y$"])).toBe("insert mode → y$")
  })
})

describe("which-key truncation", () => {
  test("keeps text that fits", () => {
    expect(truncateToWidth("你好", 4)).toBe("你好")
    expect(truncateToWidth("abc", 3)).toBe("abc")
  })

  test("truncates ASCII with an ellipsis", () => {
    expect(truncateToWidth("abcdef", 4)).toBe("abc…")
  })

  test("truncates CJK by display width", () => {
    expect(truncateToWidth("你好世界", 5)).toBe("你好…")
    expect(truncateToWidth("你好世界", 0)).toBe("")
  })
})

describe("which-key configuration", () => {
  test("parses descriptions on string and chain mappings", () => {
    const config = createVimConfig({
      keymaps: {
        normal: {
          Q: { action: ["insert", "text:go"], description: "go" },
          W: { action: "insert" },
          X: { description: "no action" },
        },
      },
    })

    expect(config.keymaps.normal?.Q).toEqual({ action: ["insert", "text:go"], description: "go" })
    expect(config.keymaps.normal?.W).toEqual({ action: "insert" })
    expect(config.keymaps.normal?.X).toBeUndefined()
  })

  test("is disabled unless configured", () => {
    expect(createVimConfig({}).whichKey).toEqual({ enabled: false })
    expect(createVimConfig({ whichKey: { enabled: true } }).whichKey).toEqual({ enabled: true })
  })
})
