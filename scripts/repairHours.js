// scripts/repairHours.js
//
// One-off repair for gyms.json entries written by the old buggy formatHours() in
// fetchGyms.js, which keyed each Places period by its opening day only. A 24/7 gym
// therefore ended up with a single `sunday` entry and six missing days, and any block
// running past midnight lost every day but the first.
//
// This rebuilds the `hours` object from `hoursText` (the human-readable weekday_text
// Google already gave us and which was stored correctly). It makes no API calls and
// touches no other field, so the hand-curated amenities/equipment/classes/monthlyPrice
// values are safe. Re-running it is harmless.
//
//   node scripts/repairHours.js            # rewrite gyms.json
//   node scripts/repairHours.js --dry-run  # report what would change, write nothing

const fs = require('fs');
const path = require('path');

const GYMS_PATH = path.join(__dirname, '..', 'gyms.json');
const DRY_RUN = process.argv.includes('--dry-run');

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Google pads weekday_text with narrow/thin no-break spaces and en dashes.
function normalize(text) {
  return text
    .replace(/[   ]/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function toMinutes(hour, minute, meridiem) {
  let h = hour % 12;
  if (meridiem === 'PM') h += 12;
  return h * 60 + minute;
}

function pad(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const TIME = /^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i;

// Parses one block, e.g. "10:00 AM - 8:00 PM" or "5:30 - 8:00 PM" (shared meridiem,
// which Google emits when both ends fall in the same half of the day).
function parseBlock(block) {
  const [rawStart, rawEnd] = block.split('-').map(s => s.trim());
  if (!rawStart || !rawEnd) return null;

  const start = TIME.exec(rawStart);
  const end   = TIME.exec(rawEnd);
  if (!start || !end) return null;

  const endMeridiem = (end[3] || '').toUpperCase();
  if (!endMeridiem) return null;

  // A start with no meridiem of its own inherits the end's.
  const startMeridiem = (start[3] || endMeridiem).toUpperCase();

  const openMin  = toMinutes(Number(start[1]), Number(start[2] || 0), startMeridiem);
  const closeMin = toMinutes(Number(end[1]),   Number(end[2]   || 0), endMeridiem);

  return { openMin, closeMin };
}

function parseDayBody(body) {
  const text = normalize(body);

  if (/^closed$/i.test(text)) return null;
  if (/open 24 hours/i.test(text)) return { open: '00:00', close: '23:59' };

  // Studios list several class windows per day ("6:30 - 7:30 AM, 5:00 - 8:00 PM").
  // A day holds one {open, close} pair, so keep the outer envelope.
  let earliest = null;
  let latest = null;

  for (const block of text.split(',')) {
    const parsed = parseBlock(block);
    if (!parsed) continue;

    const { openMin } = parsed;
    // A midnight close means "through the end of the day" in this model.
    const closeMin = parsed.closeMin <= openMin ? 24 * 60 - 1 : parsed.closeMin;

    if (earliest === null || openMin  < earliest) earliest = openMin;
    if (latest   === null || closeMin > latest)   latest   = closeMin;
  }

  if (earliest === null) return null;
  return { open: pad(earliest), close: pad(latest) };
}

function hoursFromText(hoursText) {
  if (!Array.isArray(hoursText) || hoursText.length === 0) return null;

  const formatted = {};
  for (const line of hoursText) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;

    const dayName = normalize(line.slice(0, colon)).toLowerCase();
    if (!DAYS.includes(dayName)) continue;

    const parsed = parseDayBody(line.slice(colon + 1));
    if (parsed) formatted[dayName] = parsed;
  }

  return Object.keys(formatted).length > 0 ? formatted : null;
}

function main() {
  const gyms = JSON.parse(fs.readFileSync(GYMS_PATH, 'utf8'));

  let changed = 0;
  let skipped = 0;

  for (const gym of gyms) {
    if (!gym.hoursText) {
      skipped++;
      continue;
    }

    const rebuilt = hoursFromText(gym.hoursText);
    if (!rebuilt) {
      console.warn(`  ⚠️  Could not parse hours for ${gym.name}, leaving as-is`);
      skipped++;
      continue;
    }

    const before = JSON.stringify(gym.hours);
    const after  = JSON.stringify(rebuilt);
    if (before === after) continue;

    const beforeDays = gym.hours ? Object.keys(gym.hours).length : 0;
    console.log(`  ${gym.name}: ${beforeDays} day(s) → ${Object.keys(rebuilt).length} day(s)`);
    gym.hours = rebuilt;
    changed++;
  }

  console.log(`\n${changed} gym(s) repaired, ${skipped} skipped (no usable hoursText).`);

  if (DRY_RUN) {
    console.log('Dry run — gyms.json not written.');
    return;
  }

  fs.writeFileSync(GYMS_PATH, JSON.stringify(gyms, null, 2));
  console.log(`✅ Wrote ${GYMS_PATH}`);
  console.log('Restart the server to pick up the new data: node server.js');
}

main();
