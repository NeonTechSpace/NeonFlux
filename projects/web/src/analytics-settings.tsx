import type { ConvexReactClient } from 'convex/react'
import { useEffect, useState } from 'react'
import type { DashboardAnalyticsSnapshot, DashboardCatalog } from '@neonflux/backend/dashboard-contracts'
import { dashboardApi } from './dashboard-api'
import { SearchPicker } from './search-picker'
import { SettingsForm } from './settings-form'

const formatDay = (day: number) => new Date(day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const formatCount = (value: number) => value.toLocaleString('en-US')
// Rounds an axis top up to 1, 2 or 5 times a power of ten
function niceMax(value: number) {
  if (value <= 1) return 1
  const power = 10 ** Math.floor(Math.log10(value)), step = [1, 2, 5, 10].find(step => step * power >= value)!
  return step * power
}
// A bar square at its baseline with a 4px rounded data end, growing up or down
function barPath(x: number, base: number, length: number, width: number, up: boolean) {
  const r = Math.min(4, length, width / 2), end = up ? base - length : base + length, inward = up ? r : -r
  return `M${x},${base}V${end + inward}Q${x},${end} ${x + r},${end}H${x + width - r}Q${x + width},${end} ${x + width},${end + inward}V${base}Z`
}

const WIDTH = 600, PLOT_LEFT = 44
function MemberChart({ days }: { days: DashboardAnalyticsSnapshot['members'] }) {
  const height = 180, middle = height / 2, reach = middle - 12, top = niceMax(Math.max(...days.flatMap(day => [day.joins, day.leaves])))
  const band = (WIDTH - PLOT_LEFT) / days.length, bar = Math.min(12, band - 2)
  const joins = days.reduce((sum, day) => sum + day.joins, 0), leaves = days.reduce((sum, day) => sum + day.leaves, 0)
  return <>
    <div className="chart-legend"><span><i className="swatch joins" />Joins {formatCount(joins)}</span><span><i className="swatch leaves" />Leaves {formatCount(leaves)}</span></div>
    <svg className="chart" viewBox={`0 0 ${WIDTH} ${height + 20}`} role="img" aria-label={`Member joins and leaves per day for the last 30 days. ${joins} joins and ${leaves} leaves`}>
      <line className="chart-grid" x1={PLOT_LEFT} x2={WIDTH} y1={middle - reach} y2={middle - reach} /><line className="chart-grid" x1={PLOT_LEFT} x2={WIDTH} y1={middle + reach} y2={middle + reach} />
      <text className="chart-axis" x={PLOT_LEFT - 8} y={middle - reach + 4} textAnchor="end">{formatCount(top)}</text>
      <text className="chart-axis" x={PLOT_LEFT - 8} y={middle + 4} textAnchor="end">0</text>
      <text className="chart-axis" x={PLOT_LEFT - 8} y={middle + reach + 4} textAnchor="end">{formatCount(top)}</text>
      {days.map((day, index) => { const x = PLOT_LEFT + index * band + (band - bar) / 2; return <g key={day.day}>
        {day.joins > 0 && <path className="bar joins" d={barPath(x, middle - 1, day.joins / top * reach, bar, true)} />}
        {day.leaves > 0 && <path className="bar leaves" d={barPath(x, middle + 1, day.leaves / top * reach, bar, false)} />}
        <rect className="chart-hit" x={PLOT_LEFT + index * band} y={0} width={band} height={height}><title>{`${formatDay(day.day)}: ${day.joins} joins, ${day.leaves} leaves`}</title></rect>
      </g> })}
      <line className="chart-baseline" x1={PLOT_LEFT} x2={WIDTH} y1={middle} y2={middle} />
      <text className="chart-axis" x={PLOT_LEFT} y={height + 16}>{formatDay(days[0]!.day)}</text>
      <text className="chart-axis" x={WIDTH} y={height + 16} textAnchor="end">{formatDay(days.at(-1)!.day)}</text>
    </svg>
    <details><summary>Show joins and leaves as a table</summary><table className="chart-table"><thead><tr><th>Day</th><th>Joins</th><th>Leaves</th></tr></thead><tbody>{days.map(day => <tr key={day.day}><td>{formatDay(day.day)}</td><td>{formatCount(day.joins)}</td><td>{formatCount(day.leaves)}</td></tr>)}</tbody></table></details>
  </>
}

function MessageChart({ days }: { days: DashboardAnalyticsSnapshot['messages'] }) {
  const height = 160, base = height - 8, reach = base - 12, top = niceMax(Math.max(...days.map(day => day.count)))
  const band = (WIDTH - PLOT_LEFT) / days.length, bar = Math.min(24, band - 2), total = days.reduce((sum, day) => sum + day.count, 0)
  return <>
    <svg className="chart" viewBox={`0 0 ${WIDTH} ${height + 20}`} role="img" aria-label={`Messages per day for the last 14 days. ${total} messages`}>
      <line className="chart-grid" x1={PLOT_LEFT} x2={WIDTH} y1={base - reach} y2={base - reach} /><line className="chart-grid" x1={PLOT_LEFT} x2={WIDTH} y1={base - reach / 2} y2={base - reach / 2} />
      <text className="chart-axis" x={PLOT_LEFT - 8} y={base - reach + 4} textAnchor="end">{formatCount(top)}</text>
      <text className="chart-axis" x={PLOT_LEFT - 8} y={base - reach / 2 + 4} textAnchor="end">{formatCount(top / 2)}</text>
      <text className="chart-axis" x={PLOT_LEFT - 8} y={base + 4} textAnchor="end">0</text>
      {days.map((day, index) => <g key={day.day}>
        {day.count > 0 && <path className="bar messages" d={barPath(PLOT_LEFT + index * band + (band - bar) / 2, base, day.count / top * reach, bar, true)} />}
        <rect className="chart-hit" x={PLOT_LEFT + index * band} y={0} width={band} height={height}><title>{`${formatDay(day.day)}: ${day.count} messages`}</title></rect>
      </g>)}
      <line className="chart-baseline" x1={PLOT_LEFT} x2={WIDTH} y1={base} y2={base} />
      <text className="chart-axis" x={PLOT_LEFT} y={height + 16}>{formatDay(days[0]!.day)}</text>
      <text className="chart-axis" x={WIDTH} y={height + 16} textAnchor="end">{formatDay(days.at(-1)!.day)}</text>
    </svg>
    <details><summary>Show messages as a table</summary><table className="chart-table"><thead><tr><th>Day</th><th>Messages</th></tr></thead><tbody>{days.map(day => <tr key={day.day}><td>{formatDay(day.day)}</td><td>{formatCount(day.count)}</td></tr>)}</tbody></table></details>
  </>
}

const HOURS = Array.from({ length: 24 }, (_, hour) => hour)
const formatHour = (hour: number) => `${String(hour).padStart(2, '0')}:00`
const formatAverage = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 1 })
// Monday first. Days are UTC
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const weekday = (day: number) => (new Date(day).getUTCDay() + 6) % 7
// One blue hue in five steps from dim to bright, each at least 2:1 against the panel. Hours without messages use the empty cell color
const HEAT = ['#184f95', '#256abf', '#3987e5', '#6da7ec', '#b7d3f6']
type HourDays = DashboardAnalyticsSnapshot['hours']

