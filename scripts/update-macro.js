#!/usr/bin/env node
/**
 * scripts/update-macro.js — Daily G10 macro data fetch + Supabase upsert
 *
 * Required environment variables:
 *   SUPABASE_URL  — your Supabase project URL (e.g. https://xxxx.supabase.co)
 *   SUPABASE_KEY  — Supabase SERVICE ROLE key (not anon key — needs write access)
 *   FRED_API_KEY  — free key from https://fred.stlouisfed.org/docs/api/api_key.html
 *
 * Run:  node scripts/update-macro.js
 * Deps: none — uses Node 18+ built-in fetch
 */

// Load .env for local development (dotenv is a devDependency — skipped in CI)
try { await import('dotenv/config') } catch { /* env vars injected by runner in CI */ }

// ── Env validation ───────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_KEY
const FRED_API_KEY = process.env.FRED_API_KEY

if (!SUPABASE_URL || !SUPABASE_KEY || !FRED_API_KEY) {
  console.error('[ERROR] Missing required environment variables:')
  if (!SUPABASE_URL)  console.error('  SUPABASE_URL  — your Supabase project URL')
  if (!SUPABASE_KEY)  console.error('  SUPABASE_KEY  — Supabase service role key')
  if (!FRED_API_KEY)  console.error('  FRED_API_KEY  — free key from https://fred.stlouisfed.org/docs/api/api_key.html')
  process.exit(1)
}

// ── G10 configuration ────────────────────────────────────────────────────────

const G10_CONFIG = {
  USD: { name: 'US Dollar',        cb: 'Federal Reserve', target: 2.0 },
  EUR: { name: 'Euro',             cb: 'ECB',             target: 2.0 },
  GBP: { name: 'British Pound',    cb: 'Bank of England', target: 2.0 },
  JPY: { name: 'Japanese Yen',     cb: 'Bank of Japan',   target: 2.0 },
  CAD: { name: 'Canadian Dollar',  cb: 'Bank of Canada',  target: 2.0 },
  AUD: { name: 'Aus Dollar',       cb: 'RBA',             target: 2.5 },
  NZD: { name: 'NZ Dollar',        cb: 'RBNZ',            target: 2.0 },
  CHF: { name: 'Swiss Franc',      cb: 'SNB',             target: 1.0 },
  NOK: { name: 'Norwegian Krone',  cb: 'Norges Bank',     target: 2.0 },
  SEK: { name: 'Swedish Krona',    cb: 'Riksbank',        target: 2.0 },
}

// FRED series config — confirmed working as of 2026-05.
//
// CPI (all return or compute YoY %):
//   pc1 units = FRED computes percent change from year ago on an index series
//   null units = series already returns YoY % directly (659N = "growth rate same period year ago")
//   AUD/NZD = quarterly CPI index, pc1 gives quarterly YoY
//   JPY = no usable monthly series on FRED; CPI will be null, signal defaults to easing
//
// Unemployment: LRHUTTTT = OECD Harmonized. CHF has no harmonized monthly series on FRED.
const FRED_SERIES = {
  USD: { coreSeries: 'CPILFESL',           coreUnits: 'pc1',  unempSeries: 'UNRATE'          },
  EUR: { coreSeries: 'CP0000EZ19M086NEST', coreUnits: 'pc1',  unempSeries: 'LRHUTTTTEZM156S' },
  GBP: { coreSeries: 'CPALTT01GBM659N',   coreUnits: null,   unempSeries: 'LRHUTTTTGBM156S' },
  JPY: { coreSeries: null,                 coreUnits: null,   unempSeries: 'LRUNTTTTJPM156S' },
  CAD: { coreSeries: 'CPALTT01CAM659N',   coreUnits: null,   unempSeries: 'LRUNTTTTCAM156S' },
  AUD: { coreSeries: 'AUSCPIALLQINMEI',   coreUnits: 'pc1',  unempSeries: 'LRHUTTTTAUM156S' },
  NZD: { coreSeries: 'NZLCPIALLQINMEI',   coreUnits: 'pc1',  unempSeries: 'LRHUTTTTNZQ156S' },
  CHF: { coreSeries: 'CPALTT01CHM659N',   coreUnits: null,   unempSeries: null              },
  NOK: { coreSeries: 'CPALTT01NOM659N',   coreUnits: null,   unempSeries: 'LRHUTTTTNOM156S' },
  SEK: { coreSeries: 'CPALTT01SEM659N',   coreUnits: null,   unempSeries: 'LRHUTTTTSEM156S' },
}

