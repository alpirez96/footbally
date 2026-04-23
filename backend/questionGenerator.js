// questionGenerator.js — her restart'ta GitHub'dan taze seed yükler
const fs = require('fs');
const path = require('path');
const https = require('https');

// GitHub kullanıcı adı / repo adını kendine göre değiştir
const GITHUB_USER = process.env.GH_USER || 'yourusername';
const GITHUB_REPO = process.env.GH_REPO || 'footbally';
const SEED_URL = `https://cdn.jsdelivr.net/gh/${GITHUB_USER}/${GITHUB_REPO}@main/backend/seed.json`;

const LOCAL_SEED = path.join(__dirname, 'seed.json');

let PLAYERS = [];
let loadedAt = null;

// ── Seed yükleme (önce uzaktan dene, düşersek lokal) ──
function fetchRemote() {
  return new Promise((resolve, reject) => {
    const req = https.get(SEED_URL, { timeout: 5000 }, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function loadSeed() {
  try {
    const seed = await fetchRemote();
    PLAYERS = seed.players;
    loadedAt = new Date();
    console.log(`✓ Seed jsDelivr'dan yüklendi: ${PLAYERS.length} oyuncu (güncelleme: ${seed.generatedAt})`);
    // Başarılı fetch'i diske de yaz (fallback için)
    fs.writeFileSync(LOCAL_SEED, JSON.stringify(seed));
  } catch (err) {
    console.warn(`⚠ jsDelivr başarısız (${err.message}), lokal seed kullanılıyor`);
    if (!fs.existsSync(LOCAL_SEED)) {
      throw new Error('Ne uzaktan ne de lokal seed bulunamadı');
    }
    const seed = JSON.parse(fs.readFileSync(LOCAL_SEED, 'utf8'));
    PLAYERS = seed.players;
    loadedAt = new Date();
    console.log(`✓ Seed lokal dosyadan yüklendi: ${PLAYERS.length} oyuncu`);
  }
}

// Server başlarken hemen yükle
loadSeed();

// 6 saatte bir yeniden kontrol et (güncellemeler gelsin)
setInterval(() => loadSeed().catch(e => console.error('Seed refresh:', e.message)), 6 * 60 * 60 * 1000);

// ── Yardımcılar ──
const shuffle = arr => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const pickN = (arr, n) => shuffle(arr).slice(0, n);
const formatMV = v => v >= 1e6 ? `€${(v / 1e6).toFixed(0)}M` : `€${(v / 1e3).toFixed(0)}K`;

// ── Soru tipleri (değişmedi) ──
function qHigherValue() {
  const [a, b] = pickN(PLAYERS, 2);
  if (a.marketValue === b.marketValue) return null;
  const correct = a.marketValue > b.marketValue ? a.name : b.name;
  return {
    type: 'higher_value',
    question: `Kimin piyasa değeri daha yüksek?`,
    sub: `${a.name} vs ${b.name}`,
    options: shuffle([a.name, b.name]),
    correct,
  };
}

function qPlayerClub() {
  const target = pickN(PLAYERS.filter(p => p.club !== 'Unknown'), 1)[0];
  if (!target) return null;
  const distractors = pickN(
    [...new Set(PLAYERS.filter(p => p.club !== target.club && p.club !== 'Unknown').map(p => p.club))],
    3
  );
  if (distractors.length < 3) return null;
  return {
    type: 'player_club',
    question: `${target.name} hangi kulüpte oynuyor?`,
    options: shuffle([target.club, ...distractors]),
    correct: target.club,
  };
}

function qGuessPlayer() {
  const target = pickN(PLAYERS.filter(p => p.club !== 'Unknown'), 1)[0];
  if (!target) return null;
  const distractors = pickN(PLAYERS.filter(p => p.name !== target.name).map(p => p.name), 3);
  return {
    type: 'guess_player',
    question: `${target.club}'te oynayan, ${formatMV(target.marketValue)} değerinde bir oyuncu. Kim?`,
    options: shuffle([target.name, ...distractors]),
    correct: target.name,
  };
}

function qNationality() {
  const target = pickN(PLAYERS.filter(p => p.nationality), 1)[0];
  if (!target) return null;
  const distractors = pickN(
    [...new Set(PLAYERS.filter(p => p.nationality !== target.nationality).map(p => p.nationality))],
    3
  );
  if (distractors.length < 3) return null;
  return {
    type: 'nationality',
    question: `${target.name} hangi ülkeli?`,
    options: shuffle([target.nationality, ...distractors]),
    correct: target.nationality,
  };
}

function qPosition() {
  const target = pickN(PLAYERS.filter(p => p.position && p.position !== 'Unknown'), 1)[0];
  if (!target) return null;
  const positions = [...new Set(PLAYERS.map(p => p.position).filter(p => p && p !== 'Unknown'))];
  const distractors = pickN(positions.filter(p => p !== target.position), 3);
  if (distractors.length < 3) return null;
  return {
    type: 'position',
    question: `${target.name} hangi mevkide oynuyor?`,
    options: shuffle([target.position, ...distractors]),
    correct: target.position,
  };
}

function qPreviousClub() {
  const target = pickN(PLAYERS.filter(p => p.lastTransfer?.from && p.lastTransfer?.to), 1)[0];
  if (!target) return null;
  const distractors = pickN(
    [...new Set(PLAYERS.filter(p => p.club && p.club !== target.lastTransfer.from).map(p => p.club))],
    3
  );
  if (distractors.length < 3) return null;
  return {
    type: 'previous_club',
    question: `${target.name} ${target.lastTransfer.to}'e gelmeden önce hangi kulüpteydi?`,
    options: shuffle([target.lastTransfer.from, ...distractors]),
    correct: target.lastTransfer.from,
  };
}

function qHigherTransferFee() {
  const candidates = PLAYERS.filter(p => p.lastTransfer?.fee > 0);
  if (candidates.length < 2) return null;
  const [a, b] = pickN(candidates, 2);
  if (a.lastTransfer.fee === b.lastTransfer.fee) return null;
  const correct = a.lastTransfer.fee > b.lastTransfer.fee ? a.name : b.name;
  return {
    type: 'higher_fee',
    question: `Son transferinde daha yüksek bonservis ödenen oyuncu hangisi?`,
    sub: `${a.name} vs ${b.name}`,
    options: shuffle([a.name, b.name]),
    correct,
  };
}

const GENERATORS = [qHigherValue, qPlayerClub, qGuessPlayer, qNationality, qPosition, qPreviousClub, qHigherTransferFee];

async function generateQuestions(count = 10) {
  if (PLAYERS.length === 0) await loadSeed();
  const questions = [];
  let attempts = 0;
  while (questions.length < count && attempts < count * 10) {
    const gen = GENERATORS[Math.floor(Math.random() * GENERATORS.length)];
    const q = gen();
    if (q && !questions.some(e => e.question === q.question)) questions.push(q);
    attempts++;
  }
  if (questions.length < count) throw new Error('Yetersiz soru üretildi');
  return questions;
}

module.exports = { generateQuestions, getLoadedAt: () => loadedAt };
