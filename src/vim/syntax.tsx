import type { Context } from "@opencode/plugin/tui/context"
import { SyntaxStyle } from "@opentui/core"

/** SyntaxStyle requires the renderer's native scene as its resource owner in newer OpenTUI versions. */
export function createSyntaxStyle(context: Context) {
  const create = SyntaxStyle.create as unknown as (owner?: unknown) => SyntaxStyle
  return create((context.renderer as unknown as { nativeScene?: unknown }).nativeScene)
}
