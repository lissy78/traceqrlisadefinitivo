import { useEffect, useState } from 'react';
import { supabase, RecyclingLocation } from '../lib/supabase';
import {
  MapPin, Plus, Search, Edit3, Trash2, X, Check, Phone, Clock,
  Loader2, Building2, MapPinned, Power
} from 'lucide-react';

const LOCATION_TYPES = [
  { value: 'punto_verde', label: 'Punto Verde' },
  { value: 'ecoparque', label: 'Ecoparque' },
  { value: 'supermercado', label: 'Supermercado' },
  { value: 'hospital', label: 'Hospital' },
  { value: 'punto_acopio', label: 'Punto de Acopio' },
  { value: 'otro', label: 'Otro' },
];

export default function AdminLocations() {
  const [locations, setLocations] = useState<RecyclingLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    name: '',
    address: '',
    lat: '',
    lng: '',
    location_type: 'punto_verde',
    city: '',
    department: 'Bogota',
    schedule: '',
    phone: '',
    is_active: true,
  });

  useEffect(() => {
    loadLocations();

    // Real-time subscription: reflect admin changes instantly across all users
    const channel = supabase
      .channel('recycling_locations_admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recycling_locations' }, () => {
        loadLocations();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  async function loadLocations() {
    const { data } = await supabase.from('recycling_locations').select('*').order('created_at', { ascending: false });
    setLocations((data ?? []) as RecyclingLocation[]);
    setLoading(false);
  }

  function startEdit(loc: RecyclingLocation) {
    setEditId(loc.id);
    setForm({
      name: loc.name,
      address: loc.address ?? '',
      lat: loc.lat?.toString() ?? '',
      lng: loc.lng?.toString() ?? '',
      location_type: loc.location_type ?? 'punto_verde',
      city: loc.city ?? '',
      department: loc.department ?? 'Bogota',
      schedule: loc.schedule ?? '',
      phone: loc.phone ?? '',
      is_active: loc.is_active ?? true,
    });
    setShowForm(true);
    setError('');
  }

  function startCreate() {
    setEditId(null);
    setForm({
      name: '',
      address: '',
      lat: '',
      lng: '',
      location_type: 'punto_verde',
      city: '',
      department: 'Bogota',
      schedule: '',
      phone: '',
      is_active: true,
    });
    setShowForm(true);
    setError('');
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('El nombre es obligatorio'); return; }
    if (!form.lat || !form.lng) { setError('Las coordenadas son obligatorias'); return; }

    const lat = parseFloat(form.lat);
    const lng = parseFloat(form.lng);

    if (isNaN(lat) || isNaN(lng)) { setError('Coordenadas invalidas'); return; }

    setSaving(true);
    setError('');

    const payload = {
      name: form.name,
      address: form.address || null,
      lat,
      lng,
      location_type: form.location_type,
      city: form.city || null,
      department: form.department || 'Bogota',
      schedule: form.schedule || null,
      phone: form.phone || null,
      is_active: form.is_active,
    };

    if (editId) {
      const { error: e } = await supabase.from('recycling_locations').update(payload).eq('id', editId);
      if (e) { setError(e.message); setSaving(false); return; }
    } else {
      const { error: e } = await supabase.from('recycling_locations').insert(payload);
      if (e) { setError(e.message); setSaving(false); return; }
    }

    await loadLocations();
    setShowForm(false);
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm('¿Eliminar este punto de acopio?')) return;
    await supabase.from('recycling_locations').delete().eq('id', id);
    await loadLocations();
  }

  async function toggleActive(loc: RecyclingLocation) {
    await supabase.from('recycling_locations')
      .update({ is_active: !loc.is_active })
      .eq('id', loc.id);
    await loadLocations();
  }

  const filtered = locations.filter(loc =>
    loc.name.toLowerCase().includes(search.toLowerCase()) ||
    (loc.address?.toLowerCase() ?? '').includes(search.toLowerCase()) ||
    (loc.city?.toLowerCase() ?? '').includes(search.toLowerCase())
  );

  const typeLabel = (type: string) => LOCATION_TYPES.find(t => t.value === type)?.label ?? type;

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
            <MapPinned className="w-6 h-6 text-teal-400" />
            Puntos de Acopio
          </h1>
          <p className="text-slate-400 text-sm mt-1">{locations.length} puntos registrados</p>
        </div>
        <button onClick={startCreate} className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors">
          <Plus className="w-4 h-4" /> Nuevo punto
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-slate-900/60 border border-slate-700 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-white font-semibold">{editId ? 'Editar punto de acopio' : 'Nuevo punto de acopio'}</h2>
            <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
          </div>
          {error && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2">{error}</p>}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Nombre *</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ej: Punto Verde Centro" className="w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-500 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs text-slate-400 mb-1.5">Direccion</label>
              <input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Calle 10 # 5-20, Centro" className="w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-500 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Latitud *</label>
              <input value={form.lat} onChange={e => setForm(f => ({ ...f, lat: e.target.value }))} placeholder="4.60971" className="w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-500 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Longitud *</label>
              <input value={form.lng} onChange={e => setForm(f => ({ ...f, lng: e.target.value }))} placeholder="-74.08175" className="w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-500 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Tipo</label>
              <select value={form.location_type} onChange={e => setForm(f => ({ ...f, location_type: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500 appearance-none transition-colors">
                {LOCATION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Ciudad</label>
              <input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} placeholder="Bogota" className="w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-500 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Departamento</label>
              <input value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} placeholder="Cundinamarca" className="w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-500 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Horario</label>
              <input value={form.schedule} onChange={e => setForm(f => ({ ...f, schedule: e.target.value }))} placeholder="Lun-Sab 8am-6pm" className="w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-500 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Telefono</label>
              <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+57 300 123 4567" className="w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-500 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors" />
            </div>
            <div className="flex items-center gap-2 md:col-span-2 lg:col-span-1">
              <input type="checkbox" id="is_active" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-emerald-500 focus:ring-emerald-500" />
              <label htmlFor="is_active" className="text-slate-300 text-sm">Punto activo</label>
            </div>
          </div>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm transition-colors">Cancelar</button>
            <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {editId ? 'Guardar' : 'Crear punto'}
            </button>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar punto de acopio..." className="w-full bg-slate-900/60 border border-slate-800 text-white placeholder-slate-500 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors" />
      </div>

      {/* Table */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Punto</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Tipo</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Ubicacion</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Horario</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Estado</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {filtered.map(loc => (
                <tr key={loc.id} className={`hover:bg-slate-800/30 transition-colors ${!loc.is_active ? 'opacity-50' : ''}`}>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${loc.is_active ? 'bg-teal-500/15 border border-teal-500/20' : 'bg-slate-800 border border-slate-700'}`}>
                        <MapPin className={`w-4 h-4 ${loc.is_active ? 'text-teal-400' : 'text-slate-500'}`} />
                      </div>
                      <div>
                        <p className="text-white text-sm font-medium">{loc.name}</p>
                        {loc.address && <p className="text-slate-500 text-xs truncate max-w-48">{loc.address}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-xs bg-slate-800 text-slate-300 px-2 py-1 rounded-full border border-slate-700">
                      {typeLabel(loc.location_type)}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <div className="text-slate-300 text-xs">
                      <p>{loc.city ?? '-'}, {loc.department}</p>
                      <p className="font-mono text-slate-500">{loc.lat?.toFixed(4)}, {loc.lng?.toFixed(4)}</p>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    {loc.schedule ? (
                      <span className="text-slate-300 text-xs flex items-center gap-1">
                        <Clock className="w-3 h-3 text-slate-500" /> {loc.schedule}
                      </span>
                    ) : <span className="text-slate-600 text-xs">-</span>}
                  </td>
                  <td className="px-5 py-3">
                    <button
                      onClick={() => toggleActive(loc)}
                      className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border transition-colors ${
                        loc.is_active
                          ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/20'
                          : 'text-slate-400 bg-slate-800 border-slate-700 hover:bg-slate-700'
                      }`}
                    >
                      <Power className="w-3 h-3" />
                      {loc.is_active ? 'Activo' : 'Inactivo'}
                    </button>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <button onClick={() => startEdit(loc)} className="text-slate-400 hover:text-blue-400 p-1.5 rounded-lg hover:bg-blue-500/10 transition-all">
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDelete(loc.id)} className="text-slate-400 hover:text-red-400 p-1.5 rounded-lg hover:bg-red-500/10 transition-all">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-slate-500 text-sm">
                    <MapPin className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No se encontraron puntos de acopio
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
