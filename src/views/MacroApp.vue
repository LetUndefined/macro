<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useMacro } from '@/composables/useMacro'

const { readings, pairs, loading, updating, lastUpdated, fetchMacro, triggerUpdate } = useMacro()

// ── Countdown to next 06:00 UTC fetch ───────────────────────────────────────

const countdown = ref('')

function getNextFetch(): Date {
  const now = new Date()
  const next = new Date()
  next.setUTCHours(6, 0, 0, 0)
  if (now >= next) next.setUTCDate(next.getUTCDate() + 1)
  return next
}

function updateCountdown() {
  const diff = getNextFetch().getTime() - Date.now()
  const h = Math.floor(diff / 3_600_000)
  const m = Math.floor((diff % 3_600_000) / 60_000)
  const s = Math.floor((diff % 60_000) / 1_000)
  countdown.value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

let timer: ReturnType<typeof setInterval>

// ── Helpers ──────────────────────────────────────────────────────────────────

const FLAGS: Record<string, string> = {
  USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧', JPY: '🇯🇵',
  CAD: '🇨🇦', AUD: '🇦🇺', NZD: '🇳🇿', CHF: '🇨🇭',
  NOK: '🇳🇴', SEK: '🇸🇪',
}

const lastUpdatedFormatted = computed(() => {
  if (!lastUpdated.value) return null
  return new Date(lastUpdated.value + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  })
})

const sortedPairs = computed(() =>
  [...pairs.value].sort((a, b) =>
    a.divergence_strength === b.divergence_strength
      ? a.pair.localeCompare(b.pair)
      : a.divergence_strength === 'strong' ? -1 : 1
  )
)

function fmt(v: number | null) {
  return v === null ? '—' : v.toFixed(2) + '%'
}

function deviation(cpi: number | null, target: number) {
  if (cpi === null) return ''
  const d = cpi - target
  return (d >= 0 ? '+' : '') + d.toFixed(1) + 'pp'
}

function trendArrow(t: string) {
  return t === 'rising' ? '↑' : t === 'falling' ? '↓' : '→'
}

function labourArrow(t: string) {
  return t === 'tightening' ? '↓' : t === 'softening' ? '↑' : '→'
}

onMounted(() => {
  fetchMacro()
  updateCountdown()
  timer = setInterval(updateCountdown, 1000)
})

onUnmounted(() => clearInterval(timer))
</script>

