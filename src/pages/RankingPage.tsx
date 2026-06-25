import { useEffect, useState } from 'react';
import { supabase, Profile } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { getDisplayName } from '../lib/utils';
import { Trophy, Star, Medal, TrendingUp, Recycle, Crown } from 'lucide-react';

interface RankEntry {
  id: string;
  display_name: string | null;
  email: string;
  total_points: number;
  avatar_url: string | null;
  scan_count?: number;
}

export default function RankingPage() {
  const { profile } = useAuth();
  const [ranking, setRanking] = useState<RankEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  useEffect(() => {
    loadRanking();

    const channel = supabase
      .channel('ranking-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
        loadRanking();
        setLastUpdated(new Date());
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  async function loadRanking() {
    const { data } = await supabase
      .from('profiles')
      .select('id, display_name, email, total_points, avatar_url')
      .eq('role', 'student')
      .order('total_points', { ascending: false })
      .limit(50);

    if (data) {
      // Fetch scan counts
      const ids = data.map((p: { id: string }) => p.id);
      const { data: scanCounts } = await supabase
        .from('scan_events')
        .select('user_id')
        .in('user_id', ids);

      const countMap: Record<string, number> = {};
      (scanCounts ?? []).forEach((s: { user_id: string }) => {
        countMap[s.user_id] = (countMap[s.user_id] ?? 0) + 1;
      });

      setRanking(data.map((p: Profile) => ({ ...p, scan_count: countMap[p.id] ?? 0 })));
    }
    setLoading(false);
  }

  const myRank = ranking.findIndex(r => r.id === profile?.id);

  const medalColors = [
    'text-amber-400 bg-amber-500/20 border-amber-500/30',
    'text-slate-300 bg-slate-500/20 border-slate-500/30',
    'text-orange-400 bg-orange-500/20 border-orange-500/30',
  ];

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Trophy className="w-6 h-6 text-amber-400" />
            Ranking
          </h1>
          <p className="text-slate-400 text-sm mt-1">Actualización en tiempo real</p>
        </div>
        <div className="text-right">
          <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse inline-block mr-2" />
          <span className="text-slate-400 text-xs">
            {lastUpdated.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>

      {/* Top 3 podium */}
      {ranking.length >= 3 && (
        <div className="grid grid-cols-3 gap-3">
          {[ranking[1], ranking[0], ranking[2]].map((entry, podiumIdx) => {
            const realRank = podiumIdx === 0 ? 2 : podiumIdx === 1 ? 1 : 3;
            const heights = ['h-28', 'h-36', 'h-24'];
            const isMe = entry?.id === profile?.id;
            return (
              <div key={entry?.id} className={`flex flex-col items-center justify-end ${heights[podiumIdx]}`}>
                {realRank === 1 && <Crown className="w-5 h-5 text-amber-400 mb-1" />}
                <div className={`w-10 h-10 rounded-full border-2 flex items-center justify-center text-sm font-bold uppercase mb-1 ${
                  isMe ? 'border-emerald-400 text-emerald-400 bg-emerald-500/20' : 'border-slate-600 text-slate-400 bg-slate-800'
                }`}>
                  {getDisplayName(entry?.display_name, entry?.email)[0]}
                </div>
                <div className={`w-full rounded-t-xl flex flex-col items-center justify-center py-3 border ${medalColors[realRank - 1]}`}>
                  <span className="text-white text-xs font-semibold truncate max-w-full px-1 text-center">
                    {getDisplayName(entry?.display_name, entry?.email).split(' ')[0]}
                  </span>
                  <div className="flex items-center gap-0.5 mt-0.5">
                    <Star className="w-3 h-3 text-amber-400" />
                    <span className="text-amber-300 text-xs font-bold">
                      {entry?.total_points?.toLocaleString('es-CO') ?? 0}
                    </span>
                  </div>
                  <span className="text-slate-500 text-xs mt-0.5">#{realRank}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* My position */}
      {myRank >= 0 && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold">
            {getDisplayName(profile?.display_name, profile?.email)[0]}
          </div>
          <div className="flex-1">
            <p className="text-emerald-300 font-semibold text-sm">Tu posición</p>
            <p className="text-slate-400 text-xs">{getDisplayName(profile?.display_name, profile?.email)}</p>
          </div>
          <div className="text-right">
            <p className="text-white text-2xl font-bold">#{myRank + 1}</p>
            <div className="flex items-center gap-1 justify-end">
              <Star className="w-3 h-3 text-amber-400" />
              <span className="text-amber-300 text-xs font-bold">{profile?.total_points?.toLocaleString('es-CO')}</span>
            </div>
          </div>
        </div>
      )}

      {/* Full ranking list */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-800 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-emerald-400" />
          <span className="text-white font-semibold text-sm">Clasificación completa</span>
          <span className="text-slate-500 text-xs ml-auto">{ranking.length} participantes</span>
        </div>
        <div className="divide-y divide-slate-800">
          {ranking.map((entry, idx) => {
            const isMe = entry.id === profile?.id;
            const rank = idx + 1;
            return (
              <div
                key={entry.id}
                className={`flex items-center gap-4 px-5 py-3 transition-colors ${isMe ? 'bg-emerald-500/5' : 'hover:bg-slate-800/40'}`}
              >
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                  rank === 1 ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                  rank === 2 ? 'bg-slate-500/20 text-slate-300 border border-slate-500/30' :
                  rank === 3 ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' :
                  'bg-slate-800 text-slate-500'
                }`}>
                  {rank <= 3 ? <Medal className="w-3.5 h-3.5" /> : rank}
                </div>
                <div className={`w-8 h-8 rounded-full border flex items-center justify-center text-xs font-bold uppercase ${
                  isMe ? 'border-emerald-500/50 text-emerald-400 bg-emerald-500/10' : 'border-slate-700 text-slate-400 bg-slate-800'
                }`}>
                  {getDisplayName(entry.display_name, entry.email)[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium truncate ${isMe ? 'text-emerald-300' : 'text-white'}`}>
                    {getDisplayName(entry.display_name, entry.email)}
                    {isMe && <span className="ml-2 text-xs text-emerald-500">(tú)</span>}
                  </p>
                  <div className="flex items-center gap-1">
                    <Recycle className="w-3 h-3 text-slate-500" />
                    <span className="text-slate-500 text-xs">{entry.scan_count ?? 0} reciclados</span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Star className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-amber-300 font-semibold text-sm">{entry.total_points?.toLocaleString('es-CO') ?? 0}</span>
                </div>
              </div>
            );
          })}
          {ranking.length === 0 && (
            <div className="py-12 text-center text-slate-500">
              <Trophy className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p>Aún no hay participantes</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
