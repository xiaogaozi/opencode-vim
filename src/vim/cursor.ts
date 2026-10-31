import type { CursorStyleOptions } from "@opentui/core"

export type CursorStyleTarget = {
  readonly isDestroyed?: boolean
  cursorStyle: CursorStyleOptions | undefined
}

/**
 * Keeps Vim's cursor shape while the host re-applies its own cursor config.
 *
 * OpenCode 2.2.3 resolves `tui.cursor` to a default (`block`) and writes it to
 * the focused editor on mount and whenever the prompt re-renders. Those writes
 * land after the plugin's own assignment, so insert mode would lose its bar.
 *
 * While attached, the pin shadows the editor's `cursorStyle` accessor with an
 * own property that records host writes instead of forwarding them. Detach
 * removes the own property and restores the latest host style.
 */
export function createCursorStylePin() {
  let input: CursorStyleTarget | null = null
  let descriptor: PropertyDescriptor | undefined
  let ownDescriptor: PropertyDescriptor | undefined
  let pinned = false
  let initialStyle: CursorStyleOptions | undefined
  let hostStyle: CursorStyleOptions | undefined
  let style: CursorStyleOptions | undefined

  function attach(target: CursorStyleTarget) {
    detach()
    input = target
    initialStyle = target.cursorStyle
    hostStyle = initialStyle
    ownDescriptor = Object.getOwnPropertyDescriptor(target, "cursorStyle")
    const found = ownDescriptor ?? findAccessor(Object.getPrototypeOf(target))
    if (!found?.get || !found?.set) return false
    descriptor = found
    try {
      Object.defineProperty(target, "cursorStyle", {
        configurable: true,
        enumerable: ownDescriptor?.enumerable ?? false,
        get: () => descriptor!.get!.call(target),
        set: (value: CursorStyleOptions | undefined) => {
          // Ignore host writes while Vim owns the cursor, but remember the
          // latest host preference so detach can restore it.
          if (value) hostStyle = value
        },
      })
    } catch {
      descriptor = undefined
      ownDescriptor = undefined
      return false
    }
    pinned = true
    return true
  }

  function set(next: CursorStyleOptions) {
    if (!input) return false
    style = next
    try {
      if (pinned && descriptor?.set) descriptor.set.call(input, next)
      else input.cursorStyle = next
      return true
    } catch {
      return false
    }
  }

  function detach() {
    const current = input
    if (!current) return
    const restore = hostStyle ?? initialStyle ?? style
    const own = ownDescriptor
    const wasPinned = pinned
    input = null
    descriptor = undefined
    ownDescriptor = undefined
    pinned = false
    initialStyle = undefined
    hostStyle = undefined
    style = undefined
    if (wasPinned) {
      try {
        if (own) Object.defineProperty(current, "cursorStyle", own)
        else Reflect.deleteProperty(current, "cursorStyle")
      } catch {}
    }
    if (current.isDestroyed || !restore) return
    try {
      current.cursorStyle = restore
    } catch {}
  }

  return { attach, set, detach }
}

function findAccessor(target: object | null): PropertyDescriptor | undefined {
  let current = target
  while (current) {
    const descriptor = Object.getOwnPropertyDescriptor(current, "cursorStyle")
    if (descriptor) return descriptor
    current = Object.getPrototypeOf(current)
  }
  return undefined
}