function HourChart({ totals, range }: { totals: number[], range: 7 | 30 }) {
  const height = 160, base = height - 8, reach = base - 12, top = niceMax(Math.max(...totals))
  const band = (WIDTH - PLOT_LEFT) / 24, bar = Math.min(16, band - 2), busiest = totals.indexOf(Math.max(...totals))
  return <svg className="chart" viewBox={`0 0 ${WIDTH} ${height + 20}`} role="img" aria-label={`Messages per UTC hour of the day over the last ${range} days. The busiest hour is ${formatHour(busiest)} with ${totals[busiest]} messages`}>
    <line className="chart-grid" x1={PLOT_LEFT} x2={WIDTH} y1={base - reach} y2={base - reach} /><line className="chart-grid" x1={PLOT_LEFT} x2={WIDTH} y1={base - reach / 2} y2={base - reach / 2} />
    <text className="chart-axis" x={PLOT_LEFT - 8} y={base - reach + 4} textAnchor="end">{formatCount(top)}</text>
    <text className="chart-axis" x={PLOT_LEFT - 8} y={base - reach / 2 + 4} textAnchor="end">{formatCount(top / 2)}</text>
    <text className="chart-axis" x={PLOT_LEFT - 8} y={base + 4} textAnchor="end">0</text>
    {HOURS.map(hour => <g key={hour}>
      {totals[hour]! > 0 && <path className="bar messages" d={barPath(PLOT_LEFT + hour * band + (band - bar) / 2, base, totals[hour]! / top * reach, bar, true)} />}
      <rect className="chart-hit" x={PLOT_LEFT + hour * band} y={0} width={band} height={height}><title>{`${formatHour(hour)} UTC: ${formatCount(totals[hour]!)} messages`}</title></rect>
    </g>)}
    <line className="chart-baseline" x1={PLOT_LEFT} x2={WIDTH} y1={base} y2={base} />
    {[0, 6, 12, 18].map(hour => <text key={hour} className="chart-axis" x={PLOT_LEFT + hour * band} y={height + 16}>{formatHour(hour)}</text>)}
  </svg>
}

