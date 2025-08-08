// backend/cronDailyOutfits.js
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SERVICE_ROLE_KEY
);

// --- Helper: fetch real weather ---
async function fetchWeather(lat, lon) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Weather API error: ${res.status}`);
    const data = await res.json();

    // Map weather code to human text (optional)
    const weatherCodes = {
      0: 'Clear sky',
      1: 'Mainly clear',
      2: 'Partly cloudy',
      3: 'Overcast',
      45: 'Fog',
      48: 'Rime fog',
      51: 'Light drizzle',
      53: 'Drizzle',
      55: 'Dense drizzle',
      61: 'Slight rain',
      63: 'Rain',
      65: 'Heavy rain',
      71: 'Slight snow fall',
      73: 'Snow fall',
      75: 'Heavy snow fall',
    };

    return {
      temperature: data.current_weather.temperature,
      description: weatherCodes[data.current_weather.weathercode] || 'Unknown',
    };
  } catch (err) {
    console.error('⚠️ Failed to fetch weather:', err.message);
    return { temperature: 72, description: 'Unknown' }; // fallback
  }
}

// --- Helper: generate and save outfit for one user ---
async function generateOutfitForUser(user) {
  console.log(`\n👕 Generating outfit for user: ${user.id}`);

  // Get weather snapshot
  let weatherSnapshot = { temperature: 72, description: 'Unknown' };
  if (user.location_lat && user.location_lon) {
    weatherSnapshot = await fetchWeather(user.location_lat, user.location_lon);
  }

  // Get wardrobe
  const { data: wardrobe, error: wardrobeErr } = await supabase
    .from('wardrobe')
    .select('*')
    .eq('user_id', user.id);

  if (wardrobeErr) {
    console.error(`❌ Wardrobe fetch failed for user ${user.id}:`, wardrobeErr.message);
    return;
  }
  if (!wardrobe || wardrobe.length === 0) {
    console.log(`⚠️ No wardrobe for ${user.id}, skipping.`);
    return;
  }

  // Call your AI backend to generate outfit
  const aiRes = await fetch('https://closetmind-backend.onrender.com/generate-multistep-outfit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      context: 'Daily automated fit',
      vibe: user.style_tags?.[0] || '',
      season: 'all',
      temperature: weatherSnapshot.temperature,
      wardrobe,
    }),
  });

  if (!aiRes.ok) {
    console.error(`❌ AI generation failed for ${user.id}:`, await aiRes.text());
    return;
  }

  const { steps } = await aiRes.json();
  if (!steps) {
    console.error(`❌ No steps returned for ${user.id}`);
    return;
  }

  // Convert steps to array of {id, reason}
  const generated = Object.values(steps).map((step) => ({
    id: step.id,
    reason: step.reason,
  }));

  // Save to daily_outfits
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const { error: insertErr } = await supabase
    .from('daily_outfits')
    .upsert(
      {
        user_id: user.id,
        outfit_date: today,
        items: generated,
        context: { vibe: user.style_tags?.[0] || '' },
        weather: weatherSnapshot,
      },
      { onConflict: 'user_id,outfit_date' }
    );

  if (insertErr) {
    console.error(`❌ Failed to save outfit for ${user.id}:`, insertErr.message);
  } else {
    console.log(`✅ Saved outfit for ${user.id}`);
  }
}

// --- Main ---
async function runCron() {
  console.log('🚀 Starting daily outfits cron job...');

  // Get all users
  const { data: users, error: usersErr } = await supabase
    .from('profiles')
    .select('id, style_tags, location_lat, location_lon');

  if (usersErr) {
    console.error('❌ Failed to fetch users:', usersErr.message);
    return;
  }

  for (const user of users) {
    await generateOutfitForUser(user);
  }

  console.log('🎯 Daily outfits cron completed.');
}

// Run when executed directly
runCron().then(() => process.exit(0));
