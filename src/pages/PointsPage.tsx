import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { supabase, Redemption, ScanEvent, Company } from '../lib/supabase';
import { formatPoints, timeAgo } from '../lib/utils';
import { Star, Gift, Recycle, Lock, CheckCircle2, AlertCircle, TrendingUp, Award, AlertTriangle, Building2, Coffee } from 'lucide-react';

interface BrandPoints {
  company_id: string | null;
  company_name: string | null;
  points: number;
  scans: number;
}

interface RewardOption {
  id: string;
  company_id: string | null;
  company_name: string | null;
  reward_type: string;
  remaining_stock: number;
  is_active: boolean;
  points_required: number;
  user_brand_points: number;
  canRedeem: boolean;
}

export default function PointsPage() {
  const { profile, refreshProfile } = useAuth();
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const [scans, setScans] = useState<ScanEvent[]>([]);
  const [brandPoints, setBrandPoints] = useState<BrandPoints[]>([]);
  const [rewardOptions, setRewardOptions] = useState<RewardOption[]>([]);
  const [selectedReward, setSelectedReward] = useState<RewardOption | null>(null);
  const [redeeming, setRedeeming] = useState(false);
  const [redeemMsg, setRedeemMsg] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile) return;
    loadData();
  }, [profile]);

  async function loadData() {
    if (!profile) return;

    const [{ data: rd }, { data: sd }, { data: stockData }] = await Promise.all([
      supabase.from('redemptions').select('*').eq('user_id', profile.id).order('redeemed_at', { ascending: false }),
      supabase.from('scan_events').select('*, companies(name)').eq('user_id', profile.id).order('created_at', { ascending: false }),
      supabase.from('reward_stock').select('*, companies(name)').eq('is_active', true).order('created_at'),
    ]);

    setRedemptions((rd ?? []) as Redemption[]);
    setScans((sd ?? []) as ScanEvent[]);

    // Calculate points by brand
    const brandTotals: Map<string | null, { points: number; scans: number; company_name: string | null }> = new Map();

    (sd ?? []).forEach(scan => {
      const cid = (scan as any).company_id;
      const cname = (scan as any).companies?.name ?? null;
      const existing = brandTotals.get(cid) ?? { points: 0, scans: 0, company_name: cname };
      existing.points += scan.points_earned ?? 10;
      existing.scans += 1;
      brandTotals.set(cid, existing);
    });

    const bpData: BrandPoints[] = [];
    brandTotals.forEach((v, k) => {
      bpData.push({ company_id: k, company_name: v.company_name, points: v.points, scans: v.scans });
    });
    setBrandPoints(bpData);

    // Build reward options
    const stockRows = (stockData ?? []) as Array<{
      id: string;
      company_id: string | null;
      remaining_stock: number;
      is_active: boolean;
      reward_type: string;
      companies?: { name: string } | null;
    }>;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { data: todayRedeem } = await supabase
      .from('redemptions')
      .select('id')
      .eq('user_id', profile.id)
      .gte('redeemed_at', today.toISOString())
      .maybeSingle();

    const canRedeemToday = !todayRedeem;

    const options: RewardOption[] = stockRows.map(stock => {
      const userBrandPoint = bpData.find(bp => bp.company_id === stock.company_id)?.points ?? 0;
      const pointsRequired = 50;

      return {
        id: stock.id,
        company_id: stock.company_id,
        company_name: stock.companies?.name ?? stock.company_id ? 'Empresa' : 'General',
        reward_type: stock.reward_type,
        remaining_stock: stock.remaining_stock,
        is_active: stock.is_active,
        points_required: pointsRequired,
        user_brand_points: stock.company_id ? userBrandPoint : (profile?.total_points ?? 0),
        canRedeem: canRedeemToday && stock.remaining_stock > 0 && (stock.company_id ? userBrandPoint >= pointsRequired : (profile?.total_points ?? 0) >= pointsRequired),
      };
    });

    // If no stock entries, create a default option
    if (options.length === 0) {
      options.push({
        id: 'default',
        company_id: null,
        company_name: 'General',
        reward_type: 'refrigerio',
        remaining_stock: 999,
        is_active: true,
        points_required: 50,
        user_brand_points: profile?.total_points ?? 0,
        canRedeem: canRedeemToday && (profile?.total_points ?? 0) >= 50,
      });
    }

    setRewardOptions(options);
    setLoading(false);
  }

  async function handleRedeem() {
    if (!profile || !selectedReward || !selectedReward.canRedeem) return;
    setRedeeming(true);

    // Check stock atomically if not default
    if (selectedReward.id !== 'default') {
      const { data: stockRow } = await supabase
        .from('reward_stock')
        .select('id, remaining_stock')
        .eq('id', selectedReward.id)
        .gt('remaining_stock', 0)
        .eq('is_active', true)
        .maybeSingle();

      if (!stockRow) {
        setRedeemMsg('Sin stock disponible. El cupo de refrigerios se ha agotado.');
        setRedeeming(false);
        return;
      }

      const { error } = await supabase.from('redemptions').insert({
        user_id: profile.id,
        points_used: 50,
        reward_type: selectedReward.company_name ? `${selectedReward.reward_type} - ${selectedReward.company_name}` : selectedReward.reward_type,
        company_id: selectedReward.company_id,
        stock_id: stockRow.id,
      });

      if (!error) {
        await supabase.from('reward_stock')
          .update({ remaining_stock: stockRow.remaining_stock - 1 })
          .eq('id', stockRow.id);
      }
    } else {
      await supabase.from('redemptions').insert({
        user_id: profile.id,
        points_used: 50,
        reward_type: 'refrigerio',
      });
    }

    await refreshProfile();
    await loadData();
    setRedeemMsg(`Refrigerio ${selectedReward.company_name ? `de ${selectedReward.company_name}` : ''} canjeado exitosamente!`);
    setSelectedReward(null);
    setRedeeming(false);
  }

  const totalEarned = scans.reduce((sum, s) => sum + (s.points_earned ?? 0), 0);
  const totalSpent = redemptions.reduce((sum, r) => sum + (r.points_used ?? 0), 0);

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
            <p className="text-amber-300 text-sm font-medium">Balance total</p>
            <p className="text-white text-4xl font-bold mt-1">{formatPoints(profile?.total_points ?? 0)}</p>
            <p className="text-amber-300/60 text-sm">puntos</p>
          </div>
          <div className="w-16 h-16 rounded-2xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
            <Award className="w-8 h-8 text-amber-400" />
          </div>
        </div>
      </div>

      {/* Points by brand */}
      {brandPoints.length > 1 && (
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
          <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-teal-400" />
            Puntos por marca
          </h2>
          <div className="space-y-3">
            {brandPoints.filter(bp => bp.company_name).map(bp => (
              <div key={bp.company_id ?? 'general'} className="flex items-center justify-between p-3 bg-slate-800/50 rounded-xl">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-teal-500/15 border border-teal-500/20 flex items-center justify-center">
                    <Coffee className="w-4 h-4 text-teal-400" />
                  </div>
                  <div>
                    <p className="text-white text-sm font-medium">{bp.company_name}</p>
                    <p className="text-slate-500 text-xs">{bp.scans} escaneos</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-teal-300 font-bold">{formatPoints(bp.points)}</p>
                  <p className="text-slate-500 text-xs">puntos</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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

      {/* Reward options */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
        <h2 className="text-white font-semibold mb-4">Canjear refrigerio</h2>

        {redeemMsg && (
          <div className="flex items-center gap-2 bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 rounded-xl px-4 py-3 mb-4 text-sm">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {redeemMsg}
          </div>
        )}

        <div className="space-y-3">
          {rewardOptions.map(option => (
            <button
              key={option.id}
              onClick={() => option.canRedeem && setSelectedReward(option)}
              disabled={!option.canRedeem}
              className={`w-full flex items-center gap-4 p-4 rounded-xl text-left transition-all ${
                selectedReward?.id === option.id
                  ? 'bg-emerald-500/15 border-2 border-emerald-500/50'
                  : option.canRedeem
                    ? 'bg-slate-800/60 hover:bg-slate-800 border border-slate-700'
                    : 'bg-slate-800/30 border border-slate-700/50 opacity-50 cursor-not-allowed'
              }`}
            >
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                option.company_id ? 'bg-teal-500/20 border border-teal-500/30' : 'bg-amber-500/20 border border-amber-500/30'
              }`}>
                {option.company_id ? (
                  <Building2 className="w-6 h-6 text-teal-400" />
                ) : (
                  <Gift className="w-6 h-6 text-amber-400" />
                )}
              </div>
              <div className="flex-1">
                <p className="text-white font-medium">
                  {option.company_name ? `Refrigerio ${option.company_name}` : 'Refrigerio del día'}
                </p>
                <p className="text-slate-400 text-sm">
                  {option.company_id
                    ? `${option.user_brand_points} / ${option.points_required} pts en esta marca`
                    : `${profile?.total_points ?? 0} puntos totales`}
                </p>
              </div>
              <div className="text-right">
                <p className={`font-bold text-lg ${option.canRedeem ? 'text-amber-300' : 'text-slate-500'}`}>
                  50 pts
                </p>
                {option.remaining_stock < 999 && option.remaining_stock > 0 && option.remaining_stock < 20 && (
                  <p className="text-amber-400 text-xs">Quedan {option.remaining_stock}</p>
                )}
              </div>
            </button>
          ))}
        </div>

        {selectedReward && !selectedReward.canRedeem && (
          <div className="flex items-center gap-2 bg-slate-800 rounded-xl px-4 py-3 mt-4 text-sm text-slate-400">
            <Lock className="w-4 h-4" />
            {selectedReward.remaining_stock === 0
              ? 'Sin stock disponible'
              : `Necesitas ${selectedReward.points_required - selectedReward.user_brand_points} puntos más`}
          </div>
        )}

        {selectedReward && selectedReward.canRedeem && (
          <button
            onClick={handleRedeem}
            disabled={redeeming}
            className="w-full mt-4 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-white font-semibold py-3 rounded-xl transition-colors"
          >
            {redeeming ? 'Canjeando...' : `Canjear ${selectedReward.company_name ? `de ${selectedReward.company_name}` : ''}`}
          </button>
        )}
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
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  r.company_id ? 'bg-teal-500/15 border border-teal-500/20' : 'bg-amber-500/15 border border-amber-500/20'
                }`}>
                  {r.company_id ? (
                    <Building2 className="w-4 h-4 text-teal-400" />
                  ) : (
                    <Gift className="w-4 h-4 text-amber-400" />
                  )}
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