// Each cell is the average for that weekday and hour over the days of the range, so a weekday that occurs five times is not counted heavier
function WeekChart({ days }: { days: HourDays }) {
  const sums = WEEKDAYS.map(() => HOURS.map(() => 0)), occurrences = WEEKDAYS.map(() => 0)
  for (const row of days) { const index = weekday(row.day); occurrences[index]!++; row.counts.forEach((count, hour) => { sums[index]![hour]! += count }) }
  const grid = sums.map((row, index) => row.map(sum => occurrences[index] ? sum / occurrences[index]! : 0)), top = Math.max(...grid.flat())
  const step = (value: number) => value > 0 ? HEAT[Math.min(HEAT.length - 1, Math.ceil(value / top * HEAT.length) - 1)]! : 'var(--surface-3)'
  const describe = (index: number, hour: number) => {
    const value = grid[index]![hour]!, times = occurrences[index]!
    return `${WEEKDAYS[index]} ${formatHour(hour)} UTC: ${times === 1 ? `${formatCount(value)} messages` : `${formatAverage(value)} messages on average over ${times} days`}`
  }
  const busiest = grid.flatMap((row, index) => row.map((value, hour) => ({ index, hour, value }))).reduce((best, cell) => cell.value > best.value ? cell : best)
  const row = 18, height = row * WEEKDAYS.length, band = (WIDTH - PLOT_LEFT) / 24
  return <>
    <div className="chart-legend"><span><i className="swatch" style={{ background: 'var(--surface-3)' }} />None</span><span>Fewer{HEAT.map(color => <i key={color} className="swatch" style={{ background: color }} />)}More</span></div>
    <svg className="chart" viewBox={`0 0 ${WIDTH} ${height + 20}`} role="img" aria-label={`Messages per UTC hour and weekday over the range. The busiest is ${describe(busiest.index, busiest.hour)}`}>
      {WEEKDAYS.map((name, index) => <g key={name}>
        <text className="chart-axis" x={PLOT_LEFT - 8} y={index * row + row / 2 + 4} textAnchor="end">{name}</text>
        {HOURS.map(hour => <g key={hour}>
          <rect className="heat-cell" x={PLOT_LEFT + hour * band + 1} y={index * row + 1} width={band - 2} height={row - 2} rx={3} style={{ fill: step(grid[index]![hour]!) }} />
          <rect className="chart-hit" x={PLOT_LEFT + hour * band} y={index * row} width={band} height={row}><title>{describe(index, hour)}</title></rect>
        </g>)}
      </g>)}
      {[0, 6, 12, 18].map(hour => <text key={hour} className="chart-axis" x={PLOT_LEFT + hour * band} y={height + 16}>{formatHour(hour)}</text>)}
    </svg>
    <details><summary>Show messages by hour as a table</summary><table className="chart-table"><thead><tr><th>Hour, UTC</th><th>Messages</th>{WEEKDAYS.map(name => <th key={name}>{name}</th>)}</tr></thead>
      <tbody>{HOURS.map(hour => <tr key={hour}><td>{formatHour(hour)}</td><td>{formatCount(sums.reduce((sum, row) => sum + row[hour]!, 0))}</td>{WEEKDAYS.map((name, index) => <td key={name}>{formatAverage(grid[index]![hour]!)}</td>)}</tr>)}</tbody></table>
      <p className="muted">Weekday columns are averages per day</p></details>
  </>
}

function BusiestHours({ days, range }: { days: HourDays, range: 7 | 30 }) {
  const totals = HOURS.map(hour => days.reduce((sum, day) => sum + (day.counts[hour] ?? 0), 0))
  const top = Math.max(...totals), busiest = totals.indexOf(top)
  if (top === 0) return <p className="muted">No messages counted in this range yet</p>
  return <>
    <p>Busiest hour: <strong>{formatHour(busiest)} UTC</strong>, {formatCount(top)} messages</p>
    <HourChart totals={totals} range={range} />
    <h3>By weekday</h3>
    <WeekChart days={days} />
  </>
}

