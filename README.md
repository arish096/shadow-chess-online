# ♞ Shadow Chess Online

A premium dark-themed, real-time multiplayer chess web app. It uses `chess.js` for authoritative legal chess moves and Socket.IO for live room communication.

## Features
- Create private match rooms and join with a room code
- Play solo against a lightweight server-side computer opponent with Easy, Medium and Hard levels
- Real-time move synchronization over WebSockets
- Server-side legal move validation and turn enforcement
- Check, checkmate, stalemate, draw detection, castling, en passant and pawn promotion
- Move history, captured pieces, board flip, draw offers and resignation
- Responsive dark UI for desktop and mobile
- No paid APIs or accounts required

## Requirements
- Node.js 18+
- Internet connection for the first install (to download npm packages and Google Fonts; the app itself uses no paid API)

## Run locally
```bash
npm install
npm start
```
Open the port shown in your terminal (for example, http://localhost:3001 if you selected port 3001). Open the same URL in another browser/device on the same network or deploy the app to a public Node.js host for remote play.

## Deploy online for free (Render)

1. Upload this whole project folder to a new GitHub repository.
2. Open [Render](https://render.com/) and sign in using GitHub.
3. Choose **New → Web Service**, connect your chess repository, and select the `main` branch.
4. Set **Build Command** to `npm install` and **Start Command** to `npm start`.
5. Choose the **Free** instance, then click **Deploy Web Service**.
6. When deployment finishes, open the `onrender.com` URL and share that URL plus the room code with your friend.

Free Render services can sleep after inactivity and may take about a minute to wake up. Rooms are stored in memory, so they reset if the service restarts.

Deploy this project to a Node.js-compatible host that supports long-running HTTP servers and WebSockets. Set the start command to `npm start`. The host must allow Socket.IO/WebSocket connections. A static-only host such as GitHub Pages cannot run the multiplayer server.

**Important:** Rooms are stored in server memory. Restarting/redeploying the server clears rooms and matches; this starter app is intended for casual play and demos, not ranked or tournament use. For durable games at scale, add a database, authentication, rate limiting and reconnect/session management.

## Tech
- Node.js + Express
- Socket.IO
- chess.js
- Plain HTML, CSS and JavaScript frontend
