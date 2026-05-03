// questionGenerator.js — v2
const fs    = require('fs');
const path  = require('path');
const https = require('https');

const GITHUB_USER = process.env.GH_USER || 'alpirez96';
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
const pickN    = (arr, n) => shuffle(arr).slice(0, n);
const pick1    = arr => arr[Math.floor(Math.random() * arr.length)];
const formatMV = v => v >= 1e6 ? `€${(v / 1e6).toFixed(0)}M` : `€${(v / 1e3).toFixed(0)}K`;

// ── Ayar havuzu filtreleme ────────────────────────────────────────────────────
const TR_KEYWORDS = [
  'Galatasaray','Fenerbahçe','Beşiktaş','Trabzonspor','Başakşehir',
  'Konyaspor','Sivasspor','Antalyaspor','Alanyaspor','Kayserispor',
  'Adana Demirspor','Kasımpaşa','Rizespor','Samsunspor','Pendikspor',
  'Hatayspor','Ankaragücü','Karagümrük','Eyüpspor','Bodrum',
];

const ATTACKING_POSITIONS = [
  'Centre-Forward','Second Striker','Left Winger','Right Winger','Attack','Winger',
];

function applySettings(allPlayers, settings = {}) {
  const { difficulty = 'normal', playerPool = 'europe' } = settings;
  let pool;
  switch (playerPool) {
    case 'turkey': {
      pool = allPlayers.filter(p => p.leagueId === 'TR1');
      if (pool.length < 8) {
        const byClub = allPlayers.filter(p => TR_KEYWORDS.some(k => p.club?.includes(k)));
        const byNat  = allPlayers.filter(p => p.nationality === 'Türkiye');
        pool = [...new Map([...byClub, ...byNat].map(p => [p.id, p])).values()];
      }
      break;
    }
    case 'mixed':
      pool = allPlayers;
      break;
    case 'strikers_only':
      pool = allPlayers.filter(p => ATTACKING_POSITIONS.includes(p.position));
      break;
    case 'europe':
    default:
      pool = allPlayers.filter(p => p.leagueId && p.leagueId !== 'TR1');
      break;
  }
  // PLAYERS is sorted by marketValue desc — difficulty slices the top N
  const limit = difficulty === 'easy' ? 50 : difficulty === 'hard' ? Infinity : 200;
  return limit === Infinity ? pool : pool.slice(0, limit);
}

// ── Bilingual soru yardımcısı ─────────────────────────────────────────────────
const q = (tr, en, trSub, enSub) => ({
  tr: { question: tr, sub: trSub || null },
  en: { question: en, sub: enSub || trSub || null },
});

// ── Mevki çevirisi ────────────────────────────────────────────────────────────
const POSITION_TR = {
  'Goalkeeper':'Kaleci','Centre-Back':'Stoper','Left-Back':'Sol Bek',
  'Right-Back':'Sağ Bek','Defensive Midfield':'Defansif Orta Saha',
  'Central Midfield':'Orta Saha','Attacking Midfield':'Ofansif Orta Saha',
  'Left Winger':'Sol Kanat','Right Winger':'Sağ Kanat',
  'Left Midfield':'Sol Orta Saha','Right Midfield':'Sağ Orta Saha',
  'Centre-Forward':'Santrafor','Second Striker':'İkinci Forvet',
  'Attack':'Forvet','Defender':'Defans','Midfield':'Orta Saha','Winger':'Kanat',
};
const posTR   = pos => POSITION_TR[pos] || pos;
const posOpts = opts => opts.map(posTR);

// ── Lig adları ────────────────────────────────────────────────────────────────
const LEAGUE_NAMES = {
  TR1:{tr:'Süper Lig',en:'Süper Lig'},GB1:{tr:'Premier Lig',en:'Premier League'},
  ES1:{tr:'La Liga',en:'La Liga'},IT1:{tr:'Serie A',en:'Serie A'},
  L1:{tr:'Bundesliga',en:'Bundesliga'},FR1:{tr:'Ligue 1',en:'Ligue 1'},
  NL1:{tr:'Eredivisie',en:'Eredivisie'},PO1:{tr:'Primeira Liga',en:'Primeira Liga'},
  BE1:{tr:'Pro Ligi',en:'Pro League'},SC1:{tr:'İskoç Ligi',en:'Scottish Premiership'},
};
const ligTR = id => LEAGUE_NAMES[id]?.tr || id;
const ligEN = id => LEAGUE_NAMES[id]?.en || id;

