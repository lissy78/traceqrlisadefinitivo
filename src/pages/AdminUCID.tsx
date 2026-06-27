import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import {
  QrCode, Plus, Download, Loader2, Package, Hash, Building2,
  Calendar, ChevronDown, AlertCircle, CheckCircle2, Clock,
  Trash2, Eye, FileText
} from 'lucide-react';

interface UCIDBatch {
  id: string;
  company_id: string;
  batch_name: string;
  quantity: number;
  ucid_prefix: string;
  price_per_ucid: number;
  total_price: number;
  status: string;
  created_at: string;
  generated_at: string | null;
  printed_at: string | null;
  notes: string | null;
}

interface UCIDStats {
  total: number;
  unused: number;
  scanned: number;
  invalidated: number;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending: { label: 'Pendiente', color: 'bg-slate-500/20 text-slate-300 border-slate-500/30', icon: <Clock className="w-3 h-3" /> },
  generating: { label: 'Generando', color: 'bg-blue-500/20 text-blue-300 border-blue-500/30', icon: <Loader2 className="w-3 h-3 animate-spin" /> },
  ready: { label: 'Listo', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30', icon: <CheckCircle2 className="w-3 h-3" /> },
  printed: { label: 'Impreso', color: 'bg-teal-500/20 text-teal-300 border-teal-500/30', icon: <FileText className="w-3 h-3" /> },
  active: { label: 'Activo', color: 'bg-green-500/20 text-green-300 border-green-500/30', icon: <CheckCircle2 className="w-3 h-3" /> },
  exhausted: { label: 'Agotado', color: 'bg-amber-500/20 text-amber-300 border-amber-500/30', icon: <AlertCircle className="w-3 h-3" /> },
};

export default function AdminUCID() {
  const { profile } = useAuth();
  const [batches, setBatches] = useState<UCIDBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [form, setForm] = useState({
    batch_name: '',
    quantity: 1000,
    product_name: '',
    product_brand: '',
    container_type: 'PET',
    notes: '',
  });

  const companyId = profile?.company_id;
  const isAdmin = profile?.role === 'admin';

  useEffect(() => { loadBatches(); }, [companyId]);

  async function loadBatches() {
    const query = supabase.from('ucid_batches').select('*').order('created_at', { ascending: false });
    const { data } = isAdmin
      ? await query
      : await query.eq('company_id', companyId);
    setBatches((data ?? []) as UCIDBatch[]);
    setLoading(false);
  }

  async function handleCreate() {
    if (!form.batch_name.trim() || !form.quantity) {
      setError('Nombre y cantidad son obligatorios');
      return;
    }
    if (form.quantity < 100 || form.quantity > 100000) {
      setError('La cantidad debe estar entre 100 y 100,000');
      return;
    }

    setSaving(true);
    setError('');

    const targetCompanyId = companyId!;
    const pricePerUcid = 45;
    const totalPrice = form.quantity * pricePerUcid;
    const prefix = `TRQ-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    // Create batch
    const { data: batch, error: batchError } = await supabase
      .from('ucid_batches')
      .insert({
        company_id: targetCompanyId,
        batch_name: form.batch_name,
        quantity: form.quantity,
        ucid_prefix: prefix,
        price_per_ucid: pricePerUcid,
        total_price: totalPrice,
        status: 'generating',
        created_by: profile?.id,
        notes: form.notes || null,
      })
      .select()
      .single();

    if (batchError) {
      setError(batchError.message);
      setSaving(false);
      return;
    }

    // Call edge function to generate UCIDs
    const { data: result, error: genError } = await supabase.functions.invoke('ucid-generator', {
      body: {
        action: 'generate',
        batchId: batch.id,
        companyId: targetCompanyId,
        quantity: form.quantity,
        productInfo: {
          name: form.product_name || null,
          brand: form.product_brand || null,
          containerType: form.container_type,
        },
      },
    });

    if (genError || result?.error) {
      setError(genError?.message || result?.error || 'Error generating UCIDs');
      setSaving(false);
      return;
    }

    setSuccess(`Generados ${form.quantity.toLocaleString('es-CO')} UCIDs exitosamente`);
    setShowForm(false);
    setSaving(false);
    setForm({ batch_name: '', quantity: 1000, product_name: '', product_brand: '', container_type: 'PET', notes: '' });
    await loadBatches();

    setTimeout(() => setSuccess(''), 5000);
  }

  async function handleExport(batchId: string) {
    setExporting(batchId);
    setError('');

    const { data, error: exportError } = await supabase.functions.invoke('ucid-generator', {
      body: { action: 'export', batchId },
    });

    if (exportError || data?.error) {
      setError(exportError?.message || data?.error || 'Error exporting');
      setExporting(null);
      return;
    }

    // Create downloadable CSV
    const csvRows = [
      ['short_code', 'qr_url', 'ucid_hash', 'product_name', 'status'],
      ...data.ucids.map((u: { short_code: string; qr_data: string; ucid_hash: string; product_name: string | null; status: string }) => [
        u.short_code,
        u.qr_data,
        u.ucid_hash,
        u.product_name || '',
        u.status,
      ]),
    ];
    const csvContent = csvRows.map(row => row.join(',')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ucid_batch_${batchId.slice(0, 8)}.csv`;
    link.click();
    URL.revokeObjectURL(url);

    setExporting(null);
    setSuccess('CSV exportado exitosamente');
    setTimeout(() => setSuccess(''), 3000);
    await loadBatches();
  }

  async function getBatchStats(batchId: string): Promise<UCIDStats> {
    const { data } = await supabase
      .from('ucids')
      .select('status')
      .eq('batch_id', batchId);

    const stats: UCIDStats = { total: 0, unused: 0, scanned: 0, invalidated: 0 };
    (data ?? []).forEach((u: { status: string }) => {
      stats.total++;
      if (u.status === 'unused') stats.unused++;
      else if (u.status === 'scanned') stats.scanned++;
      else if (u.status === 'invalidated') stats.invalidated++;
    });
    return stats;
  }

  if (!companyId && !isAdmin) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-2xl p-8 text-center">
          <Building2 className="w-12 h-12 text-blue-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">Vincula tu empresa</h2>
          <p className="text-slate-400 text-sm">Necesitas estar vinculado a una empresa para generar UCIDs.</p>
        </div>
      </div>
    );
  }

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
            <QrCode className="w-6 h-6 text-purple-400" />
            UCIDs - Identificadores unicos
          </h1>
          <p className="text-slate-400 text-sm mt-1">Genera QRs unicos por envase (SHA-256 + 512 bits de entropia)</p>
        </div>
        <button onClick={() => setShowForm(true)} className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors">
          <Plus className="w-4 h-4" /> Nuevo lote
        </button>
      </div>

      {/* Info card */}
      <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl px-4 py-3">
        <div className="flex items-start gap-3">
          <Hash className="w-5 h-5 text-purple-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-purple-300 text-sm font-medium">UCID - Unique Container ID</p>
            <p className="text-purple-400/70 text-xs mt-1">
              Cada envase obtiene un QR unico de 128 caracteres hex (512 bits). Probabilidad de colision: 10^-154.
              Ideal para trazabilidad REP verificable.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/15 border border-red-500/30 rounded-xl px-4 py-3 flex items-center gap-2 text-red-400 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {success && (
        <div className="bg-emerald-500/15 border border-emerald-500/30 rounded-xl px-4 py-3 flex items-center gap-2 text-emerald-400 text-sm">
          <CheckCircle2 className="w-4 h-4 shrink-0" /> {success}
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div className="bg-slate-900/60 border border-slate-700 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-white font-semibold">Nuevo lote de UCIDs</h2>
            <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-white">
              <span className="text-xl">&times;</span>
            </button>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Nombre del lote *</label>
              <input
                value={form.batch_name}
                onChange={e => setForm(f => ({ ...f, batch_name: e.target.value }))}
                placeholder="Ej: Lote Coca-Cola 500ml Junio 2026"
                className="w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-500 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Cantidad de UCIDs *</label>
              <input
                type="number"
                value={form.quantity}
                onChange={e => setForm(f => ({ ...f, quantity: parseInt(e.target.value) || 1000 }))}
                min={100}
                max={100000}
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500"
              />
              <p className="text-slate-500 text-xs mt-1">Min: 100 | Max: 100,000 | Costo: $45 COP por UCID</p>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Nombre del producto</label>
              <input
                value={form.product_name}
                onChange={e => setForm(f => ({ ...f, product_name: e.target.value }))}
                placeholder="Ej: Coca-Cola Personal 400ml"
                className="w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-500 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Marca</label>
              <input
                value={form.product_brand}
                onChange={e => setForm(f => ({ ...f, product_brand: e.target.value }))}
                placeholder="Ej: Coca-Cola"
                className="w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-500 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Tipo de envase</label>
              <select
                value={form.container_type}
                onChange={e => setForm(f => ({ ...f, container_type: e.target.value }))}
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500"
              >
                <option value="PET">PET - Botella plastica</option>
                <option value="Chuspa">Chuspa - Bolsa plastica</option>
                <option value="PP">PP - Polipropileno</option>
                <option value="PEAD">PEAD - Polietileno alta densidad</option>
                <option value="Otro">Otro tipo de plastico</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Notas</label>
              <input
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Observaciones..."
                className="w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-500 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="bg-slate-800/50 rounded-xl p-4">
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Subtotal ({form.quantity.toLocaleString('es-CO')} UCIDs x $45)</span>
              <span className="text-white font-semibold">${(form.quantity * 45).toLocaleString('es-CO')} COP</span>
            </div>
            <div className="flex justify-between text-xs mt-2">
              <span className="text-slate-500">Plataforma (12%)</span>
              <span className="text-slate-400">${Math.round(form.quantity * 45 * 0.12).toLocaleString('es-CO')} COP</span>
            </div>
            <div className="border-t border-slate-700 mt-3 pt-3 flex justify-between">
              <span className="text-white font-medium">Total</span>
              <span className="text-emerald-400 font-bold">${Math.round(form.quantity * 45 * 1.12).toLocaleString('es-CO')} COP</span>
            </div>
          </div>

          <div className="flex gap-3 justify-end">
            <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm transition-colors">
              Cancelar
            </button>
            <button onClick={handleCreate} disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}
              {saving ? 'Generando...' : 'Generar UCIDs'}
            </button>
          </div>
        </div>
      )}

      {/* Batches table */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Lote</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Prefijo</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Cantidad</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Estado</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Costo</th>
                <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Fecha</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {batches.map(batch => {
                const st = STATUS_CONFIG[batch.status] ?? STATUS_CONFIG.pending;
                return (
                  <tr key={batch.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-purple-500/15 border border-purple-500/20 flex items-center justify-center">
                          <QrCode className="w-4 h-4 text-purple-400" />
                        </div>
                        <div>
                          <p className="text-white text-sm font-medium">{batch.batch_name}</p>
                          <p className="text-slate-500 text-xs font-mono">{batch.id.slice(0, 8)}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <span className="font-mono text-slate-300 text-sm">{batch.ucid_prefix}</span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-white text-sm font-semibold">{batch.quantity.toLocaleString('es-CO')}</span>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border w-fit ${st.color}`}>
                        {st.icon} {st.label}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-amber-300 text-sm">${batch.total_price.toLocaleString('es-CO')}</span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-slate-400 text-xs">{new Date(batch.created_at).toLocaleDateString('es-CO')}</span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        {(batch.status === 'ready' || batch.status === 'printed') && (
                          <button
                            onClick={() => handleExport(batch.id)}
                            disabled={exporting === batch.id}
                            className="flex items-center gap-1 text-emerald-400 hover:bg-emerald-500/10 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                          >
                            {exporting === batch.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                            Exportar CSV
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {batches.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-slate-500 text-sm">
                    <QrCode className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No hay lotes de UCIDs. Crea tu primer lote para imprimir QRs unicos.
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