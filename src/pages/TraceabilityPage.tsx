import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';
import { supabase, ScanEvent, ProductCatalog, Company, RecyclingLocation } from '../lib/supabase';
import {
  Package, Hash, MapPin, Clock, ChevronDown, Filter, Search,
  Download, Building2, Tag, LayoutList, Map as MapIcon, X,
  Navigation, Recycle
} from 'lucide-react';

type ScanWithDetails = ScanEvent & { product?: ProductCatalog; company?: Company };
type LocWithNotes = RecyclingLocation & { notes?: string };

declare global { interface Window { L: typeof import('leaflet'); } }

const MATERIAL_COLOR: Record<string, string> = {
  PET: '#10b981', Vidrio: '#3b82f6', Aluminio: '#f59e0b', Cartón: '#a78bfa',
};

function isAcopio(loc: LocWithNotes) {
  return loc.location_type === 'punto_acopio' || loc.name.toLowerCase().includes('acopio');
}

function loadLeaflet(): Promise<void> {
  return new Promise(resolve => {
    if (window.L) { resolve(); return; }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => resolve();
    document.head.appendChild(script);
  });
}

export default function TraceabilityPage() {
  const { profile } = useAuth();
  const [scans, setScans] = useState<ScanWithDetails[]>([]);
  const [locations, setLocations] = useState<LocWithNotes[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterSource, setFilterSource] = useState('all');
  const [filterBrand, setFilterBrand] = useState('all');
  const [filterDept, setFilterDept] = useState('all');
  const [sources, setSources] = useState<string[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [view, setView] = useState<'table' | 'map'>('table');
  const [selectedScan, setSelectedScan] = useState<ScanWithDetails | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<unknown>(null);

  useEffect(() => {
    if (!profile?.company_id && profile?.role !== 'admin') return;
    loadData();
  }, [profile]);

  useEffect(() => {
    if (view === 'map' && !loading) initMap();
  }, [view, scans, locations, filterDept, loading]);

  async function loadData() {
    let scanQ = supabase
      .from('scan_events')
      .select('*, product:product_catalog(*), company:companies(*)')
      .order('created_at', { ascending: false });
    if (profile?.company_id) scanQ = scanQ.eq('company_id', profile.company_id);

    const { data: scanData } = await scanQ;
    const { data: locData } = await supabase.from('recycling_locations').select('*').eq('is_active', true);

    const sc = (scanData ?? []) as ScanWithDetails[];
    const locs = (locData ?? []) as LocWithNotes[];
    setScans(sc);
    setLocations(locs);

    setSources([...new Set(sc.map(s => s.acquisition_source).filter(Boolean))] as string[]);
    setBrands([...new Set(sc.map(s => s.product?.brand ?? (s.scan_data as Record<string, string>)?.brand_name).filter(Boolean))] as string[]);
    setDepartments([...new Set(locs.map(l => l.department).filter(Boolean))].sort() as string[]);
    setLoading(false);
  }

  async function initMap() {
    await loadLeaflet();
    const L = window.L;
    if (!L || !mapRef.current) return;

    if (leafletMap.current) {
      (leafletMap.current as { remove: () => void }).remove();
      leafletMap.current = null;
    }

    const map = L.map(mapRef.current, { zoomControl: true }).setView([4.0, -75.0], 6);
    leafletMap.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors', maxZoom: 19,
    }).addTo(map);

    // Scan pins
    const geoScans = filtered.filter(s => s.location_lat && s.location_lng);
    geoScans.forEach(s => {
      const sd = s.scan_data as Record<string, string> | null;
      const mat = sd?.material_type?.split(' ')[0] ?? s.product?.material ?? 'PET';
      const color = MATERIAL_COLOR[mat] ?? '#10b981';
      const icon = L.divIcon({
        html: `<div style="width:10px;height:10px;background:${color};border:2px solid white;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
        className: '', iconSize: [10, 10], iconAnchor: [5, 5],
      });
      L.marker([s.location_lat!, s.location_lng!], { icon }).addTo(map)
        .bindPopup(`<b>${s.product?.name ?? 'Desconocido'}</b><br/><small>${s.product?.brand ?? sd?.brand_name ?? ''}</small>`);
    });

    // Location pins
    const filteredLocs = filterDept === 'all' ? locations : locations.filter(l => l.department === filterDept);
    filteredLocs.forEach(loc => {
      const acopio = isAcopio(loc);
      const color = acopio ? '#f59e0b' : loc.location_type === 'ecoparque' ? '#14b8a6' : '#10b981';
      const sz = acopio ? 18 : 13;
      const inner = acopio
        ? `<rect width="${sz}" height="${sz}" rx="4" fill="${color}" stroke="white" stroke-width="2"/><text x="${sz/2}" y="${sz/2+3}" text-anchor="middle" fill="white" font-size="7" font-family="sans-serif" font-weight="bold">A</text>`
        : `<circle cx="${sz/2}" cy="${sz/2}" r="${sz/2-1.5}" fill="${color}" stroke="white" stroke-width="2"/>`;
      const iconUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${sz}" height="${sz}">${inner}</svg>`)}`;
      L.marker([loc.lat, loc.lng], { icon: L.icon({ iconUrl, iconSize: [sz, sz], iconAnchor: [sz/2, sz/2], popupAnchor: [0, -sz/2] }) })
        .addTo(map)
        .bindPopup(`<b>${loc.name}</b><br/><small>${loc.address ?? ''}</small><br/><small>${loc.city ?? ''}${loc.department ? ', ' + loc.department : ''}</small>${loc.schedule ? `<br/><small>Horario: ${loc.schedule}</small>` : ''}`);
    });

    const allPts: [number, number][] = [
      ...geoScans.map(s => [s.location_lat!, s.location_lng!] as [number, number]),
      ...filteredLocs.map(l => [l.lat, l.lng] as [number, number]),
    ];
    if (allPts.length > 0) {
      try { map.fitBounds(L.latLngBounds(allPts), { padding: [40, 40], maxZoom: 13 }); } catch { /* */ }
    }
  }

  const filtered = scans.filter(s => {
    const sd = s.scan_data as Record<string, string> | null;
    const brand = s.product?.brand ?? sd?.brand_name ?? '';
    return (
      (!search || s.barcode.includes(search) || (s.acquisition_source ?? '').toLowerCase().includes(search.toLowerCase()) || (s.product?.name ?? '').toLowerCase().includes(search.toLowerCase()) || brand.toLowerCase().includes(search.toLowerCase()) || (s.company?.name ?? '').toLowerCase().includes(search.toLowerCase())) &&
      (filterSource === 'all' || s.acquisition_source === filterSource) &&
      (filterBrand === 'all' || brand === filterBrand)
    );
  });

  const accopioLocs = locations.filter(l => isAcopio(l) && (filterDept === 'all' || l.department === filterDept));
  const recyclingLocs = locations.filter(l => !isAcopio(l) && (filterDept === 'all' || l.department === filterDept));

  function exportCSV() {
    const headers = ['Producto', 'Marca', 'Empresa', 'Fuente', 'Industria', 'Material', 'Token SHA-256', 'Lat', 'Lng', 'Fecha'];
    const rows = filtered.map(s => {
      const sd = s.scan_data as Record<string, string> | null;
      return [s.product?.name ?? 'Desconocido', s.product?.brand ?? sd?.brand_name ?? '', s.company?.name ?? '', s.acquisition_source ?? '', sd?.industry_type ?? s.product?.category ?? '', sd?.material_type ?? s.product?.material ?? '', s.token_hash, s.location_lat ?? '', s.location_lng ?? '', s.created_at];
    });
    const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'trazabilidad.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Package className="w-6 h-6 text-emerald-400" />
            Trazabilidad
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            {scans.length} registros · {accopioLocs.length} punto{accopioLocs.length !== 1 ? 's' : ''} de acopio
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-slate-900/60 border border-slate-800 rounded-xl p-1">
            <button onClick={() => setView('table')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${view === 'table' ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-400 hover:text-white'}`}>
              <LayoutList className="w-3.5 h-3.5" /> Tabla
            </button>
            <button onClick={() => setView('map')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${view === 'map' ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-400 hover:text-white'}`}>
              <MapIcon className="w-3.5 h-3.5" /> Mapa
            </button>
          </div>
          <button onClick={exportCSV} className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-xl text-sm transition-colors">
            <Download className="w-4 h-4" /> CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar producto, marca, empresa..." className="w-full bg-slate-900/60 border border-slate-800 text-white placeholder-slate-500 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors" />
        </div>
        {view === 'table' && (
          <>
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <select value={filterSource} onChange={e => setFilterSource(e.target.value)} className="bg-slate-900/60 border border-slate-800 text-white rounded-xl pl-9 pr-8 py-2.5 text-sm focus:outline-none focus:border-emerald-500 appearance-none transition-colors">
                <option value="all">Todas las fuentes</option>
                {sources.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            </div>
            {brands.length > 0 && (
              <div className="relative">
                <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <select value={filterBrand} onChange={e => setFilterBrand(e.target.value)} className="bg-slate-900/60 border border-slate-800 text-white rounded-xl pl-9 pr-8 py-2.5 text-sm focus:outline-none focus:border-emerald-500 appearance-none transition-colors">
                  <option value="all">Todas las marcas</option>
                  {brands.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              </div>
            )}
          </>
        )}
        {view === 'map' && departments.length > 0 && (
          <div className="relative">
            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <select value={filterDept} onChange={e => setFilterDept(e.target.value)} className="bg-slate-900/60 border border-slate-800 text-white rounded-xl pl-9 pr-8 py-2.5 text-sm focus:outline-none focus:border-emerald-500 appearance-none transition-colors">
              <option value="all">Todos los departamentos</option>
              {departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          </div>
        )}
      </div>

      {view === 'map' ? (
        <div className="grid lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2">
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2 flex-wrap">
                <MapIcon className="w-4 h-4 text-emerald-400" />
                <span className="text-white text-sm font-medium">Mapa de trazabilidad y acopio</span>
                <div className="flex items-center gap-3 ml-auto text-xs text-slate-400">
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-400 inline-block" style={{ borderRadius: '3px' }} />Acopio</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-emerald-400 inline-block" />Escaneo</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-teal-400 inline-block" />Ecoparque</span>
                </div>
              </div>
              <div ref={mapRef} className="h-[480px] w-full" style={{ background: '#0f172a' }} />
            </div>
          </div>

          <div className="space-y-4">
            {/* Puntos de acopio */}
            <div className="bg-slate-900/60 border border-amber-500/20 rounded-2xl p-4">
              <h3 className="text-amber-400 text-xs font-bold uppercase tracking-wide flex items-center gap-2 mb-3">
                <span className="w-5 h-5 rounded bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 font-bold text-[9px]">A</span>
                Puntos de Acopio ({accopioLocs.length})
              </h3>
              {accopioLocs.length === 0 ? (
                <p className="text-slate-500 text-xs py-3 text-center">Sin puntos de acopio</p>
              ) : (
                <div className="space-y-2">
                  {accopioLocs.map(loc => (
                    <div key={loc.id} className="p-3 bg-amber-500/5 border border-amber-500/10 rounded-xl hover:border-amber-500/30 transition-colors">
                      <p className="text-white text-xs font-semibold leading-tight">{loc.name}</p>
                      <p className="text-slate-400 text-xs mt-0.5">{loc.address}</p>
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-amber-400 text-xs font-medium">{loc.city}, {loc.department}</span>
                        <a href={`https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1 text-emerald-400 text-xs hover:text-emerald-300 transition-colors">
                          <Navigation className="w-3 h-3" /> Cómo llegar
                        </a>
                      </div>
                      {loc.schedule && <p className="text-slate-500 text-xs mt-1"><Clock className="w-3 h-3 inline mr-1" />{loc.schedule}</p>}
                      {loc.notes && <p className="text-slate-500 text-xs mt-1 italic">{loc.notes}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Other recycling locations */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4">
              <h3 className="text-white font-semibold text-xs uppercase tracking-wide flex items-center gap-2 mb-3">
                <Recycle className="w-4 h-4 text-emerald-400" />
                Puntos de Reciclaje ({recyclingLocs.length})
              </h3>
              <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                {recyclingLocs.slice(0, 10).map(loc => (
                  <div key={loc.id} className="flex items-start gap-2 p-2 rounded-lg hover:bg-slate-800/40 transition-colors">
                    <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-white text-xs font-medium leading-tight">{loc.name}</p>
                      <p className="text-slate-500 text-xs">{loc.city}{loc.department ? ', ' + loc.department : ''}</p>
                    </div>
                  </div>
                ))}
                {recyclingLocs.length > 10 && <p className="text-slate-600 text-xs text-center pt-1">+{recyclingLocs.length - 10} más</p>}
              </div>
            </div>

            {/* Material legend */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4">
              <h3 className="text-slate-400 font-medium text-xs uppercase tracking-wide mb-2">Color por material</h3>
              <div className="space-y-1.5">
                {Object.entries(MATERIAL_COLOR).map(([mat, color]) => (
                  <div key={mat} className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ background: color }} />
                    <span className="text-slate-400 text-xs">{mat}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
          {/* Acopio points strip */}
          {accopioLocs.length > 0 && (
            <div className="px-5 py-3 border-b border-amber-500/10 bg-amber-500/5 flex items-center gap-3 flex-wrap">
              <span className="text-amber-400 text-xs font-bold flex items-center gap-1.5 uppercase tracking-wide">
                <span className="w-4 h-4 rounded bg-amber-500/20 border border-amber-500/30 flex items-center justify-center font-bold text-amber-400 text-[8px]">A</span>
                Puntos de acopio:
              </span>
              {accopioLocs.map(loc => (
                <div key={loc.id} className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 rounded-full px-3 py-1">
                  <Building2 className="w-3 h-3 text-amber-400" />
                  <span className="text-amber-300 text-xs font-medium">{loc.name}</span>
                  <span className="text-amber-500/60 text-xs">{loc.city}</span>
                </div>
              ))}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Producto</th>
                  <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Marca</th>
                  <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Empresa</th>
                  <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Fuente</th>
                  <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Industria</th>
                  <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Material</th>
                  <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Token</th>
                  <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Fecha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {filtered.slice(0, 50).map(scan => {
                  const sd = scan.scan_data as Record<string, string> | null;
                  const brand = scan.product?.brand ?? sd?.brand_name ?? '-';
                  const industry = sd?.industry_type ?? scan.product?.category ?? '-';
                  const material = sd?.material_type?.split(' ')[0] ?? scan.product?.material ?? '-';
                  const matColor = MATERIAL_COLOR[material];
                  return (
                    <tr key={scan.id} onClick={() => setSelectedScan(selectedScan?.id === scan.id ? null : scan)}
                      className="hover:bg-slate-800/30 transition-colors cursor-pointer">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          {scan.product?.image_url ? (
                            <img src={scan.product.image_url} alt={scan.product.name} className="w-8 h-8 rounded-lg object-cover bg-slate-800" />
                          ) : (
                            <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center">
                              <Package className="w-3.5 h-3.5 text-slate-500" />
                            </div>
                          )}
                          <div>
                            <p className="text-white text-sm font-medium truncate max-w-28">{scan.product?.name ?? 'Desconocido'}</p>
                            <div className="flex items-center gap-1">
                              <Hash className="w-3 h-3 text-slate-500" />
                              <span className="text-slate-500 text-xs font-mono">{scan.barcode}</span>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`text-xs px-2 py-1 rounded-full border ${brand !== '-' ? 'bg-blue-500/10 text-blue-300 border-blue-500/20' : 'text-slate-500 border-transparent'}`}>
                          {brand}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        {scan.company ? (
                          <div className="flex items-center gap-1.5">
                            <Building2 className="w-3.5 h-3.5 text-teal-400" />
                            <span className="text-teal-300 text-xs font-medium">{scan.company.name}</span>
                          </div>
                        ) : <span className="text-slate-600 text-xs">-</span>}
                      </td>
                      <td className="px-5 py-3">
                        <span className="text-slate-300 text-xs bg-slate-800 px-2 py-1 rounded-full border border-slate-700">
                          {scan.acquisition_source ?? '-'}
                        </span>
                      </td>
                      <td className="px-5 py-3"><span className="text-slate-400 text-xs">{industry}</span></td>
                      <td className="px-5 py-3">
                        <span className="text-xs px-2 py-0.5 rounded font-medium"
                          style={matColor ? { background: `${matColor}20`, color: matColor } : { color: '#64748b' }}>
                          {material}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span className="font-mono text-xs text-emerald-400 bg-emerald-500/5 px-2 py-1 rounded">
                          {scan.token_hash?.slice(0, 14)}...
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-1 text-slate-400 text-xs">
                          <Clock className="w-3 h-3" />
                          {new Date(scan.created_at).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: '2-digit' })}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-5 py-12 text-center text-slate-500 text-sm">
                      <Package className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      No hay datos de trazabilidad
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {filtered.length > 50 && (
            <div className="px-5 py-3 border-t border-slate-800 text-center text-slate-500 text-xs">
              Mostrando 50 de {filtered.length} registros
            </div>
          )}
        </div>
      )}

      {/* Scan detail side panel */}
      {selectedScan && view === 'table' && (
        <div className="fixed inset-y-0 right-0 w-80 bg-slate-900 border-l border-slate-800 shadow-2xl z-50 flex flex-col overflow-y-auto">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
            <h3 className="text-white font-semibold text-sm">Detalle del escaneo</h3>
            <button onClick={() => setSelectedScan(null)} className="text-slate-400 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="p-5 space-y-4 flex-1">
            {selectedScan.product?.image_url && (
              <img src={selectedScan.product.image_url} alt="" className="w-full h-36 object-contain rounded-xl bg-slate-800 border border-slate-700" />
            )}
            <div>
              <p className="text-white font-semibold">{selectedScan.product?.name ?? 'Producto desconocido'}</p>
              <p className="text-slate-400 text-sm">{selectedScan.product?.brand ?? (selectedScan.scan_data as Record<string, string>)?.brand_name ?? ''}</p>
            </div>
            {[
              { label: 'Código', value: selectedScan.barcode },
              { label: 'Empresa', value: selectedScan.company?.name ?? '-' },
              { label: 'Fuente', value: selectedScan.acquisition_source ?? '-' },
              { label: 'Industria', value: (selectedScan.scan_data as Record<string, string>)?.industry_type ?? selectedScan.product?.category ?? '-' },
              { label: 'Material', value: (selectedScan.scan_data as Record<string, string>)?.material_type ?? selectedScan.product?.material ?? '-' },
              { label: 'Estado envase', value: (selectedScan.scan_data as Record<string, string>)?.container_condition ?? '-' },
              { label: 'Fecha', value: new Date(selectedScan.created_at).toLocaleDateString('es-CO', { dateStyle: 'long' }) },
              { label: 'Puntos', value: `+${selectedScan.points_earned}` },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between items-start py-2 border-b border-slate-800 last:border-0">
                <span className="text-slate-500 text-xs">{label}</span>
                <span className="text-white text-xs font-medium text-right max-w-40">{value}</span>
              </div>
            ))}
            <div className="bg-slate-800/60 rounded-xl p-3">
              <p className="text-slate-500 text-xs mb-1">Token SHA-256</p>
              <p className="font-mono text-xs text-emerald-400 break-all">{selectedScan.token_hash}</p>
            </div>
            {selectedScan.location_lat && selectedScan.location_lng && (
              <a href={`https://www.google.com/maps/search/?api=1&query=${selectedScan.location_lat},${selectedScan.location_lng}`}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-emerald-400 text-sm hover:text-emerald-300 transition-colors">
                <Navigation className="w-4 h-4" /> Ver ubicación del escaneo
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
