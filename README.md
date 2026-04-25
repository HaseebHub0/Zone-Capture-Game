# Zone Clash Arena

Room-based multiplayer zone capture game for phones and browsers.

## Local run

1. `node server.js`
2. Open `http://localhost:3000`
3. Create a room on one device and join with the room code from other devices

## Included upgrades

- Real room create/join multiplayer
- Reconnect token flow with recovery
- Disconnect grace period with temporary bot assist
- Shareable invite link UI
- Latency ping and client-side interpolation smoothing
- PWA manifest and service worker
- Docker deployment setup
- Capacitor wrapper config path for APK builds

## Production deploy

Use any Node host that supports WebSockets. Quick paths:

- Docker: `docker build -t zone-clash-arena .` then run on port `3000`
- Render/Railway/Fly.io: point the service at `node server.js`
- Health check: `/health`

## APK wrapper path

Deploy the server first, then point `capacitor.config.json` `server.url` at your live HTTPS domain.

After that, a typical Android wrapper flow is:

1. `npm install @capacitor/core @capacitor/cli @capacitor/android`
2. `npx cap add android`
3. `npx cap sync android`
4. Open Android Studio and build the APK/AAB
