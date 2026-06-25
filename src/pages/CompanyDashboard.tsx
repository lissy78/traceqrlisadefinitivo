import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { supabase, ScanEvent, Company } from '../lib/supabase';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, CartesianGrid } from 'recharts';
import {
  Package, TrendingUp, Recycle, BarChart2, MapPin,
  Activity, ShoppingBag, Calendar, Building2, Search,
  Check, Loader2, Plus, Shield, AlertTriangle
} from 'lucide-react';

const COLORS = ['#10b981', '#14b8a6', '#06b6d4', '#3b82f6', '#8b5cf6', '#f59e0b'];
const INDUSTRIES = ['Bebidas', 'Alimentos', 'Farmacéutica', 'Cosméticos', 'Limpieza', 'Otro'];

export default function CompanyDashboard() {
  const { profile, refreshProfile } = useAuth();
  const [company, setCompany] = useState<Company | null>(null);
  const [scans, setScans] = useState<ScanEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (profile?.company_id) {
      loadData();
    } else {
      setLoading(false);
    }
  }, [profile]);

  async function loadData() {
    if (!profile?.company_id) return;
    const [{ data: co }, { data: sc }] = await Promise.all([
      supabase.from('companies').select('*').eq('id', profile.company_id).maybeSingle(),
      supabase.from('scan_events').select('*, product:product_catalog(name, brand, image_url, material)').eq('company_id', profile.company_id).order('created_at', { ascending: false }),
    ]);
    const companyData = co as Company;
    setCompany(companyData);
    setScans((sc ?? []) as ScanEvent[]);
    setLoading(false);
  }

  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const label = d.toLocaleDateString('es-CO', { weekday: 'short' });
    const count = scans.filter(s => new Date(s.created_at).toDateString() === d.toDateString()).length;
    return { day: label, escaneos: count };
  });

  const sourceMap: Record<string, number> = {};
  scans.forEach(s => {
    const src = s.acquisition_source ?? 'Desconocido';
    sourceMap[src] = (sourceMap[src] ?? 0) + 1;
  });
  const sourceData = Object.entries(sourceMap).map(([name, value]) => ({ name, value }));

  const monthlyMap: Record<string, number> = {};
  scans.forEach(s => {
    const key = new Date(s.created_at).toLocaleDateString('es-CO', { month: 'short', year: '2-digit' });
    monthlyMap[key] = (monthlyMap[key] ?? 0) + 1;
  });
  const monthlyData = Object.entries(monthlyMap).slice(-6).map(([month, count]) => ({ month, count }));

  const uniqueUsers = new Set(scans.map(s => s.user_id)).size;

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
                <span> Los datos de tus productos siguen siendo rastreados</span>
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">{company?.name ?? 'Mi empresa'}</h1>
          <p className="text-slate-400 text-sm mt-1 flex items-center gap-1">
            <Activity className="w-3 h-3" /> Dashboard de trazabilidad
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
          <span className="text-slate-400 text-xs">En vivo</span>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard icon={<Recycle className="w-5 h-5 text-emerald-400" />} label="Total reciclados" value={scans.length.toString()} sub="envases rastreados" color="emerald" />
        <KPICard icon={<TrendingUp className="w-5 h-5 text-blue-400" />} label="Esta semana" value={last7Days.reduce((s, d) => s + d.escaneos, 0).toString()} sub="últimos 7 días" color="blue" />
        <KPICard icon={<ShoppingBag className="w-5 h-5 text-amber-400" />} label="Usuarios únicos" value={uniqueUsers.toString()} sub="recicladores" color="amber" />
        <KPICard icon={<Package className="w-5 h-5 text-teal-400" />} label="Fuentes distintas" value={Object.keys(sourceMap).length.toString()} sub="puntos de adquisición" color="teal" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <ChartCard title="Escaneos últimos 7 días" icon={<BarChart2 className="w-4 h-4 text-emerald-400" />}>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={last7Days} barSize={28}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="day" stroke="#64748b" tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <YAxis stroke="#64748b" tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, color: '#fff' }} />
              <Bar dataKey="escaneos" fill="#10b981" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Fuentes de adquisición" icon={<MapPin className="w-4 h-4 text-amber-400" />}>
          {sourceData.length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="50%" height={180}>
                <PieChart>
                  <Pie data={sourceData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value" paddingAngle={3}>
                    {sourceData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, color: '#fff' }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-2">
                {sourceData.slice(0, 5).map((d, i) => (
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

      <ChartCard title="Tendencia mensual" icon={<TrendingUp className="w-4 h-4 text-blue-400" />}>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={monthlyData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="month" stroke="#64748b" tick={{ fill: '#94a3b8', fontSize: 12 }} />
            <YAxis stroke="#64748b" tick={{ fill: '#94a3b8', fontSize: 12 }} />
            <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, color: '#fff' }} />
            <Line type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={2} dot={{ fill: '#3b82f6', r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h2 className="text-white font-semibold flex items-center gap-2">
            <Calendar className="w-4 h-4 text-slate-400" /> Últimas trazabilidades
          </h2>
          <span className="text-slate-500 text-xs">{scans.length} registros</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Producto / Código</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Marca</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Fuente</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Material</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Token (SHA-256)</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Fecha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {scans.slice(0, 15).map(scan => (
                <tr key={scan.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      {(scan as any).product?.image_url ? (
                        <img src={(scan as any).product.image_url} alt="" className="w-7 h-7 rounded-lg object-cover bg-slate-800" />
                      ) : <div className="w-7 h-7 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center"><Package className="w-3 h-3 text-slate-500" /></div>}
                      <div>
                        <p className="text-white text-xs font-medium">{(scan as any).product?.name ?? 'Desconocido'}</p>
                        <span className="font-mono text-xs text-slate-500">{scan.barcode}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    {(() => { const brand = (scan as any).product?.brand ?? (scan.scan_data as any)?.brand_name; return brand ? <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-300 border border-blue-500/20">{brand}</span> : <span className="text-slate-600 text-xs">-</span>; })()}
                  </td>
                  <td className="px-5 py-3"><span className="text-slate-300 text-xs">{scan.acquisition_source ?? '-'}</span></td>
                  <td className="px-5 py-3">
                    {(() => { const mat = (scan as any).product?.material ?? (scan.scan_data as any)?.material_type?.split(' ')[0]; return <span className={`text-xs px-1.5 py-0.5 rounded ${mat === 'PET' ? 'bg-emerald-500/10 text-emerald-400' : mat === 'Vidrio' ? 'bg-blue-500/10 text-blue-400' : mat === 'Aluminio' ? 'bg-amber-500/10 text-amber-400' : 'text-slate-500'}`}>{mat ?? '-'}</span>; })()}
                  </td>
                  <td className="px-5 py-3"><span className="font-mono text-xs text-slate-500 truncate max-w-24 block">{scan.token_hash?.slice(0, 16)}...</span></td>
                  <td className="px-5 py-3">
                    <span className="text-slate-400 text-xs">
                      {new Date(scan.created_at).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: '2-digit' })}
                    </span>
                  </td>
                </tr>
              ))}
              {scans.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-10 text-center text-slate-500 text-sm">
                    <Recycle className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No hay datos de trazabilidad aún. Los escaneos de tus productos aparecerán aquí.
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
    supabase.from('companies').select('*').order('name').then(({ data }) => setCompanies((data ?? []) as Company[]));
  }, []);

  const filtered = companies.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) || c.email.toLowerCase().includes(search.toLowerCase())
  );

  async function linkToExisting() {
    if (!selected || !profile) return;
    setSaving(true);
    await supabase.from('profiles').update({ company_id: selected.id }).eq('id', profile.id);
    setSaving(false);
    onLinked();
  }

  async function createAndLink() {
    if (!form.name.trim() || !form.email.trim() || !profile) return;
    setSaving(true);
    setError('');
    const { data, error: e } = await supabase.from('companies')
      .insert({ name: form.name, email: form.email, industry: form.industry, description: form.description || null, created_by: profile.id })
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
          {/* Tabs */}
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
                        <p className="text-white text-sm font-medium">{c.name}</p>
                        <p className="text-slate-500 text-xs">{c.industry}</p>
                      </div>
                      {selected?.id === c.id && <Check className="w-4 h-4 text-emerald-400" />}
                    </button>
                  ))}
                  {filtered.length === 0 && (
                    <p className="text-slate-500 text-sm text-center py-4">No se encontraron empresas</p>
                  )}
                </div>
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
                  {saving ? 'Creando empresa...' : 'Crear y vincular empresa'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function KPICard({ icon, label, value, sub, color }: { icon: React.ReactNode; label: string; value: string; sub: string; color: string }) {
  const bg: Record<string, string> = {
    emerald: 'bg-emerald-500/10 border-emerald-500/20',
    blue: 'bg-blue-500/10 border-blue-500/20',
    amber: 'bg-amber-500/10 border-amber-500/20',
    teal: 'bg-teal-500/10 border-teal-500/20',
  };
  return (
    <div className={`${bg[color]} border rounded-2xl p-5`}>
      <div className="mb-3">{icon}</div>
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
