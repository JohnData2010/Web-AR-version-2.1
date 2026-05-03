### Overview

This prototype is a static, client-side SPA intended to run inside a Qualtrics iframe, but you can run and test it locally with any static file server.

### Folder Structure

- `public/index.html` — main AR demo entry page (to be embedded in Qualtrics).
- `public/test-harness.html` — parent page to test `postMessage` (`cid` dropdown, `debug=1`).
- `src/main.js` — bootstrap, **`cid`** validation, **`AR_PROTO_AUDIT`** / **`AR_PROTO_ERROR`**, init UI.
- `src/ui.js` — screen flow: **Intro → Privacy notice → App permissions → Demo → Exit**.
- `src/conditions.js` — sixteen **`cid`** conditions (`M1_C1`…`M2_C8`); see **`docs/stimulus_spec.md`**.
- `src/logger.js` — dwell timers, interactions, lag flag, **`AR_PROTO_COMPLETE`** payload.
- `src/postmessage.js` — origin-aware `postMessage` sender.

### Running Locally

On **`localhost`**, **`127.0.0.1`**, or opening **`file:`** HTML, you may omit **`cid`** in the URL: the app will pick a random valid condition for preview. On a **deployed** host (e.g. `*.vercel.app`), **`cid` is still required** unless you add **`?debug=1`**.

Privacy notice (**Option B**): **M1_*** shows only the third-party paragraph; **M2_*** shows only retention — see **`docs/stimulus_spec.md`**.

You can use any static HTTP server. Examples below use Node.js, but Python or other tools work as well.

#### Option 1: `npx serve`

From the repository root:

```bash
npx serve .
```

The server will start on `http://localhost:3000` (or another port). Open:
- `http://localhost:3000/public/index.html` — main demo
- `http://localhost:3000/public/test-harness.html` — test harness

#### Option 2: Python HTTP server

```bash
python -m http.server 8000
```

Then open `http://localhost:8000/public/index.html`

---

### Deploying for Multiple Devices

To make the demo accessible via a public URL (for Qualtrics embedding or testing on multiple devices):

#### Option A: Netlify (Recommended - Easiest)

1. **Push code to GitHub** (create a repo and push your code)

2. **Sign up at [netlify.com](https://netlify.com)** (free account)3. **Deploy:**
   - Go to Netlify dashboard → "Add new site" → "Import an existing project"
   - Connect your GitHub repo
   - **Build settings:**
     - Build command: (leave empty or `echo "No build needed"`)
     - Publish directory: `.` (root)
   - Click "Deploy site"

4. **Result:** You'll get a URL like `https://your-site-name.netlify.app`
   - Main demo: `https://your-site-name.netlify.app/public/index.html?cid=M1_C1` (use the assigned `cid`)
   - Test harness: `https://your-site-name.netlify.app/public/test-harness.html`

5. **For Qualtrics:** Use the main demo URL in your iframe embed code

**Note:** The `netlify.toml` file in this repo configures redirects and headers for iframe embedding.

#### Option B: Vercel

1. **Install Vercel CLI:**
   ```bash
   npm i -g vercel
   ```

2. **Deploy:**
   ```bash
   vercel
   ```
   Follow prompts (defaults are fine)

3. **Result:** You'll get a URL like `https://your-site-name.vercel.app`

**Note:** The `vercel.json` file in this repo configures routes and headers.

#### Option C: ngrok (Quick Testing - Temporary URL)

For quick testing without deploying:

1. **Install ngrok:** [ngrok.com/download](https://ngrok.com/download)

2. **Start local server:**
   ```bash
   npx serve .
   ```

3. **In another terminal, start ngrok:**
   ```bash
   ngrok http 3000
   ```
   (Replace `3000` with your local server port)

4. **Result:** You'll get a temporary HTTPS URL like `https://abc123.ngrok.io`
   - Main demo: `https://abc123.ngrok.io/public/index.html?cid=M1_C1`
   - **Note:** Free ngrok URLs expire after 2 hours. Paid plans have persistent URLs.

#### Option D: GitHub Pages

1. **Push code to GitHub**

2. **Go to repo Settings → Pages**

3. **Source:** Deploy from branch `main` (or `master`), folder `/ (root)`

4. **Result:** `https://your-username.github.io/repo-name/public/index.html`

**Note:** GitHub Pages may require adjusting paths. You may need to move files or update import paths.

---

### Important Notes for Deployment

- **HTTPS is required for camera access** — All hosting options above provide HTTPS automatically
- **Iframe embedding:** The config files (`netlify.toml`, `vercel.json`) set headers to allow iframe embedding (needed for Qualtrics)
- **Camera permissions:** Users will need to allow camera access in their browser when using the demo
- **Testing:** Always test camera functionality on the deployed URL, not just locally