// ── Quickfire soru tipleri ────────────────────────────────────────────────────

function qHigherValue(pool) {
  if (pool.length < 2) return null;
  const [a, b] = pickN(pool, 2);
  if (a.marketValue === b.marketValue) return null;
  const correct = a.marketValue > b.marketValue ? a.name : b.name;
  return { type:'higher_value', ...q('Kimin piyasa değeri daha yüksek?','Who has a higher market value?',`${a.name} vs ${b.name}`), options:shuffle([a.name,b.name]), correct };
}

function qPlayerClub(pool) {
  const cands = pool.filter(p => p.club !== 'Unknown');
  if (cands.length < 4) return null;
  const target = pick1(cands);
  const distractors = pickN([...new Set(pool.filter(p => p.club !== target.club && p.club !== 'Unknown').map(p => p.club))], 3);
  if (distractors.length < 3) return null;
  return { type:'player_club', ...q(`${target.name} hangi kulüpte oynuyor?`,`Which club does ${target.name} play for?`), options:shuffle([target.club,...distractors]), correct:target.club };
}

function qGuessPlayer(pool) {
  const cands = pool.filter(p => p.club !== 'Unknown');
  if (cands.length < 4) return null;
  const target = pick1(cands);
  const distractors = pickN(pool.filter(p => p.name !== target.name).map(p => p.name), 3);
  if (distractors.length < 3) return null;
  return { type:'guess_player', ...q(`${target.club}'deki ${formatMV(target.marketValue)} değerli oyuncu kim?`,`A ${formatMV(target.marketValue)} player at ${target.club}. Who?`), options:shuffle([target.name,...distractors]), correct:target.name };
}

function qNationality(pool) {
  const cands = pool.filter(p => p.nationality);
  if (cands.length < 4) return null;
  const target = pick1(cands);
  const distractors = pickN([...new Set(pool.filter(p => p.nationality !== target.nationality).map(p => p.nationality))], 3);
  if (distractors.length < 3) return null;
  return { type:'nationality', ...q(`${target.name} hangi ülkeli?`,`What nationality is ${target.name}?`), options:shuffle([target.nationality,...distractors]), correct:target.nationality };
}

function qPosition(pool) {
  const cands = pool.filter(p => p.position && p.position !== 'Unknown');
  if (cands.length < 4) return null;
  const target = pick1(cands);
  const positions = [...new Set(pool.map(p => p.position).filter(p => p && p !== 'Unknown'))];
  const distractors = pickN(positions.filter(p => p !== target.position), 3);
  if (distractors.length < 3) return null;
  const opts = shuffle([target.position, ...distractors]);
  return { type:'position', ...q(`${target.name} hangi mevkide oynuyor?`,`What position does ${target.name} play?`), options:opts, correct:target.position, optionsTR:posOpts(opts) };
}

function qPreviousClub(pool) {
  const cands = pool.filter(p => p.lastTransfer?.from && p.lastTransfer?.to);
  if (cands.length < 4) return null;
  const target = pick1(cands);
  const distractors = pickN([...new Set(pool.filter(p => p.club && p.club !== target.lastTransfer.from).map(p => p.club))], 3);
  if (distractors.length < 3) return null;
  return { type:'previous_club', ...q(`${target.name} şu anki kulübüne geçmeden önce nerede oynuyordu?`,`Where did ${target.name} play before their current club?`,`... → ${target.lastTransfer.to}`), options:shuffle([target.lastTransfer.from,...distractors]), correct:target.lastTransfer.from };
}

function qHigherTransferFee(pool) {
  const cands = pool.filter(p => p.lastTransfer?.fee > 0);
  if (cands.length < 2) return null;
  const [a, b] = pickN(cands, 2);
  if (a.lastTransfer.fee === b.lastTransfer.fee) return null;
  const correct = a.lastTransfer.fee > b.lastTransfer.fee ? a.name : b.name;
  return { type:'higher_fee', ...q('Hangisi için daha fazla bonservis ödendi?','Who commanded a higher transfer fee?',`${a.name} vs ${b.name}`), options:shuffle([a.name,b.name]), correct };
}

