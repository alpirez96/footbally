// scripts/buildSeed.js
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const RAW = path.join(__dirname, '..', 'raw');
const OUT = path.join(__dirname, '..', 'seed.json');
const ZIP_URL = 'https://pub-e682421888d945d684bcae8890b0ec20.r2.dev/data/transfermarkt-datasets.zip';
const ZIP_PATH = path.join(RAW, 'dataset.zip');

const NEEDED = ['players.csv', 'clubs.csv', 'player_valuations.csv', 'transfers.csv'];

const EU_MIN  = 10_000_000; // €10M — Avrupa havuzu eşiği
const TR_MIN  =  3_000_000; // €3M  — Türkiye havuzu eşiği
const EU_MAX  = 400;
const TR_MAX  = 100;

// ── CSV indirme / çıkartma ──────────────────────────────────────────────────
function ensureCSVs() {
  if (!fs.existsSync(RAW)) fs.mkdirSync(RAW, { recursive: true });
  const allExist = NEEDED.every(f => fs.existsSync(path.join(RAW, f)));
  if (allExist) { console.log('CSV dosyaları zaten var, indirme atlanıyor.'); return; }

  if (!fs.existsSync(ZIP_PATH)) {
    console.log('Dataset ZIP indiriliyor...');
    execSync(`curl -L --progress-bar -o "${ZIP_PATH}" "${ZIP_URL}"`, { stdio: 'inherit' });
    const size = fs.statSync(ZIP_PATH).size;
    if (size < 1_000_000) throw new Error(`İndirilen dosya çok küçük (${size} byte)`);
    console.log(`✓ İndirme tamamlandı (${(size / 1024 / 1024).toFixed(1)} MB)`);
  }

  console.log('İhtiyaç duyulan .csv.gz dosyaları çıkartılıyor...');
  const gzFiles = NEEDED.map(f => f + '.gz');
  execSync(`unzip -o -j "${ZIP_PATH}" ${gzFiles.map(f => `"${f}"`).join(' ')} -d "${RAW}"`, { stdio: 'inherit' });

  console.log('Gzip dosyaları açılıyor...');
  for (const gzFile of gzFiles) {
    const gzPath = path.join(RAW, gzFile);
    if (!fs.existsSync(gzPath)) throw new Error(`Çıkartılan dosya bulunamadı: ${gzFile}`);
    execSync(`gunzip -f "${gzPath}"`, { stdio: 'inherit' });
    console.log(`  ✓ ${gzFile.replace('.gz', '')}`);
  }

  const missing = NEEDED.filter(f => !fs.existsSync(path.join(RAW, f)));
  if (missing.length > 0) throw new Error(`Şu CSV dosyaları hâlâ eksik: ${missing.join(', ')}`);
  console.log('✓ Tüm CSV dosyaları hazır');
}

// ── CSV parse ──────────────────────────────────────────────────────────────
function splitCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
    else if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ',' && !inQuotes) { result.push(current); current = ''; }
    else current += ch;
  }
  result.push(current);
  return result;
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = splitCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = splitCSVLine(line);
    const row = {};
    headers.forEach((h, i) => row[h] = values[i] ?? '');
    return row;
  });
}

function readCSV(filename) {
  return parseCSV(fs.readFileSync(path.join(RAW, filename), 'utf8'));
}

