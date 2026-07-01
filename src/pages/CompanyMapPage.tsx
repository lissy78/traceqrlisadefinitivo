import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';
import { supabase, ScanEvent, UCID } from '../lib/supabase';
import {
  MapPin, Navigation, Package, Clock, ChevronDown, Search,
  Loader2, Building2, QrCode, Recycle, Filter, RefreshCw,
  Truck, CheckCircle2, Circle, Leaf, Route, Layers, X
} from 'lucide-react';

declare global { interface Window { L: typeof import('leaflet'); } }

type ScanWithUCID = ScanEvent & {
  ucids?: UCID;
  product?: { name: string; brand: string | null; image_url: string | null };
};

interface ContainerRoute {
  id: string;
  ucid_code: string | null;
  barcode: string;
  product_name: string;
  brand: string | null;
  status: 'generated' | 'in_transit' | 'delivered' | 'recycled';
  origin: { lat: number; lng: number; name: string } | null;
  destination: { lat: number; lng: number; name: string } | null;
  current: { lat: number; lng: number; name: string; date: string } | null;
  route_points: Array<{ lat: number; lng: number; name: string; date: string; type: 'origin' | 'scan' | 'acopio' }>;
  created_at: string;
  scanned_at: string | null;
}

const STATUS_CONFIG: Record<string, { color: string; bg: string; label: string; icon: React.ReactNode }> = {
  generated: { color: 'text-blue-400', bg: 'bg-blue-500/20', label: 'Generado', icon: <QrCode className="w-3.5 h-3.5" /> },
  in_transit: { color: 'text-amber-400', bg: 'bg-amber-500/20', label: 'En tránsito', icon: <Truck className="w-3.5 h-3.5" /> },
  delivered: { color: 'text-teal-400', bg: 'bg-teal-500/20', label: 'Entregado', icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  recycled: { color: 'text-emerald-400', bg: 'bg-emerald-500/20', label: 'Reciclado', icon: <Leaf className="w-3.5 h-3.5" /> },
};

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

export default function CompanyMapPage() {
  const { profile } = useAuth();
  const [containers, setContainers] = useState<ContainerRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedContainer, setSelectedContainer] = useState<ContainerRoute | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [showRoutes, setShowRoutes] = useState(true);
  const [stats, setStats] = useState({ total: 0, active: 0, recycled: 0, points: 0 });
  const [companyCoords, setCompanyCoords] = useState<{ lat: number; lng: number; name: string }>({ lat: 3.5915, lng: -76.4981, name: 'Planta de producción' });

  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<unknown>(null);
  const markersRef = useRef<unknown[]>([]);
  const routesRef = useRef<unknown[]>([]);

  useEffect(() => {
    if (profile?.company_id) loadData();
  }, [profile]);

  useEffect(() => {
    if (!loading) initMap();
  }, [containers, showRoutes, filterStatus, loading]);

  async function loadData() {
    if (!profile?.company_id) return;

    // Get all scans for this company
    const { data: scans } = await supabase
      .from('scan_events')
      .select(`
        *,
        product:product_catalog(name, brand, image_url)
      `)
      .eq('company_id', profile.company_id)
      .order('created_at', { ascending: false });

    // Get all UCIDs for this company
    const { data: ucids } = await supabase
      .from('ucids')
      .select('*')
      .eq('company_id', profile.company_id);

    // Get company info for coordinates
    const { data: companyInfo } = await supabase
      .from('companies')
      .select('name, lat, lng')
      .eq('id', profile.company_id)
      .maybeSingle();

    const companyLat = companyInfo?.lat ?? 3.5915;
    const companyLng = companyInfo?.lng ?? -76.4981;
    const companyName = companyInfo?.name ?? 'Planta de producción';
    setCompanyCoords({ lat: companyLat, lng: companyLng, name: companyName });

    // Get recycling locations for reference
    const { data: locations } = await supabase
      .from('recycling_locations')
      .select('*')
      .eq('is_active', true);

    // Build container routes
    const routes: ContainerRoute[] = [];
    const locMap = new Map((locations ?? []).map(l => [l.id, l]));

    (scans ?? []).forEach(scan => {
      const sd = (scan.scan_data as Record<string, unknown>) ?? {};
      const ucid = (ucids ?? []).find(u => u.scan_event_id === scan.id);

      const routePoints: ContainerRoute['route_points'] = [];

      // Origin: Company location (from UCID generation)
      if (ucid?.created_at) {
        routePoints.push({
          lat: companyLat,
          lng: companyLng,
          name: companyName,
          date: ucid.created_at,
          type: 'origin'
        });
      }

      // Scan point: Where user scanned the package
      if (scan.location_lat && scan.location_lng) {
        routePoints.push({
          lat: scan.location_lat,
          lng: scan.location_lng,
          name: (sd.collection_point as string) ?? 'Punto de escaneo',
          date: scan.created_at,
          type: 'scan'
        });
      }

      // Destination: Collection point
      if (sd.collection_point) {
        const matchedLoc = (locations ?? []).find(l =>
          sd.collection_point?.toString().toLowerCase().includes(l.name.toLowerCase())
        );
        if (matchedLoc) {
          routePoints.push({
            lat: matchedLoc.lat,
            lng: matchedLoc.lng,
            name: matchedLoc.name,
            date: scan.created_at,
            type: 'acopio'
          });
        } else {
          // Use scan coordinates as destination
          if (scan.location_lat && scan.location_lng) {
            routePoints.push({
              lat: scan.location_lat,
              lng: scan.location_lng,
              name: sd.collection_point as string,
              date: scan.created_at,
              type: 'acopio'
            });
          }
        }
      }

      routes.push({
        id: scan.id,
        ucid_code: ucid?.short_code ?? null,
        barcode: scan.barcode,
        product_name: scan.product?.name ?? 'Envase',
        brand: scan.product?.brand ?? (sd.brand_name as string) ?? null,
        status: scan.location_lat ? 'recycled' : ucid ? 'in_transit' : 'generated',
        origin: routePoints.find(p => p.type === 'origin') ?? null,
        destination: routePoints.find(p => p.type === 'acopio') ?? null,
        current: routePoints[routePoints.length - 1] ?? null,
        route_points: routePoints,
        created_at: ucid?.created_at ?? scan.created_at,
        scanned_at: scan.created_at
      });
    });

    // Also include UCIDs that haven't been scanned yet
    (ucids ?? []).filter(u => !u.scan_event_id).forEach(ucid => {
      routes.push({
        id: ucid.id,
        ucid_code: ucid.short_code,
        barcode: '',
        product_name: ucid.product_name ?? 'Envase',
        brand: ucid.product_brand,
        status: 'generated',
        origin: { lat: companyLat, lng: companyLng, name: companyName },
        destination: null,
        current: null,
        route_points: [],
        created_at: ucid.created_at,
        scanned_at: null
      });
    });

    setContainers(routes);
    setStats({
      total: routes.length,
      active: routes.filter(r => r.status === 'in_transit' || r.status === 'generated').length,
      recycled: routes.filter(r => r.status === 'recycled').length,
      points: (scans ?? []).reduce((sum, s) => sum + (s.points_earned ?? 0), 0)
    });
    setLoading(false);
  }

  async function initMap() {
    await loadLeaflet();
    const L = window.L;
    if (!L || !mapRef.current) return;

    if (!leafletMap.current) {
      const map = L.map(mapRef.current, { zoomControl: true }).setView([companyCoords.lat, companyCoords.lng], 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);
      leafletMap.current = map;
    }

    const map = leafletMap.current as {
      addLayer: (l: unknown) => void;
      removeLayer: (l: unknown) => void;
      fitBounds: (b: unknown, o?: unknown) => void;
      setView: (c: [number, number], z: number) => void;
    };

    // Clear previous markers and routes
    markersRef.current.forEach(m => map.removeLayer(m));
    routesRef.current.forEach(r => map.removeLayer(r));
    markersRef.current = [];
    routesRef.current = [];

    const filtered = containers.filter(c => {
      const matchStatus = filterStatus === 'all' || c.status === filterStatus;
      const matchSearch = !search ||
        c.product_name.toLowerCase().includes(search.toLowerCase()) ||
        c.barcode.includes(search) ||
        (c.ucid_code?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
        (c.brand?.toLowerCase().includes(search.toLowerCase()) ?? false);
      return matchStatus && matchSearch;
    });

    // Draw routes
    if (showRoutes) {
      filtered.forEach(container => {
        if (container.route_points.length >= 2) {
          const coords: [number, number][] = container.route_points.map(p => [p.lat, p.lng]);
          const polyline = L.polyline(coords, {
            color: container.status === 'recycled' ? '#10b981' : '#f59e0b',
            weight: 3,
            opacity: 0.7,
            dashArray: container.status === 'recycled' ? '' : '10, 10'
          }).addTo(map as unknown as Parameters<typeof L.polyline>[0]);

          routesRef.current.push(polyline);
        }
      });
    }

    // Add markers
    filtered.forEach(container => {
      const lastPoint = container.route_points[container.route_points.length - 1];
      if (!lastPoint) return;

      const config = STATUS_CONFIG[container.status];
      const icon = L.divIcon({
        html: `<div style="width:28px;height:28px;background:${container.status === 'recycled' ? '#10b981' : '#f59e0b'};border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5">
            ${container.status === 'recycled'
              ? '<path d="M21 12a9 9 0 11-6.219-8.56"/><polyline points="21 3 21 9 15 9"/>'
              : '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'}
          </svg>
        </div>`,
        className: '',
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      });

      const marker = L.marker([lastPoint.lat, lastPoint.lng], { icon })
        .bindPopup(`
          <div style="font-family:sans-serif;min-width:200px">
            <div style="font-weight:700;color:#111;margin-bottom:4px">${container.product_name}</div>
            <div style="color:#666;font-size:12px">${container.brand ?? ''}</div>
            <div style="margin-top:8px;padding:4px 8px;background:${config.bg};border-radius:6px;display:inline-flex;align-items:center;gap:4px">
              <span style="font-size:12px;font-weight:600">${config.label}</span>
            </div>
            ${container.ucid_code ? `<div style="font-family:monospace;font-size:11px;color:#10b981;margin-top:6px">${container.ucid_code}</div>` : ''}
            <div style="font-size:11px;color:#888;margin-top:6px">
              ${lastPoint.date ? new Date(lastPoint.date).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
            </div>
          </div>
        `)
        .on('click', () => setSelectedContainer(container));

      map.addLayer(marker);
      markersRef.current.push(marker);
    });

    // Fit bounds
    const allPoints: [number, number][] = filtered
      .flatMap(c => c.route_points)
      .map(p => [p.lat, p.lng]);

    if (allPoints.length > 0) {
      try {
        map.fitBounds(L.latLngBounds(allPoints), { padding: [40, 40], maxZoom: 14 });
      } catch { /* */ }
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const filtered = containers.filter(c => {
    const matchStatus = filterStatus === 'all' || c.status === filterStatus;
    const matchSearch = !search ||
      c.product_name.toLowerCase().includes(search.toLowerCase()) ||
      (c.ucid_code?.toLowerCase().includes(search.toLowerCase()) ?? false);
    return matchStatus && matchSearch;
  });

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800 bg-slate-900/80 backdrop-blur flex items-center justify-between flex-wrap gap-3 shrink-0">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Route className="w-5 h-5 text-teal-400" />
            Mapa de trazabilidad
          </h1>
          <p className="text-slate-400 text-xs mt-0.5">
            {stats.total} envases · {stats.recycled} reciclados · {stats.points} pts
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar envase, UCID, marca..."
              className="bg-slate-800 border border-slate-700 text-white placeholder-slate-500 rounded-xl pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-teal-500 w-48 transition-colors"
            />
          </div>
          <div className="flex items-center gap-1 bg-slate-900/60 border border-slate-800 rounded-xl p-1">
            {[
              { key: 'all', label: 'Todos' },
              { key: 'generated', label: 'Generados' },
              { key: 'in_transit', label: 'En tránsito' },
              { key: 'recycled', label: 'Reciclados' },
            ].map(({ key, label }) => (
              <button key={key} onClick={() => setFilterStatus(key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filterStatus === key ? 'bg-teal-500/20 text-teal-300' : 'text-slate-400 hover:text-white'}`}>
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowRoutes(!showRoutes)}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-colors ${showRoutes ? 'bg-teal-500/20 text-teal-300' : 'bg-slate-800 text-slate-400 hover:text-white'}`}
          >
            <Route className="w-4 h-4" />
            Rutas
          </button>
          <button
            onClick={() => { setLoading(true); loadData(); }}
            className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white px-3 py-2 rounded-xl text-sm transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Actualizar
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Map */}
        <div className="flex-1 relative min-w-0">
          <div ref={mapRef} className="w-full h-full" style={{ minHeight: '400px', background: '#0f172a' }} />

          {/* Stats overlay */}
          <div className="absolute top-4 left-4 bg-slate-900/90 border border-slate-700 rounded-xl p-3 backdrop-blur z-[1000]">
            <p className="text-slate-400 text-xs font-medium mb-2">Resumen</p>
            <div className="space-y-1.5">
              {[
                { label: 'Total envases', value: stats.total, color: 'bg-white' },
                { label: 'En tránsito', value: stats.active, color: 'bg-amber-400' },
                { label: 'Reciclados', value: stats.recycled, color: 'bg-emerald-400' },
              ].map(item => (
                <div key={item.label} className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${item.color}`} />
                  <span className="text-slate-300 text-xs">{item.label}</span>
                  <span className="text-white text-xs font-bold ml-auto">{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Legend */}
          <div className="absolute bottom-4 left-4 bg-slate-900/90 border border-slate-700 rounded-xl p-3 backdrop-blur z-[1000]">
            <p className="text-slate-400 text-xs font-medium mb-2">Leyenda</p>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="w-4 h-0.5 bg-amber-400" style={{ backgroundImage: 'linear-gradient(90deg, #f59e0b 50%, transparent 50%)', backgroundSize: '8px' }} />
                <span className="text-slate-300 text-xs">En tránsito</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-0.5 bg-emerald-400" />
                <span className="text-slate-300 text-xs">Reciclado</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-emerald-500 border-2 border-white" />
                <span className="text-slate-300 text-xs">Ubicación actual</span>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar - Container list */}
        <div className="w-80 bg-slate-900 border-l border-slate-800 flex flex-col overflow-hidden shrink-0">
          <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/80 shrink-0">
            <p className="text-white font-semibold text-sm flex items-center gap-2">
              <Package className="w-4 h-4 text-teal-400" />
              Envases ({filtered.length})
            </p>
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="divide-y divide-slate-800">
              {filtered.map(container => {
                const config = STATUS_CONFIG[container.status];
                const isSelected = selectedContainer?.id === container.id;

                return (
                  <button
                    key={container.id}
                    onClick={() => setSelectedContainer(isSelected ? null : container)}
                    className={`w-full text-left px-4 py-3 transition-colors ${isSelected ? 'bg-teal-500/10' : 'hover:bg-slate-800/40'}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${config.bg}`}>
                        {config.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-white text-sm font-medium truncate">{container.product_name}</p>
                          <span className={`text-xs px-1.5 py-0.5 rounded ${config.bg} ${config.color}`}>
                            {config.label}
                          </span>
                        </div>
                        <p className="text-slate-400 text-xs truncate">{container.brand}</p>
                        {container.ucid_code && (
                          <p className="font-mono text-xs text-teal-400 mt-0.5">{container.ucid_code}</p>
                        )}
                        {container.lastPoint?.date && (
                          <p className="text-slate-500 text-xs mt-1 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {new Date(container.current?.date ?? container.created_at).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </p>
                        )}
                      </div>
                    </div>

                    {isSelected && container.route_points.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-slate-800">
                        <p className="text-slate-400 text-xs font-medium mb-2">Recorrido</p>
                        <div className="space-y-2">
                          {container.route_points.map((point, i) => (
                            <div key={i} className="flex items-start gap-2">
                              <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                                point.type === 'origin' ? 'bg-blue-500/20' :
                                point.type === 'scan' ? 'bg-amber-500/20' :
                                'bg-emerald-500/20'
                              }`}>
                                {point.type === 'origin' ? <QrCode className="w-3 h-3 text-blue-400" /> :
                                 point.type === 'scan' ? <MapPin className="w-3 h-3 text-amber-400" /> :
                                 <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-white text-xs">{point.name}</p>
                                <p className="text-slate-500 text-xs">
                                  {new Date(point.date).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </button>
                );
              })}

              {filtered.length === 0 && (
                <div className="px-4 py-8 text-center text-slate-500">
                  <Package className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No hay envases que mostrar</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
