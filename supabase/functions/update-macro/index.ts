import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations'

const CURRENCIES: Record<string, {
  name: string
  centralBank: string
  target: number
  coreSeries: string | null
  coreUnits: string | null
  unempSeries: string | null
}> = {
  USD: { name: 'USD', centralBank: 'Federal Reserve',    target: 2.0, coreSeries: 'CPILFESL',            coreUnits: 'pc1',  unempSeries: 'UNRATE'           },
  EUR: { name: 'EUR', centralBank: 'ECB',                target: 2.0, coreSeries: 'CP0000EZ19M086NEST',  coreUnits: 'pc1',  unempSeries: 'LRHUTTTTEZM156S'  },
  GBP: { name: 'GBP', centralBank: 'Bank of England',   target: 2.0, coreSeries: 'CPALTT01GBM659N',     coreUnits: null,   unempSeries: 'LRHUTTTTGBM156S'  },
  JPY: { name: 'JPY', centralBank: 'Bank of Japan',     target: 2.0, coreSeries: null,                  coreUnits: null,   unempSeries: 'LRUNTTTTJPM156S'  },
  CAD: { name: 'CAD', centralBank: 'Bank of Canada',    target: 2.0, coreSeries: 'CPALTT01CAM659N',     coreUnits: null,   unempSeries: 'LRUNTTTTCAM156S'  },
  AUD: { name: 'AUD', centralBank: 'Reserve Bank of Australia', target: 2.5, coreSeries: 'AUSCPIALLQINMEI', coreUnits: 'pc1', unempSeries: 'LRHUTTTTAUM156S' },
  NZD: { name: 'NZD', centralBank: 'Reserve Bank of New Zealand', target: 2.0, coreSeries: 'NZLCPIALLQINMEI', coreUnits: 'pc1', unempSeries: 'LRHUTTTTNZQ156S' },
  CHF: { name: 'CHF', centralBank: 'Swiss National Bank', target: 1.0, coreSeries: 'CPALTT01CHM659N',   coreUnits: null,   unempSeries: null               },
  NOK: { name: 'NOK', centralBank: 'Norges Bank',       target: 2.0, coreSeries: 'CPALTT01NOM659N',     coreUnits: null,   unempSeries: 'LRHUTTTTNOM156S'  },
  SEK: { name: 'SEK', centralBank: 'Riksbank',          target: 2.0, coreSeries: 'CPALTT01SEM659N',     coreUnits: null,   unempSeries: 'LRHUTTTTSEM156S'  },
}

async function fetchFred(
  series: string,
  apiKey: string,
  units: string | null = null,
  limit = 3,
): Promise<number[]> {
  const params = new URLSearchParams({
    series_id: series,
    api_key: apiKey,
    file_type: 'json',
    sort_order: 'desc',
    limit: String(limit),
  })
  if (units) params.set('units', units)

  const res = await fetch(`${FRED_BASE}?${params}`)
  if (!res.ok) return []

  const data = await res.json()
  const obs: Array<{ value: string }> = data.observations ?? []
  return obs
    .map(o => parseFloat(o.value))
    .filter(v => !isNaN(v))
}

function classify(
  cpi: number | null,
  target: number,
  cpiPrev: number | null,
  unemp: number | null,
  unempPrev: number | null,
): {
  signal: 'overheating' | 'elevated' | 'easing' | 'deflationary'
  cpiTrend: 'rising' | 'falling' | 'flat'
  labourTrend: 'tightening' | 'softening' | 'flat'
} {
  const cpiTrend: 'rising' | 'falling' | 'flat' =
    cpi !== null && cpiPrev !== null
      ? cpi > cpiPrev + 0.1 ? 'rising' : cpi < cpiPrev - 0.1 ? 'falling' : 'flat'
      : 'flat'

  const labourTrend: 'tightening' | 'softening' | 'flat' =
    unemp !== null && unempPrev !== null
      ? unemp < unempPrev - 0.1 ? 'tightening' : unemp > unempPrev + 0.1 ? 'softening' : 'flat'
      : 'flat'

  let signal: 'overheating' | 'elevated' | 'easing' | 'deflationary' = 'easing'
  if (cpi !== null) {
    if (cpi > target + 1.5) signal = 'overheating'
    else if (cpi > target + 0.25) signal = 'elevated'
    else if (cpi < target - 0.5) signal = 'deflationary'
    else signal = 'easing'
  }

  return { signal, cpiTrend, labourTrend }
}

