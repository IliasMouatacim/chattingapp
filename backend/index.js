require('dotenv').config();

const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const app = express();

const allowedOrigins = (process.env.CLIENT_ORIGIN || '').split(',').map((origin) => origin.trim()).filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : '*',
  }),
);
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({ message: 'Chat backend is running.' });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins.length > 0 ? allowedOrigins : '*',
    methods: ['GET', 'POST'],
  },
});

const usersBySocket = new Map();

const createSystemMessage = (text) => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  user: 'system',
  text,
  timestamp: new Date().toISOString(),
});

io.on('connection', (socket) => {
  socket.emit('chat_message', createSystemMessage('Connected to server. Pick a name and join the chat.'));

  socket.on('join_room', (rawName) => {
    const name = String(rawName || '').trim().slice(0, 24) || 'Anonymous';
    usersBySocket.set(socket.id, name);
    io.emit('chat_message', createSystemMessage(`${name} joined the room.`));
  });

  socket.on('send_message', (rawText) => {
    const text = String(rawText || '').trim().slice(0, 500);
    if (!text) {
      return;
    }

    const user = usersBySocket.get(socket.id) || 'Anonymous';
    io.emit('chat_message', {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      user,
      text,
      timestamp: new Date().toISOString(),
    });
  });

  socket.on('disconnect', () => {
    const name = usersBySocket.get(socket.id);
    if (name) {
      io.emit('chat_message', createSystemMessage(`${name} left the room.`));
      usersBySocket.delete(socket.id);
    }
  });
});

const port = Number(process.env.PORT) || 4000;
server.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
