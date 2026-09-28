/** @jsxImportSource @opentui/solid */
import type { TextRenderable } from "@opentui/core"
import { Show } from "solid-js"
import type { Accessor } from "solid-js"
import type { VimInputSource } from "./src/modules/vim/config"
import type { VimMode } from "./src/modules/vim/state"

type VimStatusProps = {
  mode: Accessor<VimMode>
  enabled: Accessor<boolean>
  source?: Accessor<string | undefined>
  inputSource?: VimInputSource
  theme: {
    success: TextRenderable["fg"]
    warning: TextRenderable["fg"]
    info: TextRenderable["fg"]
  }
}

export function VimStatus(props: VimStatusProps) {
  const indicator = () => {
    const config = props.inputSource
    if (!props.enabled() || !config?.enabled || !config.indicator) return undefined
    const source = props.source?.()
    if (source !== undefined && source !== config.normal) {
      return { label: "中", color: config.cursorColors.other ?? props.theme.success }
    }
    return { label: "EN", color: config.cursorColors.english ?? props.theme.info }
  }

  return (
    <box paddingRight={1} flexDirection="row" flexShrink={0}>
      <text fg={props.mode() === "insert" ? props.theme.success : props.theme.warning}>
        {props.enabled() ? modeLabel(props.mode()) : ""}
      </text>
      <Show when={indicator()}>
        {(badge) => <text fg={badge().color}>{` ${badge().label}`}</text>}
      </Show>
    </box>
  )
}

function modeLabel(mode: VimMode) {
  if (mode === "visual") return "VISUAL"
  if (mode === "visual-line") return "VISUAL LINE"
  return mode === "normal" ? "NORMAL" : "INSERT"
}