const G10_PAIRS = [
  'USD/EUR', 'USD/GBP', 'USD/JPY', 'USD/CAD', 'USD/AUD', 'USD/NZD', 'USD/CHF', 'USD/NOK', 'USD/SEK',
  'EUR/GBP', 'EUR/JPY', 'EUR/CAD', 'EUR/AUD', 'EUR/NZD', 'EUR/CHF', 'EUR/NOK', 'EUR/SEK',
  'GBP/JPY', 'GBP/CAD', 'GBP/AUD', 'GBP/NZD', 'GBP/CHF', 'GBP/NOK', 'GBP/SEK',
  'AUD/JPY', 'AUD/CAD', 'AUD/NZD', 'AUD/CHF', 'AUD/NOK', 'AUD/SEK',
  'NZD/JPY', 'NZD/CAD', 'NZD/CHF', 'NZD/NOK', 'NZD/SEK',
  'NOK/JPY', 'NOK/CAD', 'NOK/CHF', 'NOK/SEK',
  'CAD/JPY', 'CAD/CHF', 'CAD/SEK',
  'SEK/JPY', 'SEK/CHF',
]

// ── FRED API ─────────────────────────────────────────────────────────────────

async function fetchFredSeries(seriesId, units = null, limit = 3) {
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: FRED_API_KEY,
    file_type: 'json',
    sort_order: 'desc',
    limit: String(limit),
  })
  if (units) params.set('units', units)

  const url = `https://api.stlouisfed.org/fred/series/observations?${params}`

  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
    const json = await res.json()

    const obs = (json.observations ?? [])
      .filter(o => o.value !== '.' && o.value !== null && o.value !== undefined)
      .map(o => ({ date: o.date, value: parseFloat(o.value) }))
      .filter(o => !isNaN(o.value))

    if (obs.length === 0) {
      console.warn(`  [WARN] No valid observations for FRED series ${seriesId}`)
    }

    return obs
  } catch (err) {
    console.warn(`  [WARN] Failed to fetch FRED series ${seriesId}: ${err.message}`)
    return []
  }
}

// For CPALTT01*M657N: series is an index (not a rate). Fetch 14 months and compute
// YoY manually: (latest / value_12_months_ago - 1) * 100.
// Returns [{date, value}] newest-first, same shape as fetchFredSeries.

// ── Classification helpers ───────────────────────────────────────────────────

function calcCpiTrend(latest, prev) {
  if (latest === null || prev === null) return 'flat'
  const diff = latest - prev
  if (diff >= 0.2)  return 'rising'
  if (diff <= -0.2) return 'falling'
  return 'flat'
}

function calcLabourTrend(latest, prev) {
  if (latest === null || prev === null) return 'flat'
  const diff = latest - prev
  if (diff <= -0.2) return 'tightening' // unemployment fell
  if (diff >= 0.2)  return 'softening'  // unemployment rose
  return 'flat'
}

function classifySignal(coreCpi, target, cpiTrend, labourTrend) {
  if (coreCpi === null) return 'easing'

  if (coreCpi < target - 0.5) return 'deflationary'

  if (coreCpi > target + 0.5 && cpiTrend === 'rising' && labourTrend !== 'softening') {
    return 'overheating'
  }

  if (coreCpi > target + 0.3) return 'elevated'

  if (Math.abs(coreCpi - target) <= 0.5 && (cpiTrend === 'falling' || labourTrend === 'softening')) {
    return 'easing'
  }

  return 'easing'
}

function buildContext(currency, coreCpi, cpiDate, unemp, unempDate, signal) {
  const parts = []
  if (coreCpi !== null && cpiDate) {
    parts.push(`Core CPI: ${coreCpi.toFixed(1)}% YoY (obs: ${cpiDate})`)
  }
  if (unemp !== null && unempDate) {
    parts.push(`Unemployment: ${unemp.toFixed(1)}% (obs: ${unempDate})`)
  }
  parts.push(`Signal: ${signal}`)
  return parts.join('. ')
}

// ── Divergence pair generation ───────────────────────────────────────────────