function qMostExpensive(pool) {
  if (pool.length < 4) return null;
  const group = pickN(pool, 4);
  if (new Set(group.map(p => p.marketValue)).size < 4) return null;
  const richest = group.reduce((max, p) => p.marketValue > max.marketValue ? p : max, group[0]);
  return { type:'most_expensive', ...q('Piyasa değeri en yüksek oyuncu hangisi?','Which player has the highest market value?'), options:shuffle(group.map(p => p.name)), correct:richest.name };
}

function qYounger(pool) {
  const cands = pool.filter(p => p.birthYear);
  if (cands.length < 2) return null;
  const [a, b] = pickN(cands, 2);
  if (a.birthYear === b.birthYear) return null;
  const correct = a.birthYear > b.birthYear ? a.name : b.name;
  return { type:'younger', ...q('Hangisi daha genç?','Who is younger?',`${a.name} vs ${b.name}`), options:shuffle([a.name,b.name]), correct };
}

function qOlderPlayer(pool) {
  const cands = pool.filter(p => p.birthYear);
  if (cands.length < 2) return null;
  const [a, b] = pickN(cands, 2);
  if (a.birthYear === b.birthYear) return null;
  const correct = a.birthYear < b.birthYear ? a.name : b.name;
  return { type:'older_player', ...q('Hangisi daha yaşlı?','Who is older?',`${a.name} vs ${b.name}`), options:shuffle([a.name,b.name]), correct };
}

function qTallest(pool) {
  const cands = pool.filter(p => p.height && p.height > 150);
  if (cands.length < 4) return null;
  const group = pickN(cands, 4);
  const tallest = group.reduce((max, p) => p.height > max.height ? p : max, group[0]);
  return { type:'tallest', ...q('Hangisi en uzun boylu?','Who is the tallest?'), options:shuffle(group.map(p => p.name)), correct:tallest.name };
}

function qNationalityNotFrom(pool) {
  const nats = [...new Set(pool.map(p => p.nationality).filter(Boolean))];
  const abundant = nats.filter(n => pool.filter(p => p.nationality === n).length >= 3);
  if (abundant.length === 0) return null;
  const nat = pick1(abundant);
  const fromNat  = pickN(pool.filter(p => p.nationality === nat), 3);
  const notFrom  = pool.filter(p => p.nationality !== nat && p.nationality);
  if (notFrom.length === 0) return null;
  const outsider = pick1(notFrom);
  return { type:'nationality_not_from', ...q(`Hangisi ${nat} milli takımında OYNAMADI?`,`Which player did NOT play for ${nat}?`), options:shuffle([...fromNat.map(p => p.name),outsider.name]), correct:outsider.name };
}

function qCareerPath(pool) {
  const cands = pool.filter(p => p.careerPath && p.careerPath.length >= 3);
  if (cands.length < 4) return null;
  const target  = pick1(cands);
  const pathStr = target.careerPath.map(e => e.club).join(' → ');
  const distract = pickN(cands.filter(p => p.name !== target.name).map(p => p.name), 3);
  if (distract.length < 3) return null;
  return { type:'career_path', ...q('Bu kariyer yolunu hangi oyuncu izledi?','Which player followed this career path?',pathStr), options:shuffle([target.name,...distract]), correct:target.name };
}

function qSecondClub(pool) {
  const cands = pool.filter(p => p.careerPath && p.careerPath.length >= 2);
  if (cands.length < 4) return null;
  const target     = pick1(cands);
  const secondClub = target.careerPath[1].club;
  const allClubs   = [...new Set(pool.filter(p => p.club !== 'Unknown').map(p => p.club))];
  const distract   = pickN(allClubs.filter(c => c !== secondClub), 3);
  if (distract.length < 3) return null;
  return { type:'second_club', ...q(`${target.name}'in kariyer yolundaki ikinci kulübü neydi?`,`What was ${target.name}'s second club in their career?`), options:shuffle([secondClub,...distract]), correct:secondClub };
}

function qTransferDestination(pool) {
  const cands = pool.filter(p => p.lastTransfer?.to && p.lastTransfer?.from);
  if (cands.length < 4) return null;
  const target   = pick1(cands);
  const allClubs = [...new Set(pool.filter(p => p.club !== 'Unknown').map(p => p.club))];
  const distract = pickN(allClubs.filter(c => c !== target.lastTransfer.to), 3);
  if (distract.length < 3) return null;
  return { type:'transfer_destination', ...q(`${target.name} son transferinde hangi kulübe gitti?`,`Which club did ${target.name} join in their last transfer?`,`${target.lastTransfer.from} → ?`), options:shuffle([target.lastTransfer.to,...distract]), correct:target.lastTransfer.to };
}

