// server.js — Footbally v2
const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const { generateQuestions, loadAndGetHLChain } = require('./questionGenerator');

const app = express();
app.use(express.json());
app.use(require('cors')());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const rooms = new Map();

const ROOM_MAX    = 5;
const BASE_POINTS = 1000;

// ── Ayarlar ───────────────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  gameMode:            'quickfire',  // quickfire | career | squad | higherlower
  questionCount:       10,           // 5 10 15 20 30
  questionDurationMs:  10000,        // 5000 10000 15000 20000 30000
  difficulty:          'normal',     // easy | normal | hard
  playerPool:          'europe',     // europe | turkey | mixed | strikers_only
  speedBonus:          true,
  showLeaderboardLive: true,
  hintsEnabled:        true,
};

const VALID_GAME_MODES   = ['quickfire','career','squad','higherlower'];
const VALID_COUNTS       = [5,10,15,20,30];
const VALID_DURATIONS    = [5000,10000,15000,20000,30000];
const VALID_DIFFICULTIES = ['easy','normal','hard'];
const VALID_POOLS        = ['europe','turkey','mixed','strikers_only'];

function validateSettings(raw = {}) {
  return {
    gameMode:            VALID_GAME_MODES.includes(raw.gameMode)          ? raw.gameMode            : DEFAULT_SETTINGS.gameMode,
    questionCount:       VALID_COUNTS.includes(Number(raw.questionCount)) ? Number(raw.questionCount) : DEFAULT_SETTINGS.questionCount,
    questionDurationMs:  VALID_DURATIONS.includes(Number(raw.questionDurationMs)) ? Number(raw.questionDurationMs) : DEFAULT_SETTINGS.questionDurationMs,
    difficulty:          VALID_DIFFICULTIES.includes(raw.difficulty)      ? raw.difficulty          : DEFAULT_SETTINGS.difficulty,
    playerPool:          VALID_POOLS.includes(raw.playerPool)             ? raw.playerPool          : DEFAULT_SETTINGS.playerPool,
    speedBonus:          raw.speedBonus !== false,
    showLeaderboardLive: raw.showLeaderboardLive !== false,
    hintsEnabled:        raw.hintsEnabled !== false,
  };
}

const makeCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();

function makeRoom(code) {
  return {
    code, hostId: null,
    players: new Map(),
    questions: [],
    currentQ: -1,
    state: 'lobby',
    settings: { ...DEFAULT_SETTINGS },
    answers: new Map(),
    careerAnswers: new Map(),
    hlChain: [],
    hlActive: new Map(),
    qStartTs: 0,
    timer: null,
  };
}

// ── HTTP ──────────────────────────────────────────────────────────────────────
app.get('/', (_, res) => res.json({ status:'ok', service:'Footbally v2', rooms: rooms.size }));

app.post('/create-room', (req, res) => {
  const code = makeCode();
  rooms.set(code, makeRoom(code));
  console.log(`[${code}] oda oluşturuldu`);
  res.json({ code });
});

app.get('/leaderboard/:code', (req, res) => {
  const room = rooms.get(req.params.code);
  if (!room) return res.status(404).json({ error: 'room not found' });
  res.json(buildLeaderboard(room));
});

// ── Yardımcılar ───────────────────────────────────────────────────────────────
function buildLeaderboard(room) {
  return [...room.players.entries()]
    .map(([id, p]) => ({ id, name: p.name, score: p.score }))
    .sort((a, b) => b.score - a.score);
}

function broadcast(room, event, payload) {
  io.to(room.code).emit(event, payload);
}

function calcScore(correct, responseMs, durationMs, speedBonus) {
  if (!correct) return 0;
  if (!speedBonus) return BASE_POINTS;
  const remaining = Math.max(0, durationMs - responseMs);
  return BASE_POINTS + Math.round((remaining / durationMs) * BASE_POINTS);
}

// ── HL yardımcısı ─────────────────────────────────────────────────────────────
function hlMultiplier(streak) {
  return streak >= 10 ? 3 : streak >= 5 ? 2 : streak >= 3 ? 1.5 : 1;
}

function checkHLDone(room) {
  const allDone = [...room.players.keys()].every(id => room.hlActive.get(id)?.done !== false);
  if (allDone) {
    room.state = 'finished';
    broadcast(room, 'game_over', { leaderboard: buildLeaderboard(room) });
    console.log(`[${room.code}] HL oyun bitti`);
  }
}

