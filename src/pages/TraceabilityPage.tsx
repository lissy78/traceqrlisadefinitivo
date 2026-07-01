import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';
import { supabase, ScanEvent, ProductCatalog, Company, RecyclingLocation } from '../lib/supabase';
import {
  Package, Hash, MapPin, Clock, ChevronDown, Filter, Search,
  Download, Building2, Tag, LayoutList, Map as MapIcon, X,
  Navigation, Recycle, QrCode, CheckCircle2, AlertCircle,
  Loader2, Calendar, Star, User, Barcode, TrendingUp,
  ArrowRight, Leaf, Scan
} from 'lucide-react';

type ScanWithDetails = ScanEvent & { product?: ProductCatalog; company?: Company };
type LocWithNotes = RecyclingLocation & { notes?: string };
type ViewMode = 'table' | 'map' | 'tracker';

declare global { interface Window { L: typeof import('leaflet'); } }

const MATERIAL_COLOR: Record<string, string> = {
  PET: '#10b981', Vidrio: '#3b82f6', Aluminio: '#f59e0b', Cartón: '#a78bfa',
};

interface TraceStep {
  id: string;
  status: 'generated' | 'printed' | 'sold' | 'scanned' | 'delivered' | 'processed';
  label: string;
  description: string;
  date: string | null;
  location: string | null;
  lat: number | null;
  lng: number | null;
  meta?: Record<string, string>;
}

