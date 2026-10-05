# Initial public publication

Target: `michaelcrosato/tideline`.

The source package includes an initial-publication helper. It uses your GitHub CLI session and never asks you to paste a token into the game. Once the target contains this project, update it with normal Git commits and pushes; the helper intentionally refuses nonempty targets.

## Requirements

Install Git, Python 3.10+, and [GitHub CLI](https://cli.github.com/). Extract the source ZIP into a new directory, open a terminal there, and run:

```sh
gh auth login
python tools/build.py --check
python tools/publish.py
```

The destination is intentionally fixed. The helper checks the logged-in account, the target visibility, and whether the target contains branches. It accepts an absent target or an empty public target. It refuses to overwrite an existing project, change a private repository to public, replace an unrelated origin, or force-push.

It stages the named project files only. Files ignored by `.gitignore` are not added. Do not put personal screenshots, reports, secrets, or other files inside the source directories before publishing. Review `git status` first.

## Failure recovery

If authentication fails, complete `gh auth login` and rerun. If creation succeeds but pushing fails, the empty public repository can remain. Fix the reported authentication or network error and rerun. The helper does not delete repositories or undo remote work.

If the target is already nonempty, stop and inspect its files and default branch. Do not force-push this package over it. Add the changes through a normal reviewed branch or pull request.

## Alternative manual commands

After reviewing the source and authenticating, GitHub CLI can create and push a new public project from a local Git repository:

```sh
gh repo create michaelcrosato/tideline --public --source=. --push
```

This command assumes you have initialized and committed the project and the target does not already exist. See the [official command reference](https://cli.github.com/manual/gh_repo_create).

The helper publishes source to GitHub. To host the game, import the repository into Vercel using the checked-in configuration; see [Vercel deployment](vercel.md). The helper does not enable hosting or paid services.

## License

No license was selected automatically. Choose a license before inviting code reuse or outside contributions. Existing code and third-party rights must be reviewed when making that choice.
