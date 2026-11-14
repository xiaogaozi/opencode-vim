import { expect, test } from "bun:test"
import { createVimConfig } from "../../src/vim/config"

test("modeIndicator defaults to full and ignores invalid values", () => {
  expect(createVimConfig({}).modeIndicator).toBe("full")
  expect(createVimConfig({ vim: { modeIndicator: "none" } }).modeIndicator).toBe("none")
  expect(createVimConfig({ modeIndicator: "full" }).modeIndicator).toBe("full")
  expect(createVimConfig({ modeIndicator: "invalid" }).modeIndicator).toBe("full")
})

test("visual-block cursor styles and keymaps are parsed", () => {
  const config = createVimConfig({
    keymaps: { "visual-block": { Q: "y" } },
    cursorStyles: { "visual-block": { style: "underline", blinking: false } },
  })
  expect(config.keymaps["visual-block"]?.Q).toBe("y")
  expect(config.cursorStyles["visual-block"]).toEqual({ style: "underline", blinking: false })
})

test("listContinuation is enabled unless explicitly disabled", () => {
  expect(createVimConfig({}).listContinuation.enabled).toBe(true)
  expect(createVimConfig({ vim: { listContinuation: {} } }).listContinuation.enabled).toBe(true)
  expect(createVimConfig({ vim: { listContinuation: { enabled: true } } }).listContinuation.enabled).toBe(true)
  expect(createVimConfig({ vim: { listContinuation: { enabled: false } } }).listContinuation.enabled).toBe(false)
  expect(createVimConfig({ listContinuation: { enabled: "no" } }).listContinuation.enabled).toBe(true)
})
