# Project contribution rules

## Git authorship and pull requests

- Use the human contributor identity already configured in Git for every commit.
- Never set Codex, OpenAI, ChatGPT, an AI agent, or a bot as a commit author or committer.
- Never add `Co-authored-by`, `Generated-by`, or similar AI-attribution trailers for Codex or OpenAI.
- Do not mention Codex or AI assistance in commit messages, pull-request titles, or pull-request descriptions unless the user explicitly requests that disclosure.
- Before committing, verify `git config user.name` and `git config user.email`. If either is missing, stop and ask the user instead of inventing an identity.
- Before opening a pull request, inspect the commits to ensure their author and committer metadata use the configured human identity.