// ── Soru akışı ────────────────────────────────────────────────────────────────
function nextQuestion(room) {
  clearTimeout(room.timer);
  room.currentQ += 1;
  room.answers      = new Map();
  room.careerAnswers = new Map();

  if (room.currentQ >= room.questions.length) {
    room.state = 'finished';
    broadcast(room, 'game_over', { leaderboard: buildLeaderboard(room) });
    console.log(`[${room.code}] oyun bitti`);
    return;
  }

  const q          = room.questions[room.currentQ];
  const durationMs = room.settings.questionDurationMs;
  room.qStartTs    = Date.now();

  broadcast(room, 'question', {
    index:        room.currentQ,
    total:        room.questions.length,
    questionTR:   q.tr?.question || '',
    questionEN:   q.en?.question || '',
    subTR:        q.tr?.sub      || null,
    subEN:        q.en?.sub      || null,
    options:      q.options      || [],
    optionsTR:    q.optionsTR    || null,
    durationMs,
    questionType: q.type,
    // Career Challenge extras
    careerSteps:  q.careerSteps  || null,
    hints:        q.hints        || null,
    // Squad Builder extras
    squadClub:    q.clubName     || null,
    squadPlayers: q.squadPlayers || null,
  });

  room.timer = setTimeout(() => revealAndAdvance(room), durationMs);
}

function revealAndAdvance(room) {
  const q = room.questions[room.currentQ];

  if (room.settings.gameMode === 'squad') {
    // Score squad submissions
    const correctSet = new Set(q.correctIds || []);
    room.players.forEach((player, id) => {
      const sub = room.answers.get(id);
      if (sub && Array.isArray(sub.answer)) {
        let gained = 0;
        sub.answer.forEach(sid => { gained += correctSet.has(sid) ? 200 : -100; });
        player.score += Math.max(0, gained);
      }
    });
    broadcast(room, 'reveal', {
      correctIds:  [...correctSet],
      correct:     null,
      leaderboard: buildLeaderboard(room),
    });
    setTimeout(() => nextQuestion(room), 4000);
    return;
  }

  broadcast(room, 'reveal', {
    correct:     q.correct,
    leaderboard: buildLeaderboard(room),
  });
  setTimeout(() => nextQuestion(room), 3000);
}

// ── Career mode answer handler ─────────────────────────────────────────────────
function handleCareerAnswer(socket, room, q, answer) {
  let pState = room.careerAnswers.get(socket.id);
  if (!pState) pState = { wrongGuesses: 0, done: false };
  if (pState.done) return;

  const correct = answer === q.correct;
  const scoreTable = [2000, 1500, 1000, 500];

  if (correct) {
    const gained = scoreTable[Math.min(pState.wrongGuesses, scoreTable.length - 1)] || 0;
    const player = room.players.get(socket.id);
    if (player) player.score += gained;
    pState.done = true;
    room.careerAnswers.set(socket.id, pState);
    socket.emit('answer_ack', { correct: true, gained, responseMs: Date.now() - room.qStartTs });

    const allDone = [...room.players.keys()].every(id => room.careerAnswers.get(id)?.done);
    if (allDone) { clearTimeout(room.timer); revealAndAdvance(room); }
    return;
  }

  pState.wrongGuesses++;
  room.careerAnswers.set(socket.id, pState);

  if (pState.wrongGuesses >= 4) {
    pState.done = true;
    socket.emit('answer_ack', { correct: false, gained: 0, outOfHints: true });
    const allDone = [...room.players.keys()].every(id => room.careerAnswers.get(id)?.done);
    if (allDone) { clearTimeout(room.timer); revealAndAdvance(room); }
  } else {
    const hint = q.hints?.[pState.wrongGuesses - 1];
    socket.emit('career_hint', { hint, hintsLeft: 4 - pState.wrongGuesses });
  }
}

