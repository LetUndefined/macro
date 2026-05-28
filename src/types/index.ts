export interface MacroReading {
  id: string
  currency: string
  central_bank: string
  cb_target: number
  core_cpi: number | null
  core_cpi_prev: number | null
  headline_cpi: number | null
  unemployment: number | null
  unemployment_prev: number | null
  signal: 'overheating' | 'elevated' | 'easing' | 'deflationary'
  cpi_trend: 'rising' | 'falling' | 'flat'
  labour_trend: 'tightening' | 'softening' | 'flat'
  context: string | null
  snapshot_date: string
  updated_at: string
}

export interface MacroPair {
  id: string
  pair: string
  base_currency: string
  quote_currency: string
  base_signal: string
  quote_signal: string
  direction: 'long' | 'short'
  divergence_strength: 'strong' | 'moderate'
  snapshot_date: string
  updated_at: string
}
