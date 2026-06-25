import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { supabase, ScanEvent, Redemption } from '../lib/supabase';
import { timeAgo, formatPoints, getDisplayName } from '../lib/utils';
import {
  QrCode, Star, Recycle, Trophy, TrendingUp, Award,
  ChevronRight, Package, Clock, Gift
} from 'lucide-react';

interface Props {
  onNavigate: (v: string) => void;
}

export default function StudentDashboard({ onNavigate }: Props) {
  const { profile, refreshProfile } = useAuth();
  const [scans, setScans] = useState<ScanEvent[]>([]);
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const [rank, setRank] = useState<number | null>(null);
  const [canRedeem, setCanRedeem] = useState(false);
  const [redeeming, setRedeeming] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile) return;
    loadData();
  }, [profile]);

  async function loadData() {
    if (!profile) return;
    setLoading(true);
    const [{ data: scanData }, { data: redeemData }, { data: rankData }] = await Promise.all([
      supabase.from('scan_events').select('*').eq('user_id', profile.id).order('created_at', { ascending: false }).limit(10),
      supabase.from('redemptions').select('*').eq('user_id', profile.id).order('redeemed_at', { ascending: false }).limit(5),
      supabase.from('profiles').select('id, total_points').order('total_points', { ascending: false }),
    ]);
    setScans((scanData ?? []) as ScanEvent[]);
    setRedemptions((redeemData ?? []) as Redemption[]);

    if (rankData) {
      const idx = rankData.findIndex(p => p.id === profile.id);
      setRank(idx >= 0 ? idx + 1 : null);
    }

    // Check daily redemption
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { data: todayRedeem } = await supabase
      .from('redemptions')
      .select('id')
      .eq('user_id', profile.id)
      .gte('redeemed_at', today.toISOString())
      .maybeSingle();

    setCanRedeem(!todayRedeem && (profile.total_points ?? 0) >= 50);
    setLoading(false);
  }

  async function handleRedeem() {
    if (!profile || !canRedeem) return;
    setRedeeming(true);
    const { error } = await supabase.from('redemptions').insert({
      user_id: profile.id,
      points_used: 50,
      reward_type: 'refrigerio',
    });
    if (!error) {
      await supabase.from('profiles').update({ total_points: (profile.total_points ?? 0) - 50 }).eq('id', profile.id);
      await refreshProfile();
      setCanRedeem(false);
    }
    setRedeeming(false);
  }

  const totalScans = scans.length;
  const thisWeekScans = scans.filter(s => {
    const d = new Date(s.created_at);
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return d >= weekAgo;
  }).length;

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">
          Hola, {getDisplayName(profile?.display_name, profile?.email).split(' ')[0]} 👋
        </h1>
        <p className="text-slate-400 text-sm mt-1">Sigue reciclando y gana puntos canjeables</p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Star className="w-5 h-5 text-amber-400" />}
          label="Mis puntos"
          value={formatPoints(profile?.total_points ?? 0)}
          color="amber"
        />
        <StatCard
          icon={<Recycle className="w-5 h-5 text-emerald-400" />}
          label="Total reciclados"
          value={totalScans.toString()}
          color="emerald"
        />
        <StatCard
          icon={<TrendingUp className="w-5 h-5 text-blue-400" />}
          label="Esta semana"
          value={thisWeekScans.toString()}
          color="blue"
        />
        <StatCard
          icon={<Trophy className="w-5 h-5 text-violet-400" />}
          label="Mi posición"
          value={rank ? `#${rank}` : '-'}
          color="violet"
        />
      </div>

      {/* Actions */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Scan CTA */}
        <button
          onClick={() => onNavigate('scanner')}
          className="group bg-gradient-to-br from-emerald-600 to-teal-700 hover:from-emerald-500 hover:to-teal-600 rounded-2xl p-6 text-left transition-all shadow-lg shadow-emerald-900/30 hover:shadow-emerald-900/50 hover:-translate-y-0.5"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
              <QrCode className="w-6 h-6 text-white" />
            </div>
            <ChevronRight className="w-5 h-5 text-white/60 group-hover:text-white group-hover:translate-x-1 transition-all" />
          </div>
          <h3 className="text-white font-bold text-lg">Escanear ahora</h3>
          <p className="text-emerald-200 text-sm mt-1">Escanea QR o código de barras y gana 10 pts</p>
        </button>

        {/* Redeem CTA */}
        <button
          onClick={handleRedeem}
          disabled={!canRedeem || redeeming}
          className={`group rounded-2xl p-6 text-left transition-all shadow-lg ${
            canRedeem
              ? 'bg-gradient-to-br from-amber-600 to-orange-700 hover:from-amber-500 hover:to-orange-600 hover:-translate-y-0.5 shadow-amber-900/30'
              : 'bg-slate-800/60 border border-slate-700 cursor-not-allowed opacity-60'
          }`}
        >
          <div className="flex items-center justify-between mb-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${canRedeem ? 'bg-white/20' : 'bg-slate-700'}`}>
              <Gift className={`w-6 h-6 ${canRedeem ? 'text-white' : 'text-slate-500'}`} />
            </div>
            {canRedeem && <ChevronRight className="w-5 h-5 text-white/60 group-hover:text-white group-hover:translate-x-1 transition-all" />}
          </div>
          <h3 className={`font-bold text-lg ${canRedeem ? 'text-white' : 'text-slate-400'}`}>
            {redeeming ? 'Canjeando...' : 'Canjear refrigerio'}
          </h3>
          <p className={`text-sm mt-1 ${canRedeem ? 'text-amber-200' : 'text-slate-500'}`}>
            {canRedeem
              ? '50 pts · 1 refrigerio por día disponible'
              : (profile?.total_points ?? 0) < 50
              ? `Necesitas ${50 - (profile?.total_points ?? 0)} pts más`
              : 'Ya canjeaste hoy. Vuelve mañana'}
          </p>
        </button>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Recent scans */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-semibold flex items-center gap-2">
              <Package className="w-4 h-4 text-emerald-400" />
              Últimos escaneos
            </h2>
            <button onClick={() => onNavigate('scanner')} className="text-emerald-400 text-xs hover:text-emerald-300 transition-colors">
              Ver todo
            </button>
          </div>
          {scans.length === 0 ? (
            <EmptyState icon={<QrCode className="w-8 h-8 text-slate-600" />} text="Aún no has escaneado nada" />
          ) : (
            <div className="space-y-2">
              {scans.slice(0, 5).map(scan => (
                <div key={scan.id} className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-xl">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center">
                    <QrCode className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{scan.barcode}</p>
                    <p className="text-slate-500 text-xs">{timeAgo(scan.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-1 text-amber-400 text-xs font-semibold">
                    <Star className="w-3 h-3" />
                    +{scan.points_earned}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent redemptions */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-semibold flex items-center gap-2">
              <Award className="w-4 h-4 text-amber-400" />
              Mis canjes
            </h2>
          </div>
          {redemptions.length === 0 ? (
            <EmptyState icon={<Gift className="w-8 h-8 text-slate-600" />} text="Aún no has canjeado nada" />
          ) : (
            <div className="space-y-2">
              {redemptions.map(r => (
                <div key={r.id} className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-xl">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/20 flex items-center justify-center">
                    <Gift className="w-4 h-4 text-amber-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium capitalize">{r.reward_type}</p>
                    <p className="text-slate-500 text-xs flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {timeAgo(r.redeemed_at)}
                    </p>
                  </div>
                  <span className="text-red-400 text-xs font-semibold">-{r.points_used} pts</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, color }: { icon: ReactNode; label: string; value: string; color: string }) {
  const bg: Record<string, string> = {
    amber: 'bg-amber-500/10 border-amber-500/20',
    emerald: 'bg-emerald-500/10 border-emerald-500/20',
    blue: 'bg-blue-500/10 border-blue-500/20',
    violet: 'bg-violet-500/10 border-violet-500/20',
  };
  return (
    <div className={`${bg[color]} border rounded-2xl p-4`}>
      <div className="mb-2">{icon}</div>
      <p className="text-slate-400 text-xs mb-1">{label}</p>
      <p className="text-white text-2xl font-bold">{value}</p>
    </div>
  );
}

function EmptyState({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 gap-2">
      {icon}
      <p className="text-slate-500 text-sm">{text}</p>
    </div>
  );
}