export interface AnalyticsSectionProps { client: ConvexReactClient, sessionToken: string, serverId: string, connected: boolean, catalog?: DashboardCatalog | undefined }
export function AnalyticsSection({ client, sessionToken, serverId, connected, catalog }: AnalyticsSectionProps) {
  const [range, setRange] = useState<7 | 30>(7), [channelId, setChannelId] = useState<string>()
  const [remote, setRemote] = useState<DashboardAnalyticsSnapshot>(), [error, setError] = useState(false)
  // A range or channel change keeps the shown data until the new snapshot arrives
  useEffect(() => {
    const watch = client.watchQuery(dashboardApi.analytics, { sessionToken, serverId, range, ...(channelId ? { channelId } : {}) })
    const update = () => { try { const result = watch.localQueryResult(); if (result) { setRemote(result); setError(false) } } catch { setError(true) } }
    const unsubscribe = watch.onUpdate(update)
    update()
    return unsubscribe
  }, [client, sessionToken, serverId, range, channelId])
  const channelName = (id: string) => { const name = catalog?.channels.find(channel => channel.id === id)?.name; return name ? `#${name}` : id }
  // Every channel except categories, plus counted channels the catalog no longer lists
  const channelOptions = [...(catalog?.channels.filter(channel => channel.type !== 4).map(channel => ({ id: channel.id, name: `#${channel.name}` })) ?? []),
    ...(remote?.topChannels.filter(row => !catalog?.channels.some(channel => channel.id === row.channelId)).map(row => ({ id: row.channelId, name: row.channelId })) ?? [])]
  const topTotal = remote?.topChannels[0]?.count ?? 0
  return <>
    {error && <p role="alert" className="notice error">Live analytics are unavailable. Refresh your sign-in or check your server permission</p>}
    {!remote && <section className="panel"><p role="status">Loading analytics…</p></section>}
    {remote && <>
      <SettingsForm title="Analytics" description="Counts of member joins, member leaves and messages per channel for this server. Counts only, never per-member data. Days are UTC" snapshot={{ revision: remote.revision, values: { enabled: remote.enabled } }} connected={connected && !error}
        save={(values, expectedRevision) => client.action(dashboardApi.saveAnalytics, { sessionToken, serverId, expectedRevision, enabled: Boolean(values.enabled) })}
        fields={(values, edit, disabled) => <><label><input type="checkbox" checked={Boolean(values.enabled)} disabled={disabled} onChange={event => edit('enabled', event.target.checked)} />Count server activity</label>
          {remote.enabled ? <span className="field-help">The bot saves new counts about every five minutes. Channel counts are kept for 35 days and daily member counts for 400 days</span>
            : <p className="notice" role="status">Analytics is off. The bot is not counting activity for this server. Existing counts stay until they age out</p>}</>} />
      <section className="panel" aria-label="Joins and leaves"><h2>Joins and leaves</h2><p className="muted">Members who joined or left, per day for the last 30 days</p><MemberChart days={remote.members} /></section>
      <section className="panel" aria-label="Messages"><h2>Messages</h2><p className="muted">Member messages per day for the last 14 days. Bot, webhook and system messages are not counted</p><MessageChart days={remote.messages} /></section>
      <section className="panel" aria-label="Top channels">
        <div className="panel-heading"><h2>Top channels</h2><label className="inline-field">Range<select value={range} onChange={event => setRange(Number(event.target.value) === 30 ? 30 : 7)}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option></select></label></div>
        {remote.range !== range && <p className="muted" role="status">Loading the selected range…</p>}
        {remote.topChannels.length ? <ol className="top-channels">{remote.topChannels.map(row => <li key={row.channelId}><span className="top-channel-name">{channelName(row.channelId)}</span><span className="top-channel-meter" aria-hidden="true"><span style={{ width: `${Math.max(2, row.count / topTotal * 100)}%` }} /></span><span className="top-channel-count">{formatCount(row.count)}</span></li>)}</ol>
          : <p className="muted">No messages counted in this range yet</p>}
      </section>
      <section className="panel" aria-label="Busiest hours">
        <h2>Busiest hours</h2>
        <p className="muted">Messages per UTC hour over the last {remote.range} days, the range chosen for top channels. Leave the channel empty for every channel</p>
        <SearchPicker label="Channel" options={channelOptions} value={channelId ? [channelId] : []} loading={!catalog} onChange={ids => setChannelId(ids[0])} />
        {(remote.channelId ?? undefined) !== channelId && <p className="muted" role="status">Loading the selected channel…</p>}
        <BusiestHours days={remote.hours} range={remote.range} />
      </section>
    </>}
  </>
}
