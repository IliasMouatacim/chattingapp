import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { io } from '../frontend/node_modules/socket.io-client/build/esm-debug/index.js';

function event(socket, name, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(name, handler); reject(new Error(`Timed out: ${name}`)); }, 4000);
    function handler(data) {
      if (predicate(data)) { clearTimeout(timer); socket.off(name, handler); resolve(data); }
    }
    socket.on(name, handler);
  });
}

test('HTTP and realtime regression suite', async t => {
  const server = spawn(process.execPath, ['index.js'], {
    cwd: new URL('../backend/', import.meta.url),
    env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const clients = [];
  t.after(async () => {
    clients.forEach(client => client.disconnect());
    const exited = once(server, 'exit');
    server.kill();
    await exited;
  });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Backend startup timeout')), 5000);
    server.once('error', reject);
    server.stdout.on('data', data => {
      const match = data.toString().match(/localhost:(\d+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  const url = `http://127.0.0.1:${port}`;
  await t.test('health endpoint', async () => {
    const response = await fetch(`${url}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
  });
  for (let i = 0; i < 3; i++) {
    const client = io(url, { transports: ['websocket'], autoConnect: false });
    clients.push(client);
    const connected = event(client, 'connect'); client.connect(); await connected;
  }
  const [a, b, outsider] = clients;
  await t.test('presence and explicit system messages', async () => {
    const joined = event(b, 'chat_message', m => m.text === 'system joined the room.');
    a.emit('join_room', 'system'); assert.equal((await joined).system, true);
    const presence = event(a, 'online_users', users => users.some(u => u.id === b.id && u.name === 'system'));
    b.emit('join_room', 'system'); await presence;
  });
  await t.test('global messages preserve sender identity with duplicate names', async () => {
    const received = event(b, 'chat_message', m => m.text === 'hello');
    a.emit('send_message', ' hello ');
    const message = await received;
    assert.equal(message.from, a.id); assert.equal(message.user, 'system'); assert.notEqual(message.system, true);
  });
  await t.test('room normalization and membership enforcement', async () => {
    for (const client of [a, b]) {
      const joined = event(client, 'room_message', m => m.room === 'testroom');
      client.emit('join_private_room', 'test room!'); await joined;
    }
    const seen = []; b.on('room_message', m => seen.push(m.text));
    outsider.emit('send_room_message', { room: 'testroom', text: 'unauthorized' });
    const received = event(b, 'room_message', m => m.text === 'authorized');
    a.emit('send_room_message', { room: 'testroom', text: 'authorized' });
    assert.equal((await received).from, a.id);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok(!seen.includes('unauthorized'));
  });
  await t.test('direct messages reach only recipient and sender', async () => {
    const leaked = []; outsider.on('private_message', m => leaked.push(m));
    const received = event(b, 'private_message'); const echoed = event(a, 'private_message');
    a.emit('send_private_message', { to: b.id, text: 'private' });
    assert.equal((await received).text, 'private'); assert.equal((await echoed).to, b.id);
    assert.equal(leaked.length, 0);
  });
  await t.test('room names cannot be used as directed message or call targets', async () => {
    const leaked = [];
    for (const name of ['private_message', 'call_user', 'call_accepted', 'ice_candidate', 'end_call']) b.on(name, data => leaked.push({ name, data }));
    a.emit('send_private_message', { to: 'room:testroom', text: 'leak' });
    a.emit('call_user', { userToCall: 'room:testroom', signalData: { type: 'offer' } });
    a.emit('answer_call', { to: 'room:testroom', signal: { type: 'answer' } });
    a.emit('ice_candidate', { to: 'room:testroom', candidate: {} });
    a.emit('end_call', { to: 'room:testroom' });
    await new Promise(resolve => setTimeout(resolve, 150)); assert.deepEqual(leaked, []);
  });
  await t.test('call offer, answer, ICE and hangup relay', async () => {
    let received = event(b, 'call_user'); a.emit('call_user', { userToCall: b.id, signalData: { type: 'offer' } });
    assert.equal((await received).from, a.id);
    received = event(a, 'call_accepted'); b.emit('answer_call', { to: a.id, signal: { type: 'answer' } });
    assert.equal((await received).type, 'answer');
    received = event(b, 'ice_candidate'); a.emit('ice_candidate', { to: b.id, candidate: { candidate: 'test' } });
    assert.equal((await received).from, a.id);
    received = event(a, 'end_call'); b.emit('end_call', { to: a.id }); await received;
  });
});
