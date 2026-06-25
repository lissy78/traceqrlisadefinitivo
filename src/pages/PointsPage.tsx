import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { supabase, Redemption, ScanEvent } from '../lib/supabase';
import { formatPoints, timeAgo } from '../lib/utils';
import { Star, Gift, Recycle, Lock, CheckCircle2, AlertCircle, TrendingUp, Award, AlertTriangle } from 'lucide-react';

export default function PointsPage() {
  const { profile, refreshProfile } = useAuth();
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const [scans, setScans] = useState<ScanEvent[]>([]);
  const [canRedeem, setCanRedeem] = useState(false);
  const [redeeming, setRedeeming] = useState(false);
  const [redeemMsg, setRedeemMsg] = useState('');
  const [stockRemaining, setStockRemaining] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile) return;
    loadData();
  }, [profile]);

  async function loadData() {
    if (!profile) return;
    const [{ data: rd }, { data: sd }, { data: stockData }] = await Promise.all([
      supabase.from('redemptions').select('*').eq('user_id', profile.id).order('redeemed_at', { ascending: false }),
      supabase.from('scan_events').select('*').eq('user_id', profile.id).order('created_at', { ascending: false }),
      supabase.from('reward_stock').select('remaining_stock, is_active').eq('reward_type', 'refrigerio').is('company_id', null).maybeSingle(),
    ]);
    setRedemptions((rd ?? []) as Redemption[]);
    setScans((sd ?? []) as ScanEvent[]);

    const stockLeft = stockData ? (stockData as { remaining_stock: number; is_active: boolean }) : null;
    const stockOk = !stockLeft || (stockLeft.is_active && stockLeft.remaining_stock > 0);
    setStockRemaining(stockLeft?.remaining_stock ?? null);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { data: todayRedeem } = await supabase
      .from('redemptions')
      .select('id')
      .eq('user_id', profile.id)
      .gte('redeemed_at', today.toISOString())
      .maybeSingle();

    setCanRedeem(!todayRedeem && (profile.total_points ?? 0) >= 50 && stockOk);
    setLoading(false);
  }

  async function handleRedeem() {
    if (!profile || !canRedeem) return;
    setRedeeming(true);

    // Check and decrement stock atomically
    const { data: stockRow } = await supabase
      .from('reward_stock')
      .select('id, remaining_stock')
      .eq('reward_type', 'refrigerio')
      .is('company_id', null)
      .gt('remaining_stock', 0)
      .eq('is_active', true)
      .maybeSingle();

    // If stock table exists and has no remaining, block
    const { count: stockTableCount } = await supabase.from('reward_stock').select('*', { count: 'exact', head: true });
    if (stockTableCount !== null && stockTableCount > 0 && !stockRow) {
      setRedeemMsg('Sin stock disponible. El cupo de refrigerios se ha agotado.');
      setRedeeming(false);
      return;
    }

    const { error } = await supabase.from('redemptions').insert({
      user_id: profile.id,
      points_used: 50,
      reward_type: 'refrigerio',
      stock_id: stockRow?.id ?? null,
    });

    if (!error) {
      // Decrement stock if table exists
      if (stockRow) {
        await supabase.from('reward_stock')
          .update({ remaining_stock: stockRow.remaining_stock - 1 })
          .eq('id', stockRow.id);
      }
      await supabase.from('profiles').update({ total_points: (profile.total_points ?? 0) - 50 }).eq('id', profile.id);
      await refreshProfile();
      await loadData();
      setRedeemMsg('Refrigerio canjeado exitosamente. Preséntate en la cafetería.');
    }
    setRedeeming(false);
  }

  const totalEarned = scans.reduce((sum, s) => sum + (s.points_earned ?? 0), 0);
  const totalSpent = redemptions.reduce((sum, r) => sum + (r.points_used ?? 0), 0);
  const pointsToNext = 50 - ((profile?.total_points ?? 0) % 50);
  const progress = ((profile?.total_points ?? 0) % 50) / 50;

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Star className="w-6 h-6 text-amber-400" />
          Mis puntos
        </h1>
        <p className="text-slate-400 text-sm mt-1">Acumula y canjea puntos por refrigerios</p>
      </div>

      {/* Balance card */}
      <div className="bg-gradient-to-br from-amber-600/20 to-orange-700/20 border border-amber-500/30 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-amber-300 text-sm font-medium">Balance actual</p>
            <p className="text-white text-4xl font-bold mt-1">{formatPoints(profile?.total_points ?? 0)}</p>
            <p className="text-amber-300/60 text-sm">puntos</p>
          </div>
          <div className="w-16 h-16 rounded-2xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
            <Award className="w-8 h-8 text-amber-400" />
          </div>
        </div>
        {/* Progress to next reward */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-slate-400">
            <span>Progreso al siguiente canje</span>
            <span>{pointsToNext === 50 ? 'Listo para canjear!' : `${pointsToNext} pts más`}</span>
          </div>
          <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-amber-500 to-orange-400 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, progress * 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 text-center">
          <TrendingUp className="w-5 h-5 text-emerald-400 mx-auto mb-2" />
          <p className="text-white text-xl font-bold">{formatPoints(totalEarned)}</p>
          <p className="text-slate-500 text-xs">Ganados</p>
        </div>
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 text-center">
          <Gift className="w-5 h-5 text-amber-400 mx-auto mb-2" />
          <p className="text-white text-xl font-bold">{formatPoints(totalSpent)}</p>
          <p className="text-slate-500 text-xs">Canjeados</p>
        </div>
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 text-center">
          <Recycle className="w-5 h-5 text-blue-400 mx-auto mb-2" />
          <p className="text-white text-xl font-bold">{scans.length}</p>
          <p className="text-slate-500 text-xs">Escaneos</p>
        </div>
      </div>

      {/* Redeem section */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
        <h2 className="text-white font-semibold mb-4">Canjear refrigerio</h2>
        {redeemMsg && (
          <div className="flex items-center gap-2 bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 rounded-xl px-4 py-3 mb-4 text-sm">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {redeemMsg}
          </div>
        )}
        <div className="flex items-center gap-4 p-4 bg-slate-800/60 rounded-xl mb-4">
          <div className="w-12 h-12 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
            <Gift className="w-6 h-6 text-amber-400" />
          </div>
          <div className="flex-1">
            <p className="text-white font-medium">Refrigerio del día</p>
            <p className="text-slate-400 text-sm">50 puntos · 1 por día</p>
          </div>
          <div className="text-right">
            <p className="text-amber-300 font-bold text-lg">50 pts</p>
          </div>
        </div>
        {!canRedeem && (
          <div className="flex items-center gap-2 bg-slate-800 rounded-xl px-4 py-3 mb-4 text-sm text-slate-400">
            <Lock className="w-4 h-4" />
            {stockRemaining !== null && stockRemaining === 0
              ? 'Sin stock disponible. El cupo de refrigerios se ha agotado temporalmente.'
              : (profile?.total_points ?? 0) < 50
              ? `Necesitas ${50 - (profile?.total_points ?? 0)} puntos más`
              : 'Ya canjeaste tu refrigerio hoy. Vuelve mañana.'}
          </div>
        )}
        {stockRemaining !== null && stockRemaining > 0 && stockRemaining < 20 && (
          <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3 mb-4 text-sm text-amber-400">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Quedan solo {stockRemaining} refrigerios disponibles
          </div>
        )}
        <button
          onClick={handleRedeem}
          disabled={!canRedeem || redeeming}
          className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors"
        >
          {redeeming ? 'Canjeando...' : 'Canjear ahora'}
        </button>
      </div>

      {/* History */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
        <h2 className="text-white font-semibold mb-4">Historial de canjes</h2>
        {redemptions.length === 0 ? (
          <div className="text-center py-8 text-slate-500">
            <Gift className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">Aún no has canjeado puntos</p>
          </div>
        ) : (
          <div className="space-y-2">
            {redemptions.map(r => (
              <div key={r.id} className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-xl">
                <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/20 flex items-center justify-center">
                  <Gift className="w-4 h-4 text-amber-400" />
                </div>
                <div className="flex-1">
                  <p className="text-white text-sm font-medium capitalize">{r.reward_type}</p>
                  <p className="text-slate-500 text-xs">{timeAgo(r.redeemed_at)}</p>
                </div>
                <span className="text-red-400 text-sm font-semibold">-{r.points_used} pts</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
