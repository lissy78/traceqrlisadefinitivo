import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  Package, MapPin, Clock, CheckCircle2, QrCode, Truck, Leaf,
  Building2, Hash, Calendar, Navigation, Loader2, AlertCircle,
  ArrowRight, Circle
} from 'lucide-react';

declare global { interface Window { L: typeof import('leaflet'); } }

interface TrackingStep {
  id: string;
  status: 'generated' | 'in_transit' | 'scanned' | 'at_acopio' | 'recycled';
  label: string;
  description: string;
  date: string | null;
  location: { lat: number; lng: number; name: string } | null;
  completed: boolean;
}

interface TrackingResult {
  ucid: {
    short_code: string;
    ucid_hash: string;
    product_name: string | null;
    product_brand: string | null;
    container_type: string;
    status: string;
    created_at: string;
    scanned_at: string | null;
    company_name: string | null;
    batch_name: string | null;
  };
  steps: TrackingStep[];
  timeline: Array<{
    date: string;
    title: string;
    location: string;
    lat: number | null;
    lng: number | null;
  }>;
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

export default function UCIDTrackingPage() {
  // Get code from URL: supports both ?track=CODE query param and /s/{short_code}/{hash} path
  const [code, setCode] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const trackParam = params.get('track');
    if (trackParam) return trackParam;

    // Check for /s/{short_code}/{hash} path pattern
    const pathMatch = window.location.pathname.match(/^\/s\/([A-Z0-9]{8})\/([a-f0-9]+)/i);
    if (pathMatch) return pathMatch[1];

    return '';
  });

  // Track the hash from the URL for cryptographic verification
  const [urlHash, setUrlHash] = useState<string | null>(() => {
    const pathMatch = window.location.pathname.match(/^\/s\/([A-Z0-9]{8})\/([a-f0-9]+)/i);
    return pathMatch ? pathMatch[2] : null;
  });

  const [query, setQuery] = useState(code);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TrackingResult | null>(null);
  const [error, setError] = useState('');

  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<unknown>(null);

  useEffect(() => {
    if (code) {
      setQuery(code);
      searchUCID(code);
    }
  }, [code]);

  useEffect(() => {
    if (result) initMap();
  }, [result]);

  async function searchUCID(searchCode: string) {
    const q = searchCode.trim();
    if (!q) return;

    setLoading(true);
    setError('');
    setResult(null);

    try {
      // Try to find by short_code or ucid_hash
      let ucidData: Record<string, unknown> | null = null;

      // Check if it's a URL
      const urlMatch = q.match(/\/s\/([A-Z0-9]{8})/i);
      const lookupCode = urlMatch?.[1] ?? (q.length === 8 && /[A-Z]/i.test(q) ? q.toUpperCase() : null);

      if (lookupCode) {
        const { data } = await supabase
          .from('ucids')
          .select(`
            *,
            company:companies(name, lat, lng),
            batch:ucid_batches(batch_name)
          `)
          .eq('short_code', lookupCode)
          .maybeSingle();
        ucidData = data as Record<string, unknown> | null;
      } else if (/^[a-f0-9]{128}$/i.test(q)) {
        const { data } = await supabase
          .from('ucids')
          .select(`
            *,
            company:companies(name, lat, lng),
            batch:ucid_batches(batch_name)
          `)
          .eq('ucid_hash', q.toLowerCase())
          .maybeSingle();
        ucidData = data as Record<string, unknown> | null;
      }

      if (!ucidData) {
        setError('No se encontró el código UCID. Verifica que el código sea correcto.');
        setLoading(false);
        return;
      }

      // Verify hash from URL if present (cryptographic integrity check)
      if (urlHash) {
        const fullHash = ucidData.ucid_hash as string;
        if (!fullHash.startsWith(urlHash.toLowerCase())) {
          setError('El código de verificación no coincide con este UCID. El enlace podría ser inválido.');
          setLoading(false);
          return;
        }
      }

      // Get company coordinates (fallback to Yumbo default if not set)
      const companyInfo = ucidData.company as { name: string; lat: number | null; lng: number | null } | null;
      const companyLat = companyInfo?.lat ?? 3.5915;
      const companyLng = companyInfo?.lng ?? -76.4981;
      const companyName = companyInfo?.name ?? 'Planta de producción';

      // Get scan event if available
      let scanEvent: Record<string, unknown> | null = null;
      if (ucidData.scan_event_id) {
        const { data } = await supabase
          .from('scan_events')
          .select('*')
          .eq('id', ucidData.scan_event_id as string)
          .maybeSingle();
        scanEvent = data as Record<string, unknown> | null;
      }

      // Build tracking result
      const steps: TrackingStep[] = [];
      const timeline: TrackingResult['timeline'] = [];

      // Step 1: Generated
      steps.push({
        id: 'generated',
        status: 'generated',
        label: 'Envase generado',
        description: `Código UCID creado${ucidData.batch ? ` · Lote: ${(ucidData.batch as { batch_name: string }).batch_name}` : ''}`,
        date: ucidData.created_at as string,
        location: {
          lat: companyLat,
          lng: companyLng,
          name: companyName
        },
        completed: true
      });
      timeline.push({
        date: ucidData.created_at as string,
        title: 'UCID Generado',
        location: companyName,
        lat: companyLat,
        lng: companyLng
      });

      // Step 2: In transit (printed)
      if (ucidData.status === 'printed' || ucidData.status === 'scanned') {
        steps.push({
          id: 'in_transit',
          status: 'in_transit',
          label: 'QR aplicado al envase',
          description: 'El código QR fue impreso y aplicado al envase',
          date: ucidData.created_at as string,
          location: null,
          completed: true
        });
      }

      // Step 3: Scanned by user
      if (scanEvent) {
        const sd = (scanEvent.scan_data as Record<string, unknown>) ?? {};
        const scanLat = scanEvent.location_lat as number | null;
        const scanLng = scanEvent.location_lng as number | null;

        steps.push({
          id: 'scanned',
          status: 'scanned',
          label: 'Envase escaneado',
          description: `El ciudadano entregó el envase en ${(sd.collection_point as string) ?? 'punto de acopio'}`,
          date: scanEvent.created_at as string,
          location: scanLat && scanLng ? {
            lat: scanLat,
            lng: scanLng,
            name: (sd.collection_point as string) ?? 'Punto de escaneo'
          } : null,
          completed: true
        });
        timeline.push({
          date: scanEvent.created_at as string,
          title: 'Escaneado',
          location: (sd.collection_point as string) ?? 'Punto de acopio',
          lat: scanLat,
          lng: scanLng
        });

        // Step 4: At acopio
        steps.push({
          id: 'at_acopio',
          status: 'at_acopio',
          label: 'En punto de acopio',
          description: 'El envase está listo para ser procesado',
          date: scanEvent.created_at as string,
          location: scanLat && scanLng ? {
            lat: scanLat,
            lng: scanLng,
            name: (sd.collection_point as string) ?? 'Punto de acopio'
          } : null,
          completed: true
        });
      }

      // Step 5: Recycled (future)
      steps.push({
        id: 'recycled',
        status: 'recycled',
        label: 'Reciclado',
        description: 'El material será procesado en planta de reciclaje',
        date: null,
        location: null,
        completed: ucidData.status === 'recycled'
      });

      const trackingResult: TrackingResult = {
        ucid: {
          short_code: ucidData.short_code as string,
          ucid_hash: ucidData.ucid_hash as string,
          product_name: ucidData.product_name as string | null,
          product_brand: ucidData.product_brand as string | null,
          container_type: ucidData.container_type as string,
          status: ucidData.status as string,
          created_at: ucidData.created_at as string,
          scanned_at: ucidData.scanned_at as string | null,
          company_name: companyInfo?.name ?? null,
          batch_name: (ucidData.batch as { batch_name: string } | null)?.batch_name ?? null,
        },
        steps,
        timeline
      };

      setResult(trackingResult);
    } catch {
      setError('Error al buscar el código. Intenta de nuevo.');
    }

    setLoading(false);
  }

  async function initMap() {
    if (!result || !mapRef.current) return;
    await loadLeaflet();
    const L = window.L;
    if (!L) return;

    if (leafletMap.current) {
      (leafletMap.current as { remove: () => void }).remove();
    }

    // Center on the first timeline point (origin), or default
    const firstPoint = result.timeline.find(t => t.lat && t.lng);
    const centerLat = firstPoint?.lat ?? 3.5915;
    const centerLng = firstPoint?.lng ?? -76.4981;

    const map = L.map(mapRef.current, { zoomControl: true }).setView([centerLat, centerLng], 12);
    leafletMap.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    // Draw route
    const points: [number, number][] = result.timeline
      .filter(t => t.lat && t.lng)
      .map(t => [t.lat!, t.lng!]);

    if (points.length >= 2) {
      L.polyline(points, {
        color: '#10b981',
        weight: 4,
        opacity: 0.8
      }).addTo(map);
    }

    // Add markers
    result.timeline.forEach((t, i) => {
      if (!t.lat || !t.lng) return;

      const isLast = i === result.timeline.length - 1;
      const icon = L.divIcon({
        html: `<div style="width:${isLast ? 32 : 24}px;height:${isLast ? 32 : 24}px;background:${isLast ? '#10b981' : '#3b82f6'};border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center">
          <span style="color:white;font-weight:bold;font-size:${isLast ? 12 : 10}px">${i + 1}</span>
        </div>`,
        className: '',
        iconSize: [isLast ? 32 : 24, isLast ? 32 : 24],
        iconAnchor: [isLast ? 16 : 12, isLast ? 16 : 12]
      });

      L.marker([t.lat, t.lng], { icon })
        .addTo(map)
        .bindPopup(`
          <div style="font-family:sans-serif">
            <div style="font-weight:700;color:#111">${t.title}</div>
            <div style="color:#666;font-size:12px;margin-top:2px">${t.location}</div>
            <div style="color:#999;font-size:11px;margin-top:4px">${new Date(t.date).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
          </div>
        `);
    });

    if (points.length > 0) {
      try {
        map.fitBounds(L.latLngBounds(points), { padding: [60, 60] });
      } catch { /* */ }
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 p-4">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center py-6">
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4">
            <QrCode className="w-8 h-8 text-emerald-400" />
          </div>
          <h1 className="text-2xl font-bold text-white">Rastreo de Envase</h1>
          <p className="text-slate-400 text-sm mt-1">Consulta el recorrido completo de tu envase</p>
        </div>

        {/* Search */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6">
          <div className="flex gap-3 max-w-xl mx-auto">
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') searchUCID(query); }}
              placeholder="Ingresa el código UCID (ej: ABC12345)"
              className="flex-1 bg-slate-800 border border-slate-700 text-white placeholder-slate-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
            />
            <button
              onClick={() => searchUCID(query)}
              disabled={loading || !query.trim()}
              className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-semibold px-6 py-3 rounded-xl transition-colors flex items-center gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Buscar
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/30 text-red-400 rounded-2xl px-5 py-4">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="space-y-5">
            {/* Product card */}
            <div className="bg-slate-900/60 border border-emerald-500/30 rounded-2xl p-6">
              <div className="flex items-start gap-4">
                <div className="w-16 h-16 rounded-2xl bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center shrink-0">
                  <Package className="w-8 h-8 text-emerald-400" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h2 className="text-xl font-bold text-white">
                      {result.ucid.product_name ?? 'Envase'}
                    </h2>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      result.ucid.status === 'scanned'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-amber-500/20 text-amber-300'
                    }`}>
                      {result.ucid.status === 'scanned' ? 'Reciclado' : 'En circulación'}
                    </span>
                  </div>
                  <p className="text-slate-400 text-sm mt-1">
                    {result.ucid.product_brand ?? 'Marca no especificada'}
                  </p>
                  <div className="flex items-center gap-3 mt-3 text-xs">
                    <div className="flex items-center gap-1 text-emerald-400">
                      <Hash className="w-3.5 h-3.5" />
                      <span className="font-mono">{result.ucid.short_code}</span>
                    </div>
                    {result.ucid.company_name && (
                      <div className="flex items-center gap-1 text-teal-400">
                        <Building2 className="w-3.5 h-3.5" />
                        <span>{result.ucid.company_name}</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-slate-500 text-xs">Tipo</p>
                  <p className="text-white font-semibold">{result.ucid.container_type}</p>
                </div>
              </div>
            </div>

            {/* Map */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-emerald-400" />
                <span className="text-white text-sm font-medium">Ruta del envase</span>
              </div>
              <div ref={mapRef} className="h-64 w-full" style={{ background: '#0f172a' }} />
            </div>

            {/* Timeline */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
                <Clock className="w-4 h-4 text-emerald-400" />
                <span className="text-white text-sm font-medium">Historial de movimiento</span>
              </div>

              <div className="p-4">
                <div className="space-y-0">
                  {result.steps.map((step, i) => (
                    <div key={step.id} className="flex gap-3">
                      {/* Line and dot */}
                      <div className="flex flex-col items-center">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                          step.completed
                            ? 'bg-emerald-500/20 border-2 border-emerald-500'
                            : 'bg-slate-800 border-2 border-slate-700'
                        }`}>
                          {step.id === 'generated' && <QrCode className={`w-4 h-4 ${step.completed ? 'text-emerald-400' : 'text-slate-500'}`} />}
                          {step.id === 'in_transit' && <Truck className={`w-4 h-4 ${step.completed ? 'text-emerald-400' : 'text-slate-500'}`} />}
                          {step.id === 'scanned' && <CheckCircle2 className={`w-4 h-4 ${step.completed ? 'text-emerald-400' : 'text-slate-500'}`} />}
                          {step.id === 'at_acopio' && <MapPin className={`w-4 h-4 ${step.completed ? 'text-emerald-400' : 'text-slate-500'}`} />}
                          {step.id === 'recycled' && <Leaf className={`w-4 h-4 ${step.completed ? 'text-emerald-400' : 'text-slate-500'}`} />}
                        </div>
                        {i < result.steps.length - 1 && (
                          <div className={`w-0.5 flex-1 ${step.completed ? 'bg-emerald-500' : 'bg-slate-700'}`} />
                        )}
                      </div>

                      {/* Content */}
                      <div className={`flex-1 pb-6 ${i === result.steps.length - 1 ? 'pb-0' : ''}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className={`font-semibold ${step.completed ? 'text-white' : 'text-slate-500'}`}>
                              {step.label}
                            </p>
                            <p className="text-slate-400 text-sm">{step.description}</p>
                          </div>
                          {step.date && (
                            <div className="text-right shrink-0">
                              <p className="text-emerald-400 text-xs font-medium">
                                {new Date(step.date).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}
                              </p>
                              <p className="text-slate-500 text-xs">
                                {new Date(step.date).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                              </p>
                            </div>
                          )}
                        </div>
                        {step.location && (
                          <div className="flex items-center gap-2 mt-2">
                            <MapPin className="w-3.5 h-3.5 text-amber-400" />
                            <span className="text-amber-300 text-xs">{step.location.name}</span>
                            <a
                              href={`https://www.google.com/maps/search/?api=1&query=${step.location.lat},${step.location.lng}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-slate-500 hover:text-emerald-400 text-xs"
                            >
                              Ver mapa
                            </a>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Verification */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Hash className="w-4 h-4 text-emerald-400" />
                <p className="text-white text-sm font-medium">Verificación criptográfica</p>
              </div>
              <p className="font-mono text-xs text-emerald-400 break-all bg-slate-800/60 rounded-lg p-3">
                {result.ucid.ucid_hash}
              </p>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!result && !error && !loading && (
          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-8 text-center">
            <QrCode className="w-12 h-12 text-slate-600 mx-auto mb-4" />
            <p className="text-slate-400">Ingresa un código UCID para ver el recorrido del envase</p>
          </div>
        )}
      </div>
    </div>
  );
}
