# Missing credentials

Waypoint works fully with **zero** credentials. Everything below is optional and only adds a few extra details to checkpoints.

**Local AI needs no credentials or setup.** The engine is built into the app, and the model downloads automatically from Ollama's public registry (no account or API key).

## What I tried (credential procedure, step 1)

| Tool on this Mac | Result                                                                                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gcloud`         | Not installed, so no Google account was available to create an OAuth client from the command line.                                                              |
| `gh`             | Logged in, but nothing in Waypoint needs the GitHub API. GitHub repos, PRs and issues reopen directly from their URLs, and branch state comes from local `git`. |

No accounts were created, no sign-in pages were automated, and no secrets were written anywhere. `.env.example` has the placeholders.

---

## 1. Google OAuth client (Gmail, Google Drive, Google Calendar connectors)

|                            |                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Service**                | Google Cloud OAuth 2.0 client, type **Desktop app**                                                                                                                                                                                                                                                                                                                                              |
| **Unlocks**                | **Gmail:** lists drafts you touched in the last day (subject + id only) so a checkpoint can reopen them. **Drive:** fills in real file names for Google Docs/Sheets/Slides links (metadata only). **Calendar:** titles of Google Calendar events around a checkpoint, with a link to open them.                                                                                                  |
| **Scopes (all read-only)** | `gmail.readonly`, `drive.metadata.readonly`, `calendar.readonly`                                                                                                                                                                                                                                                                                                                                 |
| **Env vars (development)** | `WAYPOINT_GOOGLE_CLIENT_ID`, `WAYPOINT_GOOGLE_CLIENT_SECRET` (in `.env`, never committed)                                                                                                                                                                                                                                                                                                        |
| **File (packaged app)**    | `~/Library/Application Support/Waypoint/google-oauth-client.json`, either the JSON Google lets you download, or `{"client_id":"…","client_secret":"…"}`                                                                                                                                                                                                                                          |
| **Without it**             | Settings → Connectors shows each Google service as "Needs WAYPOINT_GOOGLE_CLIENT_ID" with the Connect button disabled. Gmail links already open in your browser are **still captured and reopened** through the browser adapter. Calendar.app events are still captured if you use Apple Calendar. Docs links keep their browser tab title instead of the Drive file name. Nothing else changes. |

Step-by-step setup is in **SETUP_GUIDE.md → Step 9**. A Desktop-app client "secret" isn't really secret (Google treats installed apps as public clients), but Waypoint still keeps it out of git and stores your sign-in tokens only in the Keychain-encrypted data folder.

**Status:** Code complete and unit-tested against mocked Google responses (PKCE loopback flow, token exchange, Gmail/Calendar/Drive parsing). **Not tested against real Google APIs**, because no client was available.

---

## 2. Apple Developer ID (code signing + notarization). Optional, not an API

|                                   |                                                                                                                                                                                                     |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Unlocks**                       | A signed, notarized `.dmg` that opens without Gatekeeper warnings. It also keeps your Accessibility/Automation permissions and Keychain access stable across app updates.                           |
| **Env vars (for `npm run dist`)** | `CSC_NAME` (your "Developer ID Application: …" certificate name), `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`                                                                        |
| **Without it**                    | The `.dmg` is **unsigned**. macOS will warn the first time you open it (right-click → Open), and you may need to re-grant Accessibility after installing a new build. See SETUP_GUIDE.md → Step 11. |
