# Personal Chat App

A real-time chat app built with **Node.js + Express + Socket.io**. Multiple people can join, see who's online, chat live, and see typing indicators — no page refresh needed.

## Features
- **Real accounts** — sign up with username + password, log back in anytime
- Passwords securely hashed (bcrypt) — never stored as plain text
- Auto-login — browser remembers you (saved token) until you log out
- **WhatsApp-style private chat** — sidebar shows every signed-up user, with a green dot for who's online
- Click any user to open a **one-to-one private conversation** — messages only go between you two, no group chat
- **Chat history saved** — reopen a conversation anytime and see past messages
- Typing indicator (only shown to the person you're chatting with)
- Clean dark-mode UI, no frontend framework needed

## How it works
- **Accounts** — stored in `users.json`, passwords hashed with bcrypt
- **Sessions** — on login, a random token is saved in the browser's `localStorage`, so reopening the site logs you back in automatically
- **Contact list** — the sidebar always shows *all* signed-up users (fetched from `/api/users`), with online status live-updated via Socket.io
- **Private messages** — stored in `messages.json`, keyed by the pair of usernames involved, so history persists across sessions
- ⚠️ **Note:** `users.json` and `messages.json` live on Render's filesystem, which is *not* permanent — a redeploy or free-tier restart can wipe them. Fine for personal/hobby use; for production you'd want a real database (e.g. PostgreSQL) later.

## Project structure
```
chat-app/
├── server.js          # Express + Socket.io backend
├── package.json
└── public/
    └── index.html      # Frontend (HTML/CSS/JS in one file)
```

## Setup

**Requirements:** [Node.js](https://nodejs.org) v16+ installed on your machine.

1. Unzip/copy this folder anywhere on your computer.
2. Open a terminal in the `chat-app` folder.
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start the server:
   ```bash
   npm start
   ```
5. Open your browser to:
   ```
   http://localhost:3000
   ```
6. Enter a username and start chatting. Open a second browser tab (or have a friend on the same network visit `http://YOUR_LOCAL_IP:3000`) to test real-time messaging between two "users."

## How it works (quick overview)
- **server.js** creates an Express server and attaches Socket.io to it. Every browser tab that connects becomes a "socket." When a socket sends a `chat-message` event, the server broadcasts it to *all* connected sockets via `io.emit(...)`, which is what makes the chat "real-time."
- **public/index.html** connects to the server via `socket.io.js` (auto-served by Socket.io), then listens for events (`chat-message`, `user-list`, `typing`, `system-message`) and updates the page live using plain JavaScript — no React/Vue needed for something this size.

## Letting others chat with you over the internet
Running `npm start` only works on your local network by default. To let friends chat with you from anywhere, deploy it for free on one of these:
- **Render** (render.com) – free tier, connect your GitHub repo, it auto-detects Node apps
- **Railway** (railway.app) – similar, very quick deploys
- **Glitch** (glitch.com) – paste code directly in browser, no GitHub needed

All three: push this folder to a GitHub repo, connect the repo on the platform, and it'll give you a public URL.

## Extending it
Some natural next steps if you want to keep building:
- **Persistent messages** — messages disappear on server restart; add a database (SQLite or MongoDB) to save chat history
- **Private rooms/DMs** — use `socket.join(roomName)` to create chat rooms
- **Authentication** — add real login instead of just typing a name
- **Message reactions/images** — extend the `chat-message` event to support more data

## Reference repos on GitHub
If you want to compare against other implementations or dig deeper:
- Socket.io official chat example: https://github.com/socketio/socket.io/tree/main/examples/chat
- Socket.io "Get Started" chat tutorial: https://socket.io/get-started/chat/
