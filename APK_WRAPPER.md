# APK Wrapper Path

This project is now ready for a hosted-web plus Android-wrapper flow.

## Recommended path

1. Deploy the multiplayer server on HTTPS
2. Update `capacitor.config.json` `server.url`
3. Install Capacitor dependencies
4. Generate the Android shell
5. Build APK or AAB in Android Studio

## Why this path

The multiplayer game depends on a live WebSocket server, so a pure offline APK is not enough. The Android app should wrap the hosted multiplayer client.

## Capacitor commands

```powershell
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap add android
npx cap sync android
```

Then open the Android project in Android Studio and build the APK.
