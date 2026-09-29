# Configuration

Replace the plugin entry in `cli.json` with an object containing `options.vim`.
This example uses `Q` for session mode and `kj` to leave insert mode:

```json
{
  "plugins": [
    {
      "package": "opencode-vim@latest",
      "options": {
        "vim": {
          "sessionKey": "Q",
          "keymaps": {
            "insert": { "kj": "normal" }
          }
        }
      }
    }
  ]
}
```

## Options

All options below belong inside `options.vim`.

| Option | Default | Purpose |
| --- | --- | --- |
| `defaultMode` | `"insert"` | Starting Vim mode; use `"normal"` to start in normal mode |
| `sessionKey` | `"s"` | Single key to enter and leave session mode |
| `diffView` | `"after"` | Starting edit/patch view: `"after"`, `"before"`, or `"diff"`; added/deleted files use the available side |
| `keymapTimeout` | `500` | Milliseconds to wait for the rest of a custom mapping |
| `keymaps` | `{}` | Custom mappings, grouped by mode |
| `cursorStyles` | See below | Cursor appearance for each editing mode |
| `inputSource` | disabled | Switch the OS input method per editing mode; see below |
| `debug` | `false` | Enable debug logging |
| `debugPath` | `~/.cache/opencode/opencode-vim.log` | Debug log file |

### Session key

Use one character, such as `"Q"`, or key notation such as `"<C-s>"`. The key changes
both entry and exit, including the footer hints. Invalid or multi-key values fall
back to `"s"`.

A custom normal-mode mapping beginning with the same key takes precedence over
entering session mode.

### Custom keymaps

Mappings apply to `insert`, `normal`, `visual`, and `visual-line` editing modes in
the prompt and search dialogs. Insert-mode mappings also apply while typing a
question answer. Use `keymaps.session` for transcript browsing and its
message/tool modals, and `keymaps.panes` for shared prompt/terminal controls.

See [Custom Keymaps](./keymap-actions.md) for actions, key notation, and examples.
See [Keybindings and Modes](./vim-behavior.md) for the default behavior.

### Pane controls

`keymaps.panes` uses the same `command:<id>` actions as editing mappings. It works
in the prompt, transcript browsing, and live terminal input, but not in dialogs,
question forms, or the composer picker. Active pane mappings take precedence over
editing mappings; unavailable commands leave the key alone.

These defaults are active even when `panes` is omitted:

| Key | Action |
| --- | --- |
| `<C-/>` | `command:opencode-vim.terminal.toggle` |
| `<M-h>` | `command:pane.focus.left` |
| `<M-l>` | `command:pane.focus.right` |

Add this inside `options.vim` to replace them with Alt+t and Alt+a/d:

```json
{
  "keymaps": {
    "panes": {
      "<C-/>": "passthrough",
      "<M-h>": "passthrough",
      "<M-l>": "passthrough",
      "<M-t>": "command:opencode-vim.terminal.toggle",
      "<M-a>": "command:pane.focus.left",
      "<M-d>": "command:pane.focus.right"
    }
  }
}
```

Omitted defaults stay active. `passthrough` disables a pane mapping and releases
that key to Vim editing or the child application. The footer follows the mappings.
`<C-_>` and `<C-/>` refer to the same terminal chord; disabling or remapping either
also changes the legacy alias.

Pane mappings require one key or chord, not sequences like `<C-w>h`, so shell
typing is never buffered. They accept `command:<id>` or `passthrough`, and support
Alt (`<M-h>`) and Ctrl punctuation (`<C-/>`) in addition to ordinary keys. The
named terminal toggle is also usable from existing normal-mode command mappings.
It remains available only in prompt normal mode, transcript browsing, or live
terminal input; pane focus commands also work in prompt insert mode.

### Cursor styles

Insert mode defaults to a blinking line cursor. Normal, visual, and visual-line
modes default to a blinking block. Supported styles are `block`, `line`,
`underline`, and `default`. Omitted values keep their defaults.

For example, add this inside `options.vim` to disable cursor blinking:

```json
{
  "cursorStyles": {
    "insert": { "style": "line", "blinking": false },
    "normal": { "style": "block", "blinking": false }
  }
}
```

### Input source (IME) switching

`inputSource` switches the OS input method when the editor changes modes. It
needs an external command that can get and set the input source. On macOS the
recommended helper is [macism](https://github.com/laishulu/macism), the same
tool used by `emacs-smart-input-source`:

```sh
brew tap laishulu/homebrew
brew install macism
```

The command with no arguments must print the current source id, and with a
source id argument must switch to it. `macism` and `im-select` are detected
automatically. Example configuration inside `options.vim`:

```json
{
  "inputSource": {
    "enabled": true,
    "normal": "com.apple.keylayout.ABC",
    "insert": "com.apple.inputmethod.SCIM.ITABC",
    "cursorColors": {
      "other": "#00cc66"
    }
  }
}
```

- `normal` is used for normal, visual, and visual-line modes.
- `insert` is used for insert mode. Leave it out to restore the last input
  source that was active when insert mode was left.
- `context` (default `true`) looks at the characters around the cursor when
  entering insert mode: text right after a Chinese character stays Chinese,
  text right after an English word stays English, and ambiguous contexts fall
  back to `insert` or the remembered source. `englishPattern`, `otherPattern`,
  and `contextAggressiveLine` tune the detection.
- `pollInterval` in milliseconds (default `500`) re-reads the input source while
  editing, so manual switches (for example with `Ctrl+Space`) also update the
  footer indicator and cursor color and are remembered. Set it to `0` to disable
  polling.
- `cursorColors.english` / `cursorColors.other` set the cursor color per active
  input source. An empty color restores the terminal default. Cursor color
  needs a terminal that supports `OSC 12` (iTerm2, kitty, WezTerm, Ghostty,
  and others).
- `indicator` (default `true`) shows a `中`/`EN` badge in the prompt footer.
  Some terminals, including Warp, parse `OSC 12` but never render cursor color
  changes; the footer badge works everywhere.
- `command`, `getCommand`, and `setCommand` override the detected helper.
  `setCommand` may contain `{source}`; without it the source id is appended.
  `waitMs` is appended after the source id as an extra argument (macism's
  macOS 26 workaround delay). Set `waitMs` to `0` to skip macism's
  `TemporaryWindow` workaround, which on some macOS 26 setups fails to switch
  CJK sources.

The plugin resets to the `normal` source and the default cursor color when Vim
mode is disabled or the plugin unloads. Switching does not apply over SSH,
because the helper runs on the machine that hosts the TUI.

### Debugging

Set `"debug": true` or launch OpenCode with `VIM_PROMPT_DEBUG=1`. Invalid mappings
are skipped and recorded in the log. A custom `debugPath` should be absolute;
`~` is not expanded in configured paths.

`keymapTimeout` controls partially typed custom mappings. If an insert-mode
mapping times out, its pending characters are inserted as ordinary text. Pending
keys are not shown in the footer.
