# Deploying Roomie+

How to run your own copy of Roomie+ with sync between roommates and receipt scanning. All the files in this repository together are what you put on the internet.

Just want a demo? Under Settings > Pages, choose "Deploy from a branch", branch `main`, folder `/ (root)`. That publishes the app in on-phone mode.

## What you get at each step

| After step | What works |
|---|---|
| 1. Put it online | The app, on your home screen, with everything saved on that one phone. No sync, no photo scanning. |
| 2 and 3. Add Firebase | Roommates join with a link and everyone sees the same money, list and chores. Works offline and syncs later. |
| 4. Add a Claude API key | Photograph a receipt and the lines are read for you. |

You can stop after any step. You need a computer for the setup (to unzip, edit one file and upload a folder). Using the app only needs a phone.

---

## Step 1. Put it online (about 5 minutes, free)

1. Make a free account at [dash.cloudflare.com](https://dash.cloudflare.com).
2. Open **Workers & Pages**, then **Create application** > **Get started** > **Drag and drop your files**.
3. Name the project, for example `roomieplus`. The name becomes your address: `roomieplus.pages.dev`.
4. Download this repository (Code > Download ZIP), unzip it, drag the folder into the box, then press **Deploy site**.
5. Open the address on your phone.
   - **iPhone:** open it in Safari, tap Share, then **Add to Home Screen**.
   - **Android:** open it in Chrome, tap the menu, then **Install app** (or use the Install button in the app's House tab).

To publish a change later: open the project in Cloudflare, press **Create a new deployment**, and drag the folder in again.

## Step 2. Create the sync database (about 10 minutes, free)

1. Go to [console.firebase.google.com](https://console.firebase.google.com), sign in with a Google account and create a project. You can turn Google Analytics off.
2. **Build > Firestore Database > Create database.** Pick the location nearest you. Either starting mode is fine, because the next step replaces the rules.
3. Open the **Rules** tab, delete what is there, paste the contents of `firestore.rules` from this folder, and press **Publish**.
4. **Build > Authentication > Get started > Sign-in method > Anonymous > Enable.** Roomie+ uses this to sign each phone in silently. Nobody types a password.

## Step 3. Point the app at your database

1. In Firebase, open **Project settings** (the gear) > **General** > **Your apps**, press the web icon `</>`, give it any nickname and register it. You do not need Firebase Hosting.
2. Firebase shows a block that starts `const firebaseConfig = { ... }`. Copy the part between the braces.
3. Open `config.js` in a text editor. Replace `firebase: null` with `firebase: { ...what you copied... }`. The file shows the exact shape.
4. Upload again (Step 1, "To publish a change later").
5. Open the app. It now offers **Start a new household**. Do the setup once, then go to **House > Invite your roommates** and send them the link.

These Firebase values are not secret. They only say which project to talk to. The rules from Step 2 are what protect the data.

## Step 4. Turn on receipt scanning (optional, pay per use)

Scanning sends the photo to Claude through the small server file `_worker.js`. It needs your own Claude API key, which is billed separately from any Claude subscription.

1. Create an API key in the Claude Console at [platform.claude.com/settings/keys](https://platform.claude.com/settings/keys) and add some credit. Check your monthly spend limit on the Console's Billing page and keep it low.
2. In Cloudflare, open your project > **Settings** > **Variables and Secrets** > **Add**. Type: **Secret**. Name: `ANTHROPIC_API_KEY`. Value: your key. Save.
3. Create a new deployment (upload the folder again) so the key takes effect.
4. Check it: open `https://YOUR-ADDRESS.pages.dev/api/scan` in a browser. It should show `{"ok":true,"ready":true}`. The app then shows "Photograph or pick a receipt" when you tap +.

The key stays on Cloudflare and never reaches a phone. Scanning uses the `claude-sonnet-5-5` model; to use another, add a variable named `SCAN_MODEL`.

---

## If something does not work

- **`/api/scan` shows a "not found" page.** The server file did not deploy. Make sure `_worker.js` sits at the top level next to `index.html`, and deploy again.
- **`/api/scan` shows `"ready":false`.** The key is not set, or you have not deployed since adding it.
- **"Can't reach your household".** Check that Anonymous sign-in is enabled (Step 2.4) and that `config.js` has the full block. If it still fails, add your `pages.dev` address under Firebase > Authentication > Settings > Authorized domains.
- **"The sync server refused that".** The Firestore rules were not published (Step 2.3).
- **An iPhone asks for the household code after adding to the home screen.** That is expected: iPhones give a home-screen app its own storage. Copy the code from House > Invite before installing, then paste it once.
- **You changed a file but the phone shows the old version.** Close the app fully and open it again while online.

## Things to know about this prototype

- **The household code is the key.** Anyone who has a household's code or invite link can read and change that household. Share it only with roommates. There are no accounts or passwords.
- **Reminders appear inside the app only.** Month-end and chore-day notices show when someone opens Roomie+. It does not send push notifications, texts or e-mails yet.
- **Roomie+ never moves money.** "Open my bank" opens the bank's own site; "I've paid" only records it.
- **Anyone who can use your site can use scanning**, which spends your API credit. The spend limit on the Console's Billing page (Step 4) is your safety net.
- **Free tiers.** Cloudflare Pages and Firebase's free plan comfortably cover a handful of households. Firebase stops syncing for the rest of the day if the free daily quota is ever used up.

## What has and has not been tested

Tested before this was handed over: the app in on-phone mode, reopening it offline, the start / join / wrong-code flows against a stand-in sync backend, the three-person split and debt math, the fair chore schedule, and every request path of the scan server against a canned Claude reply.

Not tested, because it needs your accounts: a real Firebase project, a real Cloudflare deployment, a real receipt photo through the Claude API, and installing on an actual iPhone or Android phone. Treat the first run of each as the test.

## What is in this repository

- `index.html`, `app.js`, `styles.css`: the app (plain JavaScript, no build step)
- `config.js`: the one file you edit (Firebase settings)
- `sync.js`: Firebase, bundled from `firebase-adapter.js`
- `_worker.js`: the scan server (runs on Cloudflare, never sent to phones)
- `sw.js`, `manifest.webmanifest`, the icons and the fonts: what makes it installable and work offline
- `firestore.rules`: paste into Firebase (Step 2.3)
- `worker.test.mjs`: checks for the scan server

For developers: `npm install`, then `npm run build` rebuilds `sync.js`, and `npm test` runs the scan-server checks. `npx serve .` (or any static server) runs the app locally in on-phone mode.