const SIGNAL_RANK: Record<string, number> = {
  overheating: 3, elevated: 2, easing: 1, deflationary: 0,
}

function derivePairs(readings: Array<{ currency: string; signal: string; snapshot_date: string }>) {
  const pairs: Array<{
    pair: string; base_currency: string; quote_currency: string
    base_signal: string; quote_signal: string; direction: string
    divergence_strength: string; snapshot_date: string; updated_at: string
  }> = []

  const currencies = Object.keys(CURRENCIES)
  const snapshotDate = readings[0]?.snapshot_date ?? new Date().toISOString().slice(0, 10)

  for (let i = 0; i < currencies.length; i++) {
    for (let j = i + 1; j < currencies.length; j++) {
      const a = readings.find(r => r.currency === currencies[i])
      const b = readings.find(r => r.currency === currencies[j])
      if (!a || !b) continue

      const rankA = SIGNAL_RANK[a.signal] ?? 1
      const rankB = SIGNAL_RANK[b.signal] ?? 1
      const diff = Math.abs(rankA - rankB)
      if (diff < 1) continue

      const [strong, weak] = rankA > rankB ? [a, b] : [b, a]
      const strength = diff >= 2 ? 'strong' : 'moderate'

      pairs.push({
        pair: `${strong.currency}/${weak.currency}`,
        base_currency: strong.currency,
        quote_currency: weak.currency,
        base_signal: strong.signal,
        quote_signal: weak.signal,
        direction: 'long',
        divergence_strength: strength,
        snapshot_date: snapshotDate,
        updated_at: new Date().toISOString(),
      })
    }
  }

  return pairs
}

Deno.serve(async (_req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }

  if (_req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const fredKey = Deno.env.get('FRED_API_KEY')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!fredKey || !supabaseUrl || !supabaseKey) {
      throw new Error('Missing required environment variables')
    }

    const supabase = createClient(supabaseUrl, supabaseKey)
    const snapshotDate = new Date().toISOString().slice(0, 10)

    // Fetch all FRED series in parallel
    const results = await Promise.all(
      Object.entries(CURRENCIES).map(async ([currency, cfg]) => {
        const [cpiVals, unempVals] = await Promise.all([
          cfg.coreSeries ? fetchFred(cfg.coreSeries, fredKey, cfg.coreUnits) : Promise.resolve([]),
          cfg.unempSeries ? fetchFred(cfg.unempSeries, fredKey) : Promise.resolve([]),
        ])

        const cpi = cpiVals[0] ?? null
        const cpiPrev = cpiVals[1] ?? null
        const unemp = unempVals[0] ?? null
        const unempPrev = unempVals[1] ?? null

        const { signal, cpiTrend, labourTrend } = classify(cpi, cfg.target, cpiPrev, unemp, unempPrev)

        return {
          currency,
          central_bank: cfg.centralBank,
          cb_target: cfg.target,
          core_cpi: cpi,
          core_cpi_prev: cpiPrev,
          headline_cpi: null,
          unemployment: unemp,
          unemployment_prev: unempPrev,
          signal,
          cpi_trend: cpiTrend,
          labour_trend: labourTrend,
          context: null,
          snapshot_date: snapshotDate,
          updated_at: new Date().toISOString(),
        }
      })
    )

    // Upsert readings
    const { error: readingsError } = await supabase
      .from('macro_readings')
      .upsert(results, { onConflict: 'currency,snapshot_date' })

    if (readingsError) throw new Error(`Readings upsert failed: ${readingsError.message}`)

    // Derive and upsert pairs
    const pairs = derivePairs(results)

    if (pairs.length > 0) {
      const { error: pairsError } = await supabase
        .from('macro_pairs')
        .upsert(pairs, { onConflict: 'pair,snapshot_date' })

      if (pairsError) throw new Error(`Pairs upsert failed: ${pairsError.message}`)
    }

    return new Response(
      JSON.stringify({ success: true, timestamp: new Date().toISOString(), currencies: results.length, pairs: pairs.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
