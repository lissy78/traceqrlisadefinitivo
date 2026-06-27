import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import QRCode from 'qrcode';
import {
  Printer, Download, Hash, Building2, Loader2, AlertCircle,
  CheckCircle2, Package, ArrowLeft, FileText,
  Settings, ChevronLeft, ChevronRight, Layout, Ruler
} from 'lucide-react';

interface UCID {
  id: string;
  short_code: string;
  ucid_hash: string;
  qr_data: string;
  status: string;
  product_name: string | null;
  product_brand: string | null;
  container_type: string;
}

interface UCIDBatch {
  id: string;
  company_id: string;
  batch_name: string;
  quantity: number;
  ucid_prefix: string;
  status: string;
  product_name: string | null;
  product_brand: string | null;
  container_type: string;
}

interface CompanyInfo {
  id: string;
  name: string;
  logo_url: string | null;
}

type LabelSize = 'small' | 'medium' | 'large';
type PageFormat = 'a4' | 'continuous';

const LABEL_CONFIGS: Record<LabelSize, { width: number; height: number; qrSize: number; fontSize: number; padding: number; cols: number }> = {
  small: { width: 40, height: 25, qrSize: 60, fontSize: 7, padding: 4, cols: 5 },
  medium: { width: 50, height: 35, qrSize: 90, fontSize: 8, padding: 6, cols: 4 },
  large: { width: 70, height: 45, qrSize: 120, fontSize: 10, padding: 8, cols: 3 },
};

