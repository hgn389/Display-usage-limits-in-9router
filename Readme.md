# Display usage limits in 9router

![OpenAI Codex connections and usage limits](https://raw.githubusercontent.com/hgn389/Display-usage-limits-in-9router/main/images/OpenAI%20Codex%201.jpg)

![OpenAI Codex dashboard preview](https://raw.githubusercontent.com/hgn389/Display-usage-limits-in-9router/main/images/OpenAI%20Codex.png)

Version **v1.0.0** · [Tiếng Việt](Readme-vi.md) · [Installation reference](INSTALL.txt)

Adds Codex usage bars and administrator notes to the existing 9router dashboard:
`/dashboard/providers/codex`. The native integration uses the existing dashboard
port; no browser extension is required.

## Features

- **Weekly** on the left, **5h** next, and **End date:** on the right.
- On `/dashboard/providers/antigravity`, a compact line below each email shows remaining quota and reset countdowns for the model groups/windows returned by 9router, refreshed approximately every 30 seconds.
- Remaining percentages, reset countdowns, and reset clock time for 5h. Hover for the full reset timestamp in your browser timezone.
- Automatic refresh approximately every **30 seconds** while the Codex tab is visible. At most two automatic quota requests run concurrently. Returning to the tab refreshes overdue data.
- End date is a free-text administrator note, such as `ngày 24 hết gói Plus`. Click the square pencil button to edit; **Save**, Enter, or clicking outside saves. Escape cancels. No calendar validation or automatic account disabling.
- Notes are stored independently in `data/package-expiry.json`, keyed by connection ID. No SQLite/database is required for the addon.
- A small **Check Update** button under End date checks published GitHub Releases. A newer installable release exposes **Install update vX.Y.Z**. Nothing installs automatically.

Missing quota is shown as unavailable, never inferred as a full or empty quota.
Quota reads use 9router's existing usage API; the addon does not send model prompts
or consume reset credits. 9router may refresh OAuth internally while reading usage.

## Requirements

- Node.js **22+**, Git, and an existing 9router installation.
- The native patch was developed against **9router 0.5.99**, installed globally at the conventional `/usr/lib/node_modules/9router/app` location. Pass another app path to the installer if needed.
- Permission to write one installed browser JavaScript file. No gateway restart, inference-port change, or modification to the 9router database is needed.
- Browser access to the addon service on **9092**, using the same host as the dashboard. Current supplied configuration supports a trusted HTTP network; HTTPS/TLS setups need a separately configured integration.

### Custom dashboard ports

The addon does not discover dashboard ports automatically. A dashboard on a port
such as **20128** works when the addon service is configured for that exact
origin and its local upstream, and the browser can reach the addon API on **9092**
at the same hostname. For example, if 9router listens locally on port 20128:

```sh
HOST=192.168.1.10 PORT=9092 DASHBOARD_ORIGIN=http://192.168.1.10:20128 UPSTREAM=http://127.0.0.1:20128 node service.mjs
```

Replace the example address with the server address. Configure the same values
in the service manager/firewall. The dashboard port and addon API port are
separate; changing the dashboard port does not move the addon API from 9092.

## Install on the original dashboard

After the source is published, clone the repository into a directory separate from 9router:

```sh
git clone https://github.com/hgn389/Display-usage-limits-in-9router.git
cd Display-usage-limits-in-9router
node --version
node native-ui.mjs prepare
node native-ui.mjs apply
HOST=127.0.0.1 PORT=9092 DASHBOARD_ORIGIN=http://127.0.0.1:9090 node service.mjs
```

Runtime uses built-in Node.js modules. No `npm install` is required to run it.
For a different 9router app directory, pass that path to `prepare` and `apply`,
and set `ROUTER_APP_DIR` for the addon service before using update installation.
`prepare` backs up the original browser asset under `.native-ui/`; `apply` installs
the UI patch. Both refuse unexpected package changes.

For a remote browser, replace `HOST` with the server's trusted LAN address and
`DASHBOARD_ORIGIN` with the **exact** dashboard origin you use, including port.
`localhost` always refers to the device on which it is used. Allow TCP **9092**
from your trusted client subnet if the server firewall is active. The client
uses the dashboard hostname with port 9092; do not change the service port alone.
Do not move inference clients or existing tunnels away from the gateway endpoint.

Open the original dashboard, sign in normally, and **force reload/clear browser
cache**. 9router marks its hashed JavaScript assets immutable, so the browser
may otherwise keep an older UI. `.native-ui/` and the JSON notes must remain
outside version control and be backed up separately.

## Keep the addon running

`node service.mjs` supervises only the addon service and reloads it after a
successful update. It does not restart 9router. The foreground command stops
when its session ends; it does not install startup after reboot. See `INSTALL.txt`
for a systemd example. A previously created transient systemd unit is not boot
persistence.

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Addon service bind address |
| `PORT` | `9092` | Notes/update API port; native client expects 9092 |
| `DASHBOARD_ORIGIN` | `http://127.0.0.1:9090` | Exact allowed browser origin |
| `UPSTREAM` | `http://127.0.0.1:9090` | Local trusted 9router authentication endpoint |
| `DATA_DIR` | `data` beside addon source | Notes storage directory |
| `ROUTER_APP_DIR` | `/usr/lib/node_modules/9router/app` | Installed app directory for native updates |

API access requires the existing HttpOnly dashboard session. Writes additionally
require the exact allowed Origin and addon header. Cookies stay in requests and
are never written to source, update packages or logs.

## Updates and rollback

Click **Check Update** under End date. Until a stable Release is published, it
reports **No published releases yet**. Ordinary commits, tags without a Release,
drafts and prereleases are not installed. Checks are cached for 60 seconds and
are never triggered by quota refresh.

A release must include `9router-addon-vX.Y.Z.json`, built with `npm run build:release`.
The installer checks the GitHub asset digest and each file's SHA-256, restricts
files to a fixed allowlist, rejects downgrades and local source edits, and stores
previous source in `.updates/`. It does not run npm lifecycle scripts or rewrite
Git history. If validation/native patching fails, changed addon files are rolled
back. It retains `.native-ui/` and `data/`. Updates require internet access to GitHub.

After installation the addon service reloads, while 9router remains running.
Reload the browser and clear cache if needed. The source checkout may differ
from its Git HEAD after an in-app update; subsequent installs validate against
the last installed file hashes.

To remove the native UI patch:

```sh
node native-ui.mjs restore
```

This restores the original browser asset only if the installed file still matches
the expected addon version. A 9router upgrade can replace the patch; do not restore
an old file over an upgraded package. Archive the old `.native-ui/` backup and
prepare a new one for the upgraded version. Stop only the addon service when removing it.

### After upgrading 9router

The native UI patch is stored in a JavaScript asset inside the installed 9router
package. A 9router upgrade can replace that asset, so the quota bars and note may
disappear until the patch is applied again. The addon checkout, note file under
`data/`, and addon service are separate and do not need to be reinstalled. After
upgrading, keep a copy of `.native-ui/`, then prepare and apply against the new
installed package:

```sh
cp -a .native-ui .native-ui-before-router-upgrade
node native-ui.mjs prepare
node native-ui.mjs apply
```

Use the same explicit app path as the original installation if it is not the
default. If `prepare` reports an unrecognized provider page, the new 9router
version changed its UI; wait for a compatible addon update instead of restoring
an old asset. Force reload the dashboard or clear its cache after applying.

## Development and release preparation

```sh
npm ci --ignore-scripts
npm test
npm run build:release
```

Tests use mock accounts, upstreams and isolated files. They cover DOM integration,
notes, update validation and rollback. They do not replace testing an authenticated
browser after installation. UI/API changes or a different interface language may
require changes; ambiguous account rows are skipped rather than guessed.

Release artifacts appear in `dist/` and contain runtime code and documentation,
not notes, credentials, installed 9router assets, Git metadata or device paths.
Build the package from a clean reviewed tree. When a maintainer authorizes a release,
push the reviewed branch, create the matching stable tag and attach the generated
JSON asset to a GitHub Release. The updater trusts releases published by this repository's
maintainers; publish only reviewed code. Building locally does not upload or publish anything.

The repository also retains optional legacy userscript/proxy modes, documented in
`INSTALL.txt`. Their expiry storage is separate from native-mode administrator notes.

License: [MIT](LICENSE).
