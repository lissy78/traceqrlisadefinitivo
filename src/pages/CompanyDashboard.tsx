import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { supabase, ScanEvent, Company } from '../lib/supabase';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, CartesianGrid, AreaChart, Area, Legend } from 'recharts';
import {
  Package, TrendingUp, Recycle, BarChart2, MapPin,
  Activity, ShoppingBag, Calendar, Building2, Search,
  Check, Loader2, Plus, Shield, AlertTriangle, AlertCircle,
  Users, Target, Award, TrendingDown, Clock, PieChart as PieChartIcon
} from 'lucide-react';

const COLORS = ['#10b981', '#14b8a6', '#06b6d4', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', '#ec4899'];
const INDUSTRIES = ['Bebidas', 'Alimentos', 'Farmacéutica', 'Cosméticos', 'Limpieza', 'Otro'];

interface ScanWithDetails extends ScanEvent {
  product?: {
    name: string;
    brand: string | null;
    image_url: string | null;
    material: string | null;
  };
}

export default function CompanyDashboard() {
  const { profile, refreshProfile } = useAuth();
  const [company, setCompany] = useState<Company | null>(null);
  const [scans, setScans] = useState<ScanWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('30d');

  useEffect(() => {
    if (profile?.company_id) {
      loadData();
    } else {
      setLoading(false);
    }
  }, [profile, timeRange]);

  async function loadData() {
    if (!profile?.company_id) return;

    const daysBack = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    const [{ data: co }, { data: sc }] = await Promise.all([
      supabase.from('companies').select('*').eq('id', profile.company_id).maybeSingle(),
      supabase.from('scan_events')
        .select('*, product:product_catalog(name, brand, image_url, material)')
        .eq('company_id', profile.company_id)
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: false }),
    ]);
    const companyData = co as Company;
    setCompany(companyData);
    setScans((sc ?? []) as ScanWithDetails[]);
    setLoading(false);
  }

  // Analytics calculations
  const getDaysInRange = () => timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;

  const dailyData = Array.from({ length: getDaysInRange() }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (getDaysInRange() - 1 - i));
    const label = d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
    const count = scans.filter(s => new Date(s.created_at).toDateString() === d.toDateString()).length;
    return { day: label, escaneos: count };
  });

  const dayOfWeekData = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map((day, i) => ({
    day,
    escaneos: scans.filter(s => new Date(s.created_at).getDay() === i).length
  }));

  const hourlyDistribution = Array.from({ length: 24 }, (_, h) => ({
    hora: `${h}:00`,
    escaneos: scans.filter(s => new Date(s.created_at).getHours() === h).length
  })).filter(h => h.escaneos > 0);

  const sourceMap: Record<string, number> = {};
  scans.forEach(s => {
    const src = s.acquisition_source ?? 'Desconocido';
    sourceMap[src] = (sourceMap[src] ?? 0) + 1;
  });
  const sourceData = Object.entries(sourceMap)
    .map(([name, value]) => ({ name: name.length > 15 ? name.substring(0, 15) + '...' : name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  const materialMap: Record<string, number> = {};
  scans.forEach(s => {
    const mat = s.product?.material ?? (s.scan_data as any)?.material_type?.split(' ')[0] ?? 'Otro';
    materialMap[mat] = (materialMap[mat] ?? 0) + 1;
  });
  const materialData = Object.entries(materialMap).map(([name, value]) => ({ name, value }));

  const weeklyTrend = Array.from({ length: 12 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - ((11 - i) * 7));
    const weekStart = new Date(d);
    weekStart.setDate(weekStart.getDate() - 7);
    const count = scans.filter(s => {
      const scanDate = new Date(s.created_at);
      return scanDate >= weekStart && scanDate < d;
    }).length;
    return { week: `S${Math.ceil((d.getDate() - new Date(d.getFullYear(), d.getMonth(), 1).getDate()) / 7)}`, escaneos: count };
  });

  const uniqueUsers = new Set(scans.map(s => s.user_id)).size;
  const avgScansPerUser = scans.length > 0 ? (scans.length / uniqueUsers).toFixed(1) : '0';

  const todayCount = scans.filter(s => new Date(s.created_at).toDateString() === new Date().toDateString()).length;
  const yesterdayCount = scans.filter(s => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return new Date(s.created_at).toDateString() === d.toDateString();
  }).length;
  const todayVsYesterday = yesterdayCount > 0 ? ((todayCount - yesterdayCount) / yesterdayCount * 100).toFixed(0) : 'N/A';

  const maxDailyCount = Math.max(...dailyData.map(d => d.escaneos), 1);
  const peakDay = dailyData.find(d => d.escaneos === maxDailyCount);

  if (!profile?.company_id) {
    return <CompanySetup onLinked={() => { refreshProfile().then(() => loadData()); }} />;
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  // Check if company is approved
  if (company && !company.is_approved) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center mx-auto mb-4">
            <Shield className="w-8 h-8 text-amber-400" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Empresa pendiente de aprobacion</h2>
          <p className="text-slate-400 text-sm mb-4">
            Tu empresa <strong className="text-white">{company.name}</strong> esta registrada pero aun no ha sido aprobada por el administrador.
          </p>
          <div className="bg-slate-900/60 rounded-xl p-4 text-left">
            <h3 className="text-amber-300 text-sm font-medium mb-2">Que significa esto?</h3>
            <ul className="space-y-2 text-slate-400 text-xs">
              <li className="flex items-start gap-2">
                <AlertTriangle className="w-3 h-3 text-amber-400 mt-0.5 shrink-0" />
                <span>No puedes ver el dashboard de trazabilidad hasta ser aprobado</span>
              </li>
              <li className="flex items-start gap-2">
                <AlertTriangle className="w-3 h-3 text-amber-400 mt-0.5 shrink-0" />
                <span>Los datos de tus productos siguen siendo rastreados</span>
              </li>
              <li className="flex items-start gap-2">
                <AlertTriangle className="w-3 h-3 text-amber-400 mt-0.5 shrink-0" />
                <span>Contacta al administrador para activar tu acceso</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">{company?.name ?? 'Mi empresa'}</h1>
          <p className="text-slate-400 text-sm mt-1 flex items-center gap-1">
            <Activity className="w-3 h-3" /> Panel de control de trazabilidad
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-slate-800 rounded-lg p-1">
            {(['7d', '30d', '90d'] as const).map(range => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  timeRange === range
                    ? 'bg-emerald-500 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {range === '7d' ? '7 días' : range === '30d' ? '30 días' : '90 días'}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 bg-slate-800/60 rounded-lg px-3 py-1.5">
            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
            <span className="text-slate-400 text-xs">En vivo</span>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          icon={<Recycle className="w-5 h-5 text-emerald-400" />}
          label="Total reciclados"
          value={scans.length.toString()}
          sub={`${timeRange === '7d' ? 'última' : 'últimos'} ${getDaysInRange()} días`}
          trend={todayVsYesterday !== 'N/A' ? parseFloat(todayVsYesterday) : undefined}
          color="emerald"
        />
        <KPICard
          icon={<Users className="w-5 h-5 text-blue-400" />}
          label="Recicladores únicos"
          value={uniqueUsers.toString()}
          sub={`${avgScansPerUser} escaneos/promedio`}
          color="blue"
        />
        <KPICard
          icon={<Target className="w-5 h-5 text-amber-400" />}
          label="Día pico"
          value={peakDay ? peakDay.escaneos.toString() : '0'}
          sub={peakDay ? peakDay.day : 'Sin datos'}
          color="amber"
        />
        <KPICard
          icon={<PieChartIcon className="w-5 h-5 text-teal-400" />}
          label="Fuentes distintas"
          value={Object.keys(sourceMap).length.toString()}
          sub="puntos de adquisición"
          color="teal"
        />
      </div>

      {/* Main Charts Row */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Daily Trend Chart */}
        <ChartCard title="Tendencia diaria de escaneos" icon={<TrendingUp className="w-4 h-4 text-emerald-400" />}>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={dailyData}>
              <defs>
                <linearGradient id="colorEscaneos" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="day" stroke="#64748b" tick={{ fill: '#94a3b8', fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis stroke="#64748b" tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <Tooltip
                contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, color: '#fff' }}
                labelFormatter={(label) => `Día: ${label}`}
              />
              <Area type="monotone" dataKey="escaneos" stroke="#10b981" fillOpacity={1} fill="url(#colorEscaneos)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Sources Pie Chart */}
        <ChartCard title="Fuentes de adquisición" icon={<MapPin className="w-4 h-4 text-amber-400" />}>
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
                    <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                    <span className="text-slate-400 text-xs truncate flex-1">{d.name}</span>
                    <span className="text-white text-xs font-semibold">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : <EmptyChart />}
        </ChartCard>
      </div>

      {/* Secondary Charts Row */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Day of Week */}
        <ChartCard title="Por día de la semana" icon={<Calendar className="w-4 h-4 text-blue-400" />}>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={dayOfWeekData} barSize={24}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="day" stroke="#64748b" tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <YAxis stroke="#64748b" tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, color: '#fff' }} />
              <Bar dataKey="escaneos" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Materials Distribution */}
        <ChartCard title="Por tipo de material" icon={<Package className="w-4 h-4 text-teal-400" />}>
          {materialData.length > 0 ? (
            <div className="space-y-3 pt-2">
              {materialData.map((m, i) => {
                const pct = scans.length > 0 ? ((m.value / scans.length) * 100).toFixed(0) : 0;
                return (
                  <div key={m.name}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-slate-300 text-xs">{m.name}</span>
                      <span className="text-white text-xs font-semibold">{m.value} ({pct}%)</span>
                    </div>
                    <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: COLORS[i % COLORS.length] }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : <EmptyChart />}
        </ChartCard>

        {/* Weekly Trend */}
        <ChartCard title="Tendencia semanal" icon={<TrendingUp className="w-4 h-4 text-violet-400" />}>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={weeklyTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="week" stroke="#64748b" tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <YAxis stroke="#64748b" tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, color: '#fff' }} />
              <Line type="monotone" dataKey="escaneos" stroke="#8b5cf6" strokeWidth={2} dot={{ fill: '#8b5cf6', r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Hourly Distribution */}
      <ChartCard title="Distribución por hora del día" icon={<Clock className="w-4 h-4 text-rose-400" />}>
        {hourlyDistribution.length > 0 ? (
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={hourlyDistribution} barSize={16}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="hora" stroke="#64748b" tick={{ fill: '#94a3b8', fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis stroke="#64748b" tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, color: '#fff' }} />
              <Bar dataKey="escaneos" fill="#f43f5e" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : <EmptyChart />}
      </ChartCard>

      {/* Recent Scans Table */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h2 className="text-white font-semibold flex items-center gap-2">
            <Calendar className="w-4 h-4 text-slate-400" /> Últimas trazabilidades
          </h2>
          <span className="text-slate-500 text-xs">{scans.length} registros en período</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Producto</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Marca</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Fuente</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Material</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Token</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Fecha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {scans.slice(0, 20).map(scan => (
                <tr key={scan.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      {scan.product?.image_url ? (
                        <img src={scan.product.image_url} alt="" className="w-7 h-7 rounded-lg object-cover bg-slate-800" />
                      ) : <div className="w-7 h-7 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center"><Package className="w-3 h-3 text-slate-500" /></div>}
                      <div>
                        <p className="text-white text-xs font-medium">{scan.product?.name ?? 'Desconocido'}</p>
                        <span className="font-mono text-xs text-slate-500">{scan.barcode?.slice(0, 12)}...</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    {scan.product?.brand || (scan.scan_data as any)?.brand_name ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-300 border border-blue-500/20">
                        {scan.product?.brand ?? (scan.scan_data as any)?.brand_name}
                      </span>
                    ) : <span className="text-slate-600 text-xs">-</span>}
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-slate-300 text-xs truncate max-w-24 block">
                      {scan.acquisition_source ?? '-'}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    {(() => {
                      const mat = scan.product?.material ?? (scan.scan_data as any)?.material_type?.split(' ')[0];
                      return <span className={`text-xs px-1.5 py-0.5 rounded ${
                        mat === 'PET' ? 'bg-emerald-500/10 text-emerald-400' :
                        mat === 'Vidrio' ? 'bg-blue-500/10 text-blue-400' :
                        mat === 'Aluminio' || mat === 'Lata' ? 'bg-amber-500/10 text-amber-400' :
                        'text-slate-500'
                      }`}>{mat ?? '-'}</span>;
                    })()}
                  </td>
                  <td className="px-5 py-3">
                    <span className="font-mono text-xs text-slate-500 truncate max-w-20 block">
                      {scan.token_hash?.slice(0, 14)}...
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <div className="text-slate-400 text-xs">
                      <div>{new Date(scan.created_at).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}</div>
                      <div className="text-slate-600 text-[10px]">{new Date(scan.created_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                  </td>
                </tr>
              ))}
              {scans.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-slate-500 text-sm">
                    <Recycle className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No hay datos de trazabilidad en este período.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function CompanySetup({ onLinked }: { onLinked: () => void }) {
  const { profile } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Company | null>(null);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<'select' | 'create'>('select');
  const [form, setForm] = useState({ name: profile?.display_name ?? '', email: profile?.email ?? '', industry: 'Bebidas', description: '' });
  const [error, setError] = useState('');

  useEffect(() => {
    supabase.from('companies')
      .select('*')
      .or(`is_approved.eq.true,created_by.eq.${profile?.id}`)
      .order('name')
      .then(({ data }) => setCompanies((data ?? []) as Company[]));
  }, [profile?.id]);

  const filtered = companies.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) || c.email.toLowerCase().includes(search.toLowerCase())
  );

  async function linkToExisting() {
    if (!selected || !profile) return;
    setSaving(true);
    setError('');

    if (!selected.is_approved && selected.created_by !== profile.id) {
      setError('Solo puedes vincularte a empresas aprobadas por el administrador.');
      setSaving(false);
      return;
    }

    const { error: updateError } = await supabase.from('profiles').update({ company_id: selected.id }).eq('id', profile.id);
    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }
    setSaving(false);
    onLinked();
  }

  async function createAndLink() {
    if (!form.name.trim() || !form.email.trim() || !profile) return;
    setSaving(true);
    setError('');
    const { data, error: e } = await supabase.from('companies')
      .insert({ name: form.name, email: form.email, industry: form.industry, description: form.description || null, created_by: profile.id, is_approved: false })
      .select().maybeSingle();
    if (e) { setError(e.message); setSaving(false); return; }
    if (data) {
      await supabase.from('profiles').update({ company_id: data.id }).eq('id', profile.id);
    }
    setSaving(false);
    onLinked();
  }

  return (
    <div className="flex items-center justify-center min-h-full p-6">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center mx-auto mb-4">
            <Building2 className="w-7 h-7 text-blue-400" />
          </div>
          <h2 className="text-2xl font-bold text-white">Configura tu empresa</h2>
          <p className="text-slate-400 text-sm mt-1">Vincula tu cuenta a una empresa para ver tus métricas</p>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="flex border-b border-slate-800">
            <button
              onClick={() => setTab('select')}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${tab === 'select' ? 'text-white border-b-2 border-emerald-500 bg-slate-800/30' : 'text-slate-400 hover:text-white'}`}
            >
              Empresa existente
            </button>
            <button
              onClick={() => setTab('create')}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${tab === 'create' ? 'text-white border-b-2 border-emerald-500 bg-slate-800/30' : 'text-slate-400 hover:text-white'}`}
            >
              Crear nueva empresa
            </button>
          </div>

          <div className="p-5">
            {tab === 'select' ? (
              <div className="space-y-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Buscar empresa..."
                    className="w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-500 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                  />
                </div>
                <div className="space-y-2 max-h-56 overflow-y-auto">
                  {filtered.map(c => (
                    <button
                      key={c.id}
                      onClick={() => setSelected(c)}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                        selected?.id === c.id
                          ? 'border-emerald-500/60 bg-emerald-500/10'
                          : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
                      }`}
                    >
                      <div className="w-8 h-8 rounded-lg bg-teal-500/15 border border-teal-500/20 flex items-center justify-center shrink-0">
                        <Building2 className="w-4 h-4 text-teal-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium">
                          {c.name}
                          {!c.is_approved && (
                            <span className="ml-2 text-xs text-amber-400 font-normal">(pendiente)</span>
                          )}
                        </p>
                        <p className="text-slate-500 text-xs">{c.industry}</p>
                      </div>
                      {selected?.id === c.id && <Check className="w-4 h-4 text-emerald-400" />}
                    </button>
                  ))}
                  {filtered.length === 0 && (
                    <p className="text-slate-500 text-sm text-center py-4">No se encontraron empresas aprobadas</p>
                  )}
                </div>
                {error && (
                  <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl px-4 py-3 text-sm">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {error}
                  </div>
                )}
                <button
                  onClick={linkToExisting}
                  disabled={!selected || saving}
                  className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {saving ? 'Vinculando...' : 'Vincular a esta empresa'}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {error && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2">{error}</p>}
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="block text-xs text-slate-400 mb-1.5">Nombre de la empresa *</label>
                    <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ej: Postobón S.A." className="w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-500 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-slate-400 mb-1.5">Correo *</label>
                    <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="empresa@ejemplo.com" className="w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-500 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">Industria</label>
                    <select value={form.industry} onChange={e => setForm(f => ({ ...f, industry: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500 appearance-none transition-colors">
                      {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">Descripción</label>
                    <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Breve descripción" className="w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-500 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors" />
                  </div>
                </div>
                <button
                  onClick={createAndLink}
                  disabled={!form.name.trim() || !form.email.trim() || saving}
                  className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  {saving ? 'Creando empresa...' : 'Crear empresa'}
                </button>
                <p className="text-slate-500 text-xs text-center">
                  La empresa será creada pero necesitara aprobación del administrador para acceder al dashboard.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function KPICard({ icon, label, value, sub, trend, color }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  trend?: number;
  color: string
}) {
  const bg: Record<string, string> = {
    emerald: 'bg-emerald-500/10 border-emerald-500/20',
    blue: 'bg-blue-500/10 border-blue-500/20',
    amber: 'bg-amber-500/10 border-amber-500/20',
    teal: 'bg-teal-500/10 border-teal-500/20',
  };

  return (
    <div className={`${bg[color]} border rounded-2xl p-5`}>
      <div className="flex items-start justify-between">
        <div className="mb-3">{icon}</div>
        {trend !== undefined && (
          <div className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${
            trend >= 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
          }`}>
            {trend >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {Math.abs(trend)}%
          </div>
        )}
      </div>
      <p className="text-slate-400 text-xs mb-0.5">{label}</p>
      <p className="text-white text-2xl font-bold">{value}</p>
      <p className="text-slate-500 text-xs mt-0.5">{sub}</p>
    </div>
  );
}

function ChartCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
      <h3 className="text-white font-semibold text-sm flex items-center gap-2 mb-4">{icon}{title}</h3>
      {children}
    </div>
  );
}

function EmptyChart() {
  return <div className="flex items-center justify-center h-40 text-slate-500 text-sm">Sin datos suficientes</div>;
}
