import { useEffect, useState, useCallback } from 'react'
import { supabase, Company, UCIDBatch, UCID, ScanEvent } from './lib/supabase'
import { exportScansCSV, exportBatchesCSV, generatePDFReport } from './lib/exports'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line,
  PieChart, Pie, Cell, CartesianGrid, AreaChart, Area,
} from 'recharts'
import {
  Package, TrendingUp, Recycle, Calendar, Building2, Download, FileText,
  Loader2, Clock, Users, Target, Boxes, Activity, ChevronRight, FileSpreadsheet,
} from 'lucide-react'

const COLORS = ['#10b981', '#14b8a6', '#06b6d4', '#3b82f6', '#f59e0b', '#ef4444', '#ec4899']

type Tab = 'overview' | 'batches' | 'scans'

export default function App() {
  const [company, setCompany] = useState<Company | null>(null)
  const [batches, setBatches] = useState<UCIDBatch[]>([])
  const [ucids, setUcids] = useState<UCID[]>([])
  const [scans, setScans] = useState<ScanEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('30d')
  const [tab, setTab] = useState<Tab>('overview')
  const [selectedBatch, setSelectedBatch] = useState<UCIDBatch | null>(null)
  const [batchUcids, setBatchUcids] = useState<UCID[]>([])

  const companyId = company?.id

  const loadData = useCallback(async () => {
    if (!companyId) return
    const daysBack = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - daysBack)

    const [bRes, uRes, sRes] = await Promise.all([
      supabase.from('ucid_batches').select('*').eq('company_id', companyId).order('created_at', { ascending: false }),
      supabase.from('ucids').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(500),
      supabase.from('scan_events').select('*').eq('company_id', companyId).gte('created_at', startDate.toISOString()).order('created_at', { ascending: false }),
    ])

    setBatches((bRes.data ?? []) as UCIDBatch[])
    setUcids((uRes.data ?? []) as UCID[])
    setScans((sRes.data ?? []) as ScanEvent[])
    setLoading(false)
  }, [companyId, timeRange])

  // Load company (first approved company for demo; in production use auth)
  useEffect(() => {
    supabase.from('companies').select('*').eq('is_approved', true).order('created_at').limit(1).maybeSingle()
      .then(({ data }) => {
        if (data) setCompany(data as Company)
        else setLoading(false)
      })
  }, [])

  useEffect(() => { if (companyId) loadData() }, [companyId, loadData])

  // Real-time subscription
  useEffect(() => {
    if (!companyId) return
    const channel = supabase.channel(`company-${companyId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'scan_events', filter: `company_id=eq.${companyId}` }, () => {
        loadData()
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ucid_batches', filter: `company_id=eq.${companyId}` }, () => {
        loadData()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [companyId, loadData])

  // Load UCIDs for selected batch
  useEffect(() => {
    if (!selectedBatch) { setBatchUcids([]); return }
    supabase.from('ucids').select('*').eq('batch_id', selectedBatch.id).order('created_at', { ascending: false }).limit(200)
      .then(({ data }) => setBatchUcids((data ?? []) as UCID[]))
  }, [selectedBatch])

  // Analytics
  const getDays = () => timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90
  const dailyData = Array.from({ length: getDays() }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (getDays() - 1 - i))
    const label = d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })
    const count = scans.filter(s => new Date(s.created_at).toDateString() === d.toDateString()).length
    return { day: label, escaneos: count }
  })

  const dayOfWeekData = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map((day, i) => ({
    day, escaneos: scans.filter(s => new Date(s.created_at).getDay() === i).length,
  }))

  const hourlyDist = Array.from({ length: 24 }, (_, h) => ({
    hora: `${h}:00`, escaneos: scans.filter(s => new Date(s.created_at).getHours() === h).length,
  })).filter(h => h.escaneos > 0)

  const sourceMap: Record<string, number> = {}
  scans.forEach(s => { const src = s.acquisition_source ?? 'Desconocido'; sourceMap[src] = (sourceMap[src] ?? 0) + 1 })
  const sourceData = Object.entries(sourceMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 6)

  const uniqueUsers = new Set(scans.map(s => s.user_id)).size
  const totalUcids = batches.reduce((sum, b) => sum + (b.generated_count || b.quantity), 0)
  const scannedUcids = ucids.filter(u => u.status === 'scanned' || u.scanned_at).length

  if (loading) return (
    <div className="flex items-center justify-center h-screen">
      <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
    </div>
  )

  if (!company) return (
    <div className="flex items-center justify-center h-screen">
      <div className="text-center">
        <Building2 className="w-12 h-12 text-slate-600 mx-auto mb-3" />
        <p className="text-slate-400">No hay empresa aprobada para mostrar.</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-slate-900/80 backdrop-blur-xl border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
              <Recycle className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold">{company.name}</h1>
              <p className="text-slate-400 text-xs flex items-center gap-1">
                <Activity className="w-3 h-3" /> Panel de trazabilidad en tiempo real
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center bg-slate-800 rounded-lg p-1">
              {(['7d', '30d', '90d'] as const).map(r => (
                <button key={r} onClick={() => setTimeRange(r)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${timeRange === r ? 'bg-emerald-500 text-white' : 'text-slate-400 hover:text-white'}`}>
                  {r === '7d' ? '7 días' : r === '30d' ? '30 días' : '90 días'}
                </button>
              ))}
            </div>
            <button onClick={() => generatePDFReport({
              companyName: company.name, dateRange: timeRange, totalScans: scans.length,
              uniqueUsers, totalBatches: batches.length, totalUcids, scans, batches, dailyData,
            })} className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
              <FileText className="w-4 h-4" /> PDF
            </button>
          </div>
        </div>
        {/* Tabs */}
        <div className="max-w-7xl mx-auto px-6 flex gap-1">
          {([['overview', 'Resumen', TrendingUp], ['batches', 'Lotes', Boxes], ['scans', 'Trazabilidades', Recycle]] as const).map(([key, label, Icon]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${tab === key ? 'border-emerald-500 text-white' : 'border-transparent text-slate-400 hover:text-white'}`}>
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {tab === 'overview' && <Overview scans={scans} dailyData={dailyData} dayOfWeekData={dayOfWeekData} hourlyDist={hourlyDist} sourceData={sourceData} uniqueUsers={uniqueUsers} batches={batches} totalUcids={totalUcids} scannedUcids={scannedUcids} timeRange={timeRange} />}
        {tab === 'batches' && <BatchesTab batches={batches} ucids={ucids} selectedBatch={selectedBatch} setSelectedBatch={setSelectedBatch} batchUcids={batchUcids} />}
        {tab === 'scans' && <ScansTab scans={scans} />}
      </main>
    </div>
  )
}

function Overview({ scans, dailyData, dayOfWeekData, hourlyDist, sourceData, uniqueUsers, batches, totalUcids, scannedUcids, timeRange }: {
  scans: ScanEvent[]; dailyData: { day: string; escaneos: number }[]; dayOfWeekData: { day: string; escaneos: number }[];
  hourlyDist: { hora: string; escaneos: number }[]; sourceData: { name: string; value: number }[];
  uniqueUsers: number; batches: UCIDBatch[]; totalUcids: number; scannedUcids: number; timeRange: string
}) {
  const getDays = () => timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90
  const todayCount = scans.filter(s => new Date(s.created_at).toDateString() === new Date().toDateString()).length
  const yesterdayCount = scans.filter(s => {
    const d = new Date(); d.setDate(d.getDate() - 1)
    return new Date(s.created_at).toDateString() === d.toDateString()
  }).length
  const trend = yesterdayCount > 0 ? ((todayCount - yesterdayCount) / yesterdayCount * 100) : 0
  const scanRate = totalUcids > 0 ? ((scannedUcids / totalUcids) * 100).toFixed(1) : '0'

  return (
    <>
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPI icon={<Recycle className="w-5 h-5 text-emerald-400" />} label="Total reciclados" value={scans.length} sub={`últimos ${getDays()} días`} trend={trend} color="emerald" />
        <KPI icon={<Users className="w-5 h-5 text-blue-400" />} label="Recicladores únicos" value={uniqueUsers} sub={`${scans.length > 0 ? (scans.length / uniqueUsers).toFixed(1) : 0} escaneos/prom`} color="blue" />
        <KPI icon={<Boxes className="w-5 h-5 text-amber-400" />} label="Lotes creados" value={batches.length} sub={`${totalUcids} UCIDs totales`} color="amber" />
        <KPI icon={<Target className="w-5 h-5 text-teal-400" />} label="Tasa de escaneo" value={`${scanRate}%`} sub={`${scannedUcids} de ${totalUcids} UCIDs`} color="teal" />
      </div>

      {/* Daily trend */}
      <ChartCard title="Tendencia diaria de escaneos" icon={<TrendingUp className="w-4 h-4 text-emerald-400" />}>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={dailyData}>
            <defs>
              <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="day" stroke="#64748b" tick={{ fill: '#94a3b8', fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis stroke="#64748b" tick={{ fill: '#94a3b8', fontSize: 12 }} />
            <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, color: '#fff' }} />
            <Area type="monotone" dataKey="escaneos" stroke="#10b981" fill="url(#g1)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Two-column row */}
      <div className="grid lg:grid-cols-2 gap-6">
        <ChartCard title="Fuentes de adquisición" icon={<Package className="w-4 h-4 text-amber-400" />}>
          {sourceData.length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="50%" height={200}>
                <PieChart>
                  <Pie data={sourceData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value" paddingAngle={3}>
                    {sourceData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, color: '#fff' }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-2">
                {sourceData.map((d, i) => (
                  <div key={d.name} className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />
                    <span className="text-slate-400 text-xs truncate flex-1">{d.name}</span>
                    <span className="text-white text-xs font-semibold">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : <Empty />}
        </ChartCard>

        <ChartCard title="Por día de la semana" icon={<Calendar className="w-4 h-4 text-blue-400" />}>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={dayOfWeekData} barSize={24}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="day" stroke="#64748b" tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <YAxis stroke="#64748b" tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, color: '#fff' }} />
              <Bar dataKey="escaneos" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Hourly */}
      <ChartCard title="Distribución por hora del día" icon={<Clock className="w-4 h-4 text-rose-400" />}>
        {hourlyDist.length > 0 ? (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={hourlyDist} barSize={16}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="hora" stroke="#64748b" tick={{ fill: '#94a3b8', fontSize: 10 }} />
              <YAxis stroke="#64748b" tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, color: '#fff' }} />
              <Bar dataKey="escaneos" fill="#f43f5e" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : <Empty />}
      </ChartCard>
    </>
  )
}

function BatchesTab({ batches, ucids, selectedBatch, setSelectedBatch, batchUcids }: {
  batches: UCIDBatch[]; ucids: UCID[]; selectedBatch: UCIDBatch | null; setSelectedBatch: (b: UCIDBatch | null) => void; batchUcids: UCID[]
}) {
  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold flex items-center gap-2"><Boxes className="w-5 h-5 text-amber-400" /> Lotes de UCIDs</h2>
        <button onClick={() => exportBatchesCSV(batches)} disabled={batches.length === 0}
          className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          <FileSpreadsheet className="w-4 h-4" /> Exportar CSV
        </button>
      </div>

      {selectedBatch ? (
        <div className="space-y-4">
          <button onClick={() => setSelectedBatch(null)} className="flex items-center gap-1 text-slate-400 hover:text-white text-sm transition-colors">
            <ChevronRight className="w-4 h-4 rotate-180" /> Volver a lotes
          </button>
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
            <h3 className="text-white font-semibold mb-1">{selectedBatch.batch_name}</h3>
            <p className="text-slate-400 text-xs mb-4">
              {selectedBatch.product_name ?? 'Sin producto'} · {selectedBatch.quantity} UCIDs · {selectedBatch.generated_count} generados
            </p>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="text-left text-xs text-slate-500 font-medium px-3 py-2">Short Code</th>
                    <th className="text-left text-xs text-slate-500 font-medium px-3 py-2">UCID Hash</th>
                    <th className="text-left text-xs text-slate-500 font-medium px-3 py-2">Estado</th>
                    <th className="text-left text-xs text-slate-500 font-medium px-3 py-2">Escaneado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {batchUcids.map(u => (
                    <tr key={u.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="px-3 py-2 font-mono text-xs text-emerald-400">{u.short_code}</td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-500 truncate max-w-40">{u.ucid_hash}</td>
                      <td className="px-3 py-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${u.status === 'scanned' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-700/40 text-slate-400'}`}>
                          {u.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-400 text-xs">{u.scanned_at ? new Date(u.scanned_at).toLocaleString('es-CO') : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Lote</th>
                  <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Producto</th>
                  <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Cantidad</th>
                  <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Generados</th>
                  <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Estado</th>
                  <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Creado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {batches.map(b => (
                  <tr key={b.id} onClick={() => setSelectedBatch(b)} className="hover:bg-slate-800/30 transition-colors cursor-pointer">
                    <td className="px-5 py-3 text-white text-sm font-medium">{b.batch_name}</td>
                    <td className="px-5 py-3 text-slate-300 text-xs">{b.product_name ?? '-'}</td>
                    <td className="px-5 py-3 text-white text-sm">{b.quantity}</td>
                    <td className="px-5 py-3 text-emerald-400 text-sm font-medium">{b.generated_count}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${b.status === 'generated' ? 'bg-emerald-500/10 text-emerald-400' : b.status === 'printed' ? 'bg-blue-500/10 text-blue-400' : 'bg-amber-500/10 text-amber-400'}`}>
                        {b.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-400 text-xs">{new Date(b.created_at).toLocaleDateString('es-CO')}</td>
                  </tr>
                ))}
                {batches.length === 0 && (
                  <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-500 text-sm">No hay lotes creados.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}

function ScansTab({ scans }: { scans: ScanEvent[] }) {
  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold flex items-center gap-2"><Recycle className="w-5 h-5 text-emerald-400" /> Trazabilidades</h2>
        <button onClick={() => exportScansCSV(scans)} disabled={scans.length === 0}
          className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          <FileSpreadsheet className="w-4 h-4" /> Exportar CSV
        </button>
      </div>
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Fecha</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Barcode</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Fuente</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Ubicación</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Puntos</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {scans.slice(0, 50).map(s => (
                <tr key={s.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-5 py-3 text-slate-400 text-xs">
                    <div>{new Date(s.created_at).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}</div>
                    <div className="text-slate-600 text-[10px]">{new Date(s.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</div>
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-300">{s.barcode}</td>
                  <td className="px-5 py-3 text-slate-300 text-xs">{s.acquisition_source ?? '-'}</td>
                  <td className="px-5 py-3 text-slate-300 text-xs truncate max-w-32">{s.location_name ?? '-'}</td>
                  <td className="px-5 py-3 text-emerald-400 text-xs font-semibold">{s.points_earned}</td>
                </tr>
              ))}
              {scans.length === 0 && (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-slate-500 text-sm">
                  <Recycle className="w-8 h-8 mx-auto mb-2 opacity-30" /> No hay trazabilidades en este período.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

function KPI({ icon, label, value, sub, trend, color }: {
  icon: React.ReactNode; label: string; value: number | string; sub: string; trend?: number; color: string
}) {
  const bg: Record<string, string> = {
    emerald: 'bg-emerald-500/10 border-emerald-500/20',
    blue: 'bg-blue-500/10 border-blue-500/20',
    amber: 'bg-amber-500/10 border-amber-500/20',
    teal: 'bg-teal-500/10 border-teal-500/20',
  }
  return (
    <div className={`${bg[color]} border rounded-2xl p-5`}>
      <div className="flex items-start justify-between">
        <div className="mb-3">{icon}</div>
        {trend !== undefined && trend !== 0 && (
          <div className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${trend >= 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
            {trend >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingUp className="w-3 h-3 rotate-180" />}
            {Math.abs(trend).toFixed(0)}%
          </div>
        )}
      </div>
      <p className="text-slate-400 text-xs mb-0.5">{label}</p>
      <p className="text-white text-2xl font-bold">{value}</p>
      <p className="text-slate-500 text-xs mt-0.5">{sub}</p>
    </div>
  )
}

function ChartCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
      <h3 className="text-white font-semibold text-sm flex items-center gap-2 mb-4">{icon}{title}</h3>
      {children}
    </div>
  )
}

function Empty() {
  return <div className="flex items-center justify-center h-40 text-slate-500 text-sm">Sin datos suficientes</div>
}
