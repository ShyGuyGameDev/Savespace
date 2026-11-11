# Savespace setup guide

Follow the steps **in order**. Each step says exactly what to do, what you should see when it worked, and what to try if it didn't.

> **The one command, once steps 1–2 are done:** in Terminal, inside the Savespace folder, run `npm install && npm start`.

**Contents**

1. Check your Mac
2. Install the tools Savespace needs
3. Download Savespace's dependencies
4. Start Savespace
5. Walk through the welcome screens
6. Allow Accessibility
7. Allow Automation (per app)
8. Set up local AI (optional)
9. Connect Google (optional)
10. Run the tests (optional)
11. Build the installable `.dmg`
12. Your first checkpoint and restore
13. Troubleshooting

---

## Step 1. Check your Mac

1. Click the **Apple menu ()** in the top-left corner → **About This Mac**.
2. Check the **macOS** version. Savespace supports **macOS 15 (Sequoia), 26 (Tahoe), and 27**. It was built and tested on **macOS 27.0.1**.
3. Check the **Chip**. The ready-made `.dmg` is for **Apple Silicon (M1 or later)**. On an Intel Mac, see Step 11.3.

✅ **Worked if:** you're on macOS 15 or newer.

---

## Step 2. Install the tools Savespace needs

You need **Node.js 22.12 or newer** (this includes `npm`) and **Git**.

1. Open **Terminal**: press **⌘ Space**, type `Terminal`, press **Return**.
2. Check whether Node.js is installed. Type this and press **Return**:
   ```
   node -v
   ```
   - If you see `v22.12.0` or higher (for example `v24.x` or `v26.x`), skip to item 5.
   - If you see `command not found` or a lower number, continue with item 3.
3. Go to **https://nodejs.org**, click the big **LTS** download button, open the downloaded `.pkg`, and click **Continue → Agree → Install**. Enter your Mac password when asked.
4. **Quit Terminal completely (⌘ Q), open it again**, and re-run `node -v`. You should now see a version number.
5. Check Git:
   ```
   git --version
   ```
   If a box pops up asking to install the **command line developer tools**, click **Install** and wait for it to finish (a few minutes), then run `git --version` again.

✅ **Worked if:** both `node -v` and `git --version` print version numbers.

❗ **If `node -v` still says "command not found"** after installing, quit and reopen Terminal. If that doesn't fix it, restart your Mac.

---

## Step 3. Download Savespace's dependencies

1. In Terminal, go to the Savespace folder:
   ```
   cd ~/Savespace
   ```
   (If you keep the project elsewhere, type `cd ` with a space, drag the folder from Finder into the Terminal window, and press **Return**.)
2. Install everything:
   ```
   npm install
   ```
   This takes 2–4 minutes. It downloads Electron (about 100 MB) and Savespace's built-in AI engine (about 186 MB, checksum-verified).

✅ **Worked if:** it ends with a line like `added 700 packages` and `found 0 vulnerabilities`, with no red `ERR!` lines.

❗ **If you see `npm warn install-scripts`:** run `npm install-scripts ls`. The scripts Savespace needs (Electron, esbuild, the SQLite library) are already approved in `package.json`, so this list should say _No packages with unreviewed install scripts_.
❗ **If you see `EACCES` or permission errors:** don't use `sudo`. Make sure the folder belongs to you: `sudo chown -R $(whoami) ~/Savespace`, then retry.

---

## Step 4. Start Savespace

1. In the same Terminal window, run:
   ```
   npm start
   ```
2. Wait about 10 seconds the first time (it builds the app).

✅ **Worked if:**

- A **Savespace** window opens with "Welcome to Savespace".
- A small **circle-with-a-flag icon** appears in your **menu bar** (top-right of the screen).

To stop Savespace: right-click the menu-bar icon → **Quit Savespace** (or press **Control-C** in Terminal).

❗ **If the window doesn't open and Terminal says `Cannot read properties of undefined (reading 'whenReady')`:** your terminal has `ELECTRON_RUN_AS_NODE` set (some editors' built-in terminals do this). The `npm start` script already removes it. If you started Electron some other way, use `npm start`, or run Savespace from the regular Terminal app.
❗ **If you see "Savespace could not open its database":** see Troubleshooting → _Keychain_.

