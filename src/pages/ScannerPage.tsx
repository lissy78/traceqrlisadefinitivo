import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '../lib/auth';
import { supabase, ProductCatalog } from '../lib/supabase';
import { generateScanToken, fetchOpenFoodFacts, ACQUISITION_SOURCES } from '../lib/utils';
import {
  QrCode, Barcode, Camera, CheckCircle2, XCircle,
  Loader2, Package, Star, Hash, ChevronDown,
  RefreshCw, AlertCircle, Upload, ImageIcon, Building2,
  MapPin, Navigation
} from 'lucide-react';

type Step = 'scan' | 'questions' | 'result';

const PLASTIC_TYPES = [
  'Chuspa (bolsa plástica)',
  'PET (botella plástica)',
  'Otros tipos de plástico',
];

const COLLECTION_POINTS = [
  'Univalle - Calle 3N # 2N-17, Barrio Las Vegas, Yumbo',
  'Punto Verde - Centro Yumbo',
  'Recicladora Municipal Yumbo',
  'Ecoparque Río Cauca',
  'Punto de acopio Colegio',
  'Punto de acopio Universidad',
  'Otro',
];

const SCAN_QUESTIONS = [
  { key: 'acquisition_source', label: '¿Dónde conseguiste este producto?', type: 'select', options: ACQUISITION_SOURCES },
  { key: 'brand_name', label: '¿Cuál es la marca del producto?', type: 'select', options: ['Coca-Cola', 'Colombiana', 'Postobón', 'Pepsi', 'Sprite', 'Fanta', 'Bavaria', 'Águila', 'Club Colombia', 'Cristal', 'Brisa', 'Manantial', 'Nestlé', 'Otro'] },
  { key: 'industry_type', label: '¿A qué industria pertenece?', type: 'select', options: ['Bebidas', 'Alimentos', 'Farmacéutica / Droguería', 'Cosméticos / Belleza', 'Limpieza del hogar', 'Otro'] },
  { key: 'material_type', label: '¿Qué tipo de plástico es?', type: 'select', options: PLASTIC_TYPES },
  { key: 'container_condition', label: '¿En qué estado está el envase?', type: 'select', options: ['Vacío', 'Parcialmente lleno', 'Lleno (sin abrir)'] },
  { key: 'collection_point', label: '¿En qué punto de acopio lo entregarás?', type: 'select', options: COLLECTION_POINTS },
  { key: 'location', label: 'Ubicación actual (GPS)', type: 'location', options: [] },
];

declare const BarcodeDetector: {
  new(opts: { formats: string[] }): {
    detect(source: HTMLVideoElement | HTMLImageElement | ImageBitmap): Promise<Array<{ rawValue: string; format: string }>>;
  };
};

async function matchBrandToCompany(brand: string | null): Promise<{ id: string; name: string } | null> {
  if (!brand) return null;
  const cleanBrand = brand.trim();
  if (!cleanBrand) return null;

  const { data } = await supabase
    .from('companies')
    .select('id, name')
    .ilike('name', `%${cleanBrand.split(' ')[0]}%`)
    .limit(5);

  if (!data || data.length === 0) return null;

  const brandLower = cleanBrand.toLowerCase();
  const exact = data.find((c: { name: string }) =>
    c.name.toLowerCase().includes(brandLower) || brandLower.includes(c.name.toLowerCase().split(' ')[0])
  );
  return exact ?? data[0];
}

