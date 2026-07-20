import { useEffect, useState } from 'react';
import { supabase, Company } from '../lib/supabase';
import { Building2, Plus, Search, Edit3, Trash2, X, Check, Mail, Briefcase, Loader2, Shield, ShieldOff, Eye, EyeOff, Lock, KeyRound, Copy, CheckCircle2 } from 'lucide-react';

interface CompanyWithApproval extends Company {
  is_approved?: boolean;
  approved_by?: string | null;
  approved_at?: string | null;
}

export default function AdminCompanies() {
  const [companies, setCompanies] = useState<CompanyWithApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', industry: 'Bebidas', description: '', password: '' });
  const [error, setError] = useState('');
  const [companyScanCounts, setCompanyScanCounts] = useState<Record<string, number>>({});
  const [createdCreds, setCreatedCreds] = useState<{ email: string; password: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const INDUSTRIES = ['Bebidas', 'Alimentos', 'Farmaceutica', 'Cosmeticos', 'Limpieza', 'Otro'];

  useEffect(() => {
    loadCompanies();

    const channel = supabase
      .channel('companies_rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'companies' }, () => { loadCompanies(); })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  async function loadCompanies() {
    const { data } = await supabase.from('companies').select('*').order('created_at', { ascending: false });
    const companiesData = (data ?? []) as CompanyWithApproval[];
    setCompanies(companiesData);

    if (companiesData.length > 0) {
      const { data: scans } = await supabase
        .from('scan_events')
        .select('company_id')
        .in('company_id', companiesData.map(c => c.id));
      const counts: Record<string, number> = {};
      (scans ?? []).forEach((s: { company_id: string }) => {
        if (s.company_id) counts[s.company_id] = (counts[s.company_id] ?? 0) + 1;
      });
      setCompanyScanCounts(counts);
    }
    setLoading(false);
  }

  function startEdit(c: CompanyWithApproval) {
    setEditId(c.id);
    setForm({ name: c.name, email: c.email, industry: c.industry ?? 'Bebidas', description: c.description ?? '', password: '' });
    setShowForm(true);
    setError('');
  }

  function startCreate() {
    setEditId(null);
    setForm({ name: '', email: '', industry: 'Bebidas', description: '', password: '' });
    setShowForm(true);
    setError('');
    setCreatedCreds(null);
  }

  async function handleSave() {
    if (!form.name.trim() || !form.email.trim()) { setError('Nombre y correo son obligatorios'); return; }
    setSaving(true);
    setError('');
    if (editId) {
      const { error: e } = await supabase.from('companies').update({ name: form.name, email: form.email, industry: form.industry, description: form.description || null }).eq('id', editId);
      if (e) { setError(e.message); setSaving(false); return; }
      await loadCompanies();
      setShowForm(false);
      setSaving(false);
    } else {
      // Create company + auth user via edge function
      if (!form.password.trim() || form.password.length < 6) {
        setError('La contraseña debe tener al menos 6 caracteres');
        setSaving(false); return;
      }
      const { data: { session } } = await supabase.auth.getSession();
      const fnRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-company-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({
          companyName: form.name,
          email: form.email,
          password: form.password,
          industry: form.industry,
          description: form.description,
          adminId: session?.user?.id,
        }),
      });
      const fnData = await fnRes.json();
      if (!fnRes.ok) {
        setError(fnData.error || 'Error al crear empresa');
        setSaving(false); return;
      }
      await loadCompanies();
      setShowForm(false);
      setSaving(false);
      setCreatedCreds({ email: form.email, password: form.password, name: form.name });
    }
  }

  function copyCreds() {
    const text = `TraceQR - Acceso Empresa\nEmpresa: ${createdCreds?.name}\nCorreo: ${createdCreds?.email}\nContraseña: ${createdCreds?.password}\nInicia sesión en: ${window.location.origin}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleDelete(id: string) {
    if (!confirm('¿Eliminar esta empresa? Perdera todos sus datos de trazabilidad.')) return;
    await supabase.from('companies').delete().eq('id', id);
    await loadCompanies();
  }

  async function toggleApproval(company: CompanyWithApproval) {
    const newStatus = !company.is_approved;
    const { error } = await supabase
      .from('companies')
      .update({
        is_approved: newStatus,
        approved_at: newStatus ? new Date().toISOString() : null,
      })
      .eq('id', company.id);

    if (!error) {
      await loadCompanies();
    }
  }

  const filtered = companies.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.email.toLowerCase().includes(search.toLowerCase())
  );

  const approvedCount = companies.filter(c => c.is_approved).length;
  const pendingCount = companies.filter(c => !c.is_approved).length;

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Building2 className="w-6 h-6 text-teal-400" />
            Empresas
          </h1>
          <p className="text-slate-400 text-sm mt-1">{companies.length} empresas: {approvedCount} aprobadas, {pendingCount} pendientes</p>
        </div>
        <button onClick={startCreate} className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors">
          <Plus className="w-4 h-4" /> Nueva empresa
        </button>
      </div>

      {/* Info banner */}
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-3 flex items-start gap-3">
        <Shield className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-blue-300 text-sm font-medium">Acceso sincronizado e inmediato</p>
          <p className="text-blue-400/70 text-xs">Al crear una empresa, se generan credenciales de acceso (correo + contrasena). La empresa puede iniciar sesion inmediatamente y acceder a su trazabilidad, marcas y lotes.</p>
        </div>
      </div>

      {/* Credentials confirmation modal */}
      {createdCreds && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-emerald-500/30 rounded-2xl p-6 max-w-md w-full space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <h3 className="text-white font-semibold">Empresa creada con exito</h3>
                <p className="text-slate-400 text-xs">Comparte estas credenciales con la empresa</p>
              </div>
            </div>
            <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-slate-400 text-xs">Empresa</span>
                <span className="text-white text-sm font-medium">{createdCreds.name}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400 text-xs flex items-center gap-1"><Mail className="w-3 h-3" /> Correo</span>
                <span className="text-white text-sm font-mono">{createdCreds.email}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400 text-xs flex items-center gap-1"><KeyRound className="w-3 h-3" /> Contrasena</span>
                <span className="text-white text-sm font-mono">{createdCreds.password}</span>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={copyCreds} className="flex-1 flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors">
                {copied ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copiado' : 'Copiar credenciales'}
              </button>
              <button onClick={() => setCreatedCreds(null)} className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors">
                Listo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div className="bg-slate-900/60 border border-slate-700 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-white font-semibold">{editId ? 'Editar empresa' : 'Nueva empresa'}</h2>
            <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
          </div>
          {error && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2">{error}</p>}
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Nombre *</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ej: Postobon S.A." className="w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-500 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors" />
            </div>
            <div>
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
              <label className="block text-xs text-slate-400 mb-1.5">Descripcion</label>
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Descripcion breve..." className="w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-500 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors" />
            </div>
            {!editId && (
              <div className="md:col-span-2">
                <label className="block text-xs text-slate-400 mb-1.5 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5" /> Contraseña de acceso para la empresa *
                </label>
                <input type="text" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="Minimo 6 caracteres" className="w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-500 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors" />
                <p className="text-slate-500 text-xs mt-1">La empresa usara este correo y contraseña para iniciar sesion. La empresa queda aprobada automaticamente.</p>
              </div>
            )}
          </div>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm transition-colors">Cancelar</button>
            <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {editId ? 'Guardar' : 'Crear empresa con acceso'}
            </button>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar empresa..." className="w-full bg-slate-900/60 border border-slate-800 text-white placeholder-slate-500 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors" />
      </div>

      {/* Table */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Empresa</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Industria</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Estado</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Escaneos</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Creada</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {filtered.map(c => (
                <tr key={c.id} className={`hover:bg-slate-800/30 transition-colors ${!c.is_approved ? 'bg-amber-500/5' : ''}`}>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${c.is_approved ? 'bg-teal-500/15 border border-teal-500/20' : 'bg-amber-500/15 border border-amber-500/20'}`}>
                        <Building2 className={`w-4 h-4 ${c.is_approved ? 'text-teal-400' : 'text-amber-400'}`} />
                      </div>
                      <div>
                        <p className="text-white text-sm font-medium">{c.name}</p>
                        <div className="flex items-center gap-1 text-slate-500 text-xs">
                          <Mail className="w-3 h-3" /> {c.email}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-xs bg-slate-800 text-slate-300 px-2 py-1 rounded-full border border-slate-700 flex items-center gap-1 w-fit">
                      <Briefcase className="w-3 h-3" /> {c.industry}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    {c.is_approved ? (
                      <span className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded-full w-fit">
                        <Eye className="w-3 h-3" /> Aprobado
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded-full w-fit">
                        <EyeOff className="w-3 h-3" /> Sin acceso
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-emerald-400 text-sm font-semibold">{(companyScanCounts[c.id] ?? 0).toLocaleString('es-CO')}</span>
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-slate-400 text-xs">{new Date(c.created_at).toLocaleDateString('es-CO')}</span>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        onClick={() => toggleApproval(c)}
                        className={`p-1.5 rounded-lg transition-all ${c.is_approved ? 'text-amber-400 hover:bg-amber-500/10' : 'text-emerald-400 hover:bg-emerald-500/10'}`}
                        title={c.is_approved ? 'Revocar acceso' : 'Aprobar acceso'}
                      >
                        {c.is_approved ? <ShieldOff className="w-4 h-4" /> : <Shield className="w-4 h-4" />}
                      </button>
                      <button onClick={() => startEdit(c)} className="text-slate-400 hover:text-blue-400 p-1.5 rounded-lg hover:bg-blue-500/10 transition-all">
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDelete(c.id)} className="text-slate-400 hover:text-red-400 p-1.5 rounded-lg hover:bg-red-500/10 transition-all">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-slate-500 text-sm">
                    <Building2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No se encontraron empresas
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
