import { useEffect, useState, useRef } from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import QRCode from 'qrcode';
import {
  QrCode, Download, Printer, Eye, Hash, Building2,
  Loader2, AlertCircle, CheckCircle2, Package, Grid,
  ZoomIn, ZoomOut, RefreshCw
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
  batch_name: string;
  quantity: number;
  ucid_prefix: string;
  status: string;
}

interface QRPreview {
  id: string;
  shortCode: string;
  qrDataUrl: string;
  productName: string | null;
  productBrand: string | null;
}

export default function UCIDPrintPage() {
  const { profile } = useAuth();
  const [batches, setBatches] = useState<UCIDBatch[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<UCIDBatch | null>(null);
  const [ucids, setUcids] = useState<UCID[]>([]);
  const [qrPreviews, setQrPreviews] = useState<QRPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatingQR, setGeneratingQR] = useState(false);
  const [printLayout, setPrintLayout] = useState<'grid' | 'list'>('grid');
  const [qrSize, setQrSize] = useState(150);
  const [itemsPerPage, setItemsPerPage] = useState(60);
  const [currentPage, setCurrentPage] = useState(0);
  const printRef = useRef<HTMLDivElement>(null);

  const companyId = profile?.company_id;
  const isAdmin = profile?.role === 'admin';

  useEffect(() => { loadBatches(); }, [companyId]);

  async function loadBatches() {
    const query = supabase.from('ucid_batches').select('*').in('status', ['ready', 'printed', 'active']).order('created_at', { ascending: false });
    const { data } = isAdmin
      ? await query
      : await query.eq('company_id', companyId);
    setBatches((data ?? []) as UCIDBatch[]);
    setLoading(false);
  }

  async function loadBatchUCIDs(batchId: string) {
    setGeneratingQR(true);
    const { data } = await supabase
      .from('ucids')
      .select('*')
      .eq('batch_id', batchId)
      .eq('status', 'unused')
      .order('short_code');

    if (data) {
      setUcids(data as UCID[]);
      // Generate QR codes
      const previews: QRPreview[] = [];
      for (const ucid of data as UCID[]) {
        try {
          const qrDataUrl = await QRCode.toDataURL(ucid.qr_data, {
            width: qrSize,
            margin: 2,
            color: { dark: '#000000', light: '#ffffff' },
          });
          previews.push({
            id: ucid.id,
            shortCode: ucid.short_code,
            qrDataUrl,
            productName: ucid.product_name,
            productBrand: ucid.product_brand,
          });
        } catch (err) {
          console.error('Error generating QR for', ucid.short_code, err);
        }
      }
      setQrPreviews(previews);
    }
    setGeneratingQR(false);
  }

  function handleSelectBatch(batch: UCIDBatch) {
    setSelectedBatch(batch);
    setCurrentPage(0);
    loadBatchUCIDs(batch.id);
  }

  function getCurrentPageItems() {
    const start = currentPage * itemsPerPage;
    const end = start + itemsPerPage;
    return qrPreviews.slice(start, end);
  }

  function totalPages() {
    return Math.ceil(qrPreviews.length / itemsPerPage);
  }

  async function handlePrint() {
    window.print();
  }

  async function handleDownloadPDF() {
    // Download as images (user can convert to PDF)
    const link = document.createElement('a');
    link.download = `ucid_batch_${selectedBatch?.ucid_prefix}_page_${currentPage + 1}.html`;

    const printContent = printRef.current?.innerHTML;
    if (!printContent) return;

    const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>TraceQR UCIDs - ${selectedBatch?.batch_name}</title>
  <style>
    body { font-family: Arial, sans-serif; background: white; color: black; margin: 0; padding: 20px; }
    .qr-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; }
    .qr-item { text-align: center; padding: 10px; border: 1px solid #ddd; }
    .qr-item img { max-width: 100%; }
    .short-code { font-weight: bold; font-size: 12px; margin-top: 5px; }
    .brand { font-size: 10px; color: #666; }
    @media print { body { -webkit-print-color-adjust: exact; } }
  </style>
</head>
<body>
  <h1>TraceQR - Lote: ${selectedBatch?.batch_name}</h1>
  <p>Prefix: ${selectedBatch?.ucid_prefix} | Total: ${qrPreviews.length} UCIDs</p>
  <hr/>
  ${printContent}
</body>
</html>`;

    const blob = new Blob([htmlContent], { type: 'text/html' });
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
  }

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

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Printer className="w-6 h-6 text-teal-400" />
            Imprimir QRs UCID
          </h1>
          <p className="text-slate-400 text-sm mt-1">Genera QRs para imprimir en tus envases</p>
        </div>
        {selectedBatch && (
          <div className="flex items-center gap-2">
            <button onClick={() => setSelectedBatch(null)} className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-xl text-sm transition-colors">
              <RefreshCw className="w-4 h-4" /> Cambiar lote
            </button>
          </div>
        )}
      </div>

      {/* Security Info */}
      <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-emerald-300 text-sm font-medium">QRs seguros con hash SHA-256</p>
            <p className="text-emerald-400/70 text-xs mt-1">
              Cada QR contiene un identificador unico de 128 caracteres (512 bits). Imposible de falsificar o duplicar.
              Cada codigo solo puede escanearse una vez en todo el sistema.
            </p>
          </div>
        </div>
      </div>

      {/* Batch Selection */}
      {!selectedBatch && (
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
          <h2 className="text-white font-semibold mb-4">Selecciona un lote para imprimir</h2>
          {batches.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-8">
              No hay lotes listos para imprimir. Genera UCIDs primero en la seccion UCIDs.
            </p>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {batches.map(batch => (
                <button
                  key={batch.id}
                  onClick={() => handleSelectBatch(batch)}
                  className="bg-slate-800/50 hover:bg-slate-700 border border-slate-700 hover:border-teal-500/50 rounded-xl p-4 text-left transition-all"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-teal-500/15 border border-teal-500/20 flex items-center justify-center">
                      <Hash className="w-5 h-5 text-teal-400" />
                    </div>
                    <div>
                      <p className="text-white font-medium">{batch.batch_name}</p>
                      <p className="text-slate-400 text-xs font-mono">{batch.ucid_prefix}</p>
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-slate-700 flex justify-between text-xs">
                    <span className="text-slate-400">{batch.quantity.toLocaleString('es-CO')} UCIDs</span>
                    <span className="text-teal-400 capitalize">{batch.status}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* QR Generation & Preview */}
      {selectedBatch && (
        <div className="space-y-4">
          {/* Controls */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-slate-400 text-sm">Tamano QR:</span>
                <button onClick={() => setQrSize(s => Math.max(50, s - 25))} className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg">
                  <ZoomOut className="w-4 h-4 text-slate-300" />
                </button>
                <span className="text-white text-sm w-16 text-center">{qrSize}px</span>
                <button onClick={() => setQrSize(s => Math.min(300, s + 25))} className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg">
                  <ZoomIn className="w-4 h-4 text-slate-300" />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-slate-400 text-sm">Por pagina:</span>
                <select
                  value={itemsPerPage}
                  onChange={e => { setItemsPerPage(parseInt(e.target.value)); setCurrentPage(0); }}
                  className="bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-1.5 text-sm"
                >
                  <option value={20}>20</option>
                  <option value={30}>30</option>
                  <option value={60}>60</option>
                  <option value={100}>100</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPrintLayout('grid')}
                  className={`p-1.5 rounded-lg ${printLayout === 'grid' ? 'bg-teal-500/20 text-teal-400' : 'bg-slate-800 text-slate-400'}`}
                >
                  <Grid className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setPrintLayout('list')}
                  className={`p-1.5 rounded-lg ${printLayout === 'list' ? 'bg-teal-500/20 text-teal-400' : 'bg-slate-800 text-slate-400'}`}
                >
                  <Package className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1" />

              <div className="flex items-center gap-2">
                <button
                  onClick={handlePrint}
                  disabled={generatingQR}
                  className="flex items-center gap-2 bg-teal-500 hover:bg-teal-400 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
                >
                  <Printer className="w-4 h-4" /> Imprimir
                </button>
                <button
                  onClick={handleDownloadPDF}
                  disabled={generatingQR}
                  className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
                >
                  <Download className="w-4 h-4" /> Descargar HTML
                </button>
              </div>
            </div>
          </div>

          {/* Batch Info */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl px-4 py-3 flex items-center gap-4">
            <Hash className="w-5 h-5 text-teal-400" />
            <div>
              <p className="text-white text-sm font-medium">{selectedBatch.batch_name}</p>
              <p className="text-slate-500 text-xs">{selectedBatch.ucid_prefix} | {qrPreviews.length} UCIDs disponibles</p>
            </div>
          </div>

          {/* Loading State */}
          {generatingQR && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-teal-400 animate-spin" />
              <span className="text-slate-400 text-sm ml-3">Generando {qrPreviews.length} QRs...</span>
            </div>
          )}

          {/* QR Grid */}
          {!generatingQR && qrPreviews.length > 0 && (
            <>
              {/* Pagination */}
              <div className="flex items-center justify-center gap-2">
                <button
                  onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                  disabled={currentPage === 0}
                  className="p-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 rounded-lg"
                >
                  {'<'}
                </button>
                <span className="text-slate-400 text-sm px-4">
                  Pagina {currentPage + 1} de {totalPages()} ({getCurrentPageItems().length} QRs)
                </span>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages() - 1, p + 1))}
                  disabled={currentPage >= totalPages() - 1}
                  className="p-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 rounded-lg"
                >
                  {'>'}
                </button>
              </div>

              {/* Printable Area */}
              <div ref={printRef} className="bg-white rounded-2xl p-6 print:bg-white print:p-0">
                {printLayout === 'grid' ? (
                  <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${qrSize + 40}px, 1fr))` }}>
                    {getCurrentPageItems().map((qr, i) => (
                      <div key={qr.id} className="text-center border border-slate-200 rounded-lg p-2 print:border-slate-300">
                        <img src={qr.qrDataUrl} alt={qr.shortCode} className="mx-auto" />
                        <p className="text-black font-bold text-xs mt-1">{qr.shortCode}</p>
                        {qr.productBrand && (
                          <p className="text-slate-500 text-xs">{qr.productBrand}</p>
                        )}
                        <p className="text-slate-400 text-xs">TraceQR</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {getCurrentPageItems().map((qr, i) => (
                      <div key={qr.id} className="flex items-center gap-4 border border-slate-200 rounded-lg p-3 print:border-slate-300">
                        <img src={qr.qrDataUrl} alt={qr.shortCode} className="shrink-0" />
                        <div className="flex-1">
                          <p className="text-black font-bold">{qr.shortCode}</p>
                          <p className="text-slate-600 text-sm">{qr.productBrand || 'Sin marca asignada'}</p>
                          <p className="text-slate-400 text-xs font-mono">traceqr.app/s/{qr.shortCode}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-slate-500 text-xs">#{(currentPage * itemsPerPage) + i + 1}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {qrPreviews.length === 0 && !generatingQR && (
            <div className="text-center py-12">
              <AlertCircle className="w-12 h-12 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400 text-sm">No hay UCIDs disponibles en este lote.</p>
              <p className="text-slate-500 text-xs mt-1">Todos han sido escaneados o el lote esta vacio.</p>
            </div>
          )}
        </div>
      )}

      {/* Print Styles */}
      <style>{`
        @media print {
          body { background: white !important; }
          .print-hide { display: none !important; }
          .print\:bg-white { background: white !important; }
          .print\:border-slate-300 { border-color: #cbd5e1 !important; }
          .print\:p-0 { padding: 0 !important; }
        }
      `}</style>
    </div>
  );
}