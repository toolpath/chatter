# AI agent skills

An AI agent, such as Claude Code or Codex, can help you with Chatter. Chatter gives agents **skills**: instructions for one task that the agent reads when it needs them.

| Skill | What the agent does |
| --- | --- |
| `set-up-chatter` | Helps you install Chatter on a computer or a Raspberry Pi, then add the first Admin, the machines and the users |
| `debug-machine-connection` | Finds why a machine shows **Offline**, and tells you how to fix it |
| `alert-query` | Writes an alert rule from your words, for example "tell me when the spindle load stays above 80% for 10 minutes" |
| `machine-report` | Answers questions about the history, for example "how many parts did each machine make this week?" |

## Install the skills

**Claude Code:** in a Claude Code session, type:

```
/plugin marketplace add toolpath/chatter
/plugin install chatter@toolpath-chatter
```

If your computer has no SSH key for GitHub, first set `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` in the terminal, then start Claude Code.
To get new versions of the skills, type `/plugin marketplace update toolpath-chatter`.

**Codex and other agents:** copy the skill folders into the skills folder of your agent. Codex and many other agents use `~/.agents/skills`:

```bash
git clone --depth 1 https://github.com/toolpath/chatter.git
mkdir -p ~/.agents/skills
cp -R chatter/plugins/chatter/skills/* ~/.agents/skills/
```

For another agent, see its docs for the name of its skills folder.

## Give the agent a login

The agent reads Chatter through the [API](../api/). Make an account for it in **Settings > Users and roles**, with the role **Viewer**. A Viewer can only look, so the agent cannot change your machines or your users.
To test an alert query, the `alert-query` skill needs an Admin login. With a Viewer login, it asks you to click **Test** in the app.

The agent asks you to set the login in the terminal, so that the password does not go in the chat:

```bash
export CHATTER_URL=http://<chatter address>:3001
export CHATTER_USERNAME=<the Viewer account>
read -rs CHATTER_PASSWORD && export CHATTER_PASSWORD
```

`read -rs` waits for you to type the password, and does not show it. Type it, then push Enter.

::: warning Warning:
Do not give an agent an Admin login unless you must. An agent with an Admin login can change and remove machines, users and settings.
:::
