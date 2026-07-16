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
const REQUESTS_FILE = path.join(__dirname, 'requests.json');
const CONNECTIONS_FILE = path.join(__dirname, 'connections.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Simple JSON file "database" ----------
function loadJSON(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

const loadUsers = () => loadJSON(USERS_FILE, {});
const saveUsers = (u) => saveJSON(USERS_FILE, u);
const loadMessages = () => loadJSON(MESSAGES_FILE, {});
const saveMessages = (m) => saveJSON(MESSAGES_FILE, m);
const loadRequests = () => loadJSON(REQUESTS_FILE, []); // [{from, to}]
const saveRequests = (r) => saveJSON(REQUESTS_FILE, r);
const loadConnections = () => loadJSON(CONNECTIONS_FILE, {}); // { "alice|bob": true }
const saveConnections = (c) => saveJSON(CONNECTIONS_FILE, c);

function convoKey(a, b) {
  return [a, b].sort((x, y) => x.localeCompare(y)).join('|');
}
function areConnected(a, b) {
  const connections = loadConnections();
  return connections[convoKey(a, b)] === true;
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

app.get('/api/users', (req, res) => {
  const users = loadUsers();
  res.json(Object.values(users).map((u) => u.username));
});

// ---------- Chat (Socket.io) ----------

const onlineSockets = {}; // { username: socket.id }

function broadcastOnlineList() {
  io.emit('online-list', Object.keys(onlineSockets));
}

// Build a user's current status: their connections, sent requests, received requests
function getStatusFor(username) {
  const connections = loadConnections();
  const requests = loadRequests();

  const myConnections = Object.keys(connections)
    .filter((key) => connections[key] && key.split('|').includes(username))
    .map((key) => key.split('|').find((u) => u !== username));

  const sentRequests = requests.filter((r) => r.from === username).map((r) => r.to);
  const receivedRequests = requests.filter((r) => r.to === username).map((r) => r.from);

  return { connections: myConnections, sentRequests, receivedRequests };
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
    socket.emit('my-status', getStatusFor(username));
  });

  // ----- Chat requests -----

  socket.on('send-request', (to) => {
    const from = socket.username;
    if (!from || !to || from === to) return;
    if (areConnected(from, to)) return;

    const requests = loadRequests();
    const alreadySent = requests.some((r) => r.from === from && r.to === to);
    if (alreadySent) return;

    requests.push({ from, to });
    saveRequests(requests);

    socket.emit('request-sent-ack', to);

    const targetSocketId = onlineSockets[to];
    if (targetSocketId) {
      io.to(targetSocketId).emit('incoming-request', from);
    }
  });

  socket.on('accept-request', (from) => {
    const to = socket.username;
    if (!to || !from) return;

    let requests = loadRequests();
    const exists = requests.some((r) => r.from === from && r.to === to);
    if (!exists) return;

    requests = requests.filter((r) => !(r.from === from && r.to === to));
    saveRequests(requests);

    const connections = loadConnections();
    connections[convoKey(from, to)] = true;
    saveConnections(connections);

    // Tell the accepter (me) directly
    socket.emit('connection-established', { withUser: from, iAccepted: true });

    // Tell the original requester, if online, that their request was accepted
    const requesterSocketId = onlineSockets[from];
    if (requesterSocketId) {
      io.to(requesterSocketId).emit('connection-established', { withUser: to, iAccepted: false });
    }
  });

  socket.on('reject-request', (from) => {
    const to = socket.username;
    if (!to || !from) return;
    let requests = loadRequests();
    requests = requests.filter((r) => !(r.from === from && r.to === to));
    saveRequests(requests);
    socket.emit('request-rejected-ack', from);
  });

  // ----- Private chat (only allowed once connected) -----

  socket.on('open-chat', (otherUser) => {
    if (!socket.username) return;
    if (!areConnected(socket.username, otherUser)) {
      socket.emit('not-connected', otherUser);
      return;
    }
    const messages = loadMessages();
    const key = convoKey(socket.username, otherUser);
    socket.emit('chat-history', { withUser: otherUser, messages: messages[key] || [] });
  });

  socket.on('private-message', ({ to, text }) => {
    const from = socket.username;
    if (!from || !to || !text) return;
    if (!areConnected(from, to)) {
      socket.emit('not-connected', to);
      return;
    }

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

    const recipientSocketId = onlineSockets[to];
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('private-message', msg);
    }
    socket.emit('private-message', msg);
  });

  socket.on('typing', (to) => {
    const from = socket.username;
    if (!from || !to || !areConnected(from, to)) return;
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