---

## Step 5. Walk through the welcome screens

The first window explains everything before macOS asks for anything. You can **Skip for now** on any permission step; Savespace still works with less detail.

1. **Welcome** → click **Continue**.
2. **What stays on your Mac** → read what's remembered and what never is → **Continue**.
3. **Let Savespace see window titles** → see Step 6.
4. **Ask your apps what's open** → see Step 7.
5. **Local summaries, built in** → the AI model starts downloading by itself (see Step 8). Click **Continue**.
6. **You're set** → click **Start using Savespace**.

✅ **Worked if:** you now see the dashboard with a sidebar (Projects, Suggestions, Apps, Privacy, Settings).

You can see these screens again later: **Settings → Show the welcome & permissions guide again**.

---

## Step 6. Allow Accessibility (recommended)

**What it's for:** reading the **titles and positions** of your windows, and which document each window shows. Savespace does **not** need or ask for Screen Recording.

1. On the welcome screen's Accessibility step, click **Open System Settings**. (Later: **Privacy** in the sidebar → Accessibility → **Allow…**.)
2. macOS shows a box: _"Savespace would like to control this computer using accessibility features."_ Click **Open System Settings**.
3. **System Settings → Privacy & Security → Accessibility** opens.
4. Find the app in the list and **turn its switch on**:
   - When running from Terminal with `npm start`, it's called **Electron**.
   - When running the installed app from the `.dmg`, it's called **Savespace**.
   - If it isn't listed, click **+** (bottom of the list), go to **Applications**, pick **Savespace**, and click **Open**.
5. Enter your Mac password or use Touch ID if asked.
6. Go back to the Savespace window.

✅ **Worked if:** within about 2 seconds the step shows a green **Allowed** badge. (Later: **Privacy → Permissions → Accessibility: Allowed**.)

❗ **Still not allowed after switching it on:** switch it **off and on again**, then quit Savespace and run `npm start` again. macOS sometimes only notices after a restart of the app.
❗ **Without it:** Savespace still knows which app is in front and still reads tabs, editor files, and drafts from apps that support it. It just can't tell your windows apart or see document paths.

---

## Step 7. Allow Automation (per app, recommended)

**What it's for:** asking individual apps read-only questions, such as Chrome ("which tabs are open?"), Mail ("which draft is selected?"), Notes, Calendar, Finder, and Terminal. macOS asks **once per app**.