function qSameNationality(pool) {
  const cands = pool.filter(p => p.nationality);
  if (cands.length < 4) return null;
  const nats    = [...new Set(cands.map(p => p.nationality))];
  const goodNat = nats.filter(n => cands.filter(p => p.nationality === n).length >= 2);
  if (goodNat.length === 0) return null;
  const nat      = pick1(goodNat);
  const fromNat  = cands.filter(p => p.nationality === nat);
  const [anchor, correctP] = pickN(fromNat, 2);
  const others   = cands.filter(p => p.nationality !== nat);
  if (others.length < 3) return null;
  return { type:'same_nationality', ...q(`Hangi oyuncu ${anchor.name} ile aynı milliyetten?`,`Which player shares ${anchor.name}'s nationality?`), options:shuffle([correctP.name,...pickN(others,3).map(p=>p.name)]), correct:correctP.name };
}

function qMarketValueGuess(pool) {
  if (pool.length < 2) return null;
  const target = pick1(pool);
  const mv   = target.marketValue;
  const step = mv >= 50e6 ? 10e6 : mv >= 10e6 ? 5e6 : 1e6;
  const base = Math.round(mv / step) * step;
  const offsets = shuffle([-3,-2,-1,1,2,3]).slice(0,3);
  const wrong = offsets.map(o => base + o*step).filter(v => v > 0 && v !== mv);
  if (wrong.length < 3) return null;
  const correctStr = formatMV(mv);
  const options = shuffle([correctStr,...wrong.map(formatMV)]);
  return { type:'market_value_guess', ...q(`${target.name}'in piyasa değeri hangisine en yakın?`,`Which figure is closest to ${target.name}'s market value?`), options, correct:correctStr };
}

function qPositionOddOne(pool) {
  const cands = pool.filter(p => p.position && p.position !== 'Unknown');
  if (cands.length < 4) return null;
  const positions = [...new Set(cands.map(p => p.position))];
  const goodPos   = positions.filter(pos => cands.filter(p => p.position === pos).length >= 3);
  if (goodPos.length === 0) return null;
  const pos   = pick1(goodPos);
  const same3 = pickN(cands.filter(p => p.position === pos), 3);
  const others = cands.filter(p => p.position !== pos);
  if (others.length === 0) return null;
  const odd = pick1(others);
  return { type:'position_odd_one', ...q('Hangi oyuncu diğerleriyle aynı mevkide oynamıyor?','Which player does NOT play the same position as the others?',`Ortak mevki: ${posTR(pos)}`,`Common position: ${pos}`), options:shuffle([...same3.map(p=>p.name),odd.name]), correct:odd.name };
}

function qLeagueOddOne(pool) {
  const cands = pool.filter(p => p.leagueId && LEAGUE_NAMES[p.leagueId]);
  if (cands.length < 4) return null;
  const leagues    = [...new Set(cands.map(p => p.leagueId))];
  const goodLeague = leagues.filter(l => cands.filter(p => p.leagueId === l).length >= 3);
  if (goodLeague.length === 0) return null;
  const mainLeague = pick1(goodLeague);
  const same3  = pickN(cands.filter(p => p.leagueId === mainLeague), 3);
  const others = cands.filter(p => p.leagueId !== mainLeague);
  if (others.length === 0) return null;
  const odd = pick1(others);
  return { type:'league_odd_one', ...q('Hangi oyuncu diğerleriyle aynı ligde oynamıyor?','Which player does NOT play in the same league as the others?'), options:shuffle([...same3.map(p=>p.name),odd.name]), correct:odd.name };
}

