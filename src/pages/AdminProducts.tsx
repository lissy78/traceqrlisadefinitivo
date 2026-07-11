import { useEffect, useState } from 'react';
import { supabase, ProductCatalog } from '../lib/supabase';
import { Package, Search, Trash2, ExternalLink, RefreshCw, Database, Loader2 } from 'lucide-react';

export default function AdminProducts() {
  const [products, setProducts] = useState<ProductCatalog[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProducts();

    const channel = supabase
      .channel('product_catalog_rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'product_catalog' }, () => { loadProducts(); })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  async function loadProducts() {
    const { data } = await supabase
      .from('product_catalog')
      .select('*')
      .order('scan_count', { ascending: false });
    setProducts((data ?? []) as ProductCatalog[]);
    setLoading(false);
  }

  async function handleDelete(id: string) {
    if (!confirm('¿Eliminar este producto del catálogo?')) return;
    await supabase.from('product_catalog').delete().eq('id', id);
    await loadProducts();
  }

  const filtered = products.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.barcode ?? '').includes(search) ||
    (p.brand ?? '').toLowerCase().includes(search.toLowerCase())
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
            <Package className="w-6 h-6 text-violet-400" />
            Catálogo de productos
          </h1>
          <p className="text-slate-400 text-sm mt-1">{products.length} productos registrados</p>
        </div>
        <button onClick={loadProducts} className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white px-3 py-2 rounded-xl text-sm transition-colors">
          <RefreshCw className="w-4 h-4" /> Actualizar
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 text-center">
          <Database className="w-5 h-5 text-violet-400 mx-auto mb-1" />
          <p className="text-white font-bold text-xl">{products.length}</p>
          <p className="text-slate-500 text-xs">Total productos</p>
        </div>
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 text-center">
          <Package className="w-5 h-5 text-blue-400 mx-auto mb-1" />
          <p className="text-white font-bold text-xl">{products.filter(p => p.off_data).length}</p>
          <p className="text-slate-500 text-xs">Con datos OFF</p>
        </div>
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 text-center">
          <RefreshCw className="w-5 h-5 text-emerald-400 mx-auto mb-1" />
          <p className="text-white font-bold text-xl">{products.reduce((s, p) => s + (p.scan_count ?? 0), 0)}</p>
          <p className="text-slate-500 text-xs">Escaneos totales</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nombre, código o marca..." className="w-full bg-slate-900/60 border border-slate-800 text-white placeholder-slate-500 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors" />
      </div>

      {/* Products grid */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map(p => (
          <div key={p.id} className="bg-slate-900/60 border border-slate-800 hover:border-slate-700 rounded-2xl p-4 transition-colors">
            <div className="flex items-start gap-3">
              {p.image_url ? (
                <img src={p.image_url} alt={p.name} className="w-12 h-12 rounded-xl object-cover bg-slate-800 shrink-0" />
              ) : (
                <div className="w-12 h-12 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0">
                  <Package className="w-5 h-5 text-slate-500" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-medium truncate">{p.name}</p>
                {p.brand && <p className="text-slate-400 text-xs">{p.brand}</p>}
                <p className="text-slate-600 text-xs font-mono">{p.barcode}</p>
              </div>
            </div>
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-800">
              <div className="flex items-center gap-2">
                <span className="text-xs bg-slate-800 text-slate-400 border border-slate-700 rounded-full px-2 py-0.5">
                  {p.material ?? 'PET'}
                </span>
                <span className="text-xs text-emerald-400 font-semibold">{p.scan_count ?? 0} scans</span>
                {p.off_data && (
                  <span className="text-xs bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-full px-1.5 py-0.5">OFF</span>
                )}
              </div>
              <button onClick={() => handleDelete(p.id)} className="text-slate-500 hover:text-red-400 p-1 rounded-lg hover:bg-red-500/10 transition-all">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full py-12 text-center text-slate-500">
            <Package className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p>No hay productos en el catálogo aún</p>
            <p className="text-xs mt-1">Se agregan automáticamente al escanear</p>
          </div>
        )}
      </div>
    </div>
  );
}
