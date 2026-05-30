import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import type { MacroReading, MacroPair } from '@/types'

const readings  = ref<MacroReading[]>([])
const pairs     = ref<MacroPair[]>([])
const loading   = ref(false)
const updating  = ref(false)
const error     = ref<string | null>(null)

// Tracks which currencies had a value change on last refresh
// e.g. { USD: { core_cpi: { from: 2.5, to: 2.8 }, signal: { from: 'elevated', to: 'overheating' } } }
const changes = ref<Record<string, Record<string, { from: unknown; to: unknown }>>>({})

const TRACKED = ['core_cpi', 'unemployment', 'signal', 'cpi_trend', 'labour_trend'] as const

function diffReadings(prev: MacroReading[], next: MacroReading[]) {
  const result: Record<string, Record<string, { from: unknown; to: unknown }>> = {}

  for (const nextRow of next) {
    const prevRow = prev.find(r => r.currency === nextRow.currency)
    if (!prevRow) continue

    const fieldChanges: Record<string, { from: unknown; to: unknown }> = {}
    for (const field of TRACKED) {
      const from = prevRow[field]
      const to   = nextRow[field]
      if (from !== to) fieldChanges[field] = { from, to }
    }

    if (Object.keys(fieldChanges).length > 0) {
      result[nextRow.currency] = fieldChanges
    }
  }

  return result
}

export function useMacro() {
  const lastUpdated = computed<string | null>(() => {
    if (readings.value.length === 0) return null
    return readings.value[0].snapshot_date
  })

  async function triggerUpdate(): Promise<void> {
    updating.value = true
    error.value    = null
    try {
      console.log('[macro] triggering edge function update…')
      const { error: fnError } = await supabase.functions.invoke('update-macro')
      if (fnError) throw fnError
      console.log('[macro] edge function complete, fetching fresh data…')
      await fetchMacro()
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : String(e)
      console.error('Failed to trigger macro update:', e)
    } finally {
      updating.value = false
    }
  }

  async function fetchMacro(): Promise<void> {
    loading.value = true
    error.value   = null
    try {
      const { data: latest, error: latestErr } = await supabase
        .from('macro_readings')
        .select('snapshot_date')
        .order('snapshot_date', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (latestErr) throw latestErr

      if (!latest) {
        readings.value = []
        pairs.value    = []
        return
      }

      const date = latest.snapshot_date

      const [readingsResult, pairsResult] = await Promise.all([
        supabase
          .from('macro_readings')
          .select('*')
          .eq('snapshot_date', date)
          .order('currency'),
        supabase
          .from('macro_pairs')
          .select('*')
          .eq('snapshot_date', date)
          .order('divergence_strength', { ascending: false })
          .order('pair'),
      ])

      if (readingsResult.error) throw readingsResult.error
      if (pairsResult.error)   throw pairsResult.error

      const newReadings = readingsResult.data ?? []
      const diff = diffReadings(readings.value, newReadings)

      if (Object.keys(diff).length > 0) {
        console.group('[macro] data changed')
        for (const [currency, fields] of Object.entries(diff)) {
          for (const [field, { from, to }] of Object.entries(fields)) {
            console.log(`  ${currency} ${field}: ${from} → ${to}`)
          }
        }
        console.groupEnd()
      } else {
        console.log('[macro] data loaded — no changes from previous snapshot')
      }

      changes.value  = diff
      readings.value = newReadings
      pairs.value    = pairsResult.data ?? []

      console.log(`[macro] snapshot: ${date}, ${readings.value.length} readings, ${pairs.value.length} pairs`)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      error.value = msg
      console.error('Failed to fetch macro data:', e)
    } finally {
      loading.value = false
    }
  }

  return {
    readings,
    pairs,
    loading,
    updating,
    error,
    changes,
    lastUpdated,
    fetchMacro,
    triggerUpdate,
  }
}