// ── Yaş hesabı ──────────────────────────────────────────────────────────────
function calcAge(dob) {
  if (!dob) return null;
  const birth = new Date(dob);
  if (isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  if (now < new Date(now.getFullYear(), birth.getMonth(), birth.getDate())) age--;
  return age;
}

// ── Ana iş ──────────────────────────────────────────────────────────────────
function main() {
  ensureCSVs();

  console.log('\nCSV dosyaları okunuyor...');
  const players    = readCSV('players.csv');
  const clubs      = readCSV('clubs.csv');
  const valuations = readCSV('player_valuations.csv');
  const transfers  = readCSV('transfers.csv');
  console.log(`  ${players.length} oyuncu, ${clubs.length} kulüp, ${valuations.length} değerleme, ${transfers.length} transfer`);

  // Kulüp haritaları
  const clubNameMap   = new Map(); // club_id → ad
  const clubLeagueMap = new Map(); // club_id → domestic_competition_id
  clubs.forEach(c => {
    clubNameMap.set(c.club_id, c.name);
    clubLeagueMap.set(c.club_id, c.domestic_competition_id || 'other');
  });

  // En son piyasa değeri
  const latestValue = new Map();
  valuations.forEach(v => {
    const existing = latestValue.get(v.player_id);
    if (!existing || v.date > existing.date) {
      latestValue.set(v.player_id, { value: parseInt(v.market_value_in_eur) || 0, date: v.date });
    }
  });

  // Tüm transferler oyuncu bazında (kariyer yolu için)
  const playerTransfersMap = new Map();
  transfers.forEach(t => {
    if (!t.player_id) return;
    if (!playerTransfersMap.has(t.player_id)) playerTransfersMap.set(t.player_id, []);
    playerTransfersMap.get(t.player_id).push(t);
  });
  // Tarihe göre artan sırala
  for (const txs of playerTransfersMap.values()) {
    txs.sort((a, b) => (a.transfer_date || '').localeCompare(b.transfer_date || ''));
  }

  // En son transfer (geriye dönük uyumluluk)
  const latestTransfer = new Map();
  for (const [pid, txs] of playerTransfersMap) {
    const last = txs[txs.length - 1];
    latestTransfer.set(pid, {
      from: clubNameMap.get(last.from_club_id) || null,
      to:   clubNameMap.get(last.to_club_id)   || null,
      date: last.transfer_date,
      fee:  parseInt(last.transfer_fee) || 0,
    });
  }

  // Kariyer yolu inşa et (son 4 kulüp)
  function buildCareerPath(pid) {
    const txs = playerTransfersMap.get(pid);
    if (!txs || txs.length === 0) return [];

    const entries = [];
    const firstFrom = clubNameMap.get(txs[0].from_club_id);
    if (firstFrom) entries.push({ club: firstFrom, year: (txs[0].transfer_date || '').slice(0, 4) });

    for (const t of txs) {
      const toName = clubNameMap.get(t.to_club_id);
      if (toName) entries.push({ club: toName, year: (t.transfer_date || '').slice(0, 4) });
    }

    // Ardışık tekrarları kaldır
    const deduped = entries.filter((e, i) => i === 0 || e.club !== entries[i - 1].club);
    return deduped.slice(-4); // son 4
  }

  // Oyuncuları zenginleştir
  const enriched = players.map(p => {
    const mv = latestValue.get(p.player_id);
    if (!mv) return null;

    const leagueId = clubLeagueMap.get(p.current_club_id) || 'other';
    const isTR     = leagueId === 'TR1';
    if (mv.value < (isTR ? TR_MIN : EU_MIN)) return null;

    const dob       = p.date_of_birth;
    const birthYear = dob ? (parseInt(dob.slice(0, 4)) || null) : null;
    const age       = calcAge(dob);
    const height    = parseInt(p.height_in_cm) || null;

    return {
      id:           p.player_id,
      name:         p.name,
      club:         clubNameMap.get(p.current_club_id) || 'Unknown',
      position:     p.position || p.sub_position || 'Unknown',
      nationality:  p.country_of_citizenship,
      marketValue:  mv.value,
      leagueId,
      age,
      birthYear,
      height,
      careerPath:   buildCareerPath(p.player_id),
      lastTransfer: latestTransfer.get(p.player_id) || null,
    };
  }).filter(Boolean).sort((a, b) => b.marketValue - a.marketValue);

  // Havuzları ayır
  const europePool = enriched.filter(p => p.leagueId !== 'TR1').slice(0, EU_MAX);
  const turkeyPool = enriched.filter(p => p.leagueId === 'TR1').slice(0, TR_MAX);
  const finalPlayers = [...europePool, ...turkeyPool];

  fs.writeFileSync(OUT, JSON.stringify({
    players:      finalPlayers,
    generatedAt:  new Date().toISOString(),
    count:        finalPlayers.length,
    europeCount:  europePool.length,
    turkeyCount:  turkeyPool.length,
  }, null, 2));

  const sizeKB = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log(`\n✓ seed.json: ${finalPlayers.length} oyuncu (${sizeKB} KB)`);
  console.log(`  Avrupa: ${europePool.length}, Türkiye: ${turkeyPool.length}`);
  if (finalPlayers[0]) console.log(`  En pahalı (genel): ${finalPlayers[0].name} — €${(finalPlayers[0].marketValue/1e6).toFixed(0)}M`);
  if (turkeyPool[0])   console.log(`  En pahalı (TR):    ${turkeyPool[0].name} — €${(turkeyPool[0].marketValue/1e6).toFixed(1)}M`);
  const withPath = finalPlayers.filter(p => p.careerPath.length >= 3).length;
  console.log(`  Kariyer yolu (≥3 kulüp): ${withPath} oyuncu`);
}

try {
  main();
} catch (err) {
  console.error('Hata:', err.message);
  process.exit(1);
}
