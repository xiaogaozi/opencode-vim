import { RGBA } from "@opentui/core"

export function testTheme(success = RGBA.fromHex("#00ff00")) {
  const tokens = {
    background: {
      base: RGBA.fromHex("#000000"),
      raised: { high: RGBA.fromHex("#222222") },
      action: { primary: { focused: RGBA.fromHex("#006699") } },
    },
    text: {
      base: RGBA.fromHex("#ffffff"),
      muted: RGBA.fromHex("#888888"),
      action: { primary: { focused: RGBA.fromHex("#ffffff") } },
      feedback: {
        success: { base: success },
        warning: { base: RGBA.fromHex("#ffff00") },
        info: { base: RGBA.fromHex("#00ffff") },
      },
    },
    syntax: {
      comment: RGBA.fromHex("#888888"),
      keyword: RGBA.fromHex("#ff0000"),
      function: RGBA.fromHex("#00ffff"),
      variable: RGBA.fromHex("#ffff00"),
      string: RGBA.fromHex("#00ff00"),
      number: RGBA.fromHex("#00aaff"),
      type: RGBA.fromHex("#00ff88"),
      operator: RGBA.fromHex("#ff00ff"),
      punctuation: RGBA.fromHex("#ffffff"),
    },
    markdown: {
      text: RGBA.fromHex("#ffffff"),
      heading: RGBA.fromHex("#ff0000"),
      link: RGBA.fromHex("#0000ff"),
      linkText: RGBA.fromHex("#00ffff"),
      code: RGBA.fromHex("#00ff00"),
      blockQuote: RGBA.fromHex("#ffff00"),
      emphasis: RGBA.fromHex("#ff00ff"),
      strong: RGBA.fromHex("#ff8800"),
      horizontalRule: RGBA.fromHex("#888888"),
      listItem: RGBA.fromHex("#00ffff"),
      listEnumeration: RGBA.fromHex("#00aaaa"),
      image: RGBA.fromHex("#0000ff"),
      imageText: RGBA.fromHex("#00ffff"),
      codeBlock: RGBA.fromHex("#00ff00"),
    },
    diff: {
      text: { added: success, removed: RGBA.fromHex("#ff0000"), hunkHeader: RGBA.fromHex("#00ffff") },
      background: { added: RGBA.fromHex("#003300"), removed: RGBA.fromHex("#330000") },
      lineNumber: { background: { added: RGBA.fromHex("#004400"), removed: RGBA.fromHex("#440000") } },
    },
  }
  return { ...tokens, surface: () => tokens }
}
