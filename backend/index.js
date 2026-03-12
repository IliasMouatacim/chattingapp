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
const roomsBySocket = new Map();

const createSystemMessage = (text) => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  user: 'system',
  text,
  timestamp: new Date().toISOString(),
});

const sanitizeRoomCode = (value) =>
  String(value || '')
    .trim()
    .slice(0, 32)
    .replace(/[^a-zA-Z0-9_-]/g, '');

const emitOnlineUsers = () => {
  const users = Array.from(io.sockets.sockets.values()).map((client) => ({
    id: client.id,
    name: usersBySocket.get(client.id) || 'Anonymous',
  }));
  io.emit('online_users', users);
};

io.on('connection', (socket) => {
  socket.emit('chat_message', createSystemMessage('Connected to server. Pick a name and join the chat.'));
  emitOnlineUsers();

  socket.on('join_room', (rawName) => {
    const name = String(rawName || '').trim().slice(0, 24) || 'Anonymous';
    usersBySocket.set(socket.id, name);
    io.emit('chat_message', createSystemMessage(`${name} joined the room.`));
    emitOnlineUsers();
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

  socket.on('join_private_room', (rawRoomCode) => {
    const roomCode = sanitizeRoomCode(rawRoomCode);
    if (!roomCode) {
      return;
    }

    const roomName = `room:${roomCode}`;
    socket.join(roomName);

    const currentRooms = roomsBySocket.get(socket.id) || new Set();
    currentRooms.add(roomCode);
    roomsBySocket.set(socket.id, currentRooms);

    const user = usersBySocket.get(socket.id) || 'Anonymous';
    io.to(roomName).emit('room_message', {
      ...createSystemMessage(`${user} joined room #${roomCode}.`),
      room: roomCode,
    });
  });

  socket.on('send_room_message', (payload) => {
    const roomCode = sanitizeRoomCode(payload && payload.room);
    const text = String(payload && payload.text ? payload.text : '').trim().slice(0, 500);
    if (!roomCode || !text) {
      return;
    }

    const userRooms = roomsBySocket.get(socket.id);
    if (!userRooms || !userRooms.has(roomCode)) {
      return;
    }

    const roomName = `room:${roomCode}`;
    const user = usersBySocket.get(socket.id) || 'Anonymous';
    io.to(roomName).emit('room_message', {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      user,
      text,
      room: roomCode,
      from: socket.id,
      timestamp: new Date().toISOString(),
    });
  });

  socket.on('send_private_message', (payload) => {
    const to = String(payload && payload.to ? payload.to : '').trim();
    const text = String(payload && payload.text ? payload.text : '').trim().slice(0, 500);
    if (!to || !text) {
      return;
    }

    const user = usersBySocket.get(socket.id) || 'Anonymous';
    const message = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      user,
      text,
      from: socket.id,
      to,
      timestamp: new Date().toISOString(),
    };

    io.to(to).emit('private_message', message);
    socket.emit('private_message', message);
  });

  socket.on('typing', () => {
    const user = usersBySocket.get(socket.id);
    if (!user) {
      return;
    }
    socket.broadcast.emit('user_typing', user);
  });

  socket.on('stop_typing', () => {
    const user = usersBySocket.get(socket.id);
    if (!user) {
      return;
    }
    socket.broadcast.emit('user_stop_typing', user);
  });

  socket.on('call_user', (payload) => {
    const userToCall = String(payload && payload.userToCall ? payload.userToCall : '').trim();
    if (!userToCall || !payload || !payload.signalData) {
      return;
    }

    io.to(userToCall).emit('call_user', {
      signal: payload.signalData,
      from: socket.id,
      name: usersBySocket.get(socket.id) || payload.name || 'Anonymous',
    });
  });

  socket.on('answer_call', (payload) => {
    const to = String(payload && payload.to ? payload.to : '').trim();
    if (!to || !payload || !payload.signal) {
      return;
    }

    io.to(to).emit('call_accepted', payload.signal);
  });

  socket.on('ice_candidate', (payload) => {
    const to = String(payload && payload.to ? payload.to : '').trim();
    if (!to || !payload || !payload.candidate) {
      return;
    }

    io.to(to).emit('ice_candidate', {
      candidate: payload.candidate,
      from: socket.id,
    });
  });

  socket.on('end_call', (payload) => {
    const to = String(payload && payload.to ? payload.to : '').trim();
    if (!to) {
      return;
    }

    io.to(to).emit('end_call');
  });

  socket.on('disconnect', () => {
    const name = usersBySocket.get(socket.id);
    if (name) {
      socket.broadcast.emit('user_stop_typing', name);
      io.emit('chat_message', createSystemMessage(`${name} left the room.`));
      usersBySocket.delete(socket.id);
    }
    roomsBySocket.delete(socket.id);
    emitOnlineUsers();
  });
});

const port = Number(process.env.PORT) || 4000;
server.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
