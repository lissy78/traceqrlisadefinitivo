import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line } from 'recharts';
import {
  Users, Building2, Package, Recycle, TrendingUp, Activity,
  BarChart2, ShieldCheck, Star
} from 'lucide-react';

interface Stats {
  totalUsers: number;
  totalCompanies: number;
  totalScans: number;
  totalProducts: number;
  totalPoints: number;
  todayScans: number;
}

const SEED_LOCATIONS = [
  { name: 'Punto Verde Parque El Virrey', address: 'Carrera 15 con Calle 88, Bogotá', lat: 4.6733, lng: -74.0479, location_type: 'punto_verde', city: 'Bogotá', schedule: 'Lun-Dom 7am-7pm', phone: '+57 1 3680000' },
  { name: 'Punto Verde Parque 93', address: 'Calle 93A con Carrera 11A, Bogotá', lat: 4.6762, lng: -74.0478, location_type: 'punto_verde', city: 'Bogotá', schedule: 'Lun-Dom 8am-6pm', phone: '+57 1 3680000' },
  { name: 'Ecoparque Tunal', address: 'Carrera 20 con Calle 48 Sur, Bogotá', lat: 4.5766, lng: -74.1268, location_type: 'ecoparque', city: 'Bogotá', schedule: 'Mar-Dom 9am-5pm', phone: '+57 1 3638000' },
  { name: 'Punto Verde 7-Eleven Chapinero', address: 'Calle 67 con Carrera 7, Bogotá', lat: 4.6540, lng: -74.0615, location_type: 'supermercado', city: 'Bogotá', schedule: 'Lun-Sab 8am-8pm', phone: null },
  { name: 'Centro de Reciclaje La Alquería', address: 'Carrera 53 No. 2-30 Sur, Bogotá', lat: 4.5908, lng: -74.1202, location_type: 'ecoparque', city: 'Bogotá', schedule: 'Lun-Vie 7am-4pm', phone: '+57 1 7472929' },
  { name: 'Punto Verde Plaza de Bolívar', address: 'Cra. 8 #10-66, Bogotá', lat: 4.5981, lng: -74.0760, location_type: 'punto_verde', city: 'Bogotá', schedule: 'Lun-Dom 6am-8pm', phone: null },
  { name: 'Punto Verde Parque Laureles', address: 'Carrera 80 con Calle 34, Medellín', lat: 6.2451, lng: -75.5985, location_type: 'punto_verde', city: 'Medellín', schedule: 'Lun-Dom 7am-7pm', phone: '+57 4 3856000' },
  { name: 'Ecoparque Cerro El Volador', address: 'Carrera 80 Barrio Robledo, Medellín', lat: 6.2697, lng: -75.5978, location_type: 'ecoparque', city: 'Medellín', schedule: 'Mar-Dom 8am-5pm', phone: null },
  { name: 'Punto Verde El Poblado', address: 'Calle 10 con Carrera 43, Medellín', lat: 6.2073, lng: -75.5681, location_type: 'punto_verde', city: 'Medellín', schedule: 'Lun-Sab 8am-6pm', phone: null },
  { name: 'Centro Reciclaje Manrique', address: 'Calle 75 No. 47-50, Medellín', lat: 6.2718, lng: -75.5558, location_type: 'ecoparque', city: 'Medellín', schedule: 'Lun-Vie 7am-4pm', phone: '+57 4 3856000' },
  { name: 'Punto Verde Parque de la Salud', address: 'Carrera 38 con Calle 5, Cali', lat: 3.4372, lng: -76.5305, location_type: 'punto_verde', city: 'Cali', schedule: 'Lun-Dom 7am-7pm', phone: '+57 2 8853000' },
  { name: 'Ecoparque Los Chorros', address: 'Via al Mar Km 18, Cali', lat: 3.4985, lng: -76.6201, location_type: 'ecoparque', city: 'Cali', schedule: 'Sab-Dom 9am-4pm', phone: null },
  { name: 'Punto Verde Unicentro Cali', address: 'Avenida Roosevelt con Calle 9, Cali', lat: 3.4523, lng: -76.5285, location_type: 'supermercado', city: 'Cali', schedule: 'Lun-Dom 9am-9pm', phone: null },
  { name: 'Punto Verde Plaza Mayor', address: 'Calle 19 con Carrera 5, Bogotá', lat: 4.6013, lng: -74.0710, location_type: 'punto_verde', city: 'Bogotá', schedule: 'Lun-Dom 6am-8pm', phone: null },
  { name: 'Punto Verde Parque Nacional', address: 'Calle 37 con Carrera 7, Bogotá', lat: 4.6360, lng: -74.0664, location_type: 'punto_verde', city: 'Bogotá', schedule: 'Lun-Dom 6am-8pm', phone: null },
];

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats>({ totalUsers: 0, totalCompanies: 0, totalScans: 0, totalProducts: 0, totalPoints: 0, todayScans: 0 });
  const [daily, setDaily] = useState<{ day: string; scans: number }[]>([]);
  const [topUsers, setTopUsers] = useState<{ display_name: string | null; email: string; total_points: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
    seedLocationsIfEmpty();
  }, []);

  async function seedLocationsIfEmpty() {
    const { count } = await supabase.from('recycling_locations').select('*', { count: 'exact', head: true });
    if (count === 0) {
      await supabase.from('recycling_locations').insert(SEED_LOCATIONS);
    }
  }

  async function loadData() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      { count: usersCount },
      { count: companiesCount },
      { count: scansCount },
      { count: productsCount },
      { data: pointsData },
      { count: todayCount },
      { data: allScans },
      { data: topUsersData },
    ] = await Promise.all([
      supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'student'),
      supabase.from('companies').select('*', { count: 'exact', head: true }),
      supabase.from('scan_events').select('*', { count: 'exact', head: true }),
      supabase.from('product_catalog').select('*', { count: 'exact', head: true }),
      supabase.from('profiles').select('total_points').eq('role', 'student'),
      supabase.from('scan_events').select('*', { count: 'exact', head: true }).gte('created_at', today.toISOString()),
      supabase.from('scan_events').select('created_at').order('created_at', { ascending: false }).limit(500),
      supabase.from('profiles').select('display_name, email, total_points').eq('role', 'student').order('total_points', { ascending: false }).limit(5),
    ]);

    const totalPoints = (pointsData ?? []).reduce((sum: number, p: { total_points: number }) => sum + (p.total_points ?? 0), 0);

    // Build last 7 days
    const last7 = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const label = d.toLocaleDateString('es-CO', { weekday: 'short' });
      const count = (allScans ?? []).filter((s: { created_at: string }) => new Date(s.created_at).toDateString() === d.toDateString()).length;
      return { day: label, scans: count };
    });

    setStats({ totalUsers: usersCount ?? 0, totalCompanies: companiesCount ?? 0, totalScans: scansCount ?? 0, totalProducts: productsCount ?? 0, totalPoints, todayScans: todayCount ?? 0 });
    setDaily(last7);
    setTopUsers(topUsersData ?? []);
    setLoading(false);
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-amber-400" />
            Panel de administración
          </h1>
          <p className="text-slate-400 text-sm mt-1">Vista global de la plataforma TraceQR</p>
        </div>
        <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2">
          <Activity className="w-4 h-4 text-amber-400 animate-pulse" />
          <span className="text-amber-300 text-xs font-medium">Admin activo</span>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <KPI icon={<Users className="w-5 h-5 text-blue-400" />} label="Usuarios totales" value={stats.totalUsers} color="blue" />
        <KPI icon={<Building2 className="w-5 h-5 text-teal-400" />} label="Empresas" value={stats.totalCompanies} color="teal" />
        <KPI icon={<Recycle className="w-5 h-5 text-emerald-400" />} label="Escaneos totales" value={stats.totalScans} color="emerald" />
        <KPI icon={<Package className="w-5 h-5 text-violet-400" />} label="Productos en catálogo" value={stats.totalProducts} color="violet" />
        <KPI icon={<Star className="w-5 h-5 text-amber-400" />} label="Puntos otorgados" value={stats.totalPoints} color="amber" />
        <KPI icon={<TrendingUp className="w-5 h-5 text-rose-400" />} label="Escaneos hoy" value={stats.todayScans} color="rose" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Daily scans chart */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
          <h3 className="text-white font-semibold text-sm flex items-center gap-2 mb-4">
            <BarChart2 className="w-4 h-4 text-emerald-400" />
            Escaneos últimos 7 días
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={daily} barSize={28}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="day" stroke="#64748b" tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <YAxis stroke="#64748b" tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, color: '#fff' }} />
              <Bar dataKey="scans" fill="#10b981" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Top users */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
          <h3 className="text-white font-semibold text-sm flex items-center gap-2 mb-4">
            <Star className="w-4 h-4 text-amber-400" />
            Top recicladores
          </h3>
          <div className="space-y-2">
            {topUsers.map((u, i) => (
              <div key={i} className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-xl">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                  i === 0 ? 'bg-amber-500/20 text-amber-400' :
                  i === 1 ? 'bg-slate-500/20 text-slate-300' :
                  i === 2 ? 'bg-orange-500/20 text-orange-400' :
                  'bg-slate-800 text-slate-500'
                }`}>{i + 1}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">{u.display_name ?? u.email.split('@')[0]}</p>
                  <p className="text-slate-500 text-xs truncate">{u.email}</p>
                </div>
                <div className="flex items-center gap-1">
                  <Star className="w-3 h-3 text-amber-400" />
                  <span className="text-amber-300 text-xs font-bold">{u.total_points?.toLocaleString('es-CO')}</span>
                </div>
              </div>
            ))}
            {topUsers.length === 0 && <p className="text-slate-500 text-sm text-center py-4">Sin datos aún</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

function KPI({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  const bg: Record<string, string> = {
    blue: 'bg-blue-500/10 border-blue-500/20',
    teal: 'bg-teal-500/10 border-teal-500/20',
    emerald: 'bg-emerald-500/10 border-emerald-500/20',
    violet: 'bg-violet-500/10 border-violet-500/20',
    amber: 'bg-amber-500/10 border-amber-500/20',
    rose: 'bg-rose-500/10 border-rose-500/20',
  };
  return (
    <div className={`${bg[color]} border rounded-2xl p-5`}>
      <div className="mb-3">{icon}</div>
      <p className="text-slate-400 text-xs mb-1">{label}</p>
      <p className="text-white text-2xl font-bold">{value.toLocaleString('es-CO')}</p>
    </div>
  );
}
