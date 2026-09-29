# Instructions

- When you need information about how OpenCode works, reference the source repository at `/home/dan/src/opencode`.
- Before consulting that repository, run `git -C /home/dan/src/opencode pull --ff-only` to get the latest changes on its currently checked-out branch. Note that we do not have access to modify opencode source code itself.

# Fork workflow

`origin` is the personal fork (`xiaogaozi/opencode-vim`); `upstream` is
`Tarquinen/opencode-vim`. This fork carries personal features that are not
meant for upstream, so never merge upstream into `custom`; always rebase.

## Branches

| Branch | Purpose |
| --- | --- |
| `main` | Mirror of `upstream/main`. Never commit to it. |
| `custom` | Long-lived integration branch with all personal features. Build and run OpenCode from here. |
| `feature/<name>` | Short-lived branches based on `custom`, fast-forward merged back. |

## Sync with upstream

```sh
git fetch upstream
git checkout main
git merge --ff-only upstream/main
git push origin main

git checkout custom
git rebase --update-refs upstream/main
bun install
bun run typecheck && bun test src test/plugin.test.tsx test/editor.test.ts
bun run build
git push --force-with-lease origin custom
```

- `rebase.updateRefs=true` keeps `feature/*` markers attached to the rebased history.
- `rerere.enabled=true` reuses conflict resolutions.
- Only rebase; never `git merge upstream`. Push rebased branches with
  `--force-with-lease`, never `--force`.
- `test/reference.test.ts` downloads Neovim; skip it when offline. The quick
  command above covers the fork's features.

## Adding a feature

```sh
git fetch upstream
git checkout main && git merge --ff-only upstream/main
git checkout -b feature/<name> custom
# develop + unit tests
git checkout custom && git merge --ff-only feature/<name>
bun run build
git push origin custom feature/<name>
```

- Keep each feature self-contained under `src/modules/<name>/` with its own
  `options.vim.<name>` config block, disabled unless configured.
- Keep host integration points (mostly `tui.tsx` and `view.tsx`) small and
  additive so upstream rebases stay conflict-free.

## Pull requests in the fork

- `gh` already defaults to the fork for this clone (`gh repo set-default --view`).
- Open feature PRs against `custom`: `gh pr create --base custom`. Without
  `--base`, gh targets `main`.
- Merge with "Rebase and merge" or "Squash and merge"; never create merge
  commits on `custom`.
- `.github/workflows/ci.yml` runs for PRs whose base is `main` or `custom`.

## Removing a feature

Drop its commits during `git rebase -i upstream/main` (or
`git rebase --onto <before> <after> custom`) and delete the `feature/<name>`
branch.
