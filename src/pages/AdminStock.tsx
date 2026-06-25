import { useEffect, useState } from 'react';
import { supabase, Company, RewardStock } from '../lib/supabase';
import { Gift, Plus, AlertTriangle, CheckCircle2, Building2, RefreshCw, Loader2, Package, TrendingDown, Archive } from 'lucide-react';

type StockRow = RewardStock & { company?: Company | null };

export default function AdminStock() {
  const [stocks, setStocks] = useState<StockRow[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [tableExists, setTableExists] = useState(true);

  const [form, setForm] = useState({
    company_id: '',
    reward_type: 'refrigerio',
    total_stock: '',
    notes: '',
  });

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    const { data: co } = await supabase.from('companies').select('*').order('name');
    setCompanies((co ?? []) as Company[]);

    const { data: st, error } = await supabase
      .from('reward_stock')
      .select('*, company:companies(*)');

    if (error?.code === '42P01') {
      setTableExists(false);
      setLoading(false);
      return;
    }

    setStocks((st ?? []) as StockRow[]);
    setLoading(false);
  }

  async function handleAdd() {
    if (!form.total_stock || isNaN(Number(form.total_stock))) {
      setMsg({ type: 'err', text: 'Ingresa una cantidad válida' });
      return;
    }
    setSaving(true);
    setMsg(null);
    const qty = Number(form.total_stock);
    const payload = {
      company_id: form.company_id || null,
      reward_type: form.reward_type,
      total_stock: qty,
      remaining_stock: qty,
      notes: form.notes || null,
      is_active: true,
    };

    const existing = stocks.find(s =>
      (s.company_id ?? null) === (payload.company_id ?? null) && s.reward_type === payload.reward_type
    );

    if (existing) {
      const newTotal = existing.total_stock + qty;
      const newRemaining = existing.remaining_stock + qty;
      const { error } = await supabase.from('reward_stock').update({
        total_stock: newTotal,
        remaining_stock: newRemaining,
        notes: form.notes || existing.notes,
      }).eq('id', existing.id);
      if (error) { setMsg({ type: 'err', text: error.message }); setSaving(false); return; }
      setMsg({ type: 'ok', text: `Stock actualizado: +${qty} unidades` });
    } else {
      const { error } = await supabase.from('reward_stock').insert(payload);
      if (error) { setMsg({ type: 'err', text: error.message }); setSaving(false); return; }
      setMsg({ type: 'ok', text: 'Stock creado exitosamente' });
    }

    setForm({ company_id: '', reward_type: 'refrigerio', total_stock: '', notes: '' });
    setShowForm(false);
    await loadData();
    setSaving(false);
  }

  async function toggleActive(s: StockRow) {
    await supabase.from('reward_stock').update({ is_active: !s.is_active }).eq('id', s.id);
    await loadData();
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
    </div>
  );

  if (!tableExists) return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-6 h-6 text-amber-400 shrink-0" />
          <h2 className="text-amber-300 font-semibold text-lg">Tabla de stock no encontrada</h2>
        </div>
        <p className="text-slate-300 text-sm">Para activar la gestión de stock de refrigerios, ejecuta el siguiente SQL en el editor de Supabase (Dashboard → SQL Editor):</p>
        <pre className="bg-slate-900 border border-slate-700 rounded-xl p-4 text-xs text-emerald-300 overflow-x-auto whitespace-pre-wrap">{MIGRATION_SQL}</pre>
        <button onClick={loadData} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl text-sm transition-colors">
          <RefreshCw className="w-4 h-4" /> Verificar de nuevo
        </button>
      </div>
    </div>
  );

  const totalAll = stocks.reduce((s, r) => s + r.total_stock, 0);
  const remainAll = stocks.reduce((s, r) => s + r.remaining_stock, 0);
  const usedAll = totalAll - remainAll;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Gift className="w-6 h-6 text-amber-400" />
            Stock de Refrigerios
          </h1>
          <p className="text-slate-400 text-sm mt-1">Gestiona las unidades disponibles por empresa</p>
        </div>
        <button onClick={() => { setShowForm(true); setMsg(null); }} className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors">
          <Plus className="w-4 h-4" /> Agregar stock
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
          <Package className="w-5 h-5 text-blue-400 mb-3" />
          <p className="text-slate-400 text-xs mb-1">Total cargado</p>
          <p className="text-white text-2xl font-bold">{totalAll.toLocaleString('es-CO')}</p>
        </div>
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
          <Gift className="w-5 h-5 text-emerald-400 mb-3" />
          <p className="text-slate-400 text-xs mb-1">Disponibles</p>
          <p className="text-emerald-400 text-2xl font-bold">{remainAll.toLocaleString('es-CO')}</p>
        </div>
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
          <TrendingDown className="w-5 h-5 text-amber-400 mb-3" />
          <p className="text-slate-400 text-xs mb-1">Canjeados</p>
          <p className="text-amber-400 text-2xl font-bold">{usedAll.toLocaleString('es-CO')}</p>
        </div>
      </div>

      {/* Add form */}
      {showForm && (
        <div className="bg-slate-900/60 border border-slate-700 rounded-2xl p-6 space-y-4">
          <h2 className="text-white font-semibold flex items-center gap-2"><Plus className="w-4 h-4 text-amber-400" />Cargar nuevo stock</h2>
          {msg && (
            <div className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm ${msg.type === 'ok' ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400' : 'bg-red-500/15 border border-red-500/30 text-red-400'}`}>
              {msg.type === 'ok' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
              {msg.text}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Empresa (vacío = plataforma global)</label>
              <select value={form.company_id} onChange={e => setForm(f => ({ ...f, company_id: e.target.value }))}
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500 transition-colors">
                <option value="">— Todas las empresas —</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Tipo de recompensa</label>
              <select value={form.reward_type} onChange={e => setForm(f => ({ ...f, reward_type: e.target.value }))}
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500 transition-colors">
                <option value="refrigerio">Refrigerio</option>
                <option value="bono">Bono</option>
                <option value="producto">Producto</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Cantidad a cargar</label>
              <input type="number" min="1" value={form.total_stock} onChange={e => setForm(f => ({ ...f, total_stock: e.target.value }))}
                placeholder="Ej: 500"
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500 transition-colors placeholder-slate-600" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Notas (opcional)</label>
              <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Convenio Q2 2026..."
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500 transition-colors placeholder-slate-600" />
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={handleAdd} disabled={saving} className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
            <button onClick={() => { setShowForm(false); setMsg(null); }} className="bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-xl text-sm transition-colors">Cancelar</button>
          </div>
        </div>
      )}

      {/* Stock table */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Empresa</th>
              <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Recompensa</th>
              <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Total cargado</th>
              <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Disponibles</th>
              <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Canjeados</th>
              <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Estado</th>
              <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {stocks.map(s => {
              const used = s.total_stock - s.remaining_stock;
              const pct = s.total_stock > 0 ? (s.remaining_stock / s.total_stock) * 100 : 0;
              const statusColor = pct === 0 ? 'bg-red-500' : pct < 20 ? 'bg-amber-500' : 'bg-emerald-500';
              return (
                <tr key={s.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-teal-400 shrink-0" />
                      <div>
                        <p className="text-white text-sm font-medium">{s.company?.name ?? 'Plataforma global'}</p>
                        {s.notes && <p className="text-slate-500 text-xs">{s.notes}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4"><span className="capitalize text-slate-300 text-sm">{s.reward_type}</span></td>
                  <td className="px-5 py-4"><span className="text-white font-semibold">{s.total_stock.toLocaleString('es-CO')}</span></td>
                  <td className="px-5 py-4">
                    <div className="space-y-1">
                      <span className={`font-semibold text-sm ${pct === 0 ? 'text-red-400' : pct < 20 ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {s.remaining_stock.toLocaleString('es-CO')}
                      </span>
                      <div className="w-24 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div className={`h-full ${statusColor} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4"><span className="text-slate-400 text-sm">{used.toLocaleString('es-CO')}</span></td>
                  <td className="px-5 py-4">
                    {pct === 0 ? (
                      <span className="flex items-center gap-1.5 text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-1 rounded-full w-fit">
                        <Archive className="w-3 h-3" /> Agotado
                      </span>
                    ) : pct < 20 ? (
                      <span className="flex items-center gap-1.5 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded-full w-fit">
                        <AlertTriangle className="w-3 h-3" /> Bajo stock
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded-full w-fit">
                        <CheckCircle2 className="w-3 h-3" /> Disponible
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    <button onClick={() => toggleActive(s)} className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${s.is_active ? 'border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800' : 'border-emerald-700/50 text-emerald-500 hover:bg-emerald-500/10'}`}>
                      {s.is_active ? 'Pausar' : 'Activar'}
                    </button>
                  </td>
                </tr>
              );
            })}
            {stocks.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-12 text-center text-slate-500 text-sm">
                  <Gift className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  No hay stock registrado. Agrega el primer lote.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const MIGRATION_SQL = `-- Ejecuta esto en Supabase Dashboard → SQL Editor

-- 1. Agregar campos de aprobacion a companies (control de acceso por admin)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'is_approved') THEN
    ALTER TABLE companies ADD COLUMN is_approved boolean DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'approved_by') THEN
    ALTER TABLE companies ADD COLUMN approved_by uuid REFERENCES auth.users(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'approved_at') THEN
    ALTER TABLE companies ADD COLUMN approved_at timestamptz;
  END IF;
END $$;

-- Actualizar empresas existentes como aprobadas
UPDATE companies SET is_approved = true, approved_at = now() WHERE is_approved IS NULL OR is_approved = false;

-- 2. Tabla para gestionar stock de refrigerios
CREATE TABLE IF NOT EXISTS reward_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  reward_type text NOT NULL DEFAULT 'refrigerio',
  total_stock integer NOT NULL DEFAULT 0,
  remaining_stock integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT reward_stock_remaining_check CHECK (remaining_stock >= 0),
  CONSTRAINT reward_stock_total_check CHECK (total_stock >= 0),
  CONSTRAINT reward_stock_unique UNIQUE (company_id, reward_type)
);
ALTER TABLE reward_stock ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reward_stock_select" ON reward_stock FOR SELECT TO authenticated USING (true);
CREATE POLICY "reward_stock_insert" ON reward_stock FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "reward_stock_update" ON reward_stock FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')) WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "reward_stock_delete" ON reward_stock FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS stock_id uuid REFERENCES reward_stock(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_reward_stock_company ON reward_stock(company_id);
DROP TRIGGER IF EXISTS update_reward_stock_updated_at ON reward_stock;
CREATE TRIGGER update_reward_stock_updated_at BEFORE UPDATE ON reward_stock FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 3. Restriccion unica para evitar escaneos duplicados
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'unique_user_barcode'
    AND conrelid = 'scan_events'::regclass
  ) THEN
    ALTER TABLE scan_events ADD CONSTRAINT unique_user_barcode UNIQUE (user_id, barcode);
  END IF;
END $$;

-- 4. Actualizar RLS de scan_events para que empresas solo vean datos si estan aprobadas
DROP POLICY IF EXISTS "scan_events_select" ON scan_events;
CREATE POLICY "scan_events_select" ON scan_events FOR SELECT
  TO authenticated USING (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    OR EXISTS (
      SELECT 1 FROM profiles p
      JOIN companies c ON c.id = p.company_id
      WHERE p.id = auth.uid() AND p.role = 'company' AND c.id = scan_events.company_id AND c.is_approved = true
    )
  );

-- 5. Actualizar RLS de product_catalog para empresas aprobadas
DROP POLICY IF EXISTS "product_catalog_select" ON product_catalog;
CREATE POLICY "product_catalog_select" ON product_catalog FOR SELECT
  TO authenticated USING (
    company_id IS NULL
    OR EXISTS (
      SELECT 1 FROM companies c
      WHERE c.id = product_catalog.company_id AND c.is_approved = true
    )
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "product_catalog_update" ON product_catalog;
CREATE POLICY "product_catalog_update" ON product_catalog FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    OR EXISTS (
      SELECT 1 FROM profiles p
      JOIN companies c ON c.id = p.company_id
      WHERE p.id = auth.uid() AND p.role = 'company' AND c.id = product_catalog.company_id AND c.is_approved = true
    )
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    OR EXISTS (
      SELECT 1 FROM profiles p
      JOIN companies c ON c.id = p.company_id
      WHERE p.id = auth.uid() AND p.role = 'company' AND c.id = product_catalog.company_id AND c.is_approved = true
    )
  );`;
