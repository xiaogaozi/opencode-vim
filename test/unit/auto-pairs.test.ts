import { describe, expect, test } from "bun:test"
import { DEFAULT_AUTO_PAIRS, DEFAULT_AUTO_PAIRS_CONFIG, autoPairAction, readAutoPairs } from "../../src/vim/auto-pairs"
import { createVimConfig } from "../../src/vim/config"

describe("auto pairs", () => {
  test("inserts every default pair", () => {
    for (const [open, close] of DEFAULT_AUTO_PAIRS) {
      expect(autoPairAction(open, "", "", DEFAULT_AUTO_PAIRS)).toEqual({ type: "insert", open, close })
    }
  })

  test("keeps the cursor between the pair after an opening character", () => {
    expect(autoPairAction("「", "before", "after", DEFAULT_AUTO_PAIRS)).toEqual({
      type: "insert",
      open: "「",
      close: "」",
    })
  })

  test("skips over a closing character already at the cursor", () => {
    expect(autoPairAction("」", "「text", "」", DEFAULT_AUTO_PAIRS)).toEqual({ type: "skip", close: "」" })
    expect(autoPairAction("]", "a[", "]", DEFAULT_AUTO_PAIRS)).toEqual({ type: "skip", close: "]" })
  })

  test("inserts a closing character when nothing follows it", () => {
    expect(autoPairAction("」", "text", "", DEFAULT_AUTO_PAIRS)).toBeUndefined()
    expect(autoPairAction("]", "a[", "b", DEFAULT_AUTO_PAIRS)).toBeUndefined()
  })

  test("removes both halves of an empty pair on backspace", () => {
    expect(autoPairAction("<BS>", "「", "」", DEFAULT_AUTO_PAIRS)).toEqual({
      type: "backspace",
      open: "「",
      close: "」",
    })
    expect(autoPairAction("<BS>", "a[", "]", DEFAULT_AUTO_PAIRS)).toEqual({
      type: "backspace",
      open: "[",
      close: "]",
    })
  })

  test("leaves a nonempty or unmatched pair to native backspace", () => {
    expect(autoPairAction("<BS>", "「a", "」", DEFAULT_AUTO_PAIRS)).toBeUndefined()
    expect(autoPairAction("<BS>", "「", "]", DEFAULT_AUTO_PAIRS)).toBeUndefined()
  })

  test("uses the same character on both sides", () => {
    const pairs = [['"', '"']] as const

    expect(autoPairAction('"', "", '"', pairs)).toEqual({ type: "skip", close: '"' })
    expect(autoPairAction('"', "text", "", pairs)).toEqual({ type: "insert", open: '"', close: '"' })
  })
})

describe("auto pair config", () => {
  test("is disabled with the default pairs", () => {
    const config = createVimConfig({})
    expect(config.autoPairs.enabled).toBe(false)
    expect(config.autoPairs.pairs).toEqual(DEFAULT_AUTO_PAIRS)
  })

  test("reads enabled and a custom pair list", () => {
    expect(readAutoPairs({ enabled: true })).toEqual({ enabled: true, pairs: DEFAULT_AUTO_PAIRS })
    expect(readAutoPairs({ enabled: true, pairs: ["「」", "[]"] })).toEqual({
      enabled: true,
      pairs: [
        ["「", "」"],
        ["[", "]"],
      ],
    })
  })

  test("accepts two-element arrays and ignores invalid entries", () => {
    expect(readAutoPairs({ pairs: [["「", "」"], ["abc"], 1, ["x"]] })).toEqual({
      enabled: false,
      pairs: [["「", "」"]],
    })
  })

  test("treats an empty list as no pairs", () => {
    expect(readAutoPairs({ enabled: true, pairs: [] })).toEqual({ enabled: true, pairs: [] })
  })

  test("ignores a missing or invalid option", () => {
    expect(readAutoPairs(undefined)).toBeUndefined()
    expect(readAutoPairs({ enabled: "yes" })).toEqual({ enabled: false, pairs: DEFAULT_AUTO_PAIRS })
    expect(readAutoPairs({ pairs: "not an array" })).toEqual({ enabled: false, pairs: DEFAULT_AUTO_PAIRS })
  })

  test("keeps the default config object immutable", () => {
    const config = createVimConfig({ autoPairs: { enabled: true, pairs: [] } })

    expect(DEFAULT_AUTO_PAIRS_CONFIG.enabled).toBe(false)
    expect(config.autoPairs).toEqual({ enabled: true, pairs: [] })
  })
})
