# Paseo Project Tasks

Workspace panel that stores a per-`projectId` task board on the daemon.

V1: title, long plain-text body, up to 3 images, desktop drag / mobile buttons, completed hidden. No execute-agent.

## Install

On the **daemon machine** (not the phone/desktop client):

```bash
git clone https://github.com/jqlts1/paseo-plugin-project-tasks.git
cd paseo-plugin-project-tasks
npm install
paseo plugin install "$PWD"
paseo plugin ls
```

Then in a workspace connected to that daemon: Command Center → **Open tasks**, or add the **Tasks** tab.

Needs `pluginsEnabled: true` on that daemon.

Update:

```bash
cd /path/to/paseo-plugin-project-tasks
git pull
npm install
paseo plugin reload project-tasks
```

## Data

`$PASEO_HOME/plugin-data/project-tasks/<projectId>/board.json`
`$PASEO_HOME/plugin-data/project-tasks/<projectId>/images/<taskId>/`

Not in the git repo. Same project / worktree share one board.

## Images

Desktop/web: paste or file picker. Native mobile file picker is not in the plugin module allowlist; add images from desktop, they still show on the phone.

Uninstall: `paseo plugin remove project-tasks` (does not delete the source or stored boards).
