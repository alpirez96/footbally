// server.js — Footbally backend
const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const { generateQuestions } = require('./questionGenerator');

const app = express();
app.use(express.json());
app.use(require('cors')());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const rooms = new Map();

const ROOM_MAX     = 5;
const Q_DURATION_MS = 10_000;
const Q_COUNT      = 10;
const BASE_POINTS  = 1000;
const VALID_MODES  = ['europe', 'turkey'];

const makeCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();

app.get('/', (_, res) => {
  res.json({ status: 'ok', service: 'Footbally backend', rooms: rooms.size });
});

app.post('/create-room', (req, res) => {
  const code = makeCode();
  rooms.set(code, {
    code,
    hostId:   null,
    players:  new Map(),
    questions: [],
    currentQ: -1,
    state:    'lobby',
    mode:     'europe',
    answers:  new Map(),
    qStartTs: 0,
    timer:    null,
  });
  console.log(`[${code}] oda oluşturuldu`);
  res.json({ code });
});

app.get('/leaderboard/:code', (req, res) => {
  const room = rooms.get(req.params.code);
  if (!room) return res.status(404).json({ error: 'room not found' });
  res.json(buildLeaderboard(room));
});

function buildLeaderboard(room) {
  return [...room.players.entries()]
    .map(([id, p]) => ({ id, name: p.name, score: p.score }))
    .sort((a, b) => b.score - a.score);
}

function broadcast(room, event, payload) {
  io.to(room.code).emit(event, payload);
}

function calcScore(correct, responseMs) {
  if (!correct) return 0;
  const remaining = Math.max(0, Q_DURATION_MS - responseMs);
  return BASE_POINTS + Math.round((remaining / Q_DURATION_MS) * BASE_POINTS);
}

function nextQuestion(room) {
  clearTimeout(room.timer);
  room.currentQ += 1;
  room.answers = new Map();

  if (room.currentQ >= room.questions.length) {
    room.state = 'finished';
    broadcast(room, 'game_over', { leaderboard: buildLeaderboard(room) });
    console.log(`[${room.code}] oyun bitti`);
    return;
  }

  const q = room.questions[room.currentQ];
  room.qStartTs = Date.now();

  broadcast(room, 'question', {
    index:      room.currentQ,
    total:      room.questions.length,
    question:   q.question,
    sub:        q.sub,
    options:    q.options,
    durationMs: Q_DURATION_MS,
  });

  room.timer = setTimeout(() => revealAndAdvance(room), Q_DURATION_MS);
}

function revealAndAdvance(room) {
  const q = room.questions[room.currentQ];
  broadcast(room, 'reveal', {
    correct:     q.correct,
    leaderboard: buildLeaderboard(room),
  });
  setTimeout(() => nextQuestion(room), 2500);
}

io.on('connection', (socket) => {
  socket.on('join_room', ({ code, name }, ack) => {
    const room = rooms.get(code);
    if (!room)                     return ack({ ok: false, error: 'Oda bulunamadı' });
    if (room.state !== 'lobby')    return ack({ ok: false, error: 'Oyun başlamış' });
    if (room.players.size >= ROOM_MAX) return ack({ ok: false, error: 'Oda dolu' });

    room.players.set(socket.id, { name: (name || 'Anon').slice(0, 16), score: 0 });
    if (!room.hostId) room.hostId = socket.id;
    socket.join(code);
    socket.data.roomCode = code;

    ack({ ok: true, isHost: room.hostId === socket.id });
    broadcast(room, 'lobby_update', {
      players: [...room.players.values()].map(p => p.name),
      mode:    room.mode,
    });
    console.log(`[${code}] ${name} katıldı (${room.players.size}/${ROOM_MAX})`);
  });

  // Host mod seçer, lobi güncellenir
  socket.on('set_mode', ({ mode }, ack) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room)                      return ack?.({ ok: false, error: 'Oda yok' });
    if (room.hostId !== socket.id)  return ack?.({ ok: false, error: 'Sadece host mod seçebilir' });
    if (room.state !== 'lobby')     return ack?.({ ok: false, error: 'Oyun başlamış' });

    room.mode = VALID_MODES.includes(mode) ? mode : 'europe';
    ack?.({ ok: true });
    broadcast(room, 'lobby_update', {
      players: [...room.players.values()].map(p => p.name),
      mode:    room.mode,
    });
    console.log(`[${room.code}] mod → ${room.mode}`);
  });

  socket.on('start_game', async ({ mode } = {}, ack) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room)                      return ack?.({ ok: false, error: 'Oda yok' });
    if (room.hostId !== socket.id)  return ack?.({ ok: false, error: 'Sadece host başlatabilir' });
    if (room.state !== 'lobby')     return ack?.({ ok: false, error: 'Zaten çalışıyor' });

    // mode parametresi gelirse güncelle
    if (mode && VALID_MODES.includes(mode)) room.mode = mode;

    try {
      room.questions = await generateQuestions(Q_COUNT, room.mode);
      room.state = 'playing';
      broadcast(room, 'game_started', { totalQuestions: Q_COUNT, mode: room.mode });
      setTimeout(() => nextQuestion(room), 1500);
      ack?.({ ok: true });
      console.log(`[${room.code}] oyun başladı (mod: ${room.mode})`);
    } catch (err) {
      console.error(`[${room.code}] soru üretilemedi:`, err.message);
      ack?.({ ok: false, error: 'Sorular üretilemedi: ' + err.message });
    }
  });

  socket.on('submit_answer', ({ answer }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.state !== 'playing') return;
    if (room.answers.has(socket.id)) return;

    const responseMs = Date.now() - room.qStartTs;
    const q = room.questions[room.currentQ];
    const correct = answer === q.correct;
    const gained  = calcScore(correct, responseMs);

    room.answers.set(socket.id, { answer, ts: responseMs });
    const player = room.players.get(socket.id);
    if (player) player.score += gained;

    socket.emit('answer_ack', { correct, gained, responseMs });

    if (room.answers.size === room.players.size) {
      clearTimeout(room.timer);
      revealAndAdvance(room);
    }
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    room.players.delete(socket.id);

    if (room.hostId === socket.id) {
      room.hostId = room.players.keys().next().value || null;
    }
    if (room.players.size === 0) {
      clearTimeout(room.timer);
      rooms.delete(room.code);
      console.log(`[${room.code}] oda kapatıldı (boş)`);
      return;
    }
    broadcast(room, 'lobby_update', {
      players: [...room.players.values()].map(p => p.name),
      mode:    room.mode,
    });
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Footbally on :${PORT}`));
