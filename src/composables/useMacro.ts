import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import type { MacroReading, MacroPair } from '@/types'

const readings  = ref<MacroReading[]>([])
const pairs     = ref<MacroPair[]>([])
const loading   = ref(false)
const updating  = ref(false)
const error     = ref<string | null>(null)

export function useMacro() {
  const lastUpdated = computed<string | null>(() => {
    if (readings.value.length === 0) return null
    return readings.value[0].snapshot_date
  })

  async function triggerUpdate(): Promise<void> {
    updating.value = true
    error.value    = null
    try {
      const { error: fnError } = await supabase.functions.invoke('update-macro')
      if (fnError) throw fnError
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
      // Find the most recent snapshot date
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

      readings.value = readingsResult.data ?? []
      pairs.value    = pairsResult.data    ?? []
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
    lastUpdated,
    fetchMacro,
    triggerUpdate,
  }
}
