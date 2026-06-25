import { useEffect, useRef, useState } from 'react';
import { supabase, RecyclingLocation } from '../lib/supabase';
import { MapPin, Navigation, Phone, Clock, Loader2, ChevronDown, Building2, Layers, Search } from 'lucide-react';

declare global {
  interface Window { L: typeof import('leaflet'); }
}

type LocWithNotes = RecyclingLocation & { notes?: string };

const TYPE_LABELS: Record<string, string> = {
  punto_verde: 'Punto Verde',
  ecoparque: 'Ecoparque',
  supermercado: 'Supermercado',
  hospital: 'Hospital',
  punto_acopio: 'Punto de Acopio',
  otro: 'Otro',
};

const TYPE_COLORS: Record<string, string> = {
  punto_verde: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  ecoparque: 'bg-teal-500/20 text-teal-300 border-teal-500/30',
  supermercado: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  hospital: 'bg-red-500/20 text-red-300 border-red-500/30',
  punto_acopio: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  otro: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
};

const TYPE_PIN_HEX: Record<string, string> = {
  punto_verde: '#10b981',
  ecoparque: '#14b8a6',
  supermercado: '#3b82f6',
  hospital: '#ef4444',
  punto_acopio: '#f59e0b',
  otro: '#94a3b8',
};

/** Identifies a location as a punto_acopio even if the DB type is 'otro' (constraint workaround) */
function isAcopio(loc: LocWithNotes) {
  return loc.location_type === 'punto_acopio' || loc.name.toLowerCase().includes('acopio');
}

function getEffectiveType(loc: LocWithNotes): string {
  return isAcopio(loc) ? 'punto_acopio' : loc.location_type;
}

const UNIVALLE_SEED: Partial<LocWithNotes>[] = [
  {
    name: 'Punto de Acopio Univalle - Sede Yumbo',
    address: 'Calle 3N # 2N-17, Barrio Las Vegas, Yumbo',
    lat: 3.5915, lng: -76.4981,
    location_type: 'otro', city: 'Yumbo', department: 'Valle del Cauca',
    schedule: 'Lun-Vie 7am-5pm', phone: '+57 2 3212100',
    notes: 'Sede Yumbo - Universidad del Valle · Punto de acopio oficial',
    is_active: true,
  },
  {
    name: 'Punto de Acopio Univalle - Ciudad Universitaria',
    address: 'Calle 13 # 100-00, Ciudad Universitaria Meléndez, Cali',
    lat: 3.3760, lng: -76.5350,
    location_type: 'otro', city: 'Cali', department: 'Valle del Cauca',
    schedule: 'Lun-Sab 7am-6pm', phone: '+57 2 3212100',
    notes: 'Campus principal - Universidad del Valle · Punto de acopio central',
    is_active: true,
  },
];

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

