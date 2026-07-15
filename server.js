const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const USERS_FILE = path.join(__dirname, 'users.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Simple JSON file "database" for users ----------
function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// In-memory session tokens: { token: username }
// (Resets if the server restarts — user just has to log in again, no big deal)
const sessions = {};

function makeToken() {
  return crypto.randomBytes(24).toString('hex');
}

// ---------- Auth routes ----------

// Create a new account
app.post('/api/signup', (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Username aur password dono zaroori hain' });
  }
  if (username.length < 3) {
    return res.status(400).json({ error: 'Username kam se kam 3 characters ka ho' });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: 'Password kam se kam 4 characters ka ho' });
  }

  const users = loadUsers();
  const key = username.toLowerCase();

  if (users[key]) {
    return res.status(409).json({ error: 'Ye username pehle se liya hua hai' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  users[key] = { username, passwordHash };
  saveUsers(users);

  const token = makeToken();
  sessions[token] = username;

  res.json({ token, username });
});

// Log in to an existing account
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Username aur password dono zaroori hain' });
  }

  const users = loadUsers();
  const key = username.toLowerCase();
  const user = users[key];

  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Galat username ya password' });
  }

  const token = makeToken();
  sessions[token] = user.username;

  res.json({ token, username: user.username });
});

// Verify a saved token (used to auto-login on page reload)
app.post('/api/verify', (req, res) => {
  const { token } = req.body || {};
  const username = sessions[token];
  if (!username) {
    return res.status(401).json({ error: 'Session expired, please log in again' });
  }
  res.json({ username });
});

// ---------- Chat (Socket.io) ----------

// Track connected users: { socket.id: username }
const onlineUsers = {};

io.on('connection', (socket) => {
  console.log(`New connection: ${socket.id}`);

  // Client must send a valid token to join the chat
  socket.on('join', ({ token }) => {
    const username = sessions[token];
    if (!username) {
      socket.emit('auth-error', 'Session invalid, please log in again');
      return;
    }
    socket.username = username;
    onlineUsers[socket.id] = username;
    socket.broadcast.emit('system-message', `${username} joined the chat`);
    io.emit('user-list', Object.values(onlineUsers));
  });

  socket.on('chat-message', (text) => {
    const username = onlineUsers[socket.id];
    if (!username) return; // not authenticated
    io.emit('chat-message', {
      username,
      text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  });

  socket.on('typing', () => {
    const username = onlineUsers[socket.id];
    if (username) socket.broadcast.emit('typing', username);
  });

  socket.on('disconnect', () => {
    const username = onlineUsers[socket.id];
    if (username) {
      delete onlineUsers[socket.id];
      socket.broadcast.emit('system-message', `${username} left the chat`);
      io.emit('user-list', Object.values(onlineUsers));
    }
    console.log(`Disconnected: ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`Chat app running at http://localhost:${PORT}`);
});
