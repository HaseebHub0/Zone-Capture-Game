# Render Deploy Path

## What is ready

- `render.yaml` for Render web service
- `server.js` with `/health`
- `Dockerfile` if you prefer container deploy later

## Manual steps on Render

1. Create a new Web Service from this project
2. Use the Node environment
3. Start command: `node server.js`
4. Port: Render will inject `PORT`
5. After deploy, copy the live HTTPS URL

## After deploy

Update these files with the live URL:

- `capacitor.config.json`
- `app.json`

Replace:

- `https://YOUR_DEPLOYED_DOMAIN`
- `https://YOUR_RENDER_DOMAIN`

## Important

The APK/web wrapper must point at the live HTTPS deployment, not localhost.
