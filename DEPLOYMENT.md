# Deployment Notes

## Requirements

- Node.js runtime
- WebSocket support
- HTTPS in production

## Local

```powershell
node server.js
```

Open:

```text
http://localhost:3000
```

## Docker

```powershell
docker build -t zone-clash-arena .
docker run -p 3000:3000 zone-clash-arena
```

## Platform checklist

- Expose port `3000` or use platform `PORT`
- Keep WebSockets enabled
- Use sticky sessions only if you later add multi-instance state sharing
- For horizontal scale, move room state to Redis or another shared backend

## Recommended next production step

Move room and match state from in-memory storage to Redis once you want multi-instance hosting.