export default function ScannerPage() {
  const { profile, refreshProfile } = useAuth();
  const [step, setStep] = useState<Step>('scan');
  const [manualCode, setManualCode] = useState('');
  const [scannedCode, setScannedCode] = useState('');
  const [product, setProduct] = useState<ProductCatalog | null>(null);
  const [matchedCompany, setMatchedCompany] = useState<{ id: string; name: string } | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [scanResult, setScanResult] = useState<{ points: number; token: string; companyName: string | null } | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStatus, setCameraStatus] = useState<'idle' | 'requesting' | 'active' | 'error'>('idle');
  const [offData, setOffData] = useState<Record<string, unknown> | null>(null);
  const [scanningFrame, setScanningFrame] = useState(false);
  const [geoStatus, setGeoStatus] = useState<'idle' | 'requesting' | 'granted' | 'error'>('idle');

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasBarcodeDetector = typeof window !== 'undefined' && 'BarcodeDetector' in window;

  useEffect(() => {
    return () => stopCamera();
  }, []);

  function stopCamera() {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
    setScanningFrame(false);
  }

  async function startCamera() {
    setError('');
    setCameraStatus('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
      setCameraStatus('active');
      if (hasBarcodeDetector) startBarcodeDetection();
    } catch (e: unknown) {
      const err = e as Error;
      setCameraStatus('error');
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setError('Permiso de cámara denegado. Permite el acceso o usa el ingreso manual.');
      } else if (err.name === 'NotFoundError') {
        setError('No se encontró cámara. Usa el ingreso manual o carga una imagen.');
      } else {
        setError('No se pudo acceder a la cámara. Usa el ingreso manual o carga una imagen.');
      }
    }
  }

  function startBarcodeDetection() {
    if (!videoRef.current) return;
    const detector = new BarcodeDetector({
      formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code', 'data_matrix'],
    });
    const detect = async () => {
      if (!videoRef.current || !streamRef.current) return;
      setScanningFrame(true);
      try {
        const barcodes = await detector.detect(videoRef.current);
        if (barcodes.length > 0) {
          const bc = barcodes[0];
          stopCamera();
          handleCodeDetected(bc.rawValue, bc.format === 'qr_code' ? 'qr' : 'barcode');
          return;
        }
      } catch { /* no barcode in frame */ }
      animFrameRef.current = requestAnimationFrame(detect);
    };
    animFrameRef.current = requestAnimationFrame(detect);
  }

  async function handleImageFile(file: File) {
    setError('');
    if (!hasBarcodeDetector) {
      setError('Tu navegador no soporta lectura automática de imágenes. Ingresa el código manualmente.');
      return;
    }
    setLoading(true);
    try {
      const bitmap = await createImageBitmap(file);
      const detector = new BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'],
      });
      const barcodes = await detector.detect(bitmap);
      if (barcodes.length > 0) {
        handleCodeDetected(barcodes[0].rawValue, barcodes[0].format === 'qr_code' ? 'qr' : 'barcode');
      } else {
        setError('No se detectó ningún código en la imagen. Ingresa el código manualmente.');
      }
    } catch {
      setError('Error al procesar la imagen. Ingresa el código manualmente.');
    }
    setLoading(false);
  }

  const handleCodeDetected = useCallback(async (code: string, type: 'barcode' | 'qr') => {
    setScannedCode(code);
    setLoading(true);
    setError('');
    setMatchedCompany(null);

    const { data: existing } = await supabase
      .from('product_catalog')
      .select('*')
      .eq('barcode', code)
      .maybeSingle();

    if (existing) {
      const prod = existing as ProductCatalog;
      setProduct(prod);

      // Match company from brand if not already linked
      const company = await matchBrandToCompany(prod.brand);
      setMatchedCompany(company);

      // If product has no company but we found one, update it
      if (!prod.company_id && company) {
        await supabase.from('product_catalog')
          .update({ company_id: company.id })
          .eq('id', prod.id);
        setProduct({ ...prod, company_id: company.id });
      }

      const { data: aiData } = await supabase
        .from('ai_product_responses')
        .select('*')
        .eq('barcode', code);
      const preAnswers: Record<string, string> = {};
      (aiData ?? []).forEach((r: { question_key: string; answer: string }) => {
        preAnswers[r.question_key] = r.answer;
      });
      setAnswers(preAnswers);
    } else {
      const off = await fetchOpenFoodFacts(code);
      if (off) {
        setOffData(off as Record<string, unknown>);
        const brand = (off.brands as string) || null;

        // Match brand to company
        const company = await matchBrandToCompany(brand);
        setMatchedCompany(company);

        const newProduct: Omit<ProductCatalog, 'id' | 'created_at' | 'updated_at'> = {
          barcode: code,
          name: (off.product_name as string) || code,
          brand,
          category: (off.categories as string)?.split(',')[0]?.trim() || null,
          company_id: company?.id ?? null,
          image_url: (off.image_url as string) || null,
          description: null,
          material: 'PET',
          weight_grams: null,
          off_data: off as Record<string, unknown>,
          ai_confidence: 0.7,
          scan_count: 1,
        };
        const { data: inserted } = await supabase
          .from('product_catalog')
          .insert(newProduct)
          .select()
          .maybeSingle();
        setProduct((inserted ?? { id: '', ...newProduct, created_at: '', updated_at: '' }) as ProductCatalog);
      } else {
        setProduct({
          id: '', barcode: code, name: `Código: ${code}`, brand: null, category: null,
          company_id: null, image_url: null, description: null, material: 'PET',
          weight_grams: null, off_data: null, ai_confidence: 0, scan_count: 1,
          created_at: '', updated_at: '',
        });
      }
    }
    setLoading(false);
    setStep('questions');
  }, []);

  async function handleSubmitAnswers() {
    if (!profile) return;
    const unanswered = SCAN_QUESTIONS.filter(q => !answers[q.key]);
    if (unanswered.length > 0) { setError('Por favor responde todas las preguntas'); return; }
    setLoading(true);
    setError('');

    const token = await generateScanToken(profile.id, scannedCode);

    // Use brand_name answer to match company if not already matched
    const brandAnswer = answers['brand_name'];
    let companyId = product?.company_id ?? matchedCompany?.id ?? null;
    let resolvedCompany = matchedCompany;
    if (!companyId && brandAnswer && brandAnswer !== 'Otro') {
      resolvedCompany = await matchBrandToCompany(brandAnswer);
      companyId = resolvedCompany?.id ?? null;
      if (resolvedCompany) setMatchedCompany(resolvedCompany);
    }

    // Update product brand/material from answers if not set
    if (product?.id) {
      const updates: Record<string, string | null> = {};
      if (!product.brand && brandAnswer && brandAnswer !== 'Otro') updates.brand = brandAnswer;
      if (answers['material_type']) {
        const mat = answers['material_type'].includes('PET') ? 'PET'
          : answers['material_type'].includes('Chuspa') ? 'Chuspa'
          : 'Otro plástico';
        updates.material = mat;
      }
      if (answers['industry_type']) updates.category = answers['industry_type'];
      if (companyId && !product.company_id) updates.company_id = companyId;
      if (Object.keys(updates).length > 0) {
        await supabase.from('product_catalog').update(updates).eq('id', product.id);
      }
    }

    const { error: scanErr } = await supabase.from('scan_events').insert({
      user_id: profile.id,
      barcode: scannedCode,
      scan_type: 'barcode',
      acquisition_source: answers['acquisition_source'],
      points_earned: 10,
      token_hash: token,
      product_id: product?.id || null,
      company_id: companyId,
      scan_data: answers,
    });

    if (scanErr) { 
      if (scanErr.code === '23505' || scanErr.message?.includes('unique_user_barcode')) {
        setError('duplicate_scan');
      } else {
        setError(scanErr.message); 
      }
      setLoading(false); 
      return; 
    }

    for (const [key, val] of Object.entries(answers)) {
      const { data: existing } = await supabase
        .from('ai_product_responses')
        .select('*')
        .eq('barcode', scannedCode)
        .eq('question_key', key)
        .maybeSingle();

      if (existing) {
        if (existing.answer === val) {
          await supabase.from('ai_product_responses')
            .update({ vote_count: existing.vote_count + 1, confidence: Math.min(1, existing.confidence + 0.05) })
            .eq('id', existing.id);
        } else if (existing.vote_count < 3) {
          await supabase.from('ai_product_responses')
            .update({ answer: val, confidence: 0.5, vote_count: 1 })
            .eq('id', existing.id);
        }
      } else {
        await supabase.from('ai_product_responses').insert({
          barcode: scannedCode, question_key: key, answer: val, confidence: 0.5, vote_count: 1,
        });
      }
    }

    if (product?.id) {
      await supabase.from('product_catalog')
        .update({ scan_count: (product.scan_count ?? 1) + 1 })
        .eq('id', product.id);
    }

    await refreshProfile();
    setScanResult({ points: 10, token, companyName: resolvedCompany?.name ?? matchedCompany?.name ?? null });
    setLoading(false);
    setStep('result');
  }

  function requestGeolocation() {
    if (!navigator.geolocation) {
      setAnswers(prev => ({ ...prev, location: 'Geolocalización no disponible' }));
      return;
    }
    setGeoStatus('requesting');
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude, longitude, accuracy } = pos.coords;
        const locStr = `${latitude.toFixed(6)}, ${longitude.toFixed(6)} (±${Math.round(accuracy)}m)`;
        setAnswers(prev => ({ ...prev, location: locStr }));
        setGeoStatus('granted');
      },
      () => {
        setGeoStatus('error');
        setAnswers(prev => ({ ...prev, location: 'No disponible' }));
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function resetScanner() {
    setStep('scan');
    setScannedCode('');
    setProduct(null);
    setMatchedCompany(null);
    setAnswers({});
    setScanResult(null);
    setManualCode('');
    setOffData(null);
    setError('');
    setCameraStatus('idle');
    setGeoStatus('idle');
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <QrCode className="w-6 h-6 text-emerald-400" />
          Escanear plástico
        </h1>
        <p className="text-slate-400 text-sm mt-1">Escanea el código QR o de barras del envase</p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6">
        {['Escanear', 'Preguntas', 'Resultado'].map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
              (step === 'scan' && i === 0) || (step === 'questions' && i === 1) || (step === 'result' && i === 2)
                ? 'bg-emerald-500 text-white'
                : (step === 'questions' && i === 0) || (step === 'result' && i <= 1)
                ? 'bg-emerald-500/30 text-emerald-400'
                : 'bg-slate-800 text-slate-500'
            }`}>
              {i + 1}
            </div>
            <span className="text-xs text-slate-400 hidden sm:block">{s}</span>
            {i < 2 && <div className="w-8 h-px bg-slate-700" />}
          </div>
        ))}
      </div>

      {step === 'scan' && (
        <div className="space-y-4">
          {/* Camera */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
            <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
              <Camera className="w-4 h-4 text-emerald-400" /> Cámara en vivo
            </h2>
            <div className={cameraActive ? 'block' : 'hidden'}>
              <div className="relative">
                <video ref={videoRef} className="w-full rounded-xl aspect-video object-cover bg-black" autoPlay playsInline muted />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className={`w-52 h-52 rounded-2xl border-2 ${scanningFrame ? 'border-emerald-400' : 'border-white/40'} transition-colors relative`}>
                    <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-emerald-400 rounded-tl-lg" />
                    <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-emerald-400 rounded-tr-lg" />
                    <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-emerald-400 rounded-bl-lg" />
                    <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-emerald-400 rounded-br-lg" />
                  </div>
                </div>
                <button onClick={stopCamera} className="absolute top-2 right-2 bg-slate-900/80 text-white rounded-lg px-3 py-1.5 text-xs flex items-center gap-1 hover:bg-slate-800 transition-colors">
                  <XCircle className="w-3 h-3" /> Detener
                </button>
                {!hasBarcodeDetector && (
                  <div className="absolute bottom-2 left-2 right-2 bg-amber-900/80 text-amber-300 text-xs rounded-lg px-3 py-2 text-center">
                    Ingresa el código manualmente.
                  </div>
                )}
              </div>
            </div>
            {!cameraActive && (
              <button
                onClick={startCamera}
                disabled={cameraStatus === 'requesting'}
                className="w-full bg-emerald-500/15 border border-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-50 rounded-xl py-10 flex flex-col items-center gap-3 transition-colors group"
              >
                {cameraStatus === 'requesting' ? (
                  <Loader2 className="w-10 h-10 text-emerald-400 animate-spin" />
                ) : (
                  <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Camera className="w-7 h-7 text-emerald-400" />
                  </div>
                )}
                <span className="text-emerald-300 font-medium">
                  {cameraStatus === 'requesting' ? 'Solicitando permiso...' : 'Activar cámara'}
                </span>
                <span className="text-slate-500 text-xs text-center px-4">
                  {hasBarcodeDetector ? 'Detección automática de QR y códigos de barras' : 'Ingresa el código manualmente después'}
                </span>
              </button>
            )}
          </div>

          {/* Upload image */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
            <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-violet-400" /> Foto del código
            </h2>
            <input ref={fileInputRef} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleImageFile(f); e.target.value = ''; }} />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 bg-violet-500/10 border border-violet-500/25 hover:bg-violet-500/20 text-violet-300 rounded-xl py-3.5 text-sm font-medium transition-colors"
            >
              <Upload className="w-4 h-4" />
              Tomar foto o cargar imagen
            </button>
          </div>

          {/* Manual input */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
            <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
              <Barcode className="w-4 h-4 text-blue-400" /> Código manual
            </h2>
            <div className="flex gap-2">
              <input
                type="text"
                value={manualCode}
                onChange={e => setManualCode(e.target.value)}
                placeholder="Ej: 7702001000022"
                className="flex-1 bg-slate-800 border border-slate-700 text-white placeholder-slate-500 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                onKeyDown={e => { if (e.key === 'Enter' && manualCode.trim()) handleCodeDetected(manualCode.trim(), 'barcode'); }}
              />
              <button
                onClick={() => { if (manualCode.trim()) handleCodeDetected(manualCode.trim(), 'barcode'); }}
                disabled={!manualCode.trim() || loading}
                className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white rounded-xl px-4 py-2.5 text-sm font-medium transition-colors"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Buscar'}
              </button>
            </div>
          </div>

          {error && <ErrorBanner msg={error} />}
        </div>
      )}

      {step === 'questions' && (
        <div className="space-y-4">
          {/* Product card */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
            <div className="flex items-center gap-4">
              {product?.image_url ? (
                <img src={product.image_url} alt={product.name} className="w-14 h-14 rounded-xl object-cover bg-slate-800" />
              ) : (
                <div className="w-14 h-14 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center">
                  <Package className="w-6 h-6 text-slate-500" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-white font-semibold truncate">{product?.name || scannedCode}</p>
                {product?.brand && <p className="text-slate-400 text-sm">{product.brand}</p>}
                <div className="flex items-center gap-1 mt-1">
                  <Hash className="w-3 h-3 text-slate-500" />
                  <span className="text-slate-500 text-xs font-mono">{scannedCode}</span>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                {offData && <span className="text-xs bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-full px-2 py-0.5">OFF</span>}
              </div>
            </div>

            {/* Company match indicator */}
            {matchedCompany && (
              <div className="mt-3 pt-3 border-t border-slate-800 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-teal-400 shrink-0" />
                <div>
                  <p className="text-teal-300 text-xs font-medium">Empresa identificada: <span className="font-bold">{matchedCompany.name}</span></p>
                  <p className="text-slate-500 text-xs">Este escaneo quedará registrado en su tablero</p>
                </div>
              </div>
            )}
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 space-y-5">
            <h2 className="text-white font-semibold">Cuéntanos más</h2>
            {SCAN_QUESTIONS.map(q => (
              <div key={q.key}>
                <label className="block text-sm font-medium text-slate-300 mb-2">{q.label}</label>

                {q.type === 'location' ? (
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={requestGeolocation}
                      disabled={geoStatus === 'requesting'}
                      className="w-full flex items-center justify-center gap-2 bg-blue-500/15 border border-blue-500/30 hover:bg-blue-500/25 disabled:opacity-60 text-blue-300 rounded-xl px-4 py-3 text-sm font-medium transition-colors"
                    >
                      {geoStatus === 'requesting' ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Obteniendo ubicación...</>
                      ) : geoStatus === 'granted' ? (
                        <><CheckCircle2 className="w-4 h-4 text-emerald-400" /> <span className="text-emerald-300">Ubicación capturada</span></>
                      ) : geoStatus === 'error' ? (
                        <><AlertCircle className="w-4 h-4 text-amber-400" /> Reintentar ubicación</>
                      ) : (
                        <><Navigation className="w-4 h-4" /> Capturar ubicación en tiempo real</>
                      )}
                    </button>
                    {answers['location'] && geoStatus === 'granted' && (
                      <div className="flex items-start gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-3 py-2">
                        <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                        <span className="text-emerald-300 text-xs font-mono break-all">{answers['location']}</span>
                      </div>
                    )}
                    {geoStatus === 'error' && (
                      <p className="text-xs text-amber-400 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" /> Permiso denegado. La ubicación se guardará como no disponible.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="relative">
                    <select
                      value={answers[q.key] ?? ''}
                      onChange={e => setAnswers(prev => ({ ...prev, [q.key]: e.target.value }))}
                      className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500 appearance-none transition-colors"
                    >
                      <option value="">Selecciona una opción</option>
                      {q.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  </div>
                )}

                {answers[q.key] && q.type !== 'location' && (
                  <p className="text-xs text-emerald-400 mt-1 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Aprendido por IA
                  </p>
                )}
              </div>
            ))}
          </div>

          {error && <ErrorBanner msg={error} />}

          <div className="flex gap-3">
            <button onClick={resetScanner} className="flex-1 bg-slate-800 hover:bg-slate-700 text-white rounded-xl py-2.5 text-sm font-medium transition-colors">
              Cancelar
            </button>
            <button
              onClick={handleSubmitAnswers}
              disabled={loading}
              className="flex-1 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors flex items-center justify-center gap-2"
            >
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</> : 'Confirmar escaneo'}
            </button>
          </div>
        </div>
      )}

      {step === 'result' && scanResult && (
        <div className="bg-slate-900/60 border border-emerald-500/30 rounded-2xl p-8 text-center">
          <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-10 h-10 text-emerald-400" />
          </div>
          <h2 className="text-white text-2xl font-bold mb-1">¡Escaneado!</h2>
          <p className="text-slate-400 text-sm mb-4">Tu reciclaje ha sido registrado exitosamente</p>

          {scanResult.companyName && (
            <div className="flex items-center justify-center gap-2 bg-teal-500/10 border border-teal-500/20 rounded-xl px-4 py-2 mb-4">
              <Building2 className="w-4 h-4 text-teal-400" />
              <span className="text-teal-300 text-sm">Registrado en <strong>{scanResult.companyName}</strong></span>
            </div>
          )}

          <div className="flex items-center justify-center gap-2 text-3xl font-bold text-amber-400 mb-2">
            <Star className="w-7 h-7" />
            +{scanResult.points} pts
          </div>
          <p className="text-slate-500 text-xs mb-6">
            Total: {(profile?.total_points ?? 0).toLocaleString('es-CO')} puntos
          </p>
          <div className="bg-slate-800/60 rounded-xl p-4 mb-6">
            <p className="text-slate-400 text-xs mb-1">Token de verificación (SHA-256)</p>
            <p className="text-emerald-400 font-mono text-xs break-all">{scanResult.token}</p>
          </div>
          <button
            onClick={resetScanner}
            className="w-full bg-emerald-500 hover:bg-emerald-400 text-white rounded-xl py-3 font-semibold transition-colors flex items-center justify-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Escanear otro
          </button>
        </div>
      )}
    </div>
  );
}

function ErrorBanner({ msg }: { msg: string }) {
  if (msg === 'duplicate_scan') {
    return (
      <div className="bg-slate-900/80 border border-amber-500/30 rounded-2xl p-6 text-center flex flex-col items-center justify-center gap-3 animate-fade-in">
        {/* SVG de Botella Triste */}
        <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.2)]">
          <path d="M26 12V6C26 4.89543 26.8954 4 28 4H36C37.1046 4 38 4.89543 38 6V12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
          <path d="M24 18C24 14.6863 26.6863 12 30 12H34C37.3137 12 40 14.6863 40 18V22C40 25.3137 43 28 46 31V54C46 57.3137 43.3137 60 40 60H24C20.6863 60 18 57.3137 18 54V31C21 28 24 25.3137 24 22V18Z" fill="#1e293b" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round"/>
          <rect x="24" y="2" width="16" height="3" rx="1.5" fill="currentColor"/>
          <path d="M28 50H36" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="1 3"/>
          <circle cx="27" cy="38" r="2" fill="currentColor" />
          <circle cx="37" cy="38" r="2" fill="currentColor" />
          <path d="M29 45C30.5 43.5 33.5 43.5 35 45" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          <path d="M27 41C27 41.5 26.5 42 26 42C25.5 42 25 41.5 25 41C25 40.5 27 39.5 27 39.5C27 39.5 27 40.5 27 41Z" fill="#60a5fa"/>
        </svg>

        <div>
          <h4 className="text-amber-400 font-bold text-base mb-1">¡Ups! Ya escaneaste este producto</h4>
          <p className="text-slate-400 text-xs max-w-sm mx-auto">
            Escanea otro para continuar reciclando.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 bg-red-500/15 border border-red-500/30 text-red-400 rounded-xl px-4 py-3 text-sm">
      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
      <span>{msg}</span>
    </div>
  );
}