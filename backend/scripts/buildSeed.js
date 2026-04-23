// scripts/buildSeed.js
// İndirmeyi sistem curl'ü ile yapar (Node.js v24 SSL sorunundan kaçınmak için).
// curl macOS ve Linux'ta yerleşik, Windows 10+ da yerleşik.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const RAW = path.join(__dirname, '..', 'raw');
const OUT = path.join(__dirname, '..', 'seed.json');
const ZIP_URL = 'https://pub-e682421888d945d684bcae8890b0ec20.r2.dev/data/transfermarkt-datasets.zip';
const ZIP_PATH = path.join(RAW, 'dataset.zip');

// ── CSV'leri hazırla ──
function ensureCSVs() {
  if (!fs.existsSync(RAW)) fs.mkdirSync(RAW, { recursive: true });

  const needed = ['players.csv', 'clubs.csv', 'player_valuations.csv', 'transfers.csv'];
  const allExist = needed.every(f => fs.existsSync(path.join(RAW, f)));
  if (allExist) {
    console.log('CSV dosyaları zaten var, indirme atlanıyor.');
    return;
  }

  console.log('Dataset ZIP indiriliyor (~60 MB)...');
  // curl -L: redirect'leri takip et, -o: çıktı dosyası, --progress-bar: ilerleme göster
  execSync(`curl -L --progress-bar -o "${ZIP_PATH}" "${ZIP_URL}"`, { stdio: 'inherit' });

  const size = fs.statSync(ZIP_PATH).size;
  if (size < 1_000_000) {
    throw new Error(`İndirilen dosya çok küçük (${size} byte), bozuk olmalı`);
  }
  console.log(`✓ İndirme tamamlandı (${(size / 1024 / 1024).toFixed(1)} MB)`);

  console.log('ZIP açılıyor...');
  execSync(`unzip -o -j "${ZIP_PATH}" "*.csv" -d "${RAW}"`, { stdio: 'inherit' });
  fs.unlinkSync(ZIP_PATH);
  console.log('✓ CSV dosyaları hazır');
}

// ── CSV parser ──
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

// ── Ana iş ──
function main() {
  ensureCSVs();

  console.log('CSV dosyaları okunuyor...');
  const players = readCSV('players.csv');
  const clubs = readCSV('clubs.csv');
  const valuations = readCSV('player_valuations.csv');
  const transfers = readCSV('transfers.csv');

  console.log(`  ${players.length} oyuncu, ${clubs.length} kulüp`);

  const clubMap = new Map();
  clubs.forEach(c => clubMap.set(c.club_id, c.name));

  const latestValue = new Map();
  valuations.forEach(v => {
    const existing = latestValue.get(v.player_id);
    if (!existing || v.date > existing.date) {
      latestValue.set(v.player_id, { value: parseInt(v.market_value_in_eur) || 0, date: v.date });
    }
  });

  const latestTransfer = new Map();
  transfers.forEach(t => {
    const existing = latestTransfer.get(t.player_id);
    if (!existing || t.transfer_date > existing.transfer_date) {
      latestTransfer.set(t.player_id, {
        from: clubMap.get(t.from_club_id),
        to: clubMap.get(t.to_club_id),
        date: t.transfer_date,
        fee: parseInt(t.transfer_fee) || 0,
      });
    }
  });

  const MIN_VALUE = 10_000_000;
  const enriched = players
    .map(p => {
      const mv = latestValue.get(p.player_id);
      if (!mv || mv.value < MIN_VALUE) return null;
      return {
        id: p.player_id,
        name: p.name,
        club: clubMap.get(p.current_club_id) || 'Unknown',
        position: p.position || p.sub_position || 'Unknown',
        nationality: p.country_of_citizenship,
        marketValue: mv.value,
        lastTransfer: latestTransfer.get(p.player_id) || null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.marketValue - a.marketValue)
    .slice(0, 500);

  fs.writeFileSync(OUT, JSON.stringify({
    players: enriched,
    generatedAt: new Date().toISOString(),
    count: enriched.length,
  }, null, 2));

  console.log(`✓ seed.json: ${enriched.length} oyuncu (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
  console.log(`  En pahalı: ${enriched[0].name} — €${(enriched[0].marketValue/1e6).toFixed(0)}M`);
}

try {
  main();
} catch (err) {
  console.error('Hata:', err.message);
  process.exit(1);
}