> **Note: closed apps will be opened when you ask.** macOS can only ask for permission while an app is running. So if an app is closed when you click **Ask**, Savespace opens it quietly in the background first (it won't jump in front of you), then macOS asks. The app stays open afterwards; quit it whenever you like.

1. On the welcome screen's Automation step, click **Ask** next to each app you use (for example Google Chrome, Safari, Mail, Notes, Calendar). The button says **Waiting for your answer…** while macOS shows its question.
2. macOS shows: _"Savespace" wants access to control "Google Chrome"…_ (when running from Terminal it says **"Electron"**). Click **Allow**. You have up to 2 minutes.
3. Repeat for each app you want. A short note under each app tells you what happened.

✅ **Worked if:** each row shows a green **Allowed** badge. You can also check **System Settings → Privacy & Security → Automation → Savespace (or Electron)**: each app has its switch on.

❗ **If you clicked "Don't Allow" by mistake:** open **System Settings → Privacy & Security → Automation**, find **Savespace** (or **Electron**), and turn on the switch for that app. The Privacy page in Savespace has an **Open Settings** button that takes you there.
❗ **"No answer yet":** the question was missed or took longer than 2 minutes. Click **Ask** again and choose **Allow**.
❗ **If you skip this step,** nothing gets opened. macOS asks the first time Savespace needs each app while you have it open, and you can allow it then.
❗ **Safari:** tab reading is **off by default** because Safari can't tell Savespace which windows are private. Turn it on in **Settings → Capture → Capture Safari tabs** if you want it. Reopening pages in Safari works either way.

---

## Step 8. Local AI (built in, usually nothing to wait for)

**What it's for:** a 2–3 sentence "What you were doing" recap written by AI that runs **entirely on your Mac**.

Savespace picks the best option automatically:

1. **Apple's on-device AI (Apple Intelligence).** This is used first, whenever your Mac has it: macOS 26 or later, Apple silicon, Apple Intelligence turned on. It's already part of macOS, so **nothing downloads and there's no wait**.
2. **Small built-in model.** On Macs without Apple Intelligence, Savespace quietly downloads a small model (`llama3.2:3b`, about 2 GB, one time) in the background using its built-in engine. Until it's ready you get simple summaries, so nothing is blocked.

✅ **Worked if:** **Settings → Local AI → Now using:** shows **Apple on-device AI** (or **Downloaded model** once the download finishes). New checkpoints show the matching badge next to "What you were doing". Click **Test** to try it.

- **To use Apple's AI if it says "Apple Intelligence is off":** open **System Settings → Apple Intelligence & Siri** and turn it on. Savespace switches over automatically.
- **"macOS is still downloading Apple's model":** macOS fetches it on its own. Savespace uses it as soon as it's ready.
- **AI source** (Settings → Local AI): **Automatic** (recommended), **Apple on-device AI only**, or **Downloaded model only**. You can also pick a larger downloaded model there; it downloads automatically.
- **Don't want AI at all?** Turn off **Use local AI for summaries**.
- **Privacy:**
  - Apple's model is used only in its **on-device** form. Savespace never uses Apple's Private Cloud Compute.
  - The downloaded model runs only on `127.0.0.1` while Savespace runs, and **can't reach the internet except to download the model you chose**. Every other attempt is blocked and logged in **Privacy → Activity log**.
  - Both are stored and used inside `~/Library/Application Support/Savespace/ai`.

❗ **"Apple on-device AI: Not included in this build":** the small Apple helper is compiled during `npm install`/`npm start`/`npm run dist` and needs the Xcode Command Line Tools from Step 2. Run `npm run build:apple-ai`, then start Savespace again.
❗ **Download stuck or errored:** check your internet connection, then **Settings → Local AI → Download**.

---

## Step 9. Connect Google (optional: Gmail drafts, Drive file names, Calendar events)

Savespace works fully without this. Gmail and Docs tabs you have open are still captured and reopened through your browser. This step only adds recently edited Gmail drafts, real Drive file names, and Google Calendar events.

All access is **read-only**: `gmail.readonly`, `drive.metadata.readonly`, `calendar.readonly`.

### 9.1 Create a Google OAuth client (one time, about 10 minutes)

1. Go to **https://console.cloud.google.com/** and sign in.
2. At the top, click the **project picker** → **New project** → name it `Savespace` → **Create**. Make sure it's selected afterwards.
3. Turn on the three APIs. Search for each in the top search bar, open it, and click **Enable**:
   - **Gmail API**
   - **Google Drive API**
   - **Google Calendar API**
4. Left menu → **Google Auth Platform** (older consoles: **APIs & Services → OAuth consent screen**) → **Get started**:
   - App name: `Savespace`; support email: yours → **Next**.
   - Audience: **External** → **Next**.
   - Contact email: yours → **Next** → agree → **Create**.
5. **Audience → Test users → Add users** → add your own Google address → **Save**.
6. **Data access → Add or remove scopes** → tick `.../auth/gmail.readonly`, `.../auth/drive.metadata.readonly`, `.../auth/calendar.readonly` → **Update** → **Save**.
7. **Clients → Create client** → Application type **Desktop app** → name `Savespace` → **Create**.
8. Click **Download JSON** in the box that appears.

### 9.2 Give the client to Savespace (choose A or B)

- **A. For the installed app (`.dmg`):**
  1. Rename the downloaded file to `google-oauth-client.json`.
  2. In Finder press **⇧⌘G**, type `~/Library/Application Support/Savespace`, press **Return**.
  3. Move `google-oauth-client.json` into that folder.
- **B. When running with `npm start`:**
  1. In the project folder, copy the template: `cp .env.example .env`
  2. Open `.env` in a text editor and paste the **Client ID** and **Client secret** from the console:
     ```
     SAVESPACE_GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
     SAVESPACE_GOOGLE_CLIENT_SECRET=GOCSPX-...
     ```
  3. Save. `.env` is ignored by git and is never committed.

### 9.3 Connect

1. Restart Savespace.
2. **Settings → Connectors** → click **Connect Gmail** (then Drive, then Calendar, as you like).
3. Your browser opens Google's sign-in. Choose your account. You'll see _"Google hasn't verified this app"_ because it's your own test app: click **Continue**, review the read-only permissions, and click **Continue** again.
4. The browser shows "Connected. You can close this tab."

✅ **Worked if:** each service shows **Disconnect** instead of **Connect** in Settings, and **Privacy → Activity log** shows "Connected gmail (read-only)".

❗ **Connect button is greyed out with "Needs SAVESPACE_GOOGLE_CLIENT_ID":** Savespace didn't find your client. Check the file name and folder (A) or the `.env` spelling (B), then restart Savespace.
❗ **"Access blocked" / `access_denied`:** add your Google address as a **Test user** (9.1 item 5).
❗ **`client_secret is missing`:** make sure the secret is in the JSON or `.env` as well as the ID.
❗ **To revoke:** Settings → **Disconnect** (deletes the token), and optionally https://myaccount.google.com/permissions → Savespace → **Remove access**.

---

## Step 10. Run the tests (optional)

In Terminal, in the project folder:

| Command                              | What it checks                                                                                                                                                | Expected                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `npm test`                           | All unit + integration tests (safety linter, SafeExec, privacy filter, encrypted DB, adapters, restore engine, fixture hashes)                                | `Tests 273 passed`                          |
| `npm run test:e2e`                   | Clicks through the real app (onboarding, dashboard, preview restore, Suggestions, Privacy, Settings, palette, popover). Nothing is actually opened (dry-run). | `7 passed`                                  |
| `npm run audit:safety`               | Privacy & safety audit; writes `docs/evidence/safety-audit-results.txt`                                                                                       | `RESULT: PASS`                              |
| `npm run audit:safety -- --live`     | Same, plus a **live** restore that really opens test files in TextEdit, Preview and Finder, then proves they're byte-for-byte unchanged                       | `RESULT: PASS` (a few windows open briefly) |
| `npm run typecheck` / `npm run lint` | Code quality                                                                                                                                                  | No output / no errors                       |

---

## Step 11. Build the installable `.dmg`

1. In Terminal, in the project folder:
   ```
   npm run dist
   ```
   Takes 1–3 minutes.
2. ✅ **Worked if:** the last lines mention `building target=DMG` and the file **`release/Savespace-0.1.0-arm64.dmg`** exists. Open the `release` folder in Finder with: `open release`

### 11.1 Install it

1. Double-click `Savespace-0.1.0-arm64.dmg`, then drag **Savespace** to **Applications**.
2. Open **Applications** and double-click **Savespace**.
3. Because this build is **unsigned**, macOS says _"Savespace" can't be opened_ / _cannot verify the developer_. Click **Done** (not Move to Trash).
4. Open **System Settings → Privacy & Security**, scroll to **Security**, find _"Savespace" was blocked…_, click **Open Anyway**, and confirm with your password.
5. Grant permissions again for the installed app (Steps 6–7). This time the list says **Savespace**, not Electron.

**What "unsigned" means:** the app works normally. macOS just can't confirm who made it, so you get the warning once. Permissions you grant are tied to this exact build; after installing a **new** unsigned build you may need to switch Accessibility off and on again.

### 11.2 Signing and notarization (only if you have an Apple Developer account, $99/year)

1. In Xcode → Settings → Accounts, add your Apple ID and create a **Developer ID Application** certificate (or download it from developer.apple.com → Certificates).
2. Create an app-specific password at **https://account.apple.com → Sign-In and Security → App-Specific Passwords**.
3. In `electron-builder.yml`, delete the line `identity: null` and change `notarize: false` to `notarize: true`.
4. Build with:
   ```
   CSC_NAME="Developer ID Application: Your Name (TEAMID)" \
   APPLE_ID="you@example.com" APPLE_APP_SPECIFIC_PASSWORD="abcd-efgh-ijkl-mnop" APPLE_TEAM_ID="TEAMID" \
   npm run dist
   ```
5. ✅ The `.dmg` now opens with no warning. Check with `spctl -a -vv /Applications/Savespace.app` (should say _accepted, source=Notarized Developer ID_).

### 11.3 Intel Macs

In `electron-builder.yml`, change `arch: [arm64]` to `arch: [arm64, x64]` and run `npm run dist` again.

---

## Step 12. Your first checkpoint and restore

1. Open a few things for one piece of work, for example a project folder in VS Code or Cursor, two related browser tabs, and a document.
2. Press **⌥⌘S** (Option-Command-S) anywhere. A notification says **Checkpoint saved**.
3. Open the dashboard (click the menu-bar icon → **Dashboard**). Under **All checkpoints** you'll see it, with **What you were doing** and every saved item grouped by app.
4. Close some of those windows yourself.
5. Select the checkpoint and press **R** (or click **Preview restore**). You'll see **exactly what will open**; untick anything you don't want.
6. Click **Restore** (or press **Return**). Each item shows **Opened**, **Already open** (focused, not duplicated), **Skipped**, or **Failed**, with a reason.
7. **Projects:** after you've worked for a while, open **Suggestions**. Savespace proposes projects from repeated folders, repos, sites and meetings. Press **C** to confirm, **E** to rename, **X** to dismiss. Nothing becomes a project until you confirm it.
8. **From anywhere:** press **⌥⌘Space** for the command palette, type part of a project name, and press **Return** to resume it (**⌘Return** opens it in the dashboard instead).
9. Press **?** in the dashboard for every keyboard shortcut.
10. **Edit anything:** on a checkpoint, click **Edit** to change the "What you were doing" text or remove saved items (then **Save changes**). On a project, use the **⋯** menu → **Edit project…** to change its name, colour and "What belongs to this project" (folders and websites). Use **Delete project…** to remove it; its checkpoints are kept as unassigned.

Savespace also saves checkpoints automatically when you switch projects, go idle (10 minutes by default), at 6 pm, and when your Mac sleeps or locks. You can change all of this in **Settings**. **Arrange windows** (moving windows back to their old positions) is **off** by default.

---

## Step 13. Troubleshooting

| Problem                                                           | Fix                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **⌥⌘Space or ⌥⌘S does nothing**                                   | Another app may already use that shortcut. Change it in **Settings → Keyboard** (for example `Control+Alt+Space`) and click elsewhere to save.                                                                                                                                                                                         |
| **"Savespace could not open its database"** / **Keychain**         | Savespace keeps its database key in your Keychain. If you clicked **Deny** on a Keychain prompt, quit Savespace and open it again, then click **Always Allow**. To start completely fresh (deletes Savespace data only): quit Savespace, then `rm -rf ~/Library/Application\ Support/Savespace` (or `.../Electron` when using `npm start`). |
| **Restore says "Automation permission needed…"**                  | Step 7: System Settings → Privacy & Security → Automation → Savespace → turn on that app.                                                                                                                                                                                                                                               |
| **Restore says "File no longer exists"**                          | The file was moved, renamed or deleted since the checkpoint. Savespace never creates files, so it reports this instead.                                                                                                                                                                                                                 |
| **VS Code files open without jumping to the line**                | Install the `code` command: in VS Code press **⇧⌘P**, type **Shell Command: Install 'code' command in PATH**, press Return. (Cursor: same, with `cursor`.)                                                                                                                                                                             |
| **JetBrains files don't jump to the line**                        | In the IDE: **Tools → Create Command-line Launcher…**                                                                                                                                                                                                                                                                                  |
| **No suggestions appear**                                         | Suggestions need a few separate work sessions on the same folder/repo/site. Click **Look again** on the Suggestions page, or create a project yourself (**New project**).                                                                                                                                                              |
| **Too much or too little is captured**                            | **Privacy → Exclusions:** add websites, folders, apps or title words to ignore. **Settings → Capture:** pause automatic capture.                                                                                                                                                                                                       |
| **I want to see or delete everything**                            | **Privacy → Export everything (JSON)** opens the export in Finder. **Privacy → Delete all data…** (type DELETE) wipes everything Savespace stored; your files and apps are untouched.                                                                                                                                                   |
| **The app looks wrong in dark mode / animations are distracting** | Savespace follows **System Settings → Appearance** and **Accessibility → Display → Reduce motion** automatically.                                                                                                                                                                                                                       |