function qSameLeague(pool) {
  const cands = pool.filter(p => p.leagueId && LEAGUE_NAMES[p.leagueId]);
  if (cands.length < 4) return null;
  const anchor = pick1(cands);
  const sameL  = cands.filter(p => p.leagueId === anchor.leagueId && p.name !== anchor.name);
  if (sameL.length === 0) return null;
  const correctP = pick1(sameL);
  const others   = cands.filter(p => p.leagueId !== anchor.leagueId);
  if (others.length < 3) return null;
  return { type:'same_league', ...q(`Hangi oyuncu ${anchor.name} ile aynı ligde oynuyor?`,`Which player plays in the same league as ${anchor.name}?`,`${anchor.club} — ${ligTR(anchor.leagueId)}?`,`${anchor.club} — ${ligEN(anchor.leagueId)}?`), options:shuffle([correctP.name,...pickN(others,3).map(p=>p.name)]), correct:correctP.name };
}

function qAgeGuess(pool) {
  const cands = pool.filter(p => p.age && p.age > 15 && p.age < 45);
  if (cands.length < 2) return null;
  const target = pick1(cands);
  const age = target.age;
  const wrongSet = new Set();
  for (const o of shuffle([-4,-3,-2,-1,1,2,3,4])) {
    const w = age + o;
    if (w > 15 && w < 45 && !wrongSet.has(w)) wrongSet.add(w);
    if (wrongSet.size === 3) break;
  }
  if (wrongSet.size < 3) return null;
  return { type:'age_guess', ...q(`${target.name} kaç yaşında?`,`How old is ${target.name}?`), options:shuffle([age,...wrongSet]).map(String), correct:String(age) };
}

function qHeightGuess(pool) {
  const cands = pool.filter(p => p.height && p.height > 160 && p.height < 210);
  if (cands.length < 2) return null;
  const target = pick1(cands);
  const h = target.height;
  const wrongSet = new Set();
  for (const s of shuffle([-9,-6,-3,3,6,9])) {
    const w = h + s;
    if (w > 160 && w < 210 && !wrongSet.has(w)) wrongSet.add(w);
    if (wrongSet.size === 3) break;
  }
  if (wrongSet.size < 3) return null;
  return { type:'height_guess', ...q(`${target.name} kaç cm boyunda?`,`How tall is ${target.name}? (cm)`), options:shuffle([h,...wrongSet]).map(String), correct:String(h) };
}

// ── Career Path Challenge ─────────────────────────────────────────────────────
function qCareerPathChallenge(pool) {
  const cands = pool.filter(p =>
    p.careerPath && p.careerPath.length >= 2 && p.nationality && p.position && p.age
  );
  if (cands.length < 4) return null;
  const target  = pick1(cands);
  const distract = pickN(cands.filter(p => p.id !== target.id).map(p => p.name), 3);
  if (distract.length < 3) return null;

  // Career steps — clubs hidden with block chars
  const careerSteps = target.careerPath.map(s => ({
    year:  s.year || '—',
    club:  '▓'.repeat(Math.max(4, Math.min(9, (s.club.split(' ')[0]).length + 3))),
    apps:  '—',
    goals: '—',
  }));

  const ageRange = target.age <= 21 ? '≤21' :
                   target.age <= 25 ? '22-25' :
                   target.age <= 29 ? '26-29' :
                   target.age <= 33 ? '30-33' : '34+';
  const lastClub    = target.careerPath[target.careerPath.length - 1]?.club || target.club;
  const lastInitial = lastClub.trim().charAt(0).toUpperCase();

  return {
    type: 'career_challenge',
    careerSteps,
    _realClubs: target.careerPath.map(s => s.club || '?'),
    hints: [
      { type:'nationality',  labelTR:'Milliyet',             labelEN:'Nationality',       value: target.nationality },
      { type:'position',     labelTR:'Mevki',                labelEN:'Position',          value: target.position, valueTR: posTR(target.position) },
      { type:'age_range',    labelTR:'Yaş aralığı',          labelEN:'Age range',         value: ageRange },
      { type:'last_initial', labelTR:'Son kulüp baş harfi',  labelEN:'Last club initial', value: lastInitial },
    ],
    ...q('Bu kariyer yolunu hangi oyuncu izledi?', 'Which player followed this career path?'),
    options:  shuffle([target.name, ...distract]),
    correct:  target.name,
  };
}

