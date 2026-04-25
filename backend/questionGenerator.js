// questionGenerator.js
const fs    = require('fs');
const path  = require('path');
const https = require('https');

const GITHUB_USER = process.env.GH_USER || 'yourusername';
const GITHUB_REPO = process.env.GH_REPO || 'footbally';
const SEED_URL    = `https://cdn.jsdelivr.net/gh/${GITHUB_USER}/${GITHUB_REPO}@main/backend/seed.json`;
const LOCAL_SEED  = path.join(__dirname, 'seed.json');

let PLAYERS  = [];
let loadedAt = null;

// ── Seed yükleme ─────────────────────────────────────────────────────────────
function fetchRemote() {
  return new Promise((resolve, reject) => {
    const req = https.get(SEED_URL, { timeout: 5000 }, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => data += c);
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
    console.log(`✓ Seed jsDelivr: ${PLAYERS.length} oyuncu (${seed.generatedAt})`);
    fs.writeFileSync(LOCAL_SEED, JSON.stringify(seed));
  } catch (err) {
    console.warn(`⚠ jsDelivr başarısız (${err.message}), lokal seed`);
    if (!fs.existsSync(LOCAL_SEED)) throw new Error('Seed bulunamadı');
    const seed = JSON.parse(fs.readFileSync(LOCAL_SEED, 'utf8'));
    PLAYERS = seed.players;
    loadedAt = new Date();
    console.log(`✓ Lokal seed: ${PLAYERS.length} oyuncu`);
  }
}
loadSeed();
setInterval(() => loadSeed().catch(e => console.error('Seed refresh:', e.message)), 6 * 60 * 60 * 1000);

// ── Yardımcılar ───────────────────────────────────────────────────────────────
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

// ── Havuz seçimi ──────────────────────────────────────────────────────────────
// Türkiye anahtar kelimeleri (tam ad da dahil)
const TR_KEYWORDS = [
  'Galatasaray', 'Fenerbahçe', 'Beşiktaş', 'Trabzonspor', 'Başakşehir',
  'Konyaspor', 'Sivasspor', 'Antalyaspor', 'Alanyaspor', 'Kayserispor',
  'Adana Demirspor', 'Kasımpaşa', 'Rizespor', 'Samsunspor', 'Pendikspor',
  'Hatayspor', 'Ankaragücü', 'Karagümrük', 'Eyüpspor', 'Bodrum',
];

function getPool(mode) {
  if (mode === 'turkey') {
    // 1. Yeni seed: leagueId = TR1
    const byLeague = PLAYERS.filter(p => p.leagueId === 'TR1');
    if (byLeague.length >= 8) return byLeague;
    // 2. Fallback: Türk kulübü adı eşleşmesi
    const byClub = PLAYERS.filter(p =>
      TR_KEYWORDS.some(k => p.club && p.club.includes(k))
    );
    // 3. Fallback: Türk milli takımı oyuncuları (Avrupa kulübünde olabilir)
    const byNat = PLAYERS.filter(p => p.nationality === 'Türkiye');
    // Birleştir, tekrarı kaldır
    const combined = [...new Map(
      [...byClub, ...byNat].map(p => [p.id, p])
    ).values()];
    return combined;
  }
  if (mode === 'hard') return PLAYERS; // hard: tüm oyuncular, sadece zor sorular
  return PLAYERS;
}

// ── Bilingual soru yardımcısı ─────────────────────────────────────────────────
const q = (tr, en, trSub, enSub) => ({
  tr: { question: tr, sub: trSub || null },
  en: { question: en, sub: enSub || trSub || null },
});

// ── Mevcut soru tipleri ───────────────────────────────────────────────────────

function qHigherValue(pool) {
  if (pool.length < 2) return null;
  const [a, b] = pickN(pool, 2);
  if (a.marketValue === b.marketValue) return null;
  const correct = a.marketValue > b.marketValue ? a.name : b.name;
  return {
    type: 'higher_value',
    ...q('Kimin piyasa değeri daha yüksek?', 'Who has a higher market value?',
        `${a.name} vs ${b.name}`),
    options: shuffle([a.name, b.name]), correct,
  };
}

function qPlayerClub(pool) {
  const cands = pool.filter(p => p.club !== 'Unknown');
  if (cands.length < 4) return null;
  const target = pick1(cands);
  const distractors = pickN(
    [...new Set(pool.filter(p => p.club !== target.club && p.club !== 'Unknown').map(p => p.club))], 3
  );
  if (distractors.length < 3) return null;
  return {
    type: 'player_club',
    ...q(`${target.name} hangi kulüpte oynuyor?`, `Which club does ${target.name} play for?`),
    options: shuffle([target.club, ...distractors]), correct: target.club,
  };
}

function qGuessPlayer(pool) {
  const cands = pool.filter(p => p.club !== 'Unknown');
  if (cands.length < 4) return null;
  const target = pick1(cands);
  const distractors = pickN(pool.filter(p => p.name !== target.name).map(p => p.name), 3);
  if (distractors.length < 3) return null;
  return {
    type: 'guess_player',
    ...q(
      `${target.club}'deki ${formatMV(target.marketValue)} değerli oyuncu kim?`,
      `A ${formatMV(target.marketValue)} player at ${target.club}. Who?`,
    ),
    options: shuffle([target.name, ...distractors]), correct: target.name,
  };
}

function qNationality(pool) {
  const cands = pool.filter(p => p.nationality);
  if (cands.length < 4) return null;
  const target = pick1(cands);
  const distractors = pickN(
    [...new Set(pool.filter(p => p.nationality !== target.nationality).map(p => p.nationality))], 3
  );
  if (distractors.length < 3) return null;
  return {
    type: 'nationality',
    ...q(`${target.name} hangi ülkeli?`, `What nationality is ${target.name}?`),
    options: shuffle([target.nationality, ...distractors]), correct: target.nationality,
  };
}

function qPosition(pool) {
  const cands = pool.filter(p => p.position && p.position !== 'Unknown');
  if (cands.length < 4) return null;
  const target = pick1(cands);
  const positions = [...new Set(pool.map(p => p.position).filter(p => p && p !== 'Unknown'))];
  const distractors = pickN(positions.filter(p => p !== target.position), 3);
  if (distractors.length < 3) return null;
  return {
    type: 'position',
    ...q(`${target.name} hangi mevkide oynuyor?`, `What position does ${target.name} play?`),
    options: shuffle([target.position, ...distractors]), correct: target.position,
  };
}

function qPreviousClub(pool) {
  const cands = pool.filter(p => p.lastTransfer?.from && p.lastTransfer?.to);
  if (cands.length < 4) return null;
  const target = pick1(cands);
  const distractors = pickN(
    [...new Set(pool.filter(p => p.club && p.club !== target.lastTransfer.from).map(p => p.club))], 3
  );
  if (distractors.length < 3) return null;
  return {
    type: 'previous_club',
    ...q(
      `${target.name} şu anki kulübüne geçmeden önce nerede oynuyordu?`,
      `Where did ${target.name} play before their current club?`,
      `... → ${target.lastTransfer.to}`,
    ),
    options: shuffle([target.lastTransfer.from, ...distractors]), correct: target.lastTransfer.from,
  };
}

function qHigherTransferFee(pool) {
  const cands = pool.filter(p => p.lastTransfer?.fee > 0);
  if (cands.length < 2) return null;
  const [a, b] = pickN(cands, 2);
  if (a.lastTransfer.fee === b.lastTransfer.fee) return null;
  const correct = a.lastTransfer.fee > b.lastTransfer.fee ? a.name : b.name;
  return {
    type: 'higher_fee',
    ...q(
      'Hangisi için daha fazla bonservis ödendi?',
      'Who commanded a higher transfer fee?',
      `${a.name} vs ${b.name}`,
    ),
    options: shuffle([a.name, b.name]), correct,
  };
}

// ── Yeni soru tipleri ────────────────────────────────────────────────────────

// 4 oyuncudan en değerlisi kim?
function qMostExpensive(pool) {
  if (pool.length < 4) return null;
  const group = pickN(pool, 4);
  const vals = new Set(group.map(p => p.marketValue));
  if (vals.size < 4) return null;
  const richest = group.reduce((max, p) => p.marketValue > max.marketValue ? p : max, group[0]);
  return {
    type: 'most_expensive',
    ...q(
      'Piyasa değeri en yüksek oyuncu hangisi?',
      'Which player has the highest market value?',
    ),
    options: shuffle(group.map(p => p.name)), correct: richest.name,
  };
}

// Hangisi daha genç?
function qYounger(pool) {
  const cands = pool.filter(p => p.birthYear);
  if (cands.length < 2) return null;
  const [a, b] = pickN(cands, 2);
  if (a.birthYear === b.birthYear) return null;
  const correct = a.birthYear > b.birthYear ? a.name : b.name;
  return {
    type: 'younger',
    ...q('Hangisi daha genç?', 'Who is younger?', `${a.name} vs ${b.name}`),
    options: shuffle([a.name, b.name]), correct,
  };
}

// Hangisi daha yaşlı?
function qOlderPlayer(pool) {
  const cands = pool.filter(p => p.birthYear);
  if (cands.length < 2) return null;
  const [a, b] = pickN(cands, 2);
  if (a.birthYear === b.birthYear) return null;
  const correct = a.birthYear < b.birthYear ? a.name : b.name;
  return {
    type: 'older_player',
    ...q('Hangisi daha yaşlı?', 'Who is older?', `${a.name} vs ${b.name}`),
    options: shuffle([a.name, b.name]), correct,
  };
}

// En uzun boylu kim?
function qTallest(pool) {
  const cands = pool.filter(p => p.height && p.height > 150);
  if (cands.length < 4) return null;
  const group = pickN(cands, 4);
  const tallest = group.reduce((max, p) => p.height > max.height ? p : max, group[0]);
  return {
    type: 'tallest',
    ...q('Hangisi en uzun boylu?', 'Who is the tallest?'),
    options: shuffle(group.map(p => p.name)), correct: tallest.name,
  };
}

// Hangisi [ülke] milli takımında OYNAMADI?
function qNationalityNotFrom(pool) {
  const nats = [...new Set(pool.map(p => p.nationality).filter(Boolean))];
  const abundant = nats.filter(n => pool.filter(p => p.nationality === n).length >= 3);
  if (abundant.length === 0) return null;
  const nat = pick1(abundant);
  const fromNat  = pickN(pool.filter(p => p.nationality === nat), 3);
  const notFrom  = pool.filter(p => p.nationality !== nat && p.nationality);
  if (notFrom.length === 0) return null;
  const outsider = pick1(notFrom);
  return {
    type: 'nationality_not_from',
    ...q(
      `Hangisi ${nat} milli takımında OYNAMADI?`,
      `Which player did NOT play for ${nat}?`,
    ),
    options: shuffle([...fromNat.map(p => p.name), outsider.name]),
    correct: outsider.name,
  };
}

// Kariyer yolunu hangi oyuncu izledi?
function qCareerPath(pool) {
  const cands = pool.filter(p => p.careerPath && p.careerPath.length >= 3);
  if (cands.length < 4) return null;
  const target   = pick1(cands);
  const pathStr  = target.careerPath.map(e => e.club).join(' → ');
  const distract = pickN(cands.filter(p => p.name !== target.name).map(p => p.name), 3);
  if (distract.length < 3) return null;
  return {
    type: 'career_path',
    ...q(
      'Bu kariyer yolunu hangi oyuncu izledi?',
      'Which player followed this career path?',
      pathStr,
    ),
    options: shuffle([target.name, ...distract]), correct: target.name,
  };
}

// İkinci kulübü neydi?
function qSecondClub(pool) {
  const cands = pool.filter(p => p.careerPath && p.careerPath.length >= 2);
  if (cands.length < 4) return null;
  const target     = pick1(cands);
  const secondClub = target.careerPath[1].club;
  const allClubs   = [...new Set(pool.filter(p => p.club !== 'Unknown').map(p => p.club))];
  const distract   = pickN(allClubs.filter(c => c !== secondClub), 3);
  if (distract.length < 3) return null;
  return {
    type: 'second_club',
    ...q(
      `${target.name}'in kariyer yolundaki ikinci kulübü neydi?`,
      `What was ${target.name}'s second club in their career?`,
    ),
    options: shuffle([secondClub, ...distract]), correct: secondClub,
  };
}

// [Oyuncu]'nun son transferinde gittiği kulüp hangisi?
function qTransferDestination(pool) {
  const cands = pool.filter(p => p.lastTransfer?.to && p.lastTransfer?.from);
  if (cands.length < 4) return null;
  const target = pick1(cands);
  const allClubs = [...new Set(pool.filter(p => p.club !== 'Unknown').map(p => p.club))];
  const distract = pickN(allClubs.filter(c => c !== target.lastTransfer.to), 3);
  if (distract.length < 3) return null;
  return {
    type: 'transfer_destination',
    ...q(
      `${target.name} son transferinde hangi kulübe gitti?`,
      `Which club did ${target.name} join in their last transfer?`,
      `${target.lastTransfer.from} → ?`,
    ),
    options: shuffle([target.lastTransfer.to, ...distract]), correct: target.lastTransfer.to,
  };
}

// Hangi oyuncu [oyuncu] ile aynı milliyetten?
function qSameNationality(pool) {
  const cands = pool.filter(p => p.nationality);
  if (cands.length < 4) return null;
  const nats = [...new Set(cands.map(p => p.nationality))];
  const goodNat = nats.filter(n => cands.filter(p => p.nationality === n).length >= 2);
  if (goodNat.length === 0) return null;
  const nat    = pick1(goodNat);
  const fromNat = cands.filter(p => p.nationality === nat);
  const [anchor, correct_p] = pickN(fromNat, 2);
  const others = cands.filter(p => p.nationality !== nat);
  if (others.length < 3) return null;
  const distract = pickN(others, 3);
  return {
    type: 'same_nationality',
    ...q(
      `Hangi oyuncu ${anchor.name} ile aynı milliyetten?`,
      `Which player shares ${anchor.name}'s nationality?`,
    ),
    options: shuffle([correct_p.name, ...distract.map(p => p.name)]), correct: correct_p.name,
  };
}

// [Oyuncu]'nun piyasa değeri hangisine en yakın?
function qMarketValueGuess(pool) {
  if (pool.length < 2) return null;
  const target = pick1(pool);
  const mv = target.marketValue;
  const step = mv >= 50e6 ? 10e6 : mv >= 10e6 ? 5e6 : 1e6;
  const base = Math.round(mv / step) * step;
  const offsets = shuffle([-3, -2, -1, 1, 2, 3]).slice(0, 3);
  const wrong = offsets.map(o => base + o * step).filter(v => v > 0 && v !== mv);
  if (wrong.length < 3) return null;
  const correctStr = formatMV(mv);
  const options = shuffle([correctStr, ...wrong.map(formatMV)]);
  return {
    type: 'market_value_guess',
    ...q(
      `${target.name}'in piyasa değeri hangisine en yakın?`,
      `Which figure is closest to ${target.name}'s market value?`,
    ),
    options, correct: correctStr,
  };
}

// Hangisi diğerleriyle aynı mevkide oynamıyor?
function qPositionOddOne(pool) {
  const cands = pool.filter(p => p.position && p.position !== 'Unknown');
  if (cands.length < 4) return null;
  const positions = [...new Set(cands.map(p => p.position))];
  const goodPos   = positions.filter(pos => cands.filter(p => p.position === pos).length >= 3);
  if (goodPos.length === 0) return null;
  const pos    = pick1(goodPos);
  const same3  = pickN(cands.filter(p => p.position === pos), 3);
  const others = cands.filter(p => p.position !== pos);
  if (others.length === 0) return null;
  const odd = pick1(others);
  return {
    type: 'position_odd_one',
    ...q(
      'Hangi oyuncu diğerleriyle aynı mevkide oynamıyor?',
      'Which player does NOT play the same position as the others?',
    ),
    options: shuffle([...same3.map(p => p.name), odd.name]),
    correct: odd.name,
  };
}

// ── Generator listeleri ───────────────────────────────────────────────────────
const BASE_GENERATORS = [
  qHigherValue, qPlayerClub, qGuessPlayer, qNationality,
  qPosition, qPreviousClub, qHigherTransferFee,
  qMostExpensive, qPositionOddOne,
  qTransferDestination, qSameNationality, qMarketValueGuess,
];

const ALL_GENERATORS = [
  ...BASE_GENERATORS,
  qNationalityNotFrom, qCareerPath, qSecondClub,
  qOlderPlayer, qYounger, qTallest,
];

const HARD_GENERATORS = [
  qNationalityNotFrom, qCareerPath, qSecondClub,
  qOlderPlayer, qYounger, qTallest,
  qMostExpensive, qPositionOddOne,
  qSameNationality, qMarketValueGuess,
];

function getGenerators(mode) {
  if (mode === 'hard') return HARD_GENERATORS;
  return ALL_GENERATORS;
}

// ── Ana export ────────────────────────────────────────────────────────────────
async function generateQuestions(count = 10, mode = 'europe') {
  if (PLAYERS.length === 0) await loadSeed();

  const pool = getPool(mode);
  if (pool.length < 5) {
    throw new Error(
      mode === 'turkey'
        ? 'Türkiye modu için yeterli oyuncu yok. Seed güncellenmeli — GitHub Actions çalıştır.'
        : `Yeterli oyuncu yok (${pool.length})`
    );
  }

  const gens = getGenerators(mode);
  const questions = [];
  let attempts = 0;
  while (questions.length < count && attempts < count * 25) {
    const gen = gens[Math.floor(Math.random() * gens.length)];
    const q   = gen(pool);
    // deduplicate: question text + sub birlikte kontrol et
    const key = (q?.tr.question || '') + '|' + (q?.tr.sub || '');
    if (q && !questions.some(e => (e.tr.question + '|' + (e.tr.sub || '')) === key)) {
      questions.push(q);
    }
    attempts++;
  }

  if (questions.length < count) {
    // Turkey pool çok küçük olabilir, üretilebildiği kadarını döndür
    if (mode === 'turkey' && questions.length >= 5) return questions;
    throw new Error(`Yetersiz soru: ${questions.length}/${count}`);
  }
  return questions;
}

module.exports = { generateQuestions, getLoadedAt: () => loadedAt };
