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

const broadcastOnlineUsers = () => {
  const users = Array.from(usersBySocket.entries()).map(([id, name]) => ({ id, name }));
  io.emit('online_users', users);
};

io.on('connection', (socket) => {
  socket.emit('chat_message', createSystemMessage('Connected to server. Pick a name and join the chat.'));

  socket.on('join_room', (rawName) => {
    const name = String(rawName || '').trim().slice(0, 24) || 'Anonymous';
    usersBySocket.set(socket.id, name);
    io.emit('chat_message', createSystemMessage(`${name} joined the room.`));
    broadcastOnlineUsers();
  });

  socket.on('typing', () => {
    const user = usersBySocket.get(socket.id);
    if (user) {
      socket.broadcast.emit('user_typing', user);
    }
  });

  socket.on('stop_typing', () => {
    const user = usersBySocket.get(socket.id);
    if (user) {
      socket.broadcast.emit('user_stop_typing', user);
    }
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

  socket.on('send_private_message', ({ to, text }) => {
    const cleanText = String(text || '').trim().slice(0, 500);
    if (!cleanText || !to) return;

    const user = usersBySocket.get(socket.id) || 'Anonymous';
    const message = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      user,
      text: cleanText,
      timestamp: new Date().toISOString(),
      from: socket.id,
      to,
    };

    io.to(to).emit('private_message', message);
    if (to !== socket.id) {
      socket.emit('private_message', message);
    }
  });

  socket.on('join_private_room', (roomCode) => {
    const code = String(roomCode || '').trim().slice(0, 24);
    if (!code) return;

    socket.join(code);
    const user = usersBySocket.get(socket.id) || 'Anonymous';
    
    // Broadcast to the room that someone joined
    io.to(code).emit('room_message', createSystemMessage(`${user} joined the room.`));
  });

  socket.on('send_room_message', ({ room, text }) => {
    const cleanText = String(text || '').trim().slice(0, 500);
    const code = String(room || '').trim().slice(0, 24);
    if (!cleanText || !code) return;

    const user = usersBySocket.get(socket.id) || 'Anonymous';
    const message = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      user,
      text: cleanText,
      timestamp: new Date().toISOString(),
      room: code,
    };

    io.to(code).emit('room_message', message);
  });

  // WebRTC Signaling Events
  socket.on('call_user', ({ userToCall, signalData, from, name }) => {
    io.to(userToCall).emit('call_user', { signal: signalData, from, name });
  });

  socket.on('answer_call', ({ to, signal }) => {
    io.to(to).emit('call_accepted', signal);
  });

  socket.on('ice_candidate', ({ to, candidate }) => {
    io.to(to).emit('ice_candidate', { candidate, from: socket.id });
  });

  socket.on('end_call', ({ to }) => {
    io.to(to).emit('end_call');
  });

  socket.on('disconnect', () => {
    const name = usersBySocket.get(socket.id);
    if (name) {
      io.emit('chat_message', createSystemMessage(`${name} left the room.`));
      usersBySocket.delete(socket.id);
      broadcastOnlineUsers();
    }
  });
});

const port = Number(process.env.PORT) || 4000;
server.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