export default function UCIDPrintPage() {
  const { profile } = useAuth();
  const [batches, setBatches] = useState<UCIDBatch[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<UCIDBatch | null>(null);
  const [ucids, setUcids] = useState<UCID[]>([]);
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [generatingQR, setGeneratingQR] = useState(false);
  const [labelSize, setLabelSize] = useState<LabelSize>('medium');
  const [pageFormat, setPageFormat] = useState<PageFormat>('a4');
  const [showSettings, setShowSettings] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [printRange, setPrintRange] = useState<'all' | 'page'>('all');
  const [customPageStart, setCustomPageStart] = useState(1);
  const [customPageEnd, setCustomPageEnd] = useState(1);

  const companyId = profile?.company_id;
  const isAdmin = profile?.role === 'admin';

  const config = LABEL_CONFIGS[labelSize];
  const itemsPerPage = pageFormat === 'a4' ? config.cols * 7 : 50;
  const totalPages = Math.ceil(ucids.length / itemsPerPage);

  useEffect(() => { loadBatches(); loadCompanyInfo(); }, [companyId]);

  async function loadCompanyInfo() {
    if (!companyId) return;
    const { data } = await supabase.from('companies').select('id, name, logo_url').eq('id', companyId).single();
    if (data) setCompanyInfo(data as CompanyInfo);
  }

  async function loadBatches() {
    const query = supabase
      .from('ucid_batches')
      .select('id, company_id, batch_name, quantity, ucid_prefix, status, product_name, product_brand, container_type')
      .in('status', ['ready', 'printed', 'active'])
      .order('created_at', { ascending: false });
    const { data } = isAdmin ? await query : await query.eq('company_id', companyId);
    setBatches((data ?? []) as UCIDBatch[]);
    setLoading(false);
  }

  async function loadBatchUCIDs(batchId: string) {
    setGeneratingQR(true);
    const { data } = await supabase
      .from('ucids')
      .select('id, short_code, ucid_hash, qr_data, status, product_name, product_brand, container_type')
      .eq('batch_id', batchId)
      .eq('status', 'unused')
      .order('short_code');
    setUcids((data ?? []) as UCID[]);
    setGeneratingQR(false);
    setCurrentPage(0);
  }

  function handleSelectBatch(batch: UCIDBatch) {
    setSelectedBatch(batch);
    loadBatchUCIDs(batch.id);
  }

  const getPageItems = useCallback((page: number) => {
    const start = page * itemsPerPage;
    return ucids.slice(start, start + itemsPerPage);
  }, [ucids, itemsPerPage]);

  const generateQRDataUrl = useCallback(async (qrData: string): Promise<string> => {
    return QRCode.toDataURL(qrData, {
      width: config.qrSize,
      margin: 1,
      color: { dark: '#0a0a0a', light: '#ffffff' },
      errorCorrectionLevel: 'H',
    });
  }, [config.qrSize]);

  async function generatePrintHTML(): Promise<string> {
    const batch = selectedBatch;
    const company = companyInfo;
    const pageItems = getPageItems(currentPage);

    const qrDataUrls = await Promise.all(
      pageItems.map(async (u) => {
        const url = await generateQRDataUrl(u.qr_data);
        return { ...u, qrUrl: url };
      })
    );

    const labelStyle = `
      .label {
        width: ${config.width}mm;
        height: ${config.height}mm;
        padding: ${config.padding}mm;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        border: 0.5pt dashed #ccc;
        page-break-inside: avoid;
        position: relative;
      }
      .label .qr { max-width: 100%; max-height: ${config.qrSize * 0.35}mm; }
      .label .code {
        font-family: 'Courier New', monospace;
        font-weight: bold;
        font-size: ${config.fontSize + 1}pt;
        color: #111;
        margin-top: 1mm;
        letter-spacing: 0.3pt;
      }
      .label .brand {
        font-size: ${config.fontSize - 1}pt;
        color: #555;
        margin-top: 0.5mm;
        text-align: center;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .label .company {
        font-size: ${config.fontSize - 2}pt;
        color: #777;
        margin-top: 0.5mm;
      }
      .label .cut-line {
        position: absolute;
        bottom: -1mm;
        left: 10%;
        right: 10%;
        border-bottom: 0.3pt dotted #bbb;
      }
    `;

    const pageStyle = pageFormat === 'a4'
      ? `
        @page { size: A4; margin: 8mm; }
        .page {
          display: grid;
          grid-template-columns: repeat(${config.cols}, ${config.width}mm);
          gap: 3mm;
          justify-content: center;
        }
      `
      : `
        @page { size: auto; margin: 5mm; }
        .page {
          display: flex;
          flex-wrap: wrap;
          gap: 3mm;
          justify-content: flex-start;
        }
      `;

    const labelsHtml = qrDataUrls.map((u) => `
      <div class="label">
        <img class="qr" src="${u.qrUrl}" alt="${u.short_code}" />
        <div class="code">${u.short_code}</div>
        ${u.product_brand ? `<div class="brand">${u.product_brand}${u.product_name ? ` - ${u.product_name}` : ''}</div>` : ''}
        <div class="company">${company?.name || 'TraceQR'}</div>
        ${pageFormat === 'a4' ? '<div class="cut-line"></div>' : ''}
      </div>
    `).join('');

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>TraceQR - ${batch?.batch_name || 'UCIDs'}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: white;
      color: #111;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .header {
      text-align: center;
      padding: 4mm 0 6mm;
      border-bottom: 0.5pt solid #ddd;
      margin-bottom: 4mm;
    }
    .header h1 { font-size: 11pt; font-weight: 700; }
    .header p { font-size: 8pt; color: #666; margin-top: 1mm; }
    .header .meta {
      font-size: 7pt; color: #888;
      margin-top: 2mm;
      display: flex;
      gap: 4mm;
      justify-content: center;
      flex-wrap: wrap;
    }
    ${pageStyle}
    ${labelStyle}
    .page-number {
      text-align: center;
      font-size: 7pt;
      color: #999;
      margin-top: 3mm;
      padding-top: 2mm;
      border-top: 0.3pt solid #eee;
    }
    @media print {
      .no-print { display: none !important; }
      .page-break { page-break-after: always; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>TraceQR - ${batch?.batch_name || 'Etiquetas UCID'}</h1>
    <p>${company?.name || 'Empresa'} | ${batch?.ucid_prefix || ''} | ${ucids.length} etiquetas</p>
    <div class="meta">
      <span>Tipo: ${batch?.container_type || 'PET'}</span>
      <span>Prefijo: ${batch?.ucid_prefix || ''}</span>
      <span>Seguro SHA-256</span>
    </div>
  </div>
  <div class="page">
    ${labelsHtml}
  </div>
  <div class="page-number">Pagina ${currentPage + 1} de ${totalPages}</div>

  <div class="no-print" style="position:fixed;bottom:0;left:0;right:0;background:#f8f9fa;border-top:1px solid #ddd;padding:8px 16px;display:flex;gap:8px;justify-content:center;align-items:center;z-index:1000;">
    <button onclick="window.print()" style="padding:6px 16px;background:#0d9488;color:#fff;border:none;border-radius:6px;font-size:13px;cursor:pointer;font-weight:500;">
      Imprimir
    </button>
    <button onclick="window.close()" style="padding:6px 16px;background:#64748b;color:#fff;border:none;border-radius:6px;font-size:13px;cursor:pointer;font-weight:500;">
      Cerrar
    </button>
    <span style="font-size:11px;color:#666;">
      Ctrl+P para imprimir | ${pageFormat === 'a4' ? 'Formato A4' : 'Formato continuo'}
    </span>
  </div>
</body>
</html>`;
  }

  async function handleOpenPrint() {
    const html = await generatePrintHTML();
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) {
      alert('Permite ventanas emergentes para imprimir');
      return;
    }
    win.document.write(html);
    win.document.close();
  }

  async function handleDownloadPrintable() {
    const html = await generatePrintHTML();
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `traceqr-${selectedBatch?.ucid_prefix || 'ucids'}-pagina-${currentPage + 1}.html`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // Inline preview renderer
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!ucids.length) return;
    const pageItems = getPageItems(currentPage);
    let cancelled = false;

    (async () => {
      const urls: Record<string, string> = {};
      for (const u of pageItems) {
        if (cancelled) break;
        if (!previewUrls[u.id]) {
          try {
            urls[u.id] = await generateQRDataUrl(u.qr_data);
          } catch {
            urls[u.id] = '';
          }
        }
      }
      if (!cancelled) setPreviewUrls(prev => ({ ...prev, ...urls }));
    })();

    return () => { cancelled = true; };
  }, [ucids, currentPage, labelSize]);

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!companyId && !isAdmin) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-2xl p-8 text-center">
          <Building2 className="w-12 h-12 text-blue-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">Vincula tu empresa</h2>
          <p className="text-slate-400 text-sm">Necesitas estar vinculado a una empresa para imprimir QRs.</p>
        </div>
      </div>
    );
  }

  // Batch selection screen
  if (!selectedBatch) {
    return (
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Printer className="w-6 h-6 text-teal-400" />
            Imprimir etiquetas UCID
          </h1>
          <p className="text-slate-400 text-sm mt-1">Selecciona un lote para imprimir los identificadores de tus envases</p>
        </div>

        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-emerald-300 text-sm font-medium">Etiquetas listas para imprimir</p>
              <p className="text-emerald-400/70 text-xs mt-1">
                Cada etiqueta contiene un QR unico con hash SHA-256 de 512 bits. 
                Selecciona un lote, configura el formato y abre la ventana de impresion.
              </p>
            </div>
          </div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
          <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
            <Package className="w-4 h-4 text-teal-400" />
            Lotes disponibles para imprimir
          </h2>
          {batches.length === 0 ? (
            <div className="text-center py-12">
              <Package className="w-10 h-10 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 text-sm">No hay lotes listos para imprimir.</p>
              <p className="text-slate-500 text-xs mt-1">Genera UCIDs primero en la seccion UCIDs.</p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {batches.map(batch => (
                <button
                  key={batch.id}
                  onClick={() => handleSelectBatch(batch)}
                  className="bg-slate-800/50 hover:bg-slate-700 border border-slate-700 hover:border-teal-500/50 rounded-xl p-4 text-left transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-teal-500/15 border border-teal-500/20 flex items-center justify-center">
                      <Hash className="w-5 h-5 text-teal-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-white font-medium text-sm truncate">{batch.batch_name}</p>
                      <p className="text-slate-400 text-xs font-mono">{batch.ucid_prefix}</p>
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-slate-700 flex justify-between items-center text-xs">
                    <span className="text-slate-400">{batch.quantity.toLocaleString('es-CO')} UCIDs</span>
                    <span className="text-teal-400 flex items-center gap-1 group-hover:underline">
                      <Printer className="w-3 h-3" /> Imprimir
                    </span>
                  </div>
                  {batch.product_brand && (
                    <div className="mt-2 text-xs text-slate-500">
                      {batch.product_brand} {batch.product_name ? `· ${batch.product_name}` : ''}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Print preview screen
  const pageItems = getPageItems(currentPage);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setSelectedBatch(null); setUcids([]); setPreviewUrls({}); setCurrentPage(0); }}
            className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white transition-colors"
            title="Volver a lotes"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <Printer className="w-5 h-5 text-teal-400" />
              {selectedBatch.batch_name}
            </h1>
            <p className="text-slate-400 text-xs mt-0.5">
              {selectedBatch.ucid_prefix} · {selectedBatch.quantity.toLocaleString('es-CO')} UCIDs · {selectedBatch.container_type}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSettings(s => !s)}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
              showSettings ? 'bg-teal-500/20 text-teal-300 border border-teal-500/30' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
            }`}
          >
            <Settings className="w-4 h-4" /> Configuracion
          </button>
          <button
            onClick={handleDownloadPrintable}
            className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white px-3 py-2 rounded-xl text-sm font-medium transition-colors"
          >
            <Download className="w-4 h-4" /> Descargar HTML
          </button>
          <button
            onClick={handleOpenPrint}
            className="flex items-center gap-2 bg-teal-500 hover:bg-teal-400 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
          >
            <Printer className="w-4 h-4" /> Abrir para imprimir
          </button>
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="bg-slate-900/80 border border-slate-700 rounded-xl p-4 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Ruler className="w-4 h-4 text-teal-400" />
            <h3 className="text-white text-sm font-semibold">Configuracion de impresion</h3>
          </div>
          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Tamano de etiqueta</label>
              <div className="flex gap-2">
                {(['small', 'medium', 'large'] as LabelSize[]).map(size => (
                  <button
                    key={size}
                    onClick={() => setLabelSize(size)}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors border ${
                      labelSize === size
                        ? 'bg-teal-500/20 text-teal-300 border-teal-500/40'
                        : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-600'
                    }`}
                  >
                    {size === 'small' ? 'Pequeña' : size === 'medium' ? 'Mediana' : 'Grande'}
                    <div className="text-[10px] text-slate-500 mt-0.5 font-normal">
                      {LABEL_CONFIGS[size].width}x{LABEL_CONFIGS[size].height}mm
                    </div>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Formato de pagina</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setPageFormat('a4')}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors border ${
                    pageFormat === 'a4'
                      ? 'bg-teal-500/20 text-teal-300 border-teal-500/40'
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-600'
                  }`}
                >
                  <Layout className="w-3 h-3 mx-auto mb-1" /> Hoja A4
                </button>
                <button
                  onClick={() => setPageFormat('continuous')}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors border ${
                    pageFormat === 'continuous'
                      ? 'bg-teal-500/20 text-teal-300 border-teal-500/40'
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-600'
                  }`}
                >
                  <FileText className="w-3 h-3 mx-auto mb-1" /> Continuo
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Rango de impresion</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setPrintRange('all')}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors border ${
                    printRange === 'all'
                      ? 'bg-teal-500/20 text-teal-300 border-teal-500/40'
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-600'
                  }`}
                >
                  Todas las paginas
                </button>
                <button
                  onClick={() => setPrintRange('page')}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors border ${
                    printRange === 'page'
                      ? 'bg-teal-500/20 text-teal-300 border-teal-500/40'
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-600'
                  }`}
                >
                  Solo esta pagina
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Batch info bar */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl px-4 py-3 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Hash className="w-4 h-4 text-teal-400" />
          <span className="text-white text-sm font-medium">{selectedBatch.batch_name}</span>
        </div>
        <div className="w-px h-4 bg-slate-700 hidden sm:block" />
        <div className="text-slate-400 text-xs">
          {ucids.length} UCIDs disponibles · {totalPages} paginas
        </div>
        <div className="w-px h-4 bg-slate-700 hidden sm:block" />
        <div className="text-slate-400 text-xs">
          {companyInfo?.name || 'Empresa'} · {selectedBatch.container_type}
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-400">Etiqueta:</span>
          <span className="text-teal-300 font-medium">{config.width}x{config.height}mm</span>
          <span className="text-slate-500">· {config.cols} columnas</span>
        </div>
      </div>

      {/* Loading state */}
      {generatingQR && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-teal-400 animate-spin" />
          <span className="text-slate-400 text-sm ml-3">Cargando UCIDs...</span>
        </div>
      )}

      {/* Empty state */}
      {!generatingQR && ucids.length === 0 && (
        <div className="text-center py-16">
          <AlertCircle className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <p className="text-slate-400 text-sm">No hay UCIDs disponibles en este lote.</p>
          <p className="text-slate-500 text-xs mt-1">Todos han sido escaneados o el lote esta vacio.</p>
        </div>
      )}

      {/* Preview grid */}
      {!generatingQR && ucids.length > 0 && (
        <>
          {/* Pagination */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                disabled={currentPage === 0}
                className="p-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 rounded-lg text-slate-300 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-slate-400 text-sm px-2">
                Pagina <span className="text-white font-medium">{currentPage + 1}</span> de {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={currentPage >= totalPages - 1}
                className="p-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 rounded-lg text-slate-300 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <div className="text-slate-500 text-xs">
              Mostrando {pageItems.length} de {ucids.length} etiquetas
            </div>
          </div>

          {/* Preview grid - simulates A4 page */}
          <div className="bg-white rounded-xl p-6 overflow-x-auto shadow-lg">
            <div
              className="mx-auto bg-white"
              style={{
                maxWidth: pageFormat === 'a4' ? '210mm' : '100%',
                minHeight: pageFormat === 'a4' ? '297mm' : 'auto',
              }}
            >
              <div
                className="grid gap-3"
                style={{
                  gridTemplateColumns: pageFormat === 'a4'
                    ? `repeat(${config.cols}, ${config.width}mm)`
                    : `repeat(auto-fill, minmax(${config.width}mm, 1fr))`,
                  justifyContent: pageFormat === 'a4' ? 'center' : 'start',
                }}
              >
                {pageItems.map((ucid) => (
                  <div
                    key={ucid.id}
                    className="border border-slate-300 rounded flex flex-col items-center justify-center text-center"
                    style={{
                      width: `${config.width}mm`,
                      height: `${config.height}mm`,
                      padding: `${config.padding}mm`,
                    }}
                  >
                    {previewUrls[ucid.id] ? (
                      <img
                        src={previewUrls[ucid.id]}
                        alt={ucid.short_code}
                        className="max-w-full"
                        style={{ maxHeight: `${config.qrSize * 0.35}mm` }}
                      />
                    ) : (
                      <div className="w-8 h-8 border-2 border-slate-300 border-t-transparent rounded-full animate-spin" />
                    )}
                    <div
                      className="font-mono font-bold text-slate-900 mt-1"
                      style={{ fontSize: `${config.fontSize + 1}pt` }}
                    >
                      {ucid.short_code}
                    </div>
                    {ucid.product_brand && (
                      <div
                        className="text-slate-600 mt-0.5 truncate w-full"
                        style={{ fontSize: `${config.fontSize - 1}pt` }}
                      >
                        {ucid.product_brand}
                        {ucid.product_name ? ` · ${ucid.product_name}` : ''}
                      </div>
                    )}
                    <div
                      className="text-slate-400 mt-0.5"
                      style={{ fontSize: `${config.fontSize - 2}pt` }}
                    >
                      {companyInfo?.name || 'TraceQR'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Footer actions */}
          <div className="flex items-center justify-center gap-3 pb-4">
            <button
              onClick={() => setCurrentPage(0)}
              disabled={currentPage === 0}
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 rounded-lg text-slate-300 text-xs transition-colors"
            >
              Primera
            </button>
            <button
              onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
              disabled={currentPage === 0}
              className="p-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 rounded-lg text-slate-300 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-slate-400 text-sm">
              {currentPage + 1} / {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={currentPage >= totalPages - 1}
              className="p-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 rounded-lg text-slate-300 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => setCurrentPage(totalPages - 1)}
              disabled={currentPage >= totalPages - 1}
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 rounded-lg text-slate-300 text-xs transition-colors"
            >
              Ultima
            </button>
          </div>
        </>
      )}
    </div>
  );
}