// ── Squad Builder ─────────────────────────────────────────────────────────────
function qSquadBuilder(pool) {
  const clubMap = new Map();
  pool.forEach(p => {
    if (p.club && p.club !== 'Unknown') {
      if (!clubMap.has(p.club)) clubMap.set(p.club, []);
      clubMap.get(p.club).push(p);
    }
  });
  const validClubs = [...clubMap.entries()].filter(([, ps]) => ps.length >= 8);
  if (validClubs.length === 0) return null;

  const [clubName, clubPlayers] = pick1(validClubs);
  const squad8 = pickN(clubPlayers, 8);
  const squadPositions = squad8.map(p => p.position).filter(Boolean);

  const distractPool = pool.filter(p => p.club !== clubName);
  const samePosPool  = distractPool.filter(p => squadPositions.includes(p.position));
  const distract4    = pickN(samePosPool.length >= 4 ? samePosPool : distractPool, 4);
  if (distract4.length < 4) return null;

  const allCards = shuffle([
    ...squad8.map(p   => ({ id: String(p.id), name: p.name, position: p.position || '' })),
    ...distract4.map(p => ({ id: String(p.id), name: p.name, position: p.position || '' })),
  ]);

  return {
    type:         'squad_builder',
    clubName,
    squadPlayers: allCards,
    correctIds:   squad8.map(p => String(p.id)),
    ...q(`${clubName} kadrosuna kimin dahil olduğunu bul!`, `Find who belongs to ${clubName}'s squad!`),
    options: [],
    correct: '',
  };
}

// ── Higher or Lower Chain ─────────────────────────────────────────────────────
function generateHLChain(players, count = 30) {
  const pool = players.filter(p => p.marketValue > 0);
  return pickN(pool, Math.min(count, pool.length)).map(p => ({
    id: p.id, name: p.name, club: p.club,
    nationality: p.nationality, position: p.position,
    marketValue: p.marketValue,
  }));
}

// ── Generator listeleri ───────────────────────────────────────────────────────
const EASY_GENERATORS = [
  qHigherValue, qPlayerClub, qGuessPlayer, qNationality, qPosition, qMostExpensive,
];

const BASE_GENERATORS = [
  qHigherValue, qPlayerClub, qGuessPlayer, qNationality, qPosition,
  qPreviousClub, qHigherTransferFee, qMostExpensive, qPositionOddOne,
  qTransferDestination, qSameNationality, qMarketValueGuess,
];

const ALL_GENERATORS = [
  ...BASE_GENERATORS,
  qNationalityNotFrom, qCareerPath, qSecondClub,
  qOlderPlayer, qYounger, qTallest,
  qLeagueOddOne, qSameLeague, qAgeGuess, qHeightGuess,
];

const HARD_GENERATORS = [
  qNationalityNotFrom, qCareerPath, qSecondClub,
  qOlderPlayer, qYounger, qTallest, qMostExpensive, qPositionOddOne,
  qSameNationality, qMarketValueGuess, qLeagueOddOne, qSameLeague,
  qAgeGuess, qHeightGuess,
];

function getGenerators(difficulty) {
  if (difficulty === 'easy') return EASY_GENERATORS;
  if (difficulty === 'hard') return HARD_GENERATORS;
  return ALL_GENERATORS;
}

