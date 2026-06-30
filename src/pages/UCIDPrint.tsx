import { useState, useRef } from 'react';
import QRCode from 'qrcode';
import {
  QrCode, Download, Printer, Eye, Hash,
  Loader2, AlertCircle, CheckCircle2, Package, Grid,
  ZoomIn, ZoomOut, Upload, FileText, X
} from 'lucide-react';

interface CSVRow {
  short_code: string;
  qr_url: string;
  ucid_hash: string;
  product_name: string;
  status: string;
}

interface QRPreview {
  shortCode: string;
  qrDataUrl: string;
  qrUrl: string;
  productName: string;
  productBrand: string;
}

const BASE_URL = 'https://traceqr.app';

export default function UCIDPrintPage() {
  const [csvRows, setCsvRows] = useState<CSVRow[]>([]);
  const [qrPreviews, setQrPreviews] = useState<QRPreview[]>([]);
  const [fileName, setFileName] = useState('');
  const [parsing, setParsing] = useState(false);
  const [generatingQR, setGeneratingQR] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(0);
  const [printLayout, setPrintLayout] = useState<'grid' | 'list'>('grid');
  const [qrSize, setQrSize] = useState(150);
  const [itemsPerPage, setItemsPerPage] = useState(60);
  const [currentPage, setCurrentPage] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const printRef = useRef<HTMLDivElement>(null);

  function parseCSV(text: string): CSVRow[] {
    const lines = text.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return [];

    // Detect delimiter (comma or semicolon)
    const delim = lines[0].includes(';') ? ';' : ',';
    const headers = lines[0].split(delim).map(h => h.trim().toLowerCase());

    const idx = {
      short_code: headers.indexOf('short_code'),
      qr_url: headers.indexOf('qr_url'),
      ucid_hash: headers.indexOf('ucid_hash'),
      product_name: headers.indexOf('product_name'),
      status: headers.indexOf('status'),
    };

    if (idx.short_code === -1) {
      throw new Error('El CSV debe tener una columna "short_code"');
    }

    const rows: CSVRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(delim);
      rows.push({
        short_code: (cols[idx.short_code] || '').trim(),
        qr_url: idx.qr_url >= 0 ? (cols[idx.qr_url] || '').trim() : '',
        ucid_hash: idx.ucid_hash >= 0 ? (cols[idx.ucid_hash] || '').trim() : '',
        product_name: idx.product_name >= 0 ? (cols[idx.product_name] || '').trim() : '',
        status: idx.status >= 0 ? (cols[idx.status] || '').trim() : 'unused',
      });
    }
    return rows.filter(r => r.short_code);
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError('');
    setParsing(true);
    setQrPreviews([]);
    setCsvRows([]);
    setProgress(0);

    try {
      const text = await file.text();
      const rows = parseCSV(text);
      if (rows.length === 0) {
        setError('El CSV esta vacio o no tiene el formato correcto');
        setParsing(false);
        return;
      }
      setCsvRows(rows);
      setFileName(file.name);
      setParsing(false);

      // Generate QR codes in batches to avoid blocking the UI
      setGeneratingQR(true);
      const previews: QRPreview[] = [];
      const batchSize = 50;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        // Yield to the event loop between batches
        await new Promise(r => setTimeout(r, 0));
        for (const row of batch) {
          const qrUrl = row.qr_url || `${BASE_URL}/s/${row.short_code}`;
          try {
            const qrDataUrl = await QRCode.toDataURL(qrUrl, {
              width: qrSize,
              margin: 2,
              color: { dark: '#000000', light: '#ffffff' },
            });
            previews.push({
              shortCode: row.short_code,
              qrDataUrl,
              qrUrl,
              productName: row.product_name,
              productBrand: '',
            });
          } catch (err) {
            console.error('Error generating QR for', row.short_code, err);
          }
        }
        setProgress(Math.min(100, Math.round(((i + batch.length) / rows.length) * 100)));
        setQrPreviews([...previews]);
      }
      setGeneratingQR(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al procesar el CSV');
      setParsing(false);
      setGeneratingQR(false);
    }
  }

  function handleReset() {
    setCsvRows([]);
    setQrPreviews([]);
    setFileName('');
    setError('');
    setProgress(0);
    setCurrentPage(0);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function getCurrentPageItems() {
    const start = currentPage * itemsPerPage;
    return qrPreviews.slice(start, start + itemsPerPage);
  }

  function totalPages() {
    return Math.max(1, Math.ceil(qrPreviews.length / itemsPerPage));
  }

  function handlePrint() {
    window.print();
  }

  function handleDownloadHTML() {
    const printContent = printRef.current?.innerHTML;
    if (!printContent) return;

    const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>TraceQR QRs - ${fileName}</title>
  <style>
    body { font-family: Arial, sans-serif; background: white; color: black; margin: 0; padding: 20px; }
    h1 { font-size: 18px; }
    .qr-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; }
    .qr-item { text-align: center; padding: 10px; border: 1px solid #ddd; page-break-inside: avoid; }
    .qr-item img { max-width: 100%; }
    .short-code { font-weight: bold; font-size: 12px; margin-top: 5px; }
    .brand { font-size: 10px; color: #666; }
    @media print { body { -webkit-print-color-adjust: exact; } }
  </style>
</head>
<body>
  <h1>TraceQR - ${fileName}</h1>
  <p>Total: ${qrPreviews.length} QRs</p>
  <hr/>
  ${printContent}
</body>
</html>`;

    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `traceqr_qrs_${fileName.replace('.csv', '')}.html`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // Upload screen
  if (qrPreviews.length === 0) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Printer className="w-6 h-6 text-teal-400" />
            Imprimir QRs UCID
          </h1>
          <p className="text-slate-400 text-sm mt-1">Sube el CSV exportado desde la seccion UCIDs para generar los QRs imprimibles</p>
        </div>

        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-emerald-300 text-sm font-medium">Funciona 100% offline desde tu CSV</p>
              <p className="text-emerald-400/70 text-xs mt-1">
                No se consulta la base de datos. Todos los QRs se generan en tu navegador a partir del archivo CSV exportado.
                Esto evita sobrecargar la app y la base de datos con miles de registros.
              </p>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-500/15 border border-red-500/30 rounded-xl px-4 py-3 flex items-center gap-2 text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}

        <div
          onClick={() => fileInputRef.current?.click()}
          className="bg-slate-900/60 border-2 border-dashed border-slate-700 hover:border-teal-500/50 rounded-2xl p-12 text-center cursor-pointer transition-colors"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileUpload}
            className="hidden"
          />
          {parsing || generatingQR ? (
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-10 h-10 text-teal-400 animate-spin" />
              <p className="text-slate-300 text-sm">
                {parsing ? 'Leyendo CSV...' : `Generando QRs... ${progress}%`}
              </p>
              {generatingQR && (
                <div className="w-64 h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-teal-500 transition-all" style={{ width: `${progress}%` }} />
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div className="w-14 h-14 rounded-2xl bg-teal-500/15 border border-teal-500/20 flex items-center justify-center">
                <Upload className="w-7 h-7 text-teal-400" />
              </div>
              <p className="text-white font-medium">Haz clic para subir tu CSV</p>
              <p className="text-slate-500 text-xs">Archivo exportado desde la seccion "UCIDs" (boton Exportar CSV)</p>
            </div>
          )}
        </div>

        <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
          <h3 className="text-slate-300 text-sm font-medium mb-2 flex items-center gap-2">
            <FileText className="w-4 h-4 text-slate-400" /> Formato esperado del CSV
          </h3>
          <pre className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs text-emerald-300 overflow-x-auto">{`short_code,qr_url,ucid_hash,product_name,status
ABCD1234,https://traceqr.app/s/ABCD1234/...,a1b2c3...,Coca-Cola 500ml,unused
EFGH5678,https://traceqr.app/s/EFGH5678/...,d4e5f6...,Pepsi 400ml,unused`}</pre>
          <p className="text-slate-500 text-xs mt-2">Las columnas minimas requeridas son <code className="text-teal-400">short_code</code>. Si incluye <code className="text-teal-400">qr_url</code> se usara esa URL para el QR.</p>
        </div>
      </div>
    );
  }

  // Print preview screen
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Printer className="w-6 h-6 text-teal-400" />
            Imprimir QRs UCID
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            {fileName} - {qrPreviews.length.toLocaleString('es-CO')} QRs generados
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleReset} className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-xl text-sm transition-colors">
            <X className="w-4 h-4" /> Subir otro CSV
          </button>
        </div>
      </div>

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
              className="flex items-center gap-2 bg-teal-500 hover:bg-teal-400 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
            >
              <Printer className="w-4 h-4" /> Imprimir
            </button>
            <button
              onClick={handleDownloadHTML}
              className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
            >
              <Download className="w-4 h-4" /> Descargar HTML
            </button>
          </div>
        </div>
      </div>

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
            {getCurrentPageItems().map((qr) => (
              <div key={qr.shortCode} className="text-center border border-slate-200 rounded-lg p-2 print:border-slate-300">
                <img src={qr.qrDataUrl} alt={qr.shortCode} className="mx-auto" />
                <p className="text-black font-bold text-xs mt-1">{qr.shortCode}</p>
                {qr.productName && (
                  <p className="text-slate-500 text-xs">{qr.productName}</p>
                )}
                <p className="text-slate-400 text-xs">TraceQR</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {getCurrentPageItems().map((qr, i) => (
              <div key={qr.shortCode} className="flex items-center gap-4 border border-slate-200 rounded-lg p-3 print:border-slate-300">
                <img src={qr.qrDataUrl} alt={qr.shortCode} className="shrink-0" />
                <div className="flex-1">
                  <p className="text-black font-bold">{qr.shortCode}</p>
                  <p className="text-slate-600 text-sm">{qr.productName || 'Sin producto asignado'}</p>
                  <p className="text-slate-400 text-xs font-mono">{qr.qrUrl}</p>
                </div>
                <div className="text-right">
                  <p className="text-slate-500 text-xs">#{(currentPage * itemsPerPage) + i + 1}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Print Styles */}
      <style>{`
        @media print {
          body { background: white !important; }
          .print-hide { display: none !important; }
          .print\\:bg-white { background: white !important; }
          .print\\:border-slate-300 { border-color: #cbd5e1 !important; }
          .print\\:p-0 { padding: 0 !important; }
        }
      `}</style>
    </div>
  );
}