interface TraceResult {
  ucid?: {
    short_code: string;
    ucid_hash: string;
    product_name: string | null;
    product_brand: string | null;
    container_type: string;
    status: string;
    created_at: string;
    scanned_at: string | null;
    company_name?: string;
    batch_name?: string;
  };
  scan?: ScanWithDetails;
  steps: TraceStep[];
}

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
  const [view, setView] = useState<ViewMode>('tracker');
  const [selectedScan, setSelectedScan] = useState<ScanWithDetails | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<unknown>(null);

  // Tracker state
  const [trackerQuery, setTrackerQuery] = useState('');
  const [trackerLoading, setTrackerLoading] = useState(false);
  const [trackerResult, setTrackerResult] = useState<TraceResult | null>(null);
  const [trackerError, setTrackerError] = useState('');

  useEffect(() => {
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
    if (profile?.role === 'company' && profile?.company_id) {
      scanQ = scanQ.eq('company_id', profile.company_id);
    } else if (profile?.role === 'student') {
      scanQ = scanQ.eq('user_id', profile.id);
    }

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

  async function runTracker() {
    const q = trackerQuery.trim();
    if (!q) return;
    setTrackerLoading(true);
    setTrackerError('');
    setTrackerResult(null);

    try {
      // Try UCID by short_code first - only if code contains at least one letter (not a pure barcode)
      const isHex128 = /^[a-f0-9]{128}$/i.test(q);
      const urlMatch = q.match(/\/s\/([A-Z0-9]{8})\//i);
      const isUCIDCode = /^[A-Z0-9]{8}$/i.test(q) && /[A-Z]/i.test(q); // Must have letters
      const lookupCode = urlMatch?.[1] ?? (isUCIDCode ? q.toUpperCase() : null);

      let ucidData: Record<string, unknown> | null = null;

      if (isHex128) {
        const { data } = await supabase
          .from('ucids')
          .select('*, company:companies(name)')
          .eq('ucid_hash', q.toLowerCase())
          .maybeSingle();
        if (data) {
          const { data: batch } = await supabase.from('ucid_batches').select('batch_name').eq('id', (data as Record<string, unknown>).batch_id as string).maybeSingle();
          ucidData = { ...data, batch } as Record<string, unknown>;
        }
      } else if (lookupCode) {
        const { data } = await supabase
          .from('ucids')
          .select('*, company:companies(name)')
          .eq('short_code', lookupCode)
          .maybeSingle();
        if (data) {
          const { data: batch } = await supabase.from('ucid_batches').select('batch_name').eq('id', (data as Record<string, unknown>).batch_id as string).maybeSingle();
          ucidData = { ...data, batch } as Record<string, unknown>;
        }
      }

      // Also try barcode or token hash search
      let scanData: ScanWithDetails | null = null;
      // Try barcode exact match first
      const { data: scanByBarcode } = await supabase
        .from('scan_events')
        .select('*, product:product_catalog(*), company:companies(*)')
        .eq('barcode', q)
        .order('created_at', { ascending: false })
        .maybeSingle();
      scanData = scanByBarcode as ScanWithDetails | null;

      // If no match, try token hash prefix (for SHA-256 lookup)
      if (!scanData && q.length >= 16 && /^[a-f0-9]+$/i.test(q)) {
        const { data: scanByToken } = await supabase
          .from('scan_events')
          .select('*, product:product_catalog(*), company:companies(*)')
          .like('token_hash', `${q.slice(0, 32)}%`)
          .maybeSingle();
        scanData = scanByToken as ScanWithDetails | null;
      }

      // If UCID has scan_event_id, get its scan
      if (ucidData?.scan_event_id) {
        const { data: ucidScan } = await supabase
          .from('scan_events')
          .select('*, product:product_catalog(*), company:companies(*)')
          .eq('id', ucidData.scan_event_id as string)
          .maybeSingle();
        if (ucidScan) scanData = ucidScan as ScanWithDetails;
      }

      if (!ucidData && !scanData) {
        setTrackerError('No se encontró ningún envase con ese código. Verifica que el código sea correcto.');
        setTrackerLoading(false);
        return;
      }

      // Build journey steps
      const steps: TraceStep[] = [];
      const sd = scanData?.scan_data as Record<string, string> | null;

      if (ucidData) {
        const company = ucidData.company as { name: string } | null;
        const batch = ucidData.batch as { batch_name: string } | null;

        steps.push({
          id: 'generated',
          status: 'generated',
          label: 'UCID generado',
          description: `Código único creado para el envase${batch?.batch_name ? ` · Lote: ${batch.batch_name}` : ''}`,
          date: ucidData.created_at as string,
          location: company?.name ?? null,
          lat: null, lng: null,
          meta: {
            'Empresa': company?.name ?? 'N/A',
            'Tipo de envase': (ucidData.container_type as string) ?? 'PET',
            'Producto': (ucidData.product_name as string) ?? 'N/A',
            'Marca': (ucidData.product_brand as string) ?? 'N/A',
          },
        });

        if (ucidData.status === 'printed' || ucidData.status === 'scanned') {
          steps.push({
            id: 'printed',
            status: 'printed',
            label: 'QR impreso y aplicado',
            description: 'El código QR fue impreso y aplicado al envase en la planta',
            date: ucidData.created_at as string,
            location: company?.name ?? null,
            lat: null, lng: null,
          });
        }
      }

      if (scanData) {
        steps.push({
          id: 'scanned',
          status: 'scanned',
          label: 'Envase escaneado',
          description: `El usuario entregó el envase en ${sd?.collection_point ?? 'punto de acopio'}`,
          date: scanData.created_at,
          location: sd?.collection_point ?? sd?.location ?? null,
          lat: scanData.location_lat,
          lng: scanData.location_lng,
          meta: {
            'Marca': sd?.resolved_brand ?? sd?.brand_name ?? scanData.product?.brand ?? 'N/A',
            'Material': sd?.material_type ?? scanData.product?.material ?? 'N/A',
            'Fuente': scanData.acquisition_source ?? 'N/A',
            'Industria': sd?.industry_type ?? 'N/A',
            'Estado envase': sd?.container_condition ?? 'N/A',
            'Tamaño': sd?.container_size ?? 'N/A',
            'Puntos': `+${scanData.points_earned}`,
          },
        });

        steps.push({
          id: 'delivered',
          status: 'delivered',
          label: 'En punto de acopio',
          description: 'El envase está en proceso de clasificación y verificación',
          date: scanData.created_at,
          location: sd?.collection_point ?? null,
          lat: scanData.location_lat,
          lng: scanData.location_lng,
        });

        steps.push({
          id: 'processed',
          status: 'processed',
          label: 'Procesado y reciclado',
          description: 'El material será procesado por la planta de reciclaje asociada',
          date: null,
          location: null,
          lat: null, lng: null,
        });
      }

      const result: TraceResult = {
        ucid: ucidData ? {
          short_code: ucidData.short_code as string,
          ucid_hash: ucidData.ucid_hash as string,
          product_name: ucidData.product_name as string | null,
          product_brand: ucidData.product_brand as string | null,
          container_type: ucidData.container_type as string,
          status: ucidData.status as string,
          created_at: ucidData.created_at as string,
          scanned_at: ucidData.scanned_at as string | null,
          company_name: (ucidData.company as { name: string } | null)?.name,
          batch_name: (ucidData.batch as { batch_name: string } | null)?.batch_name,
        } : undefined,
        scan: scanData ?? undefined,
        steps,
      };
      setTrackerResult(result);
    } catch {
      setTrackerError('Error al consultar el sistema. Intenta de nuevo.');
    }
    setTrackerLoading(false);
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
    const now = new Date();
    // Analytics summary block
    const totalScans = filtered.length;
    const totalPoints = filtered.reduce((s, sc) => s + (sc.points_earned ?? 0), 0);
    const uniqueUsers = new Set(filtered.map(s => s.user_id)).size;
    const uniqueBrands = new Set(filtered.map(s => s.product?.brand ?? (s.scan_data as Record<string, string>)?.brand_name).filter(Boolean)).size;
    const uniqueCompanies = new Set(filtered.map(s => s.company_id).filter(Boolean)).size;
    const byMaterial = filtered.reduce<Record<string, number>>((acc, s) => {
      const sd = s.scan_data as Record<string, string> | null;
      const mat = sd?.material_type?.split(' ')[0] ?? s.product?.material ?? 'Desconocido';
      acc[mat] = (acc[mat] ?? 0) + 1;
      return acc;
    }, {});
    const bySource = filtered.reduce<Record<string, number>>((acc, s) => {
      const src = s.acquisition_source ?? 'Desconocido';
      acc[src] = (acc[src] ?? 0) + 1;
      return acc;
    }, {});
    const byBrand = filtered.reduce<Record<string, number>>((acc, s) => {
      const sd = s.scan_data as Record<string, string> | null;
      const br = sd?.resolved_brand ?? sd?.brand_name ?? s.product?.brand ?? 'Desconocido';
      acc[br] = (acc[br] ?? 0) + 1;
      return acc;
    }, {});

    const summaryRows = [
      ['=== RESUMEN EJECUTIVO DE TRAZABILIDAD ==='],
      [`Generado: ${now.toLocaleString('es-CO')}`],
      [`Periodo: Todos los registros`],
      [],
      ['INDICADORES CLAVE (KPIs)'],
      [`Total de escaneos,${totalScans}`],
      [`Usuarios únicos,${uniqueUsers}`],
      [`Empresas rastreadas,${uniqueCompanies}`],
      [`Marcas distintas,${uniqueBrands}`],
      [`Puntos totales generados,${totalPoints}`],
      [],
      ['DISTRIBUCIÓN POR MATERIAL'],
      ...Object.entries(byMaterial).map(([mat, cnt]) => [`${mat},${cnt},${((cnt / totalScans) * 100).toFixed(1)}%`]),
      [],
      ['DISTRIBUCIÓN POR FUENTE DE ADQUISICIÓN'],
      ...Object.entries(bySource).map(([src, cnt]) => [`${src},${cnt},${((cnt / totalScans) * 100).toFixed(1)}%`]),
      [],
      ['DISTRIBUCIÓN POR MARCA'],
      ...Object.entries(byBrand).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([br, cnt]) => [`${br},${cnt},${((cnt / totalScans) * 100).toFixed(1)}%`]),
      [],
      ['=== DETALLE DE TRAZABILIDAD ==='],
      [],
    ];

    // Detail headers
    const headers = [
      'ID_Escaneo', 'Fecha', 'Hora',
      'Producto', 'Marca_Detectada', 'Marca_Confirmada', 'Empresa', 'Industria',
      'Material', 'Tamaño_Envase', 'Condición_Envase',
      'Fuente_Adquisición', 'Punto_Acopio',
      'Latitud_GPS', 'Longitud_GPS',
      'Puntos_Ganados', 'Tipo_Escaneo',
      'Código_Barras', 'Token_SHA256',
      'Empresa_ID', 'Producto_ID',
    ];

    const rows = filtered.map(s => {
      const sd = s.scan_data as Record<string, string> | null;
      const d = new Date(s.created_at);
      return [
        s.id,
        d.toLocaleDateString('es-CO'),
        d.toLocaleTimeString('es-CO'),
        s.product?.name ?? 'Desconocido',
        s.product?.brand ?? sd?.brand_name ?? '',
        sd?.resolved_brand ?? sd?.brand_name ?? s.product?.brand ?? '',
        s.company?.name ?? '',
        sd?.industry_type ?? s.product?.category ?? '',
        sd?.material_type?.split(' ')[0] ?? s.product?.material ?? '',
        sd?.container_size ?? '',
        sd?.container_condition ?? '',
        s.acquisition_source ?? '',
        sd?.collection_point ?? '',
        s.location_lat ?? '',
        s.location_lng ?? '',
        s.points_earned ?? 10,
        s.scan_type,
        s.barcode,
        s.token_hash,
        s.company_id ?? '',
        s.product_id ?? '',
      ];
    });

    const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const summarySection = summaryRows.map(row => (Array.isArray(row) ? row.join(',') : String(row)));
    const detailSection = [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))];

    const csv = [...summarySection, ...detailSection].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trazabilidad_completa_${now.toISOString().slice(0, 10)}.csv`;
    a.click();
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
            {scans.length} registros · Rastrea el ciclo de vida de cada envase
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-slate-900/60 border border-slate-800 rounded-xl p-1">
            <button
              onClick={() => setView('tracker')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${view === 'tracker' ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-400 hover:text-white'}`}
            >
              <QrCode className="w-3.5 h-3.5" /> Rastrear
            </button>
            <button
              onClick={() => setView('table')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${view === 'table' ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-400 hover:text-white'}`}
            >
              <LayoutList className="w-3.5 h-3.5" /> Tabla
            </button>
            <button
              onClick={() => setView('map')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${view === 'map' ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-400 hover:text-white'}`}
            >
              <MapIcon className="w-3.5 h-3.5" /> Mapa
            </button>
          </div>
          {view === 'table' && (
            <button onClick={exportCSV} className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-xl text-sm transition-colors">
              <Download className="w-4 h-4" /> CSV Completo
            </button>
          )}
        </div>
      </div>

      {/* TRACKER VIEW */}
      {view === 'tracker' && (
        <div className="space-y-6">
          {/* Search bar */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6">
            <div className="text-center mb-6">
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center mx-auto mb-3">
                <QrCode className="w-7 h-7 text-emerald-400" />
              </div>
              <h2 className="text-xl font-bold text-white">Rastreador de envases</h2>
              <p className="text-slate-400 text-sm mt-1">Ingresa el código UCID, QR o de barras para ver el recorrido completo del envase</p>
            </div>
            <div className="flex gap-3 max-w-2xl mx-auto">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  value={trackerQuery}
                  onChange={e => setTrackerQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') runTracker(); }}
                  placeholder="Ej: ABC12345, 7702001000022, o código hash..."
                  className="w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-500 rounded-xl pl-12 pr-4 py-3.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                />
              </div>
              <button
                onClick={runTracker}
                disabled={trackerLoading || !trackerQuery.trim()}
                className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white px-6 py-3.5 rounded-xl text-sm font-semibold transition-colors flex items-center gap-2 whitespace-nowrap"
              >
                {trackerLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Rastrear
              </button>
            </div>
            <p className="text-slate-600 text-xs text-center mt-3">
              Acepta: Código corto UCID (8 caracteres), código de barras (EAN-13), hash completo (128 hex), o URL de escaneo
            </p>
          </div>

          {/* Error */}
          {trackerError && (
            <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/30 text-red-400 rounded-2xl px-5 py-4">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span className="text-sm">{trackerError}</span>
            </div>
          )}

          {/* Results */}
          {trackerResult && (
            <div className="space-y-5">
              {/* Container identity card */}
              <div className="bg-slate-900/60 border border-emerald-500/20 rounded-2xl p-6">
                <div className="flex items-start gap-5 flex-wrap">
                  <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center shrink-0">
                    {trackerResult.ucid ? (
                      <QrCode className="w-7 h-7 text-emerald-400" />
                    ) : (
                      <Barcode className="w-7 h-7 text-blue-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h3 className="text-white font-bold text-lg">
                        {trackerResult.ucid?.product_name ?? trackerResult.scan?.product?.name ?? 'Envase rastreado'}
                      </h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        trackerResult.ucid?.status === 'scanned' || trackerResult.scan
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      }`}>
                        {trackerResult.ucid?.status === 'scanned' ? 'Reciclado' : trackerResult.scan ? 'Escaneado' : 'Generado'}
                      </span>
                    </div>
                    <p className="text-slate-400 text-sm">
                      {trackerResult.ucid?.product_brand ?? (trackerResult.scan?.scan_data as Record<string, string>)?.resolved_brand ?? trackerResult.scan?.product?.brand ?? 'Marca no especificada'}
                    </p>
                    {trackerResult.ucid && (
                      <div className="flex items-center gap-2 mt-2">
                        <Hash className="w-3.5 h-3.5 text-slate-500" />
                        <span className="font-mono text-xs text-emerald-400">{trackerResult.ucid.short_code}</span>
                        {trackerResult.ucid.company_name && (
                          <>
                            <span className="text-slate-600">·</span>
                            <Building2 className="w-3.5 h-3.5 text-teal-400" />
                            <span className="text-teal-300 text-xs">{trackerResult.ucid.company_name}</span>
                          </>
                        )}
                      </div>
                    )}
                    {!trackerResult.ucid && trackerResult.scan && (
                      <div className="flex items-center gap-2 mt-2">
                        <Hash className="w-3.5 h-3.5 text-slate-500" />
                        <span className="font-mono text-xs text-blue-400">{trackerResult.scan.barcode}</span>
                        {trackerResult.scan.company?.name && (
                          <>
                            <span className="text-slate-600">·</span>
                            <Building2 className="w-3.5 h-3.5 text-teal-400" />
                            <span className="text-teal-300 text-xs">{trackerResult.scan.company.name}</span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-slate-400 text-xs">Tipo de envase</p>
                    <p className="text-white font-semibold">{trackerResult.ucid?.container_type ?? trackerResult.scan?.product?.material ?? 'PET'}</p>
                  </div>
                </div>
              </div>

              {/* Timeline - Interrapidísimo style */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-800 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-white font-semibold text-sm">Recorrido del envase</h3>
                </div>

                {/* Horizontal steps bar */}
                <div className="px-6 py-5 border-b border-slate-800 overflow-x-auto">
                  <div className="flex items-center gap-0 min-w-max">
                    {trackerResult.steps.map((step, i) => {
                      const isActive = i === trackerResult!.steps.length - 1 || (step.date != null);
                      const isPast = step.date != null;
                      const isFuture = step.date == null;
                      return (
                        <div key={step.id} className="flex items-center">
                          <div className={`flex flex-col items-center gap-2 px-4 ${isActive && !isFuture ? 'opacity-100' : 'opacity-40'}`}>
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors ${
                              step.id === 'processed' && !step.date
                                ? 'border-slate-700 bg-slate-800'
                                : isPast
                                ? 'border-emerald-500 bg-emerald-500/20'
                                : 'border-slate-700 bg-slate-800'
                            }`}>
                              {step.id === 'generated' && <QrCode className={`w-5 h-5 ${isPast ? 'text-emerald-400' : 'text-slate-500'}`} />}
                              {step.id === 'printed' && <Package className={`w-5 h-5 ${isPast ? 'text-emerald-400' : 'text-slate-500'}`} />}
                              {step.id === 'scanned' && <Scan className={`w-5 h-5 ${isPast ? 'text-emerald-400' : 'text-slate-500'}`} />}
                              {step.id === 'delivered' && <MapPin className={`w-5 h-5 ${isPast ? 'text-emerald-400' : 'text-slate-500'}`} />}
                              {step.id === 'processed' && <Leaf className={`w-5 h-5 ${isPast ? 'text-emerald-400' : 'text-slate-500'}`} />}
                            </div>
                            <div className="text-center max-w-24">
                              <p className={`text-xs font-semibold leading-tight ${isPast ? 'text-white' : 'text-slate-500'}`}>{step.label}</p>
                              {step.date && (
                                <p className="text-emerald-400 text-xs mt-0.5">{new Date(step.date).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}</p>
                              )}
                              {step.date && (
                                <p className="text-slate-500 text-xs">{new Date(step.date).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</p>
                              )}
                            </div>
                          </div>
                          {i < trackerResult!.steps.length - 1 && (
                            <div className={`w-16 h-0.5 shrink-0 ${
                              trackerResult!.steps[i + 1].date != null ? 'bg-emerald-500' : 'bg-slate-700'
                            }`} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Step details */}
                <div className="divide-y divide-slate-800">
                  {trackerResult.steps.filter(s => s.date).map(step => (
                    <div key={step.id} className="px-6 py-4 flex items-start gap-4">
                      <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center shrink-0 mt-0.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div>
                            <p className="text-white font-semibold text-sm">{step.label}</p>
                            <p className="text-slate-400 text-xs mt-0.5">{step.description}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-emerald-400 text-xs font-medium">
                              {new Date(step.date!).toLocaleDateString('es-CO', { dateStyle: 'medium' })}
                            </p>
                            <p className="text-slate-500 text-xs">
                              {new Date(step.date!).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                        </div>

                        {/* Location */}
                        {step.location && (
                          <div className="flex items-center gap-1.5 mt-2">
                            <MapPin className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                            <span className="text-amber-300 text-xs">{step.location}</span>
                            {step.lat && step.lng && (
                              <a
                                href={`https://www.google.com/maps/search/?api=1&query=${step.lat},${step.lng}`}
                                target="_blank" rel="noopener noreferrer"
                                className="text-slate-500 hover:text-emerald-400 text-xs ml-1 transition-colors"
                              >
                                (ver mapa)
                              </a>
                            )}
                          </div>
                        )}

                        {/* Meta fields */}
                        {step.meta && Object.keys(step.meta).length > 0 && (
                          <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {Object.entries(step.meta).map(([k, v]) => v && v !== 'N/A' ? (
                              <div key={k} className="bg-slate-800/60 rounded-lg px-3 py-1.5">
                                <p className="text-slate-500 text-xs">{k}</p>
                                <p className="text-white text-xs font-medium truncate">{v}</p>
                              </div>
                            ) : null)}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Future step: processed */}
                  {trackerResult.steps.find(s => s.id === 'processed' && !s.date) && (
                    <div className="px-6 py-4 flex items-start gap-4 opacity-40">
                      <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0 mt-0.5">
                        <Leaf className="w-4 h-4 text-slate-500" />
                      </div>
                      <div>
                        <p className="text-slate-400 font-semibold text-sm">Procesado y reciclado</p>
                        <p className="text-slate-500 text-xs">Pendiente · El material será enviado a planta de reciclaje</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* SHA-256 verification */}
              {trackerResult.scan && (
                <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
                  <h3 className="text-white font-semibold text-sm mb-3 flex items-center gap-2">
                    <Hash className="w-4 h-4 text-emerald-400" />
                    Verificación criptográfica
                  </h3>
                  <div className="space-y-2">
                    <div>
                      <p className="text-slate-500 text-xs mb-1">Token de autenticidad (SHA-256)</p>
                      <p className="font-mono text-xs text-emerald-400 break-all bg-emerald-500/5 border border-emerald-500/15 rounded-xl px-3 py-2">
                        {trackerResult.scan.token_hash}
                      </p>
                    </div>
                    {trackerResult.ucid && (
                      <div>
                        <p className="text-slate-500 text-xs mb-1">Hash UCID (SHA-512)</p>
                        <p className="font-mono text-xs text-blue-400 break-all bg-blue-500/5 border border-blue-500/15 rounded-xl px-3 py-2">
                          {trackerResult.ucid.ucid_hash}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Empty state hints */}
          {!trackerResult && !trackerError && !trackerLoading && (
            <div className="grid sm:grid-cols-3 gap-4">
              {[
                { icon: <QrCode className="w-5 h-5 text-emerald-400" />, title: 'Código UCID', desc: 'Escanea o ingresa el código corto de 8 caracteres del QR TraceQR', ex: 'Ej: ABC12345' },
                { icon: <Barcode className="w-5 h-5 text-blue-400" />, title: 'Código de barras', desc: 'Usa el EAN-13 o cualquier código de barras del producto', ex: 'Ej: 7702001000022' },
                { icon: <Hash className="w-5 h-5 text-amber-400" />, title: 'Hash SHA-256', desc: 'El token de verificación del escaneo para auditoría', ex: 'Ej: 3a7f...' },
              ].map(item => (
                <div key={item.title} className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5">
                  <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center mb-3">
                    {item.icon}
                  </div>
                  <p className="text-white font-semibold text-sm mb-1">{item.title}</p>
                  <p className="text-slate-400 text-xs">{item.desc}</p>
                  <p className="text-slate-600 text-xs mt-2 font-mono">{item.ex}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TABLE / MAP VIEWS */}
      {(view === 'table' || view === 'map') && (
        <>
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
                    </div>
                  </div>
                  <div ref={mapRef} className="h-[480px] w-full" style={{ background: '#0f172a' }} />
                </div>
              </div>
              <div className="space-y-4">
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
                        <div key={loc.id} className="p-3 bg-amber-500/5 border border-amber-500/10 rounded-xl">
                          <p className="text-white text-xs font-semibold leading-tight">{loc.name}</p>
                          <p className="text-slate-400 text-xs mt-0.5">{loc.address}</p>
                          <div className="flex items-center justify-between mt-2">
                            <span className="text-amber-400 text-xs font-medium">{loc.city}</span>
                            <a href={`https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`} target="_blank" rel="noopener noreferrer"
                              className="flex items-center gap-1 text-emerald-400 text-xs hover:text-emerald-300 transition-colors">
                              <Navigation className="w-3 h-3" /> Cómo llegar
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4">
                  <h3 className="text-white font-semibold text-xs uppercase tracking-wide flex items-center gap-2 mb-3">
                    <Recycle className="w-4 h-4 text-emerald-400" />
                    Puntos de Reciclaje ({recyclingLocs.length})
                  </h3>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {recyclingLocs.slice(0, 10).map(loc => (
                      <div key={loc.id} className="flex items-start gap-2 p-2 rounded-lg hover:bg-slate-800/40 transition-colors">
                        <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                        <div>
                          <p className="text-white text-xs font-medium">{loc.name}</p>
                          <p className="text-slate-500 text-xs">{loc.city}</p>
                        </div>
                      </div>
                    ))}
                    {recyclingLocs.length > 10 && <p className="text-slate-600 text-xs text-center pt-1">+{recyclingLocs.length - 10} más</p>}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
              {/* Analytics mini-summary */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-slate-800">
                {[
                  { label: 'Registros filtrados', value: filtered.length, icon: <Package className="w-4 h-4 text-emerald-400" /> },
                  { label: 'Pts generados', value: filtered.reduce((s, sc) => s + (sc.points_earned ?? 0), 0), icon: <Star className="w-4 h-4 text-amber-400" /> },
                  { label: 'Usuarios únicos', value: new Set(filtered.map(s => s.user_id)).size, icon: <User className="w-4 h-4 text-blue-400" /> },
                  { label: 'Empresas', value: new Set(filtered.map(s => s.company_id).filter(Boolean)).size, icon: <Building2 className="w-4 h-4 text-teal-400" /> },
                ].map(item => (
                  <div key={item.label} className="bg-slate-900/60 px-5 py-3 flex items-center gap-3">
                    {item.icon}
                    <div>
                      <p className="text-white font-bold">{item.value.toLocaleString('es-CO')}</p>
                      <p className="text-slate-500 text-xs">{item.label}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-800">
                      <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Producto</th>
                      <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Marca</th>
                      <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Empresa</th>
                      <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Fuente</th>
                      <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Material</th>
                      <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Puntos</th>
                      <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Token</th>
                      <th className="text-left text-xs text-slate-500 font-medium px-5 py-3">Fecha</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {filtered.slice(0, 50).map(scan => {
                      const sd = scan.scan_data as Record<string, string> | null;
                      const brand = sd?.resolved_brand ?? sd?.brand_name ?? scan.product?.brand ?? '-';
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
                                  <span className="text-slate-500 text-xs font-mono">{scan.barcode.slice(0, 16)}</span>
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
                          <td className="px-5 py-3">
                            <span className="text-xs px-2 py-0.5 rounded font-medium"
                              style={matColor ? { background: `${matColor}20`, color: matColor } : { color: '#64748b' }}>
                              {material}
                            </span>
                          </td>
                          <td className="px-5 py-3">
                            <span className="text-amber-400 text-xs font-semibold">+{scan.points_earned}</span>
                          </td>
                          <td className="px-5 py-3">
                            <button
                              onClick={e => { e.stopPropagation(); setTrackerQuery(scan.token_hash); setView('tracker'); }}
                              className="font-mono text-xs text-emerald-400 bg-emerald-500/5 px-2 py-1 rounded hover:bg-emerald-500/15 transition-colors"
                              title="Rastrear este envase"
                            >
                              {scan.token_hash?.slice(0, 14)}...
                            </button>
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
                  Mostrando 50 de {filtered.length} registros · <button onClick={exportCSV} className="text-emerald-400 hover:text-emerald-300">Exportar todos en CSV</button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Detail side panel */}
      {selectedScan && view === 'table' && (
        <div className="fixed inset-y-0 right-0 w-80 bg-slate-900 border-l border-slate-800 shadow-2xl z-50 flex flex-col overflow-y-auto">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
            <h3 className="text-white font-semibold text-sm">Detalle del escaneo</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setTrackerQuery(selectedScan.token_hash); setSelectedScan(null); setView('tracker'); }}
                className="text-emerald-400 hover:text-emerald-300 text-xs flex items-center gap-1 transition-colors"
              >
                <QrCode className="w-3.5 h-3.5" /> Rastrear
              </button>
              <button onClick={() => setSelectedScan(null)} className="text-slate-400 hover:text-white transition-colors ml-2">
                <X className="w-5 h-5" />
              </button>
            </div>
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
              { label: 'Tamaño', value: (selectedScan.scan_data as Record<string, string>)?.container_size ?? '-' },
              { label: 'Estado', value: (selectedScan.scan_data as Record<string, string>)?.container_condition ?? '-' },
              { label: 'Punto de acopio', value: (selectedScan.scan_data as Record<string, string>)?.collection_point ?? '-' },
              { label: 'Fecha', value: new Date(selectedScan.created_at).toLocaleDateString('es-CO', { dateStyle: 'long' }) },
              { label: 'Puntos', value: `+${selectedScan.points_earned}` },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between items-start py-2 border-b border-slate-800 last:border-0">
                <span className="text-slate-500 text-xs">{label}</span>
                <span className="text-white text-xs font-medium text-right max-w-44">{value}</span>
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
                <Navigation className="w-4 h-4" /> Ver ubicación
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
