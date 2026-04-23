// questionGenerator.js — her restart'ta GitHub'dan taze seed yükler
const fs   = require('fs');
const path = require('path');
const https = require('https');

const GITHUB_USER = process.env.GH_USER || 'yourusername';
const GITHUB_REPO = process.env.GH_REPO || 'footbally';
const SEED_URL    = `https://cdn.jsdelivr.net/gh/${GITHUB_USER}/${GITHUB_REPO}@main/backend/seed.json`;
const LOCAL_SEED  = path.join(__dirname, 'seed.json');

let PLAYERS   = [];
let loadedAt  = null;

// ── Seed yükleme ────────────────────────────────────────────────────────────
function fetchRemote() {
  return new Promise((resolve, reject) => {
    const req = https.get(SEED_URL, { timeout: 5000 }, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
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
    console.log(`✓ Seed jsDelivr'dan yüklendi: ${PLAYERS.length} oyuncu (${seed.generatedAt})`);
    fs.writeFileSync(LOCAL_SEED, JSON.stringify(seed));
  } catch (err) {
    console.warn(`⚠ jsDelivr başarısız (${err.message}), lokal seed kullanılıyor`);
    if (!fs.existsSync(LOCAL_SEED)) throw new Error('Ne uzaktan ne de lokal seed bulunamadı');
    const seed = JSON.parse(fs.readFileSync(LOCAL_SEED, 'utf8'));
    PLAYERS = seed.players;
    loadedAt = new Date();
    console.log(`✓ Seed lokal dosyadan yüklendi: ${PLAYERS.length} oyuncu`);
  }
}

loadSeed();
setInterval(() => loadSeed().catch(e => console.error('Seed refresh:', e.message)), 6 * 60 * 60 * 1000);

// ── Yardımcılar ─────────────────────────────────────────────────────────────
const shuffle = arr => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const pickN   = (arr, n) => shuffle(arr).slice(0, n);
const pick1   = arr => arr[Math.floor(Math.random() * arr.length)];
const formatMV = v => v >= 1e6 ? `€${(v / 1e6).toFixed(0)}M` : `€${(v / 1e3).toFixed(0)}K`;

// ── Havuz seçimi ─────────────────────────────────────────────────────────────
function getPool(mode) {
  if (mode === 'turkey') return PLAYERS.filter(p => p.leagueId === 'TR1');
  return PLAYERS;
}

// ── Mevcut soru tipleri (pool parametresi aldı) ──────────────────────────────

function qHigherValue(pool) {
  if (pool.length < 2) return null;
  const [a, b] = pickN(pool, 2);
  if (a.marketValue === b.marketValue) return null;
  const correct = a.marketValue > b.marketValue ? a.name : b.name;
  return {
    type: 'higher_value',
    question: 'Kimin piyasa değeri daha yüksek?',
    sub: `${a.name} vs ${b.name}`,
    options: shuffle([a.name, b.name]),
    correct,
  };
}

function qPlayerClub(pool) {
  const candidates = pool.filter(p => p.club !== 'Unknown');
  if (candidates.length < 4) return null;
  const target = pick1(candidates);
  const distractors = pickN(
    [...new Set(pool.filter(p => p.club !== target.club && p.club !== 'Unknown').map(p => p.club))],
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

function qGuessPlayer(pool) {
  const candidates = pool.filter(p => p.club !== 'Unknown');
  if (candidates.length < 4) return null;
  const target = pick1(candidates);
  const distractors = pickN(pool.filter(p => p.name !== target.name).map(p => p.name), 3);
  if (distractors.length < 3) return null;
  return {
    type: 'guess_player',
    question: `${target.club}'te oynayan, ${formatMV(target.marketValue)} değerinde bir oyuncu. Kim?`,
    options: shuffle([target.name, ...distractors]),
    correct: target.name,
  };
}

function qNationality(pool) {
  const candidates = pool.filter(p => p.nationality);
  if (candidates.length < 4) return null;
  const target = pick1(candidates);
  const distractors = pickN(
    [...new Set(pool.filter(p => p.nationality !== target.nationality).map(p => p.nationality))],
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

function qPosition(pool) {
  const candidates = pool.filter(p => p.position && p.position !== 'Unknown');
  if (candidates.length < 4) return null;
  const target = pick1(candidates);
  const positions = [...new Set(pool.map(p => p.position).filter(p => p && p !== 'Unknown'))];
  const distractors = pickN(positions.filter(p => p !== target.position), 3);
  if (distractors.length < 3) return null;
  return {
    type: 'position',
    question: `${target.name} hangi mevkide oynuyor?`,
    options: shuffle([target.position, ...distractors]),
    correct: target.position,
  };
}

function qPreviousClub(pool) {
  const candidates = pool.filter(p => p.lastTransfer?.from && p.lastTransfer?.to);
  if (candidates.length < 4) return null;
  const target = pick1(candidates);
  const distractors = pickN(
    [...new Set(pool.filter(p => p.club && p.club !== target.lastTransfer.from).map(p => p.club))],
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

function qHigherTransferFee(pool) {
  const candidates = pool.filter(p => p.lastTransfer?.fee > 0);
  if (candidates.length < 2) return null;
  const [a, b] = pickN(candidates, 2);
  if (a.lastTransfer.fee === b.lastTransfer.fee) return null;
  const correct = a.lastTransfer.fee > b.lastTransfer.fee ? a.name : b.name;
  return {
    type: 'higher_fee',
    question: 'Son transferinde daha yüksek bonservis ödenen oyuncu hangisi?',
    sub: `${a.name} vs ${b.name}`,
    options: shuffle([a.name, b.name]),
    correct,
  };
}

// ── Yeni soru tipleri ────────────────────────────────────────────────────────

// "Bu kariyer yolunu hangi oyuncu izledi?"
function qCareerPath(pool) {
  const candidates = pool.filter(p => p.careerPath && p.careerPath.length >= 3);
  if (candidates.length < 4) return null;
  const target = pick1(candidates);
  const pathStr = target.careerPath.map(e => e.club).join(' → ');
  const distractors = pickN(
    candidates.filter(p => p.name !== target.name).map(p => p.name),
    3
  );
  if (distractors.length < 3) return null;
  return {
    type: 'career_path',
    question: 'Bu kariyer yolunu hangi oyuncu izledi?',
    sub: pathStr,
    options: shuffle([target.name, ...distractors]),
    correct: target.name,
  };
}

// "X ile Y'den hangisi daha yaşlı?"
function qOlderPlayer(pool) {
  const candidates = pool.filter(p => p.birthYear);
  if (candidates.length < 2) return null;
  const [a, b] = pickN(candidates, 2);
  if (a.birthYear === b.birthYear) return null;
  const correct = a.birthYear < b.birthYear ? a.name : b.name; // küçük yıl = daha yaşlı
  return {
    type: 'older_player',
    question: 'Hangisi daha yaşlı?',
    sub: `${a.name} (d. ${a.birthYear}) vs ${b.name} (d. ${b.birthYear})`,
    options: shuffle([a.name, b.name]),
    correct,
  };
}

// "Şu oyunculardan hangisi en uzun?"
function qTallest(pool) {
  const candidates = pool.filter(p => p.height && p.height > 150);
  if (candidates.length < 4) return null;
  const group = pickN(candidates, 4);
  const tallest = group.reduce((max, p) => p.height > max.height ? p : max, group[0]);
  return {
    type: 'tallest',
    question: 'Şu oyunculardan hangisi en uzun?',
    options: shuffle(group.map(p => p.name)),
    correct: tallest.name,
  };
}

// "Hangisi [ülke] milli takımında OYNAMADI?"
function qNationalityNotFrom(pool) {
  const nationalities = [...new Set(pool.map(p => p.nationality).filter(Boolean))];
  // En az 3 oyuncusu olan milliyetler
  const abundant = nationalities.filter(
    nat => pool.filter(p => p.nationality === nat).length >= 3
  );
  if (abundant.length === 0) return null;
  const nat = pick1(abundant);
  const fromNat = pickN(pool.filter(p => p.nationality === nat), 3);
  const notFromNat = pool.filter(p => p.nationality !== nat && p.nationality);
  if (notFromNat.length === 0) return null;
  const outsider = pick1(notFromNat);
  const options = shuffle([...fromNat.map(p => p.name), outsider.name]);
  return {
    type: 'nationality_not_from',
    question: `Şu oyunculardan hangisi ${nat} milli takımında OYNAMADI?`,
    options,
    correct: outsider.name,
  };
}

// "X'in kariyer yolundaki ikinci kulübü neydi?"
function qSecondClub(pool) {
  const candidates = pool.filter(p => p.careerPath && p.careerPath.length >= 2);
  if (candidates.length < 4) return null;
  const target = pick1(candidates);
  const secondClub = target.careerPath[1].club;
  const allClubs = [...new Set(pool.filter(p => p.club !== 'Unknown').map(p => p.club))];
  const distractors = pickN(allClubs.filter(c => c !== secondClub), 3);
  if (distractors.length < 3) return null;
  return {
    type: 'second_club',
    question: `${target.name}'in kariyer yolundaki ikinci kulübü neydi?`,
    options: shuffle([secondClub, ...distractors]),
    correct: secondClub,
  };
}

// ── Generator listesi ────────────────────────────────────────────────────────
const GENERATORS = [
  qHigherValue,
  qPlayerClub,
  qGuessPlayer,
  qNationality,
  qPosition,
  qPreviousClub,
  qHigherTransferFee,
  qCareerPath,
  qOlderPlayer,
  qTallest,
  qNationalityNotFrom,
  qSecondClub,
];

// ── Ana export ───────────────────────────────────────────────────────────────
async function generateQuestions(count = 10, mode = 'europe') {
  if (PLAYERS.length === 0) await loadSeed();

  const pool = getPool(mode);
  if (pool.length < 10) throw new Error(`Yeterli oyuncu yok (${mode} modunda ${pool.length} oyuncu)`);

  const questions = [];
  let attempts = 0;
  while (questions.length < count && attempts < count * 20) {
    const gen = GENERATORS[Math.floor(Math.random() * GENERATORS.length)];
    const q = gen(pool);
    if (q && !questions.some(e => e.question === q.question)) questions.push(q);
    attempts++;
  }

  if (questions.length < count) throw new Error(`Yetersiz soru üretildi (${questions.length}/${count})`);
  return questions;
}

module.exports = { generateQuestions, getLoadedAt: () => loadedAt };