// ── Ana export ────────────────────────────────────────────────────────────────
async function generateQuestions(count = 10, gameMode = 'quickfire', settings = {}) {
  if (PLAYERS.length === 0) await loadSeed();
  const pool = applySettings(PLAYERS, settings);
  if (pool.length < 5) throw new Error(`Yeterli oyuncu yok (${pool.length})`);

  if (gameMode === 'career') {
    const cands = pool.filter(p => p.careerPath?.length >= 2 && p.nationality && p.position && p.age);
    if (cands.length < 4) throw new Error('Kariyer modu için yeterli oyuncu yok (seed güncelle)');
    const questions = [];
    let attempts = 0;
    while (questions.length < count && attempts < count * 20) {
      const q = qCareerPathChallenge(cands);
      if (q && !questions.some(e => e.correct === q.correct)) questions.push(q);
      attempts++;
    }
    if (questions.length < count) throw new Error(`Yetersiz kariyer sorusu: ${questions.length}/${count}`);
    return questions;
  }

  if (gameMode === 'squad') {
    // Squad builder always uses the full player database across all leagues so there
    // are enough clubs with 8+ players. The playerPool setting does not restrict here.
    const squadPool = PLAYERS;
    const clubMap = new Map();
    squadPool.forEach(p => { if (p.club && p.club !== 'Unknown') { if (!clubMap.has(p.club)) clubMap.set(p.club, []); clubMap.get(p.club).push(p); } });
    const eligibleClubCount = [...clubMap.values()].filter(ps => ps.length >= 8).length;
    if (eligibleClubCount === 0) throw new Error('Yeterli kulüp verisi yok');
    const target = Math.min(count, eligibleClubCount);
    const usedClubs = new Set();
    const questions = [];
    let attempts = 0;
    while (questions.length < target && attempts < target * 20) {
      const q = qSquadBuilder(squadPool);
      if (q && !usedClubs.has(q.clubName)) { usedClubs.add(q.clubName); questions.push(q); }
      attempts++;
    }
    if (questions.length === 0) throw new Error('Yetersiz kulüp');
    return questions;
  }

  if (gameMode === 'findplayer') {
    // Always use full PLAYERS so all career paths are available for pair-finding
    const clubIndex = buildClubIndex(PLAYERS);
    const usedPairs = new Set();
    const questions = [];
    let attempts = 0;
    while (questions.length < count && attempts < count * 50) {
      const q = qFindPlayer(PLAYERS, clubIndex);
      if (q) {
        const key = [q.fpClubA, q.fpClubB].sort().join('|||');
        if (!usedPairs.has(key)) { usedPairs.add(key); questions.push(q); }
      }
      attempts++;
    }
    if (questions.length === 0) throw new Error('Find Player sorusu oluşturulamadı');
    return questions;
  }

  // quickfire / blitz
  const gens = getGenerators(settings.difficulty || 'normal');
  const questions = [];
  let attempts = 0;
  while (questions.length < count && attempts < count * 25) {
    const gen = gens[Math.floor(Math.random() * gens.length)];
    const q   = gen(pool);
    const key = (q?.tr.question || '') + '|' + (q?.tr.sub || '');
    if (q && !questions.some(e => (e.tr.question + '|' + (e.tr.sub || '')) === key)) questions.push(q);
    attempts++;
  }
  if (questions.length < count) {
    if (settings.playerPool === 'turkey' && questions.length >= 5) return questions;
    throw new Error(`Yetersiz soru: ${questions.length}/${count}`);
  }
  return questions;
}

async function loadAndGetHLChain(settings = {}, count = 30) {
  if (PLAYERS.length === 0) await loadSeed();
  const pool = applySettings(PLAYERS, settings);
  if (pool.length < 5) throw new Error('Higher or Lower için yeterli oyuncu yok');
  return generateHLChain(pool, count);
}

// ── Find the Player ───────────────────────────────────────────────────────────
function normalizeName(s) {
  return (s || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ');
}

function buildClubIndex(players) {
  const index = new Map();
  players.forEach(p => {
    const clubs = new Set();
    if (p.club && p.club !== 'Unknown') clubs.add(p.club);
    (p.careerPath || []).forEach(s => { if (s.club) clubs.add(s.club); });
    clubs.forEach(c => {
      if (!index.has(c)) index.set(c, []);
      index.get(c).push(String(p.id));
    });
  });
  return index;
}

function qFindPlayer(players, clubIndex) {
  // Only use clubs with 5+ players so questions feature recognisable teams
  const clubs = [...clubIndex.entries()]
    .filter(([, ids]) => ids.length >= 5)
    .map(([c]) => c);
  if (clubs.length < 2) return null;
  for (let attempt = 0; attempt < 80; attempt++) {
    const [clubA, clubB] = pickN(clubs, 2);
    const setA = new Set(clubIndex.get(clubA) || []);
    const sharedIds = (clubIndex.get(clubB) || []).filter(id => setA.has(id));
    if (sharedIds.length === 0) continue;
    const validPlayers = sharedIds
      .map(id => players.find(p => String(p.id) === id))
      .filter(Boolean);
    if (validPlayers.length === 0) continue;
    const validPlayerNames = [...new Set(validPlayers.map(p => p.name))];
    return {
      type: 'find_player',
      fpClubA: clubA,
      fpClubB: clubB,
      validPlayerNames,
      ...q(
        `${clubA} ve ${clubB} takımlarında oynayan futbolcuyu bul!`,
        `Find a player who played for both ${clubA} and ${clubB}!`,
      ),
      options: [],
      correct: validPlayerNames[0],
    };
  }
  return null;
}

module.exports = { generateQuestions, loadAndGetHLChain, normalizeName, getLoadedAt: () => loadedAt };
