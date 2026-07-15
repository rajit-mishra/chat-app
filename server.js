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
const MESSAGES_FILE = path.join(__dirname, 'messages.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Simple JSON file "database" ----------
function loadJSON(file) {
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

const loadUsers = () => loadJSON(USERS_FILE);
const saveUsers = (u) => saveJSON(USERS_FILE, u);
const loadMessages = () => loadJSON(MESSAGES_FILE);
const saveMessages = (m) => saveJSON(MESSAGES_FILE, m);

// Conversation key for a pair of users (order-independent)
function convoKey(a, b) {
  return [a, b].sort((x, y) => x.localeCompare(y)).join('|');
}

// In-memory session tokens: { token: username }
const sessions = {};
function makeToken() {
  return crypto.randomBytes(24).toString('hex');
}

// ---------- Auth routes ----------

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

app.post('/api/verify', (req, res) => {
  const { token } = req.body || {};
  const username = sessions[token];
  if (!username) {
    return res.status(401).json({ error: 'Session expired, please log in again' });
  }
  res.json({ username });
});

// List every signed-up user (used to build the sidebar contact list)
app.get('/api/users', (req, res) => {
  const users = loadUsers();
  res.json(Object.values(users).map((u) => u.username));
});

// ---------- Chat (Socket.io) ----------

// Track who's online: { username: socket.id }
const onlineSockets = {};

function broadcastOnlineList() {
  io.emit('online-list', Object.keys(onlineSockets));
}

io.on('connection', (socket) => {
  socket.on('join', ({ token }) => {
    const username = sessions[token];
    if (!username) {
      socket.emit('auth-error', 'Session invalid, please log in again');
      return;
    }
    socket.username = username;
    onlineSockets[username] = socket.id;
    broadcastOnlineList();
  });

  // Client asks to open a conversation with someone -> send back history
  socket.on('open-chat', (otherUser) => {
    if (!socket.username) return;
    const messages = loadMessages();
    const key = convoKey(socket.username, otherUser);
    socket.emit('chat-history', { withUser: otherUser, messages: messages[key] || [] });
  });

  // Send a private message
  socket.on('private-message', ({ to, text }) => {
    const from = socket.username;
    if (!from || !to || !text) return;

    const messages = loadMessages();
    const key = convoKey(from, to);
    if (!messages[key]) messages[key] = [];

    const msg = {
      from,
      to,
      text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    messages[key].push(msg);
    saveMessages(messages);

    // Send to recipient if online
    const recipientSocketId = onlineSockets[to];
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('private-message', msg);
    }
    // Echo back to sender (so their own screen updates too)
    socket.emit('private-message', msg);
  });

  socket.on('typing', (to) => {
    const from = socket.username;
    if (!from || !to) return;
    const recipientSocketId = onlineSockets[to];
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('typing', from);
    }
  });

  socket.on('disconnect', () => {
    if (socket.username && onlineSockets[socket.username] === socket.id) {
      delete onlineSockets[socket.username];
      broadcastOnlineList();
    }
  });
});

server.listen(PORT, () => {
  console.log(`Chat app running at http://localhost:${PORT}`);
});
