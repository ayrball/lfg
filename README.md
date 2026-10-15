# Pickup 🏟️

Find a pickup game near you, or host one and fill it fast.

- **Host a game** at a venue (search or drop a pin), set time, player limits and skill level — with sensible defaults per sport
- **Pings**: everyone within your chosen radius (5–50 mi) who plays that sport gets notified (push + in-app inbox).
  Hosts see how many players were pinged; players get a daily ping limit and quiet hours
- **RSVP** going / maybe / can't go, with an **automatic waitlist** that promotes people when spots open
- **Reminders & nudges**: everyone going is reminded an hour before; games short of players re-ping nearby players
- **Check-in** at the venue (GPS-verified within the game's check-in area: court, complex or big park)
- **Live roster & game chat** (host messages notify everyone), edit/cancel, share link with rich previews, calendar, directions
- **Safety**: report or block players, hosts can remove players
- **First-run setup** so new players pick their sports and home area before anything else
- **Website + Android app + iPhone app** from one codebase. One account works everywhere; games, RSVPs, chat
  and notifications sync live between all three, and shared game links open straight in the app when it's installed

**Stack (all free tiers):** React + Vite (website / PWA) · Capacitor (Android & iOS apps) · Supabase (Postgres + PostGIS, Auth, Realtime, Edge Functions) ·
Leaflet + OpenStreetMap · Photon place search · Web Push (VAPID) · Cloudflare Pages (or Vercel) for hosting + custom domain.

---

## 1. Create the backend (Supabase, free)

1. Sign up at <https://supabase.com> → **New project** (pick a region near your players). Save the DB password.
2. **Create the schema** — either:
   - **Dashboard:** SQL Editor → run each file in [`supabase/migrations/`](supabase/migrations/) **in order**
     (`…_init.sql`, then `…_improvements.sql`, then `…_scheduler.sql`), **or**
   - **CLI:**
     ```bash
     npx supabase login
     npx supabase link --project-ref YOUR_PROJECT_REF
     npx supabase db push
     ```
3. **Auth settings** (Dashboard → Authentication):
   - *URL Configuration*: set **Site URL** to your domain (e.g. `https://pickup.yourdomain.com`) and add
     `http://localhost:5641/**` and `https://pickup.yourdomain.com/**` to **Redirect URLs**.
   - *Email*: Supabase's built-in mailer only sends a few emails per hour and only to your team's addresses,
     so for real users either **turn off “Confirm email”** (simplest to start) or add free custom SMTP
     (e.g. [Resend](https://resend.com), 3,000 emails/month) under *Authentication → SMTP*.
   - *Optional — Google sign-in*: Providers → Google, paste a Google OAuth client ID/secret.
4. **Let the scheduler find your push function** (SQL Editor, once — use your own project URL):
   ```sql
   select vault.create_secret('https://YOUR-PROJECT-REF.supabase.co', 'project_url');
   ```
   Every minute the database sends reminders, "needs players" nudges and any notifications the app didn't
   deliver itself (e.g. the sender closed the app straight away).
5. **Reports** from players land in the `reports` table (Table Editor). Check it now and then.

## 2. Push notifications (optional but recommended)

```bash
npx web-push generate-vapid-keys
```

```bash
npx supabase secrets set VAPID_PUBLIC_KEY=<public> VAPID_PRIVATE_KEY=<private> VAPID_SUBJECT=mailto:you@yourdomain.com
```

```bash
npx supabase functions deploy dispatch-push --no-verify-jwt
```

Put the **public** key in `VITE_VAPID_PUBLIC_KEY` (next step). Without push, notifications still land in the in-app 🔔 inbox.

## 3. Run locally

```bash
cp .env.example .env.local   # fill in URL + anon/publishable key (Project Settings → API) + VAPID public key
npm install
npm run dev
```

## 4. Deploy with a custom domain (free)

**Cloudflare Pages** (recommended — free SSL, unlimited bandwidth):

1. Push this repo to GitHub.
2. Cloudflare dashboard → Workers & Pages → Create → Pages → connect the repo.
   Build command `npm run build`, output directory `dist`.
3. Add environment variables `VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY`, `VITE_VAPID_PUBLIC_KEY`.
4. Custom domains → add `pickup.yourdomain.com` (Cloudflare sets up DNS + HTTPS).
5. Add that domain to Supabase **Site URL / Redirect URLs** (step 1.3).

Shared game links get rich previews (title, time, spots left) from the Pages Function in
[`functions/games/[id].ts`](functions/games/[id].ts) — it uses the same environment variables, so add them for
both *Production* and *Preview*.

**Vercel** works too (`vercel.json` handles SPA routing), but link previews are Cloudflare-only.

**Keep Supabase awake:** free projects pause after 7 days without activity. The included GitHub Action
([`.github/workflows/keepalive.yml`](.github/workflows/keepalive.yml)) pings the database every 3 days — add
repository secrets `SUPABASE_URL` and `SUPABASE_KEY` (the anon/publishable key) under
*Settings → Secrets and variables → Actions*.

The only cost is the domain itself (~$10–15/yr).

## 5. Android & iPhone apps

The apps in [`android/`](android) and [`ios/`](ios) are [Capacitor](https://capacitorjs.com) shells around the same
React code, talking to the same Supabase backend as the website. Inside the apps you get native location, the
system share sheet, native push notifications, the Android back button, and deep links.

**After any change to the web code**, copy it into both apps:

```bash
npm run cap:sync
```

### Point the apps at your domain

Game links like `https://yourdomain.com/games/…` open in the app (Android App Links / iOS Universal Links):

```bash
npm run set-domain -- yourdomain.com --team YOUR_APPLE_TEAM_ID --sha256 YOUR_ANDROID_SIGNING_SHA256
```

This updates the Android and iOS projects plus the two verification files in `public/.well-known/` that your
website must serve. Also add `com.pickupsports.app://auth-callback` to Supabase **Redirect URLs** so Google
sign-in can return to the app.

### Android

- **Run on a phone or emulator:** `npm run android` opens Android Studio → press ▶.
- **Build an installable APK:** `npm run android:apk` → `android/app/build/outputs/apk/debug/app-debug.apk`.
  Or let GitHub build it: the **Mobile apps** workflow uploads the APK on every push to `main`.
- **Google Play:** one-time $25 developer account. In Android Studio: *Build → Generate Signed App Bundle*, upload
  the `.aab` in the Play Console. Use the SHA-256 shown under *App integrity* with `set-domain --sha256`.

### iPhone

Building iOS apps requires a Mac with Xcode (Apple's rule). Options:

- **Have a Mac:** `npm run ios` opens Xcode → pick your team under *Signing & Capabilities* → ▶.
- **No Mac:** run the **Mobile apps** workflow manually (*Actions → Mobile apps → Run workflow*). It compiles the
  iOS app on a GitHub macOS machine. To ship to TestFlight/App Store without a Mac, connect the repo to a cloud
  Mac service such as [Codemagic](https://codemagic.io) (free tier) with your Apple certificates.
- **App Store:** Apple Developer Program, $99/year. Before submitting, set `aps-environment` to `production` in
  [`ios/App/App/App.entitlements`](ios/App/App/App.entitlements).

### Push notifications in the apps (optional)

Players always get the 🔔 inbox. For phone notifications:

- **Android (Firebase, free):** create a Firebase project → add an Android app with package `com.pickupsports.app` →
  download `google-services.json` into `android/app/` (or save it as the `GOOGLE_SERVICES_JSON` GitHub secret).
  Then *Project settings → Service accounts → Generate new private key* and store it on Supabase:
  ```bash
  npx supabase secrets set FCM_SERVICE_ACCOUNT="$(cat path/to/service-account.json)"
  ```
- **iPhone (APNs):** in the Apple Developer portal create an APNs key (*Keys → +*, enable Apple Push Notifications)
  and enable the Push Notifications capability for `com.pickupsports.app`. Then:
  ```bash
  npx supabase secrets set APNS_KEY_ID=ABC123 APNS_TEAM_ID=YOUR_TEAM_ID APNS_PRIVATE_KEY="$(cat AuthKey_ABC123.p8)"
  ```
  Add `APNS_SANDBOX=true` while testing builds installed from Xcode.
- Set `VITE_NATIVE_PUSH=true`, redeploy `dispatch-push`, and run `npm run cap:sync`.

## Free-tier limits to know

| Service | Limit | Notes |
|---|---|---|
| Supabase | 500 MB DB, 50k monthly active users, 500k edge function calls | Projects **pause after 7 days with no activity** — the keep-awake GitHub Action prevents this. If it ever happens, resume from the dashboard; the app shows a “Can't reach Pickup” screen with retry meanwhile. |
| OpenStreetMap tiles | Fair use | Fine for launch. At scale switch to MapTiler/Stadia free tiers (one-line change in `src/components/maps.tsx`). |
| Photon search | Fair use | Same — swap in another geocoder if traffic grows. |

## How it works

```
src/
  pages/            Feed (nearby list + map), HostGame, GameDetail, EditGame, Profile, Notifications, Login
  components/       Maps (Leaflet), place search, game form, cards, layout
  lib/              Supabase client, auth context, geo helpers, push subscription, formatting
  sw.ts             Service worker: offline app shell + Web Push display / click handling
supabase/
  migrations/       Schema, RLS policies, RPCs (create_game, set_rsvp, check_in, …)
  functions/        dispatch-push — sends queued notifications as Web Push
```

- **Radius matching** uses PostGIS `ST_DWithin` on indexed `geography` points.
  A player is pinged when they're within *both* the host's ping radius and their own preferred radius.
- **All writes that matter go through Postgres functions** (`create_game`, `set_rsvp`, `check_in`, `update_game`,
  `cancel_game`), which lock the game row so the roster can never overfill, and enforce host-only actions.
- **Row Level Security** keeps home locations, notifications and push subscriptions private, and limits chat to participants.
- **Notifications** are rows in `notifications`; the app calls the `dispatch-push` function after actions,
  which atomically claims undelivered rows and sends them via Web Push (expired subscriptions are cleaned up).

## Ideas for next steps

- Password reset ("forgot password") flow
- Player reliability score (no-shows vs check-ins) and post-game ratings
- Recurring weekly games, private/invite-only games, friends & groups
- Auto-balanced teams from the checked-in roster
- Venue directory with photos and court/field details
- Store listings (screenshots, privacy policy page) for Google Play and the App Store

## License

Licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE). You are free to use, modify and share this for personal, hobby, educational, research and other noncommercial purposes.

**Commercial use** (selling it, building a paid product or service on it, or using it in a business) needs a separate license from the author. Commercial licenses are available: get in touch via [github.com/ayrball](https://github.com/ayrball) to discuss terms.