<template>
  <div class="page">

    <!-- Header -->
    <header class="header">
      <div class="header-left">
        <h1 class="title">G10 Macro Scorecard</h1>
        <p v-if="lastUpdatedFormatted" class="subtitle">Snapshot: {{ lastUpdatedFormatted }}</p>
        <p v-else-if="!loading" class="subtitle muted">No data — run <code>node scripts/update-macro.js</code></p>
      </div>
      <div class="header-right">
        <div class="countdown-block">
          <span class="countdown-label">Next fetch in</span>
          <span class="countdown">{{ countdown }}</span>
        </div>
        <button class="refresh-btn" :disabled="loading || updating" @click="triggerUpdate">
          {{ updating ? 'Fetching…' : loading ? 'Loading…' : 'Refresh' }}
        </button>
      </div>
    </header>

    <div v-if="loading && readings.length === 0" class="loading">Loading…</div>

    <template v-else-if="readings.length > 0">

      <!-- Macro readings -->
      <section class="section">
        <h2 class="section-title">Macro Readings</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Currency</th>
                <th>Central Bank</th>
                <th>Target</th>
                <th>Core CPI</th>
                <th>vs Target</th>
                <th>Trend</th>
                <th>Unemployment</th>
                <th>Labour</th>
                <th>Signal</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in readings" :key="r.currency" :class="'row-' + r.signal">
                <td class="td-currency">
                  <span class="flag">{{ FLAGS[r.currency] }}</span>
                  <span class="currency-code">{{ r.currency }}</span>
                </td>
                <td class="td-cb">{{ r.central_bank }}</td>
                <td class="td-num">{{ r.cb_target.toFixed(1) }}%</td>
                <td class="td-num cpi-val" :class="'cpi-' + r.signal">{{ fmt(r.core_cpi) }}</td>
                <td class="td-num dev" :class="'dev-' + r.signal">{{ deviation(r.core_cpi, r.cb_target) }}</td>
                <td class="td-trend">
                  <span :class="'trend-' + r.cpi_trend">{{ trendArrow(r.cpi_trend) }}</span>
                </td>
                <td class="td-num">{{ fmt(r.unemployment) }}</td>
                <td class="td-trend">
                  <span :class="'labour-' + r.labour_trend">{{ labourArrow(r.labour_trend) }}</span>
                </td>
                <td class="td-signal">
                  <span :class="'sig sig-' + r.signal">{{ r.signal }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Divergence pairs -->
      <section class="section">
        <h2 class="section-title">Divergence Pairs</h2>
        <p v-if="sortedPairs.length === 0" class="muted">No qualifying pairs today.</p>
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Pair</th>
                <th>Direction</th>
                <th>Base</th>
                <th>Quote</th>
                <th>Strength</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="p in sortedPairs"
                :key="p.pair"
                :class="{ 'pair-strong': p.divergence_strength === 'strong' }"
              >
                <td class="td-pair">{{ p.pair }}</td>
                <td :class="p.direction === 'long' ? 'td-long' : 'td-short'">
                  {{ p.direction === 'long' ? '↑ Long' : '↓ Short' }}
                </td>
                <td>
                  <span :class="'sig sig-' + p.base_signal">{{ p.base_currency }}: {{ p.base_signal }}</span>
                </td>
                <td>
                  <span :class="'sig sig-' + p.quote_signal">{{ p.quote_currency }}: {{ p.quote_signal }}</span>
                </td>
                <td :class="'strength-' + p.divergence_strength">{{ p.divergence_strength }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

    </template>

    <footer class="footer">
      Data: FRED (St. Louis Fed) · Updates daily at 06:00 UTC
    </footer>
  </div>
</template>

<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 14px;
  background: #f8f8f6;
  color: #1a1a1a;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
</style>

<style scoped>
.page {
  max-width: 1100px;
  margin: 0 auto;
  padding: 40px 24px 80px;
}

/* ── Header ── */
.header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 40px;
  padding-bottom: 24px;
  border-bottom: 1px solid #e0e0db;
}

.title {
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: #111;
}

.subtitle {
  margin-top: 4px;
  font-size: 13px;
  color: #777;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 20px;
  flex-shrink: 0;
}

.countdown-block {
  text-align: right;
}

.countdown-label {
  display: block;
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #999;
  margin-bottom: 2px;
}

.countdown {
  font-family: 'JetBrains Mono', monospace;
  font-size: 22px;
  font-weight: 500;
  color: #333;
  letter-spacing: 0.04em;
}

.refresh-btn {
  padding: 6px 14px;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 13px;
  color: #444;
  cursor: pointer;
  transition: border-color 0.15s;
}
.refresh-btn:hover:not(:disabled) { border-color: #999; color: #111; }
.refresh-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* ── Sections ── */
.section { margin-bottom: 48px; }

.section-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #999;
  margin-bottom: 12px;
}

/* ── Tables ── */
.table-wrap { overflow-x: auto; }

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

th {
  text-align: left;
  padding: 8px 12px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #aaa;
  border-bottom: 1px solid #e8e8e4;
  white-space: nowrap;
}

td {
  padding: 10px 12px;
  border-bottom: 1px solid #f0f0ec;
  vertical-align: middle;
}

tr:last-child td { border-bottom: none; }
tr:hover td { background: #fafaf8; }

/* ── Currency column ── */
.td-currency { white-space: nowrap; }
.flag { margin-right: 6px; font-size: 15px; }
.currency-code {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 500;
  font-size: 13px;
  color: #111;
}

.td-cb { color: #555; white-space: nowrap; }

.td-num {
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
  color: #333;
  white-space: nowrap;
}

/* ── CPI / deviation colours (muted, text-only) ── */
.cpi-overheating  { color: #b03030; font-weight: 500; }
.cpi-elevated     { color: #b05a00; font-weight: 500; }
.cpi-easing       { color: #1a7a4a; font-weight: 500; }
.cpi-deflationary { color: #1a5a8a; font-weight: 500; }

.dev { font-size: 11px; }
.dev-overheating  { color: #b03030; }
.dev-elevated     { color: #b05a00; }
.dev-easing       { color: #1a7a4a; }
.dev-deflationary { color: #1a5a8a; }

/* ── Trend arrows ── */
.td-trend {
  font-family: 'JetBrains Mono', monospace;
  font-size: 14px;
  text-align: center;
}
.trend-rising   { color: #b03030; }
.trend-falling  { color: #1a7a4a; }
.trend-flat     { color: #bbb; }
.labour-tightening { color: #1a7a4a; }
.labour-softening  { color: #b03030; }
.labour-flat       { color: #bbb; }

/* ── Signal ── */
.sig {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.04em;
}
.sig-overheating  { color: #b03030; }
.sig-elevated     { color: #b05a00; }
.sig-easing       { color: #1a7a4a; }
.sig-deflationary { color: #1a5a8a; }

/* ── Pairs table ── */
.td-pair {
  font-family: 'JetBrains Mono', monospace;
  font-size: 15px;
  font-weight: 500;
  color: #111;
}

.td-long {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  color: #1a7a4a;
}

.td-short {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  color: #b03030;
}

.pair-strong td { background: #fdfcf7; }
.pair-strong .td-pair { color: #111; }

.strength-strong   { font-weight: 600; color: #b05a00; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
.strength-moderate { color: #aaa; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }

/* ── Misc ── */
.loading { color: #999; padding: 40px 0; }
.muted   { color: #999; font-size: 13px; }
code { font-family: 'JetBrains Mono', monospace; font-size: 12px; }

.footer {
  font-size: 11px;
  color: #bbb;
  border-top: 1px solid #e8e8e4;
  padding-top: 20px;
  margin-top: 20px;
}
</style>
