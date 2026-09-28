# SnapChart Pro — project guide for Claude Code

## MANDATORY: Version bump on every single commit
**Every commit must bump ALL THREE of these:**
1. `1.x.x` in `src/ui/dashboard.js` (appversion span)
2. `1.x.x` in `src/ui/login.js` (footer span)
3. `const VERSION = "1.x.x"` in `public/sw.js`
4. `"version": "1.x.x"` in `package.json`

No exceptions. The VERSION in sw.js is what triggers the "Update available" toast on installed home screen apps — skipping it means coaches never see the new version.

## Deploy commands
```
npm run build
npx firebase deploy --only hosting:app        # app only
npx firebase deploy --only hosting            # app + admin
npx firebase deploy --only firestore:rules    # rules only
```

## Security
- `.env` must NEVER be committed — contains live Firebase API keys
- Admin email: rcatalano1@gmail.com
- Admin tool: https://snapchartpro-admin.web.app
- App: https://snapchartpro.web.app

## Architecture
- Vite + Firebase Auth + Firestore
- `src/ui/dashboard.js` — game list, settings modal, license activation
- `src/ui/game.js` — play charting screen
- `src/ui/login.js` — login screen
- `src/license.js` — license check/activation (Firestore `licenses` collection)
- `public/sw.js` — service worker (offline cache + update toast)
- `admin/index.html` — standalone license admin tool
