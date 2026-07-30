require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const API_KEY = process.env.GOOGLE_PLACES_KEY;
const BASE_URL = 'https://maps.googleapis.com/maps/api';

// UW-Madison center coordinates
const MADISON_LAT = 43.0731;
const MADISON_LNG = -89.4012;
const RADIUS = 16000; // ~10 miles in meters

async function searchGyms() {
  console.log('Fetching gyms near Madison...');
  const results = [];
  let nextPageToken = null;

  do {
    const params = {
      location: `${MADISON_LAT},${MADISON_LNG}`,
      radius: RADIUS,
      type: 'gym',
      key: API_KEY,
      ...(nextPageToken && { pagetoken: nextPageToken })
    };

    const response = await axios.get(`${BASE_URL}/place/nearbysearch/json`, { params });
    const data = response.data;

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      console.error('Places API error:', data.status, data.error_message);
      break;
    }

    results.push(...data.results);
    nextPageToken = data.next_page_token || null;

    if (nextPageToken) {
      console.log(`Got ${data.results.length} results, waiting for next page...`);
      await new Promise(res => setTimeout(res, 2000)); // Google requires this delay
    }

  } while (nextPageToken);

  console.log(`Found ${results.length} total gyms`);
  return results;
}

async function getGymDetails(placeId) {
  const params = {
    place_id: placeId,
    fields: [
      'name',
      'place_id',
      'formatted_address',
      'geometry',
      'website',
      'formatted_phone_number',
      'opening_hours',
      'rating',
      'user_ratings_total',
      'business_status'
    ].join(','),
    key: API_KEY
  };

  const response = await axios.get(`${BASE_URL}/place/details/json`, { params });
  return response.data.result;
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Merge a block into a day, keeping the widest window if that day already has one.
// "HH:MM" sorts lexicographically the same way it sorts chronologically.
function widenDay(formatted, dayName, open, close) {
  const current = formatted[dayName];
  if (!current) {
    formatted[dayName] = { open, close };
    return;
  }
  formatted[dayName] = {
    open:  open  < current.open  ? open  : current.open,
    close: close > current.close ? close : current.close,
  };
}

function formatHours(openingHours) {
  if (!openingHours?.periods) return null;

  const periods = openingHours.periods;
  const formatted = {};
  const hhmm = t => `${t.slice(0, 2)}:${t.slice(2)}`;

  // Places represents "always open" as a single period with an open time of 0000 and
  // no close. Keyed naively that produced a lone sunday entry and six missing days.
  if (periods.length === 1 && !periods[0].close) {
    for (const day of DAYS) formatted[day] = { open: '00:00', close: '23:59' };
    return formatted;
  }

  for (const period of periods) {
    if (!period.open) continue;

    const startDay = period.open.day;
    const openTime = hhmm(period.open.time);

    if (!period.close) {
      widenDay(formatted, DAYS[startDay], openTime, '23:59');
      continue;
    }

    const endDay    = period.close.day;
    const closeTime = hhmm(period.close.time);

    if (endDay === startDay && closeTime > openTime) {
      widenDay(formatted, DAYS[startDay], openTime, closeTime);
      continue;
    }

    // The block runs past midnight, so it covers several calendar days: the first day
    // runs to midnight, any whole day in between is open around the clock, and the last
    // day runs from midnight to the close time. Previously only the start day survived.
    widenDay(formatted, DAYS[startDay], openTime, '23:59');

    for (let d = (startDay + 1) % 7; d !== endDay; d = (d + 1) % 7) {
      widenDay(formatted, DAYS[d], '00:00', '23:59');
    }

    if (closeTime !== '00:00') {
      widenDay(formatted, DAYS[endDay], '00:00', closeTime);
    }
  }

  return Object.keys(formatted).length > 0 ? formatted : null;
}

function buildGymObject(details) {
  return {
    name: details.name,
    placeId: details.place_id,
    address: details.formatted_address,
    phone: details.formatted_phone_number || null,
    website: details.website || null,
    coordinates: {
      lat: details.geometry.location.lat,
      lng: details.geometry.location.lng
    },
    rating: details.rating || null,
    totalRatings: details.user_ratings_total || 0,
    businessStatus: details.business_status,
    hours: formatHours(details.opening_hours),
    hoursText: details.opening_hours?.weekday_text || null,
    // ── Fill these in manually by looking up each gym's website ──
    amenities: [],   // e.g. ["pool", "sauna", "parking", "showers", "locker rooms"]
    classes: [],     // e.g. ["yoga", "spin", "zumba", "pilates", "HIIT"]
    equipment: [],   // e.g. ["free weights", "cables", "treadmills", "squat racks"]
    monthlyPrice: null  // e.g. 25  (just the number, in dollars)
  };
}

async function main() {
  if (!API_KEY) {
    console.error('❌ GOOGLE_PLACES_KEY not found in .env');
    process.exit(1);
  }

  try {
    const gyms = await searchGyms();
    const activeGyms = gyms.filter(g => g.business_status === 'OPERATIONAL');
    console.log(`\nFetching details for ${activeGyms.length} active gyms...`);

    const enrichedGyms = [];

    for (let i = 0; i < activeGyms.length; i++) {
      const gym = activeGyms[i];
      console.log(`[${i + 1}/${activeGyms.length}] ${gym.name}`);

      try {
        const details = await getGymDetails(gym.place_id);
        enrichedGyms.push(buildGymObject(details));
      } catch (err) {
        console.warn(`  ⚠️  Skipping ${gym.name}: ${err.message}`);
      }

      await new Promise(res => setTimeout(res, 300));
    }

    const outputPath = path.join(__dirname, '..', 'gyms.json');
    fs.writeFileSync(outputPath, JSON.stringify(enrichedGyms, null, 2));

    console.log(`\n✅ Saved ${enrichedGyms.length} gyms to gyms.json`);
    console.log(`\n👉 Next steps:`);
    console.log(`   1. Open gyms.json`);
    console.log(`   2. Fill in amenities, classes, equipment, and monthlyPrice for each gym`);
    console.log(`   3. Use each gym's website or a quick Google search to find this info`);
    console.log(`   4. Then run: node server.js`);

  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

main();