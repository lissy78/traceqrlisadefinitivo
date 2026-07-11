import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  Tag, Plus, AlertTriangle, CheckCircle2, Building2, RefreshCw, Loader2,
  Package, Trash2, Edit2, X, Save
} from 'lucide-react';

interface ProductLine {
  id: string;
  company_id: string | null;
  brand_name: string;
  product_category: string | null;
  container_types: string[];
  is_active: boolean;
  company?: { name: string } | null;
}

interface Company {
  id: string;
  name: string;
}

export default function AdminProductLines() {
  const [lines, setLines] = useState<ProductLine[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [form, setForm] = useState({
    company_id: '',
    brand_name: '',
    product_category: '',
    container_types: [] as string[],
    is_active: true,
  });

  const CONTAINER_TYPES = ['PET', 'Vidrio', 'Lata', 'Chuspa', 'Otro plástico'];
  const CATEGORIES = ['Bebidas', 'Alimentos', 'Farmacéutica', 'Cosméticos', 'Limpieza', 'Otro'];

  useEffect(() => {
    loadData();

    const channel = supabase
      .channel('product_lines_rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'product_lines' }, () => { loadData(); })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  async function loadData() {
    setLoading(true);
    const { data: co } = await supabase.from('companies').select('id, name').order('name');
    setCompanies((co ?? []) as Company[]);

    const { data: pl } = await supabase
      .from('product_lines')
      .select('*, company:companies(name)')
      .order('brand_name');

    setLines((pl ?? []) as ProductLine[]);
    setLoading(false);
  }

  async function handleAdd() {
    if (!form.brand_name.trim()) {
      setMsg({ type: 'err', text: 'El nombre de la marca es requerido' });
      return;
    }
    setSaving(true);
    setMsg(null);

    const payload = {
      company_id: form.company_id || null,
      brand_name: form.brand_name.trim(),
      product_category: form.product_category || null,
      container_types: form.container_types,
      is_active: form.is_active,
    };

    const { error } = await supabase.from('product_lines').insert(payload);

    if (error) {
      if (error.code === '23505') {
        setMsg({ type: 'err', text: 'Esta marca ya existe para esta empresa' });
      } else {
        setMsg({ type: 'err', text: error.message });
      }
      setSaving(false);
      return;
    }

    setMsg({ type: 'ok', text: 'Línea de producto creada exitosamente' });
    setForm({ company_id: '', brand_name: '', product_category: '', container_types: [], is_active: true });
    setShowForm(false);
    await loadData();
    setSaving(false);
  }

  async function handleUpdate() {
    if (!editingId || !form.brand_name.trim()) {
      setMsg({ type: 'err', text: 'El nombre de la marca es requerido' });
      return;
    }
    setSaving(true);
    setMsg(null);

    const payload = {
      company_id: form.company_id || null,
      brand_name: form.brand_name.trim(),
      product_category: form.product_category || null,
      container_types: form.container_types,
      is_active: form.is_active,
    };

    const { error } = await supabase.from('product_lines').update(payload).eq('id', editingId);

    if (error) {
      setMsg({ type: 'err', text: error.message });
      setSaving(false);
      return;
    }

    setMsg({ type: 'ok', text: 'Línea de producto actualizada' });
    setEditingId(null);
    setForm({ company_id: '', brand_name: '', product_category: '', container_types: [], is_active: true });
    await loadData();
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm('¿Eliminar esta línea de producto?')) return;
    await supabase.from('product_lines').delete().eq('id', id);
    await loadData();
  }

  function startEdit(line: ProductLine) {
    setEditingId(line.id);
    setForm({
      company_id: line.company_id || '',
      brand_name: line.brand_name,
      product_category: line.product_category || '',
      container_types: line.container_types || [],
      is_active: line.is_active,
    });
    setShowForm(true);
  }

  function toggleContainerType(type: string) {
    setForm(prev => ({
      ...prev,
      container_types: prev.container_types.includes(type)
        ? prev.container_types.filter(t => t !== type)
        : [...prev.container_types, type]
    }));
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
    </div>
  );

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Tag className="w-6 h-6 text-blue-400" />
            Líneas de Producto
          </h1>
          <p className="text-slate-400 text-sm mt-1">Asocia marcas a empresas para verificación de códigos de barras</p>
        </div>
        <button
          onClick={() => { setShowForm(true); setMsg(null); setEditingId(null); setForm({ company_id: '', brand_name: '', product_category: '', container_types: [], is_active: true }); }}
          className="flex items-center gap-2 bg-blue-500 hover:bg-blue-400 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" /> Agregar marca
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
          <Tag className="w-5 h-5 text-blue-400 mb-3" />
          <p className="text-slate-400 text-xs mb-1">Total marcas</p>
          <p className="text-white text-2xl font-bold">{lines.length}</p>
        </div>
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 mb-3" />
          <p className="text-slate-400 text-xs mb-1">Marcas activas</p>
          <p className="text-emerald-400 text-2xl font-bold">{lines.filter(l => l.is_active).length}</p>
        </div>
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
          <Building2 className="w-5 h-5 text-teal-400 mb-3" />
          <p className="text-slate-400 text-xs mb-1">Empresas vinculadas</p>
          <p className="text-teal-400 text-2xl font-bold">{new Set(lines.filter(l => l.company_id).map(l => l.company_id)).size}</p>
        </div>
      </div>

      {/* Add/Edit form */}
      {showForm && (
        <div className="bg-slate-900/60 border border-slate-700 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-white font-semibold flex items-center gap-2">
              {editingId ? <Edit2 className="w-4 h-4 text-blue-400" /> : <Plus className="w-4 h-4 text-blue-400" />}
              {editingId ? 'Editar marca' : 'Agregar nueva marca'}
            </h2>
            <button onClick={() => { setShowForm(false); setEditingId(null); }} className="text-slate-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          </div>

          {msg && (
            <div className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm ${msg.type === 'ok' ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400' : 'bg-red-500/15 border border-red-500/30 text-red-400'}`}>
              {msg.type === 'ok' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
              {msg.text}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Nombre de la marca *</label>
              <input
                type="text"
                value={form.brand_name}
                onChange={e => setForm(f => ({ ...f, brand_name: e.target.value }))}
                placeholder="Ej: Coca-Cola, Postobón"
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 transition-colors placeholder-slate-600"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Empresa asociada</label>
              <select
                value={form.company_id}
                onChange={e => setForm(f => ({ ...f, company_id: e.target.value }))}
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 transition-colors"
              >
                <option value="">— Sin empresa —</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Categoría</label>
              <select
                value={form.product_category}
                onChange={e => setForm(f => ({ ...f, product_category: e.target.value }))}
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 transition-colors"
              >
                <option value="">— Sin categoría —</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Estado</label>
              <select
                value={form.is_active ? 'true' : 'false'}
                onChange={e => setForm(f => ({ ...f, is_active: e.target.value === 'true' }))}
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 transition-colors"
              >
                <option value="true">Activa</option>
                <option value="false">Inactiva</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-2">Tipos de contenedor</label>
            <div className="flex flex-wrap gap-2">
              {CONTAINER_TYPES.map(type => (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleContainerType(type)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    form.container_types.includes(type)
                      ? 'bg-blue-500/20 border border-blue-500/40 text-blue-300'
                      : 'bg-slate-800 border border-slate-700 text-slate-400 hover:border-slate-600'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={editingId ? handleUpdate : handleAdd}
              disabled={saving}
              className="flex items-center gap-2 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
            <button
              onClick={() => { setShowForm(false); setEditingId(null); }}
              className="bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-xl text-sm transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Marca</th>
              <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Empresa</th>
              <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Categoría</th>
              <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Contenedores</th>
              <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Estado</th>
              <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {lines.map(line => (
              <tr key={line.id} className="hover:bg-slate-800/30 transition-colors">
                <td className="px-5 py-4">
                  <div className="flex items-center gap-2">
                    <Tag className="w-4 h-4 text-blue-400 shrink-0" />
                    <span className="text-white font-medium">{line.brand_name}</span>
                  </div>
                </td>
                <td className="px-5 py-4">
                  {line.company ? (
                    <div className="flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-teal-400" />
                      <span className="text-slate-300">{(line.company as { name: string }).name}</span>
                    </div>
                  ) : (
                    <span className="text-slate-500 text-sm">Sin empresa</span>
                  )}
                </td>
                <td className="px-5 py-4">
                  <span className="text-slate-300 text-sm capitalize">{line.product_category || '-'}</span>
                </td>
                <td className="px-5 py-4">
                  <div className="flex flex-wrap gap-1">
                    {(line.container_types || []).map(t => (
                      <span key={t} className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded">{t}</span>
                    ))}
                  </div>
                </td>
                <td className="px-5 py-4">
                  {line.is_active ? (
                    <span className="text-xs bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-1 rounded-full">
                      Activa
                    </span>
                  ) : (
                    <span className="text-xs bg-slate-700/50 text-slate-400 px-2 py-1 rounded-full">
                      Inactiva
                    </span>
                  )}
                </td>
                <td className="px-5 py-4">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => startEdit(line)}
                      className="text-slate-400 hover:text-blue-400 transition-colors"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(line.id)}
                      className="text-slate-400 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {lines.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center text-slate-500 text-sm">
                  <Tag className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  No hay líneas de producto registradas. Agrega la primera marca.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
