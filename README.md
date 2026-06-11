# SwipeRush

A real-time mobile web game where players race to **swipe-reveal** a blurred image. First to 95% wins!

Built with **Node.js + Express** and a vanilla HTML/CSS/JS frontend. It has no build step and can run locally or on Vercel.

## Screenshots

| Home | Admin Lobby | Playing | Results |
|------|-------------|---------|---------|
| ![Home](screenshots/home.png) | ![Lobby](screenshots/admin-lobby.png) | ![Game](screenshots/game.png) | ![Results](screenshots/results.png) |

## Features

- 🎮 **Real-time multiplayer** — HTTP polling for rooms, timer sync, and progress
- 🖼️ **Scratch-off canvas** — swipe to reveal a blurred image underneath
- 👑 **Admin controls** — set time limit (15–120s), manage images, finish early
- 📸 **Multiple images** — upload up to 5 PNGs; each round picks one at random
- 🏆 **Winner detection** — first player to 95% wins; top 3 shown on a podium
- 🌓 **Light/dark theme** — toggled with a button, saved to localStorage
- 📱 **Mobile-first** — responsive UI with bouncy animations and confetti
- ☁️ **Vercel-ready** — polling-based API works on serverless; Vercel KV is recommended for multiplayer rooms

## How to Play

1. **Host** creates a room, uploads images, and shares the 4-letter code
2. **Players** join with a nickname
3. **Host** starts the game — each player sees a blurred image
4. **Swipe** to scratch off the blur and reveal the image
5. **First to 95%** wins! Results show on a podium with confetti 🎉

## Run Locally

```sh
npm install
npm start
```

Open `http://localhost:3000` on your phone or desktop.

## Deploy on Vercel

```sh
npm i -g vercel
vercel
```

The API uses HTTP polling instead of WebSocket, so it can run in Vercel's serverless environment.

### Important: use shared storage for Vercel room state

Vercel serverless functions do not guarantee that every request uses the same warm instance. If room state is only stored in memory, the host can create a room on one instance and then hit another instance during image upload or start, causing `Unauthorized` or `Room not found`.

The simplest option is Vercel KV:

1. Go to **Vercel Dashboard → Storage** for your project
2. Click **"Create Database"** → select **"Vercel KV"**
3. Choose the region closest to your players (e.g., Singapore for Asia)
4. The environment variables are auto-linked — redeploy:

```sh
npx vercel deploy --prod --yes
```

The KV store keeps rooms alive across cold starts and serverless instances. Without it, the game uses in-memory fallback (works for single-instance sessions).

You do not have to use Redis/KV specifically, but multiplayer on Vercel still needs shared storage. Practical alternatives:

1. **Postgres** via Vercel Postgres, Neon, Supabase, or Railway.
2. **Firebase/Firestore** for document-style room state.
3. **A persistent Node host** such as Railway, Render, Fly.io, or a VPS, where one Node process can keep in-memory room state and optionally use WebSocket.

Vercel Blob/object storage is not recommended for this game state because players update progress frequently and object writes are not a good fit for low-latency mutable room data.

### Troubleshooting: Start Game stays disabled

The host can start only after at least one PNG upload is successfully saved by the API. If the button stays disabled:

1. Confirm the upload uses PNG files and no more than 5 images.
2. Check that the `set-images` request returns success in the browser Network tab.
3. Call `/api/health`. `durableStorage` should be `true` on Vercel for reliable multiplayer.
4. On Vercel, confirm KV environment variables are attached to the deployment and redeploy after creating KV.

## Tech Stack

- **Backend:** Node.js, Express-style serverless handler
- **Frontend:** Vanilla HTML/CSS/JS (no frameworks or build tools)
- **Realtime:** HTTP polling
- **Persistence:** Vercel KV when configured; in-memory fallback locally or without KV