function makePin(color: string, isAcopioPin: boolean) {
  const size = isAcopioPin ? 22 : 16;
  const inner = isAcopioPin
    ? `<rect width="${size}" height="${size}" rx="5" fill="${color}" stroke="white" stroke-width="2.5"/><text x="${size / 2}" y="${size / 2 + 4}" text-anchor="middle" fill="white" font-size="9" font-family="sans-serif" font-weight="bold">A</text>`
    : `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 1.5}" fill="${color}" stroke="white" stroke-width="2.5"/>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${inner}</svg>`
  )}`;
}

export default function MapPage() {
  const [locations, setLocations] = useState<LocWithNotes[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [filterDept, setFilterDept] = useState<string>('all');
  const [departments, setDepartments] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<LocWithNotes | null>(null);
  const [loading, setLoading] = useState(true);
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<unknown>(null);
  const markersRef = useRef<unknown[]>([]);

  useEffect(() => {
    loadLocations();
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {}
      );
    }
  }, []);

  useEffect(() => {
    if (!loading) initMap();
  }, [locations, filter, filterDept, search, loading]);

  async function loadLocations() {
    const { data } = await supabase.from('recycling_locations').select('*').eq('is_active', true).order('name');
    let locs = (data ?? []) as LocWithNotes[];

    // Seed Univalle if not present
    if (!locs.some(l => l.name.toLowerCase().includes('univalle'))) {
      await supabase.from('recycling_locations').insert(UNIVALLE_SEED);
      const { data: fresh } = await supabase.from('recycling_locations').select('*').eq('is_active', true).order('name');
      locs = (fresh ?? []) as LocWithNotes[];
    }

    setLocations(locs);
    const depts = [...new Set(locs.map(l => l.department).filter(Boolean))].sort() as string[];
    setDepartments(depts);
    setLoading(false);
  }

  function getDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  const filtered = locations.filter(l => {
    const effType = getEffectiveType(l);
    const matchType = filter === 'all' || (filter === 'punto_acopio' ? isAcopio(l) : effType === filter);
    const matchDept = filterDept === 'all' || l.department === filterDept;
    const matchSearch = !search || l.name.toLowerCase().includes(search.toLowerCase()) || (l.city ?? '').toLowerCase().includes(search.toLowerCase());
    return matchType && matchDept && matchSearch;
  });

  const sorted = userPos
    ? [...filtered].sort((a, b) => getDistanceKm(userPos.lat, userPos.lng, a.lat, a.lng) - getDistanceKm(userPos.lat, userPos.lng, b.lat, b.lng))
    : filtered;

  async function initMap() {
    if (!mapRef.current) return;
    await loadLeaflet();
    const L = window.L;
    if (!L) return;

    if (!leafletMap.current) {
      const map = L.map(mapRef.current, { zoomControl: true }).setView([4.5, -74.5], 6);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map);
      if (userPos) {
        const userIcon = L.divIcon({
          html: `<div style="width:14px;height:14px;background:#3b82f6;border:3px solid white;border-radius:50%;box-shadow:0 0 0 3px rgba(59,130,246,.3)"></div>`,
          className: '', iconSize: [14, 14], iconAnchor: [7, 7],
        });
        L.marker([userPos.lat, userPos.lng], { icon: userIcon }).addTo(map).bindPopup('Tu ubicación');
      }
      leafletMap.current = map;
    }

    const map = leafletMap.current as {
      addLayer: (l: unknown) => void;
      removeLayer: (l: unknown) => void;
      fitBounds: (b: unknown, o?: unknown) => void;
    };

    markersRef.current.forEach(m => map.removeLayer(m));
    markersRef.current = [];

    sorted.forEach(loc => {
      const acopio = isAcopio(loc);
      const effType = getEffectiveType(loc);
      const color = TYPE_PIN_HEX[effType] ?? '#94a3b8';
      const iconUrl = makePin(color, acopio);
      const sz = acopio ? 22 : 16;
      const icon = window.L.icon({ iconUrl, iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2], popupAnchor: [0, -sz / 2] });
      const marker = window.L.marker([loc.lat, loc.lng], { icon })
        .bindPopup(`
          <div style="font-family:sans-serif;min-width:200px;max-width:240px">
            <div style="font-weight:700;color:#111;margin-bottom:4px">${loc.name}</div>
            <div style="color:#666;font-size:12px;margin-bottom:3px">${loc.address ?? ''}</div>
            <div style="color:#999;font-size:11px">${loc.city ?? ''}${loc.department ? ', ' + loc.department : ''}</div>
            ${loc.schedule ? `<div style="color:#999;font-size:11px;margin-top:4px">Horario: ${loc.schedule}</div>` : ''}
            ${loc.phone ? `<div style="color:#999;font-size:11px">Tel: ${loc.phone}</div>` : ''}
            ${loc.notes ? `<div style="color:#888;font-size:11px;font-style:italic;margin-top:4px">${loc.notes}</div>` : ''}
            <a href="https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}" target="_blank"
              style="display:inline-flex;align-items:center;gap:4px;color:#10b981;font-size:12px;font-weight:600;margin-top:8px;text-decoration:none">
              Ver en Google Maps →
            </a>
          </div>
        `)
        .on('click', () => setSelected(loc));
      map.addLayer(marker);
      markersRef.current.push(marker);
    });

    if (sorted.length > 0) {
      try {
        const bounds = window.L.latLngBounds(sorted.map(l => [l.lat, l.lng] as [number, number]));
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
      } catch { /* ignore */ }
    }
  }

  const accopioLocs = sorted.filter(l => isAcopio(l));
  const otherLocs = sorted.filter(l => !isAcopio(l));

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800 bg-slate-900/80 backdrop-blur flex items-center justify-between flex-wrap gap-3 shrink-0">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <MapPin className="w-5 h-5 text-emerald-400" />
            Puntos de reciclaje y acopio
          </h1>
          <p className="text-slate-400 text-xs mt-0.5">{sorted.length} ubicaciones · Colombia</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar ciudad o nombre..."
              className="bg-slate-800 border border-slate-700 text-white placeholder-slate-500 rounded-xl pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-emerald-500 w-52 transition-colors" />
          </div>
          <div className="flex items-center gap-1 bg-slate-900/60 border border-slate-800 rounded-xl p-1">
            {[
              { key: 'all', label: 'Todos' },
              { key: 'punto_acopio', label: 'Acopio' },
              { key: 'punto_verde', label: 'Punto Verde' },
              { key: 'ecoparque', label: 'Ecoparque' },
            ].map(({ key, label }) => (
              <button key={key} onClick={() => setFilter(key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filter === key ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-400 hover:text-white'}`}>
                {label}
              </button>
            ))}
          </div>
          {departments.length > 0 && (
            <div className="relative">
              <Layers className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <select value={filterDept} onChange={e => setFilterDept(e.target.value)}
                className="bg-slate-800 border border-slate-700 text-white rounded-xl pl-9 pr-7 py-2 text-sm focus:outline-none focus:border-emerald-500 appearance-none transition-colors">
                <option value="all">Todos los departamentos</option>
                {departments.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            </div>
          )}
        </div>
      </div>

      {/* Map + sidebar */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Map canvas */}
        <div className="flex-1 relative min-w-0">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80 z-10">
              <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
            </div>
          )}
          <div ref={mapRef} className="w-full h-full" style={{ minHeight: '400px', background: '#0f172a' }} />

          {/* Legend */}
          <div className="absolute bottom-4 left-4 bg-slate-900/90 border border-slate-700 rounded-xl p-3 backdrop-blur z-[1000] pointer-events-none">
            <p className="text-slate-400 text-xs font-medium mb-2">Leyenda</p>
            <div className="space-y-1.5">
              {[
                { key: 'punto_acopio', label: 'Punto de Acopio', square: true },
                { key: 'punto_verde', label: 'Punto Verde', square: false },
                { key: 'ecoparque', label: 'Ecoparque', square: false },
                { key: 'supermercado', label: 'Supermercado', square: false },
              ].map(({ key, label, square }) => (
                <div key={key} className="flex items-center gap-2">
                  <span className="w-3 h-3 shrink-0" style={{
                    background: TYPE_PIN_HEX[key],
                    borderRadius: square ? '3px' : '50%',
                    display: 'inline-block',
                  }} />
                  <span className="text-slate-300 text-xs">{label}</span>
                </div>
              ))}
              <div className="flex items-center gap-2 pt-1 border-t border-slate-700">
                <span className="w-3 h-3 rounded-full shrink-0 bg-blue-500 border-2 border-white inline-block" />
                <span className="text-slate-300 text-xs">Tu ubicación</span>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="w-80 bg-slate-900 border-l border-slate-800 flex flex-col overflow-hidden shrink-0">
          {/* Puntos de acopio */}
          <div className="px-4 pt-4 pb-3 border-b border-amber-500/20 bg-amber-500/5 shrink-0">
            <h2 className="text-amber-400 text-xs font-bold flex items-center gap-1.5 mb-3 uppercase tracking-wide">
              <span className="w-4 h-4 rounded bg-amber-500/20 border border-amber-500/30 flex items-center justify-center font-bold text-amber-400 text-[8px]">A</span>
              Puntos de Acopio ({accopioLocs.length})
            </h2>
            {accopioLocs.length === 0 ? (
              <p className="text-slate-600 text-xs pb-1">Sin puntos de acopio en este filtro</p>
            ) : (
              <div className="space-y-2">
                {accopioLocs.map(loc => (
                  <button key={loc.id} onClick={() => setSelected(selected?.id === loc.id ? null : loc)}
                    className={`w-full text-left p-2.5 rounded-xl border transition-all ${selected?.id === loc.id ? 'bg-amber-500/10 border-amber-500/50 ring-1 ring-amber-500/30' : 'bg-amber-500/5 border-amber-500/10 hover:border-amber-500/30'}`}>
                    <p className="text-white text-xs font-semibold leading-snug">{loc.name}</p>
                    <p className="text-amber-400/80 text-xs mt-0.5">{loc.city}, {loc.department}</p>
                    {loc.schedule && <p className="text-slate-500 text-xs mt-0.5">{loc.schedule}</p>}
                    {loc.notes && <p className="text-slate-500 text-xs mt-0.5 italic">{loc.notes}</p>}
                    {selected?.id === loc.id && (
                      <div className="mt-2 pt-2 border-t border-amber-500/20 flex items-center gap-3 flex-wrap">
                        {loc.phone && (
                          <div className="flex items-center gap-1 text-slate-400 text-xs">
                            <Phone className="w-3 h-3" /> {loc.phone}
                          </div>
                        )}
                        <a href={`https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`}
                          target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                          className="flex items-center gap-1 text-emerald-400 text-xs font-medium hover:text-emerald-300 transition-colors">
                          <Navigation className="w-3 h-3" /> Cómo llegar
                        </a>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Other locations list */}
          <div className="flex-1 overflow-y-auto">
            <div className="px-4 py-2 border-b border-slate-800 sticky top-0 bg-slate-900 z-10">
              <p className="text-slate-400 text-xs font-medium">{otherLocs.length} puntos de reciclaje</p>
            </div>
            <div className="divide-y divide-slate-800/60">
              {otherLocs.map(loc => {
                const dist = userPos ? getDistanceKm(userPos.lat, userPos.lng, loc.lat, loc.lng) : null;
                const isSelected = selected?.id === loc.id;
                const effType = getEffectiveType(loc);
                return (
                  <button key={loc.id} onClick={() => setSelected(isSelected ? null : loc)}
                    className={`w-full text-left px-4 py-3 transition-colors ${isSelected ? 'bg-emerald-500/5' : 'hover:bg-slate-800/40'}`}>
                    <div className="flex items-start gap-2">
                      <div className={`w-6 h-6 rounded-lg flex items-center justify-center border shrink-0 mt-0.5 ${TYPE_COLORS[effType] ?? TYPE_COLORS['otro']}`}>
                        <MapPin className="w-3 h-3" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-xs font-medium leading-snug truncate">{loc.name}</p>
                        <p className="text-slate-500 text-xs truncate">{loc.address ?? loc.city}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`text-xs px-1.5 py-0.5 rounded-full border ${TYPE_COLORS[effType] ?? TYPE_COLORS['otro']}`}>
                            {TYPE_LABELS[effType]}
                          </span>
                          {dist !== null && (
                            <span className="text-slate-600 text-xs">
                              {dist < 1 ? `${(dist * 1000).toFixed(0)} m` : `${dist.toFixed(1)} km`}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    {isSelected && (
                      <div className="mt-2 pl-8 space-y-1">
                        {loc.schedule && (
                          <div className="flex items-center gap-1.5 text-slate-400 text-xs">
                            <Clock className="w-3 h-3 shrink-0" /> {loc.schedule}
                          </div>
                        )}
                        {loc.phone && (
                          <div className="flex items-center gap-1.5 text-slate-400 text-xs">
                            <Phone className="w-3 h-3 shrink-0" /> {loc.phone}
                          </div>
                        )}
                        <a href={`https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`}
                          target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                          className="flex items-center gap-1 text-emerald-400 text-xs font-medium hover:text-emerald-300 transition-colors mt-1">
                          <Navigation className="w-3 h-3" /> Cómo llegar
                        </a>
                      </div>
                    )}
                  </button>
                );
              })}
              {otherLocs.length === 0 && (
                <div className="px-4 py-8 text-center text-slate-600 text-sm">
                  <MapPin className="w-6 h-6 mx-auto mb-2 opacity-30" />
                  Sin resultados para este filtro
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
