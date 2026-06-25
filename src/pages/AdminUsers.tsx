import { useEffect, useState } from 'react';
import { supabase, Profile, Company } from '../lib/supabase';
import { getDisplayName } from '../lib/utils';
import { Users, Search, Edit3, Shield, GraduationCap, Building2, Mail, Check, X, Loader2 } from 'lucide-react';

const ROLE_CONFIG = {
  admin: { label: 'Admin', color: 'bg-amber-500/20 text-amber-300 border-amber-500/30', icon: <Shield className="w-3 h-3" /> },
  company: { label: 'Empresa', color: 'bg-blue-500/20 text-blue-300 border-blue-500/30', icon: <Building2 className="w-3 h-3" /> },
  student: { label: 'Estudiante', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30', icon: <GraduationCap className="w-3 h-3" /> },
};

export default function AdminUsers() {
  const [users, setUsers] = useState<Profile[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<string>('student');
  const [editCompany, setEditCompany] = useState<string>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    const [{ data: ud }, { data: cd }] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at', { ascending: false }),
      supabase.from('companies').select('*').order('name'),
    ]);
    setUsers((ud ?? []) as Profile[]);
    setCompanies((cd ?? []) as Company[]);
    setLoading(false);
  }

  function startEdit(u: Profile) {
    setEditId(u.id);
    setEditRole(u.role);
    setEditCompany(u.company_id ?? '');
  }

  async function saveEdit(userId: string) {
    setSaving(true);
    await supabase.from('profiles')
      .update({ role: editRole, company_id: editCompany || null })
      .eq('id', userId);
    await loadData();
    setEditId(null);
    setSaving(false);
  }

  const filtered = users.filter(u =>
    getDisplayName(u.display_name, u.email).toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Users className="w-6 h-6 text-blue-400" />
            Usuarios
          </h1>
          <p className="text-slate-400 text-sm mt-1">{users.length} usuarios registrados</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar usuario..." className="w-full bg-slate-900/60 border border-slate-800 text-white placeholder-slate-500 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors" />
      </div>

      {/* Table */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Usuario</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Rol</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Empresa</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Puntos</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Registro</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {filtered.map(u => {
                const rc = ROLE_CONFIG[u.role] ?? ROLE_CONFIG.student;
                const isEditing = editId === u.id;
                const companyName = companies.find(c => c.id === u.company_id)?.name;
                return (
                  <tr key={u.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-700 border border-slate-600 flex items-center justify-center text-slate-300 text-xs font-bold uppercase">
                          {getDisplayName(u.display_name, u.email)[0]}
                        </div>
                        <div>
                          <p className="text-white text-sm font-medium">{getDisplayName(u.display_name, u.email)}</p>
                          <div className="flex items-center gap-1 text-slate-500 text-xs">
                            <Mail className="w-3 h-3" /> {u.email}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      {isEditing ? (
                        <select value={editRole} onChange={e => setEditRole(e.target.value)} className="bg-slate-800 border border-slate-700 text-white rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-emerald-500">
                          <option value="student">Estudiante</option>
                          <option value="company">Empresa</option>
                          <option value="admin">Admin</option>
                        </select>
                      ) : (
                        <span className={`text-xs px-2 py-1 rounded-full border flex items-center gap-1 w-fit ${rc.color}`}>
                          {rc.icon} {rc.label}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {isEditing ? (
                        <select value={editCompany} onChange={e => setEditCompany(e.target.value)} className="bg-slate-800 border border-slate-700 text-white rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-emerald-500 max-w-32">
                          <option value="">Sin empresa</option>
                          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      ) : (
                        <span className="text-slate-400 text-xs">{companyName ?? '-'}</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-amber-300 text-sm font-semibold">{(u.total_points ?? 0).toLocaleString('es-CO')}</span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-slate-400 text-xs">{new Date(u.created_at).toLocaleDateString('es-CO')}</span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        {isEditing ? (
                          <>
                            <button onClick={() => saveEdit(u.id)} disabled={saving} className="text-emerald-400 hover:text-emerald-300 p-1.5 rounded-lg hover:bg-emerald-500/10 transition-all">
                              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                            </button>
                            <button onClick={() => setEditId(null)} className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-700 transition-all">
                              <X className="w-4 h-4" />
                            </button>
                          </>
                        ) : (
                          <button onClick={() => startEdit(u)} className="text-slate-400 hover:text-blue-400 p-1.5 rounded-lg hover:bg-blue-500/10 transition-all">
                            <Edit3 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-slate-500 text-sm">
                    <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No se encontraron usuarios
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
