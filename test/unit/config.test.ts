import { expect, test } from "bun:test"
import { createVimConfig } from "../../src/vim/config"

test("modeIndicator defaults to full and ignores invalid values", () => {
  expect(createVimConfig({}).modeIndicator).toBe("full")
  expect(createVimConfig({ vim: { modeIndicator: "none" } }).modeIndicator).toBe("none")
  expect(createVimConfig({ modeIndicator: "full" }).modeIndicator).toBe("full")
  expect(createVimConfig({ modeIndicator: "invalid" }).modeIndicator).toBe("full")
})

test("listContinuation is enabled unless explicitly disabled", () => {
  expect(createVimConfig({}).listContinuation.enabled).toBe(true)
  expect(createVimConfig({ vim: { listContinuation: {} } }).listContinuation.enabled).toBe(true)
  expect(createVimConfig({ vim: { listContinuation: { enabled: true } } }).listContinuation.enabled).toBe(true)
  expect(createVimConfig({ vim: { listContinuation: { enabled: false } } }).listContinuation.enabled).toBe(false)
  expect(createVimConfig({ listContinuation: { enabled: "no" } }).listContinuation.enabled).toBe(true)
})
