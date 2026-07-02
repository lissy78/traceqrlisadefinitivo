import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '../lib/auth';
import { supabase, ProductCatalog } from '../lib/supabase';
import { generateScanToken, fetchOpenFoodFacts, ACQUISITION_SOURCES } from '../lib/utils';
import Tesseract from 'tesseract.js';
import {
  QrCode, Barcode, Camera, CheckCircle2, XCircle,
  Loader2, Package, Star, Hash, ChevronDown,
  RefreshCw, AlertCircle, Upload, ImageIcon, Building2,
  MapPin, Navigation, ImageOff, FileImage, ShieldCheck, ShieldAlert
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

const SCAN_QUESTIONS: Array<{
  key: string;
  label: string;
  type: 'select' | 'text' | 'location';
  options: string[];
  showIf?: { key: string; value: string };
}> = [
  { key: 'acquisition_source', label: '¿Dónde conseguiste este producto?', type: 'select', options: ACQUISITION_SOURCES },
  { key: 'brand_name', label: '¿Cuál es la marca del producto?', type: 'select', options: ['Coca-Cola', 'Colombiana', 'Postobón', 'Pepsi', 'Sprite', 'Fanta', 'Bavaria', 'Águila', 'Club Colombia', 'Cristal', 'Brisa', 'Manantial', 'Nestlé', 'Otro'] },
  { key: 'other_brand', label: 'Especifica la marca', type: 'text', options: [], showIf: { key: 'brand_name', value: 'Otro' } },
  { key: 'industry_type', label: '¿A qué industria pertenece?', type: 'select', options: ['Bebidas', 'Alimentos', 'Farmacéutica / Droguería', 'Cosméticos / Belleza', 'Limpieza del hogar', 'Otro'] },
  { key: 'other_industry', label: 'Especifica la industria', type: 'text', options: [], showIf: { key: 'industry_type', value: 'Otro' } },
  { key: 'material_type', label: '¿Qué tipo de plástico es?', type: 'select', options: PLASTIC_TYPES },
  { key: 'container_size', label: '¿Cuál es el tamaño del envase?', type: 'select', options: ['Pequeño (< 500ml)', 'Mediano (500ml - 1L)', 'Grande (> 1L)'] },
  { key: 'container_condition', label: '¿En qué estado está el envase?', type: 'select', options: ['Vacío', 'Parcialmente lleno', 'Lleno (sin abrir)'] },
  { key: 'collection_point', label: '¿En qué punto de acopio lo entregarás?', type: 'select', options: COLLECTION_POINTS },
  { key: 'other_collection_point', label: 'Especifica el punto de acopio', type: 'text', options: [], showIf: { key: 'collection_point', value: 'Otro' } },
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

// Detect if code is a TraceQR UCID (QR from our platform)
function isTraceQRUCID(code: string): { isUCID: boolean; shortCode?: string; ucidHash?: string } {
  // Pattern 1: Full URL like traceqr.app/s/SHORTCODE/HASHPART
  const urlMatch = code.match(/traceqr\.app\/s\/([A-Z0-9]{8})\/([a-f0-9]+)/i);
  if (urlMatch) {
    return { isUCID: true, shortCode: urlMatch[1], ucidHash: undefined };
  }
  // Pattern 2: Just short code with hash part: SHORTCODE/HASHPART
  const shortMatch = code.match(/^([A-Z0-9]{8})\/([a-f0-9]{16,})$/i);
  if (shortMatch) {
    return { isUCID: true, shortCode: shortMatch[1], ucidHash: undefined };
  }
  // Pattern 3: 128-char hex hash (full UCID hash)
  if (/^[a-f0-9]{128}$/i.test(code)) {
    return { isUCID: true, shortCode: undefined, ucidHash: code.toLowerCase() };
  }
  return { isUCID: false };
}

// Look up UCID by short_code or full hash, then validate
async function lookupAndValidateUCID(shortCode?: string, ucidHash?: string): Promise<{ valid: boolean; error?: string; data?: Record<string, unknown> }> {
  try {
    // If we have the full hash, use the edge function
    if (ucidHash && /^[a-f0-9]{128}$/i.test(ucidHash)) {
      const { data, error } = await supabase.functions.invoke('ucid-generator', {
        body: { action: 'validate', ucidHash },
      });
      if (error) return { valid: false, error: error.message };
      return data;
    }

    // If we only have short_code, look up directly in the DB
    if (shortCode) {
      const { data, error } = await supabase
        .from('ucids')
        .select('*')
        .eq('short_code', shortCode.toUpperCase())
        .maybeSingle();

      if (error) return { valid: false, error: error.message };
      if (!data) return { valid: false, error: 'UCID no encontrado' };
      if (data.status === 'scanned') return { valid: false, error: 'Este envase ya fue escaneado' };

      return { valid: true, data: { ...data, ucid_id: data.id, ucid_hash: data.ucid_hash } };
    }

    return { valid: false, error: 'Código UCID inválido' };
  } catch {
    return { valid: false, error: 'Error al validar UCID' };
  }
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
  const [locationWarning, setLocationWarning] = useState<string | null>(null);
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [verificationPhoto, setVerificationPhoto] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoVerified, setPhotoVerified] = useState<'pending' | 'verified' | 'mismatch' | null>(null);
  const [extractedData, setExtractedData] = useState<{ brands: string[]; sizes: string[]; rawText: string } | null>(null);
  const [ocrProgress, setOcrProgress] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

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

    // Check if this is a TraceQR UCID (unique container identifier)
    const ucidCheck = isTraceQRUCID(code);
    if (ucidCheck.isUCID) {
      // This is a UCID - validate it (lookup by short_code or full hash)
      const validation = await lookupAndValidateUCID(ucidCheck.shortCode, ucidCheck.ucidHash);

      if (!validation.valid) {
        setError(validation.error || 'UCID invalido');
        setLoading(false);
        return;
      }

      // UCID is valid - get company info
      const ucidData = validation.data as Record<string, unknown>;
      const companyData = ucidData.company_id ? await supabase
        .from('companies')
        .select('id, name')
        .eq('id', ucidData.company_id as string)
        .maybeSingle() : null;

      if (companyData?.data) {
        setMatchedCompany({ id: companyData.data.id, name: companyData.data.name });
      }

      // Set product info from UCID
      const ucidProduct: ProductCatalog = {
        id: '',
        barcode: ucidHash.slice(0, 24),
        name: (ucidData.product_name as string) || `UCID: ${ucidData.short_code}`,
        brand: (ucidData.product_brand as string) || null,
        category: null,
        company_id: (ucidData.company_id as string) || null,
        image_url: null,
        description: null,
        material: (ucidData.container_type as string) || 'PET',
        weight_grams: null,
        off_data: { ucid_hash: ucidHash, short_code: ucidData.short_code, validated: true },
        ai_confidence: 1,
        scan_count: 1,
        created_at: '',
        updated_at: '',
      };
      setProduct(ucidProduct);

      // Store UCID hash for later use
      setAnswers(prev => ({ ...prev, _ucid_id: ucidData.ucid_id as string, _ucid_hash: ucidHash }));
      setLoading(false);
      setStep('questions');
      // Auto-request geolocation immediately
      requestGeolocation();
      return;
    }

    // Standard barcode flow
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
    // Auto-request geolocation immediately
    requestGeolocation();
  }, []);

  async function handleSubmitAnswers() {
    if (!profile) return;

    // Check required questions including conditional ones
    const unanswered = SCAN_QUESTIONS.filter(q => {
      // Skip questions with showIf conditions not met
      if (q.showIf && answers[q.showIf.key] !== q.showIf.value) return false;
      return !answers[q.key] && !q.key.startsWith('_');
    });
    if (unanswered.length > 0) { setError('Por favor responde todas las preguntas'); return; }

    // If brand is "Otro", verify other_brand is filled
    if (answers['brand_name'] === 'Otro' && !answers['other_brand']?.trim()) {
      setError('Por favor especifica el nombre de la marca');
      return;
    }
    // If industry is "Otro", verify other_industry is filled
    if (answers['industry_type'] === 'Otro' && !answers['other_industry']?.trim()) {
      setError('Por favor especifica la industria');
      return;
    }
    // If collection_point is "Otro", verify other_collection_point is filled
    if (answers['collection_point'] === 'Otro' && !answers['other_collection_point']?.trim()) {
      setError('Por favor especifica el punto de acopio');
      return;
    }

    setLoading(true);
    setError('');

    const token = await generateScanToken(profile.id, scannedCode);
    const ucidId = answers._ucid_id as string | undefined;
    const ucidHash = answers._ucid_hash as string | undefined;

    // Use brand_name answer to match company if not already matched
    // If "Otro" was selected, use the custom brand
    const brandAnswer = answers['brand_name'] === 'Otro' ? answers['other_brand'] : answers['brand_name'];
    const industryAnswer = answers['industry_type'] === 'Otro' ? answers['other_industry'] : answers['industry_type'];
    const collectionPointAnswer = answers['collection_point'] === 'Otro' ? answers['other_collection_point'] : answers['collection_point'];

    let companyId = product?.company_id ?? matchedCompany?.id ?? null;
    let resolvedCompany = matchedCompany;
    if (!companyId && brandAnswer) {
      resolvedCompany = await matchBrandToCompany(brandAnswer);
      companyId = resolvedCompany?.id ?? null;
      if (resolvedCompany) setMatchedCompany(resolvedCompany);
    }

    // Update product brand/material from answers if not set
    if (product?.id) {
      const updates: Record<string, string | null> = {};
      if (!product.brand && brandAnswer) updates.brand = brandAnswer;
      if (answers['material_type']) {
        const mat = answers['material_type'].includes('PET') ? 'PET'
          : answers['material_type'].includes('Chuspa') ? 'Chuspa'
          : 'Otro plástico';
        updates.material = mat;
      }
      if (industryAnswer) updates.category = industryAnswer;
      if (companyId && !product.company_id) updates.company_id = companyId;
      if (Object.keys(updates).length > 0) {
        await supabase.from('product_catalog').update(updates).eq('id', product.id);
      }
    }

    // Prepare scan data with all answers including custom values
    const scanData = {
      ...answers,
      resolved_brand: brandAnswer,
      resolved_industry: industryAnswer,
      resolved_collection_point: collectionPointAnswer,
    };

    const { error: scanErr } = await supabase.from('scan_events').insert({
      user_id: profile.id,
      barcode: scannedCode,
      scan_type: ucidId ? 'qr' : 'barcode',
      acquisition_source: answers['acquisition_source'],
      points_earned: 10,
      token_hash: token,
      product_id: product?.id || null,
      company_id: companyId,
      scan_data: scanData,
      location_lat: userCoords?.lat ?? null,
      location_lng: userCoords?.lng ?? null,
      verification_photo_url: answers['_verification_photo_url'] || null,
    });

    if (scanErr) {
      if (scanErr.code === '23505' || scanErr.message?.includes('unique_user_barcode') || scanErr.message?.includes('unique_barcode_globally')) {
        setError('duplicate_scan');
      } else {
        setError(scanErr.message);
      }
      setLoading(false);
      return;
    }

    // Update user total points
    const newTotal = (profile.total_points ?? 0) + 10;
    await supabase.from('profiles').update({ total_points: newTotal }).eq('id', profile.id);

    // If this was a UCID scan, mark the UCID as scanned
    if (ucidId) {
      const { data: scanEvent } = await supabase
        .from('scan_events')
        .select('id')
        .eq('token_hash', token)
        .maybeSingle();
      await supabase.from('ucids')
        .update({
          status: 'scanned',
          scanned_at: new Date().toISOString(),
          scan_event_id: scanEvent?.id || null,
        })
        .eq('id', ucidId);
    }

    for (const [key, val] of Object.entries(answers)) {
      // Skip internal keys, empty values, "Otro" selections, and other_* fields (we save resolved values instead)
      if (key.startsWith('_') || !val || val === 'Otro' || key.startsWith('other_')) continue;

      // Use resolved values for brand, industry, and collection_point
      let valueToSave = val;
      if (key === 'brand_name' && answers['brand_name'] === 'Otro') {
        valueToSave = answers['other_brand'] || val;
      } else if (key === 'industry_type' && answers['industry_type'] === 'Otro') {
        valueToSave = answers['other_industry'] || val;
      } else if (key === 'collection_point' && answers['collection_point'] === 'Otro') {
        valueToSave = answers['other_collection_point'] || val;
      }

      const { data: existing } = await supabase
        .from('ai_product_responses')
        .select('*')
        .eq('barcode', scannedCode)
        .eq('question_key', key)
        .maybeSingle();

      if (existing) {
        if (existing.answer === valueToSave) {
          await supabase.from('ai_product_responses')
            .update({ vote_count: existing.vote_count + 1, confidence: Math.min(1, existing.confidence + 0.05) })
            .eq('id', existing.id);
        } else if (existing.vote_count < 3) {
          await supabase.from('ai_product_responses')
            .update({ answer: valueToSave, confidence: 0.5, vote_count: 1 })
            .eq('id', existing.id);
        }
      } else {
        await supabase.from('ai_product_responses').insert({
          barcode: scannedCode, question_key: key, answer: valueToSave, confidence: 0.5, vote_count: 1,
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

  async function requestGeolocation() {
    if (!navigator.geolocation) {
      setAnswers(prev => ({ ...prev, location: 'Geolocalización no disponible' }));
      setGeoStatus('error');
      return;
    }
    setGeoStatus('requesting');
    setLocationWarning(null);

    navigator.geolocation.getCurrentPosition(
      async pos => {
        const { latitude, longitude, accuracy } = pos.coords;
        setUserCoords({ lat: latitude, lng: longitude });
        const locStr = `${latitude.toFixed(6)}, ${longitude.toFixed(6)} (±${Math.round(accuracy)}m)`;
        setAnswers(prev => ({ ...prev, location: locStr }));
        setGeoStatus('granted');

        // Validate against collection points
        if (accuracy > 100) {
          setLocationWarning('La precisión GPS es baja. Acerca más al punto de acopio para mejor verificación.');
        } else {
          // Check if user is near a collection point
          const { data: locations } = await supabase
            .from('recycling_locations')
            .select('name, lat, lng')
            .eq('is_active', true);

          if (locations && locations.length > 0) {
            const nearPoint = locations.find(loc => {
              const dist = Math.sqrt(
                Math.pow((loc.lat - latitude) * 111000, 2) +
                Math.pow((loc.lng - longitude) * 111000 * Math.cos(latitude * Math.PI / 180), 2)
              );
              return dist < 200; // Within 200 meters
            });

            if (!nearPoint) {
              setLocationWarning('No estás cerca de un punto de acopio registrado. Tu ubicación será guardada para verificación.');
            }
          }
        }
      },
      err => {
        setGeoStatus('error');
        let errMsg = 'No disponible';
        if (err.code === 1) errMsg = 'Permiso denegado. Activa la ubicación para registrar el punto de reciclaje.';
        else if (err.code === 3) errMsg = 'Tiempo agotado. Intenta de nuevo.';
        setAnswers(prev => ({ ...prev, location: errMsg }));
        setLocationWarning(errMsg);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
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
    setLocationWarning(null);
    setUserCoords(null);
    setVerificationPhoto(null);
    setUploadingPhoto(false);
    setPhotoVerified(null);
    setExtractedData(null);
    setOcrProgress(0);
  }

  async function handleVerificationPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingPhoto(true);
    setPhotoVerified('pending');
    setExtractedData(null);
    setOcrProgress(0);

    try {
      // Resize and convert to base64
      const img = new Image();
      const reader = new FileReader();

      reader.onload = async (ev) => {
        img.src = ev.target?.result as string;
        img.onload = async () => {
          // Resize to max 800px
          const canvas = document.createElement('canvas');
          const maxDim = 800;
          const scale = Math.min(maxDim / img.width, maxDim / img.height);
          canvas.width = img.width * scale;
          canvas.height = img.height * scale;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
          setVerificationPhoto(dataUrl);

          // Run OCR to extract text
          try {
            const result = await Tesseract.recognize(dataUrl, 'spa+eng', {
              logger: (m) => {
                if (m.status === 'recognizing text') {
                  setOcrProgress(Math.round(m.progress * 100));
                }
              },
            });

            const rawText = result.data.text;
            console.log('OCR extracted text:', rawText);

            // Extract brand names from known brands
            const knownBrands = ['Coca-Cola', 'Colombiana', 'Postobón', 'Pepsi', 'Sprite', 'Fanta', 'Bavaria', 'Águila', 'Club Colombia', 'Cristal', 'Brisa', 'Manantial', 'Nestlé', 'Maní', 'Pony Malta', 'Cola y Pola', 'Levapan', 'Alpina', 'Alquería', 'Hit', 'Juice'];
            const foundBrands: string[] = [];

            const textUpper = rawText.toUpperCase();
            knownBrands.forEach(brand => {
              if (textUpper.includes(brand.toUpperCase()) || rawText.toLowerCase().includes(brand.toLowerCase())) {
                foundBrands.push(brand);
              }
            });

            // Extract sizes (ml, L)
            const sizePattern = /(\d+)\s*(ml|ML|Ml|mL|L|l|litros?|litro)/gi;
            const foundSizes: string[] = [];
            let match;
            while ((match = sizePattern.exec(rawText)) !== null) {
              foundSizes.push(match[0].replace(/\s+/g, '').toLowerCase());
            }

            // Deduplicate sizes
            const uniqueSizes = [...new Set(foundSizes)];

            setExtractedData({
              brands: foundBrands,
              sizes: uniqueSizes,
              rawText: rawText.substring(0, 500),
            });

            // Store extracted data for validation
            setAnswers(prev => ({
              ...prev,
              _ocr_brands: foundBrands.join(','),
              _ocr_sizes: uniqueSizes.join(','),
            }));

          } catch (ocrErr) {
            console.error('OCR error:', ocrErr);
          }

          // Upload to Supabase storage for verification
          const fileName = `scan_verification/${profile?.id}_${Date.now()}.jpg`;
          const base64Data = dataUrl.split(',')[1];

          const { error: uploadError } = await supabase.storage
            .from('scan-photos')
            .upload(fileName, decode(base64Data), {
              contentType: 'image/jpeg',
              upsert: false,
            });

          if (!uploadError) {
            // Get public URL
            const { data: urlData } = supabase.storage
              .from('scan-photos')
              .getPublicUrl(fileName);

            // Store photo URL in answers for later verification
            setAnswers(prev => ({ ...prev, _verification_photo_url: urlData.publicUrl }));
            setPhotoVerified('verified');
          }
        };
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error('Error uploading photo:', err);
      setPhotoVerified(null);
    }

    setUploadingPhoto(false);
    e.target.value = '';
  }

  // Function to validate user answers against OCR data
  function validateAgainstOCR(): { valid: boolean; warnings: string[] } {
    const warnings: string[] = [];

    if (!extractedData) return { valid: true, warnings };

    const selectedBrand = answers['brand_name'] === 'Otro' ? answers['other_brand'] : answers['brand_name'];

    // Check brand match
    if (selectedBrand && extractedData.brands.length > 0) {
      const brandMatch = extractedData.brands.some(
        b => b.toLowerCase() === selectedBrand.toLowerCase() ||
             b.toLowerCase().includes(selectedBrand.toLowerCase()) ||
             selectedBrand.toLowerCase().includes(b.toLowerCase())
      );
      if (!brandMatch) {
        warnings.push(`La foto muestra "${extractedData.brands.join(', ')}" pero seleccionaste "${selectedBrand}"`);
      }
    }

    // Check size match
    const selectedSize = answers['container_size'];
    if (selectedSize && extractedData.sizes.length > 0) {
      const normalizeSize = (s: string) => {
        const num = parseInt(s.replace(/\D/g, ''));
        if (s.toLowerCase().includes('l') && !s.toLowerCase().includes('ml')) {
          return num * 1000; // Convert L to ml
        }
        return num;
      };

      const ocrMl = extractedData.sizes.map(normalizeSize);
      const selectedMl = selectedSize.includes('Pequeño') ? 400 :
                        selectedSize.includes('Mediano') ? 750 :
                        selectedSize.includes('Grande') ? 1500 : 0;

      const sizeMatch = ocrMl.some((ml: number) => {
        if (selectedMl === 0) return true;
        // Allow 20% tolerance
        return Math.abs(ml - selectedMl) < selectedMl * 0.3;
      });

      if (!sizeMatch && ocrMl.length > 0) {
        warnings.push(`La foto muestra ${extractedData.sizes.join(' o ')} pero seleccionaste "${selectedSize}"`);
      }
    }

    return { valid: warnings.length === 0, warnings };
  }

  // Decode base64 to Uint8Array for storage upload
  function decode(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
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

            {/* Auto-geolocation status banner */}
            {geoStatus === 'requesting' && (
              <div className="flex items-center gap-3 bg-blue-500/10 border border-blue-500/30 rounded-xl px-4 py-3">
                <Loader2 className="w-5 h-5 animate-spin text-blue-400 shrink-0" />
                <div>
                  <p className="text-blue-300 text-sm font-medium">Capturando tu ubicación en tiempo real...</p>
                  <p className="text-slate-400 text-xs mt-0.5">Necesario para registrar el punto de reciclaje en el mapa</p>
                </div>
              </div>
            )}
            {geoStatus === 'granted' && (
              <div className="flex items-center gap-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <div>
                  <p className="text-emerald-300 text-sm font-medium">Ubicación capturada correctamente</p>
                  <p className="text-slate-400 text-xs font-mono mt-0.5">{answers['location']}</p>
                </div>
              </div>
            )}
            {geoStatus === 'error' && (
              <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3">
                <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />
                <div>
                  <p className="text-amber-300 text-sm font-medium">No se pudo obtener la ubicación</p>
                  <p className="text-slate-400 text-xs mt-0.5">{locationWarning ?? 'Activa los permisos de ubicación para registrar el punto en el mapa'}</p>
                </div>
              </div>
            )}

            {/* Verification photo section */}
            <div className="border border-slate-700 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileImage className="w-4 h-4 text-violet-400" />
                  <span className="text-white text-sm font-medium">Foto de verificación (opcional)</span>
                </div>
                {photoVerified === 'verified' && (
                  <span className="text-xs text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Foto subida
                  </span>
                )}
              </div>
              <p className="text-slate-400 text-xs">
                Sube una foto del envase para verificar que coincide con la marca y tamaño declarados.
                Esto ayuda a evitar reportes falsos.
              </p>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleVerificationPhoto}
                className="hidden"
              />
              {verificationPhoto ? (
                <div className="space-y-3">
                  <div className="relative">
                    <img src={verificationPhoto} alt="Foto de verificación" className="w-full h-40 object-cover rounded-lg bg-slate-800" />
                    <button
                      onClick={() => { setVerificationPhoto(null); setPhotoVerified(null); setExtractedData(null); }}
                      className="absolute top-2 right-2 bg-slate-900/80 hover:bg-red-500/80 text-white p-1.5 rounded-lg transition-colors"
                    >
                      <XCircle className="w-4 h-4" />
                    </button>
                  </div>

                  {/* OCR Progress */}
                  {uploadingPhoto && ocrProgress > 0 && ocrProgress < 100 && (
                    <div className="flex items-center gap-2 text-violet-300 text-xs">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Analizando imagen... {ocrProgress}%
                    </div>
                  )}

                  {/* OCR Results */}
                  {extractedData && !uploadingPhoto && (
                    <div className="bg-violet-500/10 border border-violet-500/20 rounded-lg p-3 space-y-2">
                      <div className="flex items-center gap-2 text-violet-300 text-xs font-medium">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        Datos detectados en la imagen
                      </div>
                      {extractedData.brands.length > 0 && (
                        <div className="text-slate-300 text-xs">
                          Marcas: <span className="text-emerald-400 font-medium">{extractedData.brands.join(', ')}</span>
                        </div>
                      )}
                      {extractedData.sizes.length > 0 && (
                        <div className="text-slate-300 text-xs">
                          Tamaños: <span className="text-emerald-400 font-medium">{extractedData.sizes.join(', ')}</span>
                        </div>
                      )}
                      {extractedData.brands.length === 0 && extractedData.sizes.length === 0 && (
                        <div className="text-amber-400 text-xs">
                          No se detectaron marcas ni tamaños claros
                        </div>
                      )}
                    </div>
                  )}

                  {/* Validation warnings */}
                  {extractedData && answers['brand_name'] && !uploadingPhoto && (() => {
                    const validation = validateAgainstOCR();
                    if (validation.warnings.length > 0) {
                      return (
                        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 space-y-1">
                          <div className="flex items-center gap-2 text-red-400 text-xs font-medium">
                            <ShieldAlert className="w-3.5 h-3.5" />
                            Advertencia de validación
                          </div>
                          {validation.warnings.map((w, i) => (
                            <p key={i} className="text-red-300 text-xs">{w}</p>
                          ))}
                        </div>
                      );
                    }
                    return (
                      <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3">
                        <div className="flex items-center gap-2 text-emerald-400 text-xs">
                          <ShieldCheck className="w-3.5 h-3.5" />
                          Datos verificados correctamente
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <button
                  onClick={() => photoInputRef.current?.click()}
                  disabled={uploadingPhoto}
                  className="w-full flex items-center justify-center gap-2 bg-violet-500/10 border border-violet-500/25 hover:bg-violet-500/20 disabled:opacity-50 text-violet-300 rounded-xl py-3 text-sm font-medium transition-colors"
                >
                  {uploadingPhoto ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Analizando imagen...</>
                  ) : (
                    <><Camera className="w-4 h-4" /> Tomar foto del envase</>
                  )}
                </button>
              )}
            </div>

            {SCAN_QUESTIONS.map(q => {
              // Skip if showIf condition is not met
              if (q.showIf && answers[q.showIf.key] !== q.showIf.value) return null;

              return (
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
                      {locationWarning && (
                        <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
                          <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                          <span className="text-amber-300 text-xs">{locationWarning}</span>
                        </div>
                      )}
                      {geoStatus === 'error' && (
                        <p className="text-xs text-amber-400 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" /> Permiso denegado. La ubicación se guardará como no disponible.
                        </p>
                      )}
                    </div>
                  ) : q.type === 'text' ? (
                    <input
                      type="text"
                      value={answers[q.key] ?? ''}
                      onChange={e => setAnswers(prev => ({ ...prev, [q.key]: e.target.value }))}
                      placeholder="Escribe el nombre de la marca"
                      className="w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-500 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                    />
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

                  {/* Brand validation warning */}
                  {q.key === 'brand_name' && product?.brand && answers['brand_name'] && answers['brand_name'] !== 'Otro' && !answers['brand_name'].toLowerCase().includes(product.brand.toLowerCase()) && !product.brand.toLowerCase().includes(answers['brand_name'].toLowerCase()) && (
                    <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2 mt-2">
                      <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                      <span className="text-amber-300 text-xs">
                        El código indica marca <strong>{product.brand}</strong>. Verifica que seleccionaste la correcta.
                      </span>
                    </div>
                  )}

                  {answers[q.key] && q.type !== 'location' && q.type !== 'text' && (
                    <p className="text-xs text-emerald-400 mt-1 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Aprendido por IA
                    </p>
                  )}
                </div>
              );
            })}
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
          <h4 className="text-amber-400 font-bold text-base mb-1">Este envase ya fue escaneado</h4>
          <p className="text-slate-400 text-xs max-w-sm mx-auto">
            Este código ya figura en el sistema. Cada envase solo puede escanearse una vez de forma global para evitar duplicados. Escanea otro producto para continuar.
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