// ── Socket.IO ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {

  socket.on('join_room', ({ code, name }, ack) => {
    const room = rooms.get(code);
    if (!room)                         return ack({ ok: false, error: 'Oda bulunamadı' });
    if (room.state !== 'lobby')        return ack({ ok: false, error: 'Oyun başlamış' });
    if (room.players.size >= ROOM_MAX) return ack({ ok: false, error: 'Oda dolu' });

    room.players.set(socket.id, { name: (name || 'Anon').slice(0, 16), score: 0 });
    if (!room.hostId) room.hostId = socket.id;
    socket.join(code);
    socket.data.roomCode = code;

    ack({ ok: true, isHost: room.hostId === socket.id, settings: room.settings });
    broadcast(room, 'lobby_update', {
      players: [...room.players.values()].map(p => p.name),
      settings: room.settings,
    });
    console.log(`[${code}] ${name} katıldı (${room.players.size}/${ROOM_MAX})`);
  });

  socket.on('update_settings', (rawSettings, ack) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room)                     return ack?.({ ok: false, error: 'Oda yok' });
    if (room.hostId !== socket.id) return ack?.({ ok: false, error: 'Sadece host' });
    if (room.state !== 'lobby')    return ack?.({ ok: false, error: 'Oyun başlamış' });

    room.settings = validateSettings(rawSettings);
    ack?.({ ok: true, settings: room.settings });
    broadcast(room, 'lobby_update', {
      players:  [...room.players.values()].map(p => p.name),
      settings: room.settings,
    });
    console.log(`[${room.code}] ayarlar güncellendi:`, JSON.stringify(room.settings));
  });

  socket.on('start_game', async ({ settings } = {}, ack) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room)                     return ack?.({ ok: false, error: 'Oda yok' });
    if (room.hostId !== socket.id) return ack?.({ ok: false, error: 'Sadece host başlatabilir' });
    if (room.state !== 'lobby')    return ack?.({ ok: false, error: 'Zaten çalışıyor' });

    if (settings) room.settings = validateSettings(settings);
    const { gameMode, questionCount, questionDurationMs } = room.settings;

    try {
      if (gameMode === 'higherlower') {
        room.hlChain  = await loadAndGetHLChain(room.settings, 30);
        room.hlActive = new Map();
        room.players.forEach((_, id) =>
          room.hlActive.set(id, { position: 1, streak: 0, score: 0, done: false })
        );
        room.state = 'playing';
        broadcast(room, 'game_started', { totalQuestions: 0, mode: gameMode, settings: room.settings });
        setTimeout(() => {
          const chain = room.hlChain;
          broadcast(room, 'hl_start', {
            players:           chain.map(p => ({ id: p.id, name: p.name, club: p.club, nationality: p.nationality, position: p.position })),
            firstRevealedValue: chain[0].marketValue,
            firstLeft:  { id: chain[0].id, name: chain[0].name, club: chain[0].club, nationality: chain[0].nationality, position: chain[0].position },
            firstRight: chain[1] ? { id: chain[1].id, name: chain[1].name, club: chain[1].club, nationality: chain[1].nationality, position: chain[1].position } : null,
            chainLength: chain.length,
          });
        }, 1500);
      } else {
        room.questions = await generateQuestions(questionCount, gameMode, room.settings);
        room.state     = 'playing';
        broadcast(room, 'game_started', { totalQuestions: room.questions.length, mode: gameMode, settings: room.settings });
        setTimeout(() => nextQuestion(room), 1500);
      }
      ack?.({ ok: true });
      console.log(`[${room.code}] başladı (${gameMode}, ${questionDurationMs}ms, ${room.questions.length} soru)`);
    } catch (err) {
      console.error(`[${room.code}] hata:`, err.message);
      ack?.({ ok: false, error: err.message });
    }
  });

  socket.on('submit_answer', ({ answer }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.state !== 'playing') return;
    const q = room.questions[room.currentQ];
    if (!q) return;

    if (room.settings.gameMode === 'career' && room.settings.hintsEnabled) {
      handleCareerAnswer(socket, room, q, answer);
      return;
    }

    // Quickfire / career without hints (one guess)
    if (room.answers.has(socket.id)) return;
    const responseMs = Date.now() - room.qStartTs;
    const correct    = answer === q.correct;
    const gained     = calcScore(correct, responseMs, room.settings.questionDurationMs, room.settings.speedBonus);
    room.answers.set(socket.id, { answer, ts: responseMs });
    const player = room.players.get(socket.id);
    if (player) player.score += gained;
    socket.emit('answer_ack', { correct, gained, responseMs });

    if (room.answers.size === room.players.size) {
      clearTimeout(room.timer);
      revealAndAdvance(room);
    }
  });

  socket.on('submit_squad', ({ selected }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.state !== 'playing' || room.settings.gameMode !== 'squad') return;
    if (room.answers.has(socket.id)) return;
    room.answers.set(socket.id, { answer: Array.isArray(selected) ? selected : [], ts: Date.now() - room.qStartTs });
    if (room.answers.size === room.players.size) {
      clearTimeout(room.timer);
      revealAndAdvance(room);
    }
  });

  socket.on('hl_answer', ({ direction }, ack) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.state !== 'playing' || room.settings.gameMode !== 'higherlower') return;

    const pState = room.hlActive.get(socket.id);
    if (!pState || pState.done) return;

    const { position, streak, score } = pState;
    const chain = room.hlChain;

    if (position >= chain.length) {
      pState.done = true;
      socket.emit('hl_result', { chainEnd: true, done: true, streak, totalScore: score });
      checkHLDone(room);
      return;
    }

    const left  = chain[position - 1];
    const right = chain[position];
    const correct = (direction === 'higher' && right.marketValue > left.marketValue) ||
                    (direction === 'lower'  && right.marketValue < left.marketValue);

    const newStreak  = correct ? streak + 1 : 0;
    const mult       = hlMultiplier(newStreak);
    const gained     = correct ? Math.round(1000 * mult) : 0;
    const newScore   = score + gained;
    const newPos     = correct ? position + 1 : position;
    const done       = !correct || newPos >= chain.length;

    Object.assign(pState, { position: newPos, streak: newStreak, score: newScore, done });

    if (correct) {
      const player = room.players.get(socket.id);
      if (player) player.score += gained;
    }

    const nextPlayer = !done && chain[newPos] ? {
      id: chain[newPos].id, name: chain[newPos].name,
      club: chain[newPos].club, nationality: chain[newPos].nationality, position: chain[newPos].position,
    } : null;

    socket.emit('hl_result', {
      correct,
      revealedValue: right.marketValue,
      streak: newStreak,
      multiplier: mult,
      gained,
      totalScore: newScore,
      done,
      nextPlayer,
    });

    if (done) checkHLDone(room);
    ack?.({ ok: true });
  });

  socket.on('hl_bank', (ack) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.state !== 'playing' || room.settings.gameMode !== 'higherlower') return;
    const pState = room.hlActive.get(socket.id);
    if (!pState || pState.done) return;
    pState.done = true;
    socket.emit('hl_result', { banked: true, done: true, totalScore: pState.score });
    checkHLDone(room);
    ack?.({ ok: true });
  });

  socket.on('rematch', async (ack) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room)                     return ack?.({ ok: false, error: 'Oda yok' });
    if (room.hostId !== socket.id) return ack?.({ ok: false, error: 'Sadece host' });
    if (room.state !== 'finished') return ack?.({ ok: false, error: 'Oyun bitmedi' });

    // Reset scores, keep players & settings
    room.players.forEach(p => { p.score = 0; });
    room.currentQ    = -1;
    room.answers     = new Map();
    room.careerAnswers = new Map();
    room.hlActive    = new Map();
    clearTimeout(room.timer);

    const { gameMode, questionCount } = room.settings;
    try {
      if (gameMode === 'higherlower') {
        room.hlChain = await loadAndGetHLChain(room.settings, 30);
        room.players.forEach((_, id) =>
          room.hlActive.set(id, { position: 1, streak: 0, score: 0, done: false })
        );
        room.state = 'playing';
        broadcast(room, 'game_started', { totalQuestions: 0, mode: gameMode, settings: room.settings });
        const chain = room.hlChain;
        setTimeout(() => broadcast(room, 'hl_start', {
          players:            chain.map(p => ({ id: p.id, name: p.name, club: p.club, nationality: p.nationality, position: p.position })),
          firstRevealedValue: chain[0].marketValue,
          firstLeft:  { id: chain[0].id, name: chain[0].name, club: chain[0].club, nationality: chain[0].nationality, position: chain[0].position },
          firstRight: chain[1] ? { id: chain[1].id, name: chain[1].name, club: chain[1].club, nationality: chain[1].nationality, position: chain[1].position } : null,
          chainLength: chain.length,
        }), 1500);
      } else {
        room.questions = await generateQuestions(questionCount, gameMode, room.settings);
        room.state     = 'playing';
        broadcast(room, 'game_started', { totalQuestions: room.questions.length, mode: gameMode, settings: room.settings });
        setTimeout(() => nextQuestion(room), 1500);
      }
      ack?.({ ok: true });
      console.log(`[${room.code}] rematch (${gameMode})`);
    } catch (err) {
      console.error(`[${room.code}] rematch hata:`, err.message);
      ack?.({ ok: false, error: err.message });
    }
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    room.players.delete(socket.id);
    room.hlActive.delete(socket.id);

    if (room.hostId === socket.id) {
      room.hostId = room.players.keys().next().value || null;
    }
    if (room.players.size === 0) {
      clearTimeout(room.timer);
      rooms.delete(room.code);
      console.log(`[${room.code}] oda kapatıldı`);
      return;
    }

    // If HL mode and this player leaving causes all-done
    if (room.state === 'playing' && room.settings.gameMode === 'higherlower') {
      checkHLDone(room);
    }

    broadcast(room, 'lobby_update', {
      players:  [...room.players.values()].map(p => p.name),
      settings: room.settings,
    });
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Footbally v2 on :${PORT}`));