function generatePairs(readings, today) {
  const signalMap = Object.fromEntries(readings.map(r => [r.currency, r.signal]))
  const pairs = []

  for (const pairStr of G10_PAIRS) {
    const [base, quote] = pairStr.split('/')
    const baseSignal  = signalMap[base]
    const quoteSignal = signalMap[quote]

    if (!baseSignal || !quoteSignal) continue

    const baseOverheating = baseSignal === 'overheating'
    const quoteEasing     = quoteSignal === 'easing' || quoteSignal === 'deflationary'

    if (baseOverheating && quoteEasing) {
      pairs.push({
        pair:                pairStr,
        base_currency:       base,
        quote_currency:      quote,
        base_signal:         baseSignal,
        quote_signal:        quoteSignal,
        direction:           'long',
        divergence_strength: quoteSignal === 'deflationary' ? 'strong' : 'moderate',
        snapshot_date:       today,
        updated_at:          new Date().toISOString(),
      })
    }
  }

  return pairs
}

// ── Supabase REST upsert ─────────────────────────────────────────────────────

async function supabaseUpsert(table, rows) {
  if (rows.length === 0) {
    console.log(`  [INFO] No rows to upsert for ${table}`)
    return
  }

  const conflictCols = table === 'macro_readings' ? 'currency,snapshot_date' : 'pair,snapshot_date'
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${conflictCols}`, {
    method: 'POST',
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Supabase upsert to '${table}' failed (${res.status}): ${text}`)
  }

  console.log(`  [OK] Upserted ${rows.length} row(s) into ${table}`)
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const today = new Date().toISOString().split('T')[0]
  console.log(`\n╔══ G10 Macro Update — ${today} ══╗\n`)

  const readings = []

  for (const [currency, config] of Object.entries(G10_CONFIG)) {
    const series = FRED_SERIES[currency]
    console.log(`▸ ${currency} (${config.cb}, target ${config.target}%)`)

    // Core CPI — all series return YoY % directly or via pc1 transformation
    const coreObs = series.coreSeries
      ? await fetchFredSeries(series.coreSeries, series.coreUnits)
      : []

    // Unemployment
    const unempObs = series.unempSeries
      ? await fetchFredSeries(series.unempSeries)
      : []

    // Latest + 3-month-ago values (obs[0]=latest, obs[2]=oldest of the 3)
    const coreCpi      = coreObs[0]?.value   ?? null
    const coreCpiPrev  = coreObs[2]?.value   ?? coreObs[1]?.value ?? null
    const cpiDate      = coreObs[0]?.date    ?? null

    const headlineCpi = coreCpi

    const unemp        = unempObs[0]?.value  ?? null
    const unempPrev    = unempObs[2]?.value  ?? unempObs[1]?.value ?? null
    const unempDate    = unempObs[0]?.date   ?? null

    const cpiTrend    = calcCpiTrend(coreCpi, coreCpiPrev)
    const labourTrend = calcLabourTrend(unemp, unempPrev)
    const signal      = classifySignal(coreCpi, config.target, cpiTrend, labourTrend)
    const context     = buildContext(currency, coreCpi, cpiDate, unemp, unempDate, signal)

    console.log(`  Core CPI:    ${coreCpi !== null ? coreCpi.toFixed(2) + '%' : 'N/A'} (${cpiDate ?? 'no date'})`)
    console.log(`  CPI trend:   ${cpiTrend}   Labour trend: ${labourTrend}`)
    console.log(`  Signal:      ${signal}\n`)

    readings.push({
      currency,
      central_bank:      config.cb,
      cb_target:         config.target,
      core_cpi:          coreCpi,
      core_cpi_prev:     coreCpiPrev,
      headline_cpi:      headlineCpi,
      unemployment:      unemp,
      unemployment_prev: unempPrev,
      signal,
      cpi_trend:         cpiTrend,
      labour_trend:      labourTrend,
      context,
      snapshot_date:     today,
      updated_at:        new Date().toISOString(),
    })
  }

  const pairs = generatePairs(readings, today)
  console.log(`▸ Generated ${pairs.length} divergence pair(s):`)
  if (pairs.length > 0) {
    pairs.forEach(p =>
      console.log(`  ${p.pair}  ${p.base_signal.toUpperCase()} vs ${p.quote_signal.toUpperCase()} → ${p.divergence_strength.toUpperCase()}`)
    )
  } else {
    console.log('  (none — no overheating/easing divergence today)')
  }

  console.log('\n▸ Upserting to Supabase...')
  await supabaseUpsert('macro_readings', readings)
  await supabaseUpsert('macro_pairs', pairs)

  console.log('\n╚══ Macro update complete ══╝\n')
}

main().catch(err => {
  console.error('\n[FATAL]', err.message)
  process.exit(1)
})
