#!/usr/bin/env node
// Points the website, Android app and iOS app at your real domain so shared
// game links open straight in the apps.
//
//   npm run set-domain -- pickup.mydomain.com
//   npm run set-domain -- pickup.mydomain.com --team ABCDE12345 --sha256 AA:BB:…
//
//   --team    Apple Developer Team ID (developer.apple.com → Membership)
//   --sha256  SHA-256 fingerprint of the key that signs your Android app
//             (Play Console → App integrity, or `keytool -list -v -keystore …`).
//             Repeatable, e.g. once for your upload key and once for debug builds.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const domain = args.find((a) => !a.startsWith('--') && !/^[0-9A-F:]{20,}$/i.test(a) && !/^[A-Z0-9]{10}$/.test(a));
const flag = (name) => args.flatMap((a, i) => (a === `--${name}` && args[i + 1] ? [args[i + 1]] : []));

if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain.replace(/^https?:\/\//, '').replace(/\/.*$/, ''))) {
  console.error('Usage: npm run set-domain -- yourdomain.com [--team APPLE_TEAM_ID] [--sha256 FINGERPRINT]');
  process.exit(1);
}
const host = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();

function update(file, fn) {
  const path = resolve(root, file);
  if (!existsSync(path)) return console.warn(`  skipped ${file} (not found)`);
  const before = readFileSync(path, 'utf8');
  const after = fn(before);
  if (after !== before) {
    writeFileSync(path, after);
    console.log(`  updated ${file}`);
  }
}

console.log(`Setting domain to ${host}`);
update('android/gradle.properties', (s) => s.replace(/^pickupDomain=.*$/m, `pickupDomain=${host}`));
update('ios/App/App/App.entitlements', (s) => s.replace(/<string>applinks:[^<]*<\/string>/, `<string>applinks:${host}</string>`));
for (const envFile of ['.env.local', '.env.production']) {
  update(envFile, (s) => (/^VITE_SITE_URL=.*$/m.test(s) ? s.replace(/^VITE_SITE_URL=.*$/m, `VITE_SITE_URL=https://${host}`) : `${s.trimEnd()}\nVITE_SITE_URL=https://${host}\n`));
}

const [team] = flag('team');
if (team) {
  update('public/.well-known/apple-app-site-association', (s) => s.replace(/"[A-Z0-9_]+\.com\.pickupsports\.app"/, `"${team}.com.pickupsports.app"`));
}
const shas = flag('sha256');
if (shas.length) {
  update('public/.well-known/assetlinks.json', (s) => {
    const json = JSON.parse(s);
    json[0].target.sha256_cert_fingerprints = shas.map((x) => x.toUpperCase());
    return `${JSON.stringify(json, null, 2)}\n`;
  });
}

console.log(`
Next:
  • Set VITE_SITE_URL=https://${host} in your hosting provider's environment variables too.
  • Rebuild the apps: npm run cap:sync${team ? '' : '\n  • Re-run with --team <Apple Team ID> before shipping the iOS app.'}${shas.length ? '' : '\n  • Re-run with --sha256 <signing cert fingerprint> before shipping the Android app.'}`);
