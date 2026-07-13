const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Serve static frontend files from the "public" folder
app.use(express.static(path.join(__dirname, 'public')));

// Track connected users: { socket.id: username }
const users = {};

io.on('connection', (socket) => {
  console.log(`New connection: ${socket.id}`);

  // When a user joins with a username
  socket.on('join', (username) => {
    users[socket.id] = username;
    socket.broadcast.emit('system-message', `${username} joined the chat`);
    io.emit('user-list', Object.values(users));
  });

  // When a user sends a chat message
  socket.on('chat-message', (text) => {
    const username = users[socket.id] || 'Anonymous';
    io.emit('chat-message', {
      username,
      text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  });

  // Typing indicator
  socket.on('typing', () => {
    const username = users[socket.id];
    if (username) socket.broadcast.emit('typing', username);
  });

  // When a user disconnects
  socket.on('disconnect', () => {
    const username = users[socket.id];
    if (username) {
      delete users[socket.id];
      socket.broadcast.emit('system-message', `${username} left the chat`);
      io.emit('user-list', Object.values(users));
    }
    console.log(`Disconnected: ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`Chat app running at http://localhost:${PORT}`);
});
