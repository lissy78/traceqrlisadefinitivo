import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { UCIDBatch, UCID, ScanEvent } from './supabase'

export function exportToCSV(filename: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return
  const headers = Object.keys(rows[0])
  const csv = [
    headers.join(','),
    ...rows.map(r =>
      headers
        .map(h => {
          const val = r[h]
          const s = val === null || val === undefined ? '' : String(val)
          return `"${s.replace(/"/g, '""')}"`
        })
        .join(','),
    ),
  ].join('\n')
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function exportScansCSV(scans: ScanEvent[]) {
  const rows = scans.map(s => ({
    Fecha: new Date(s.created_at).toLocaleString('es-CO'),
    Barcode: s.barcode,
    Fuente: s.acquisition_source ?? '',
    Ubicacion: s.location_name ?? '',
    Puntos: s.points_earned,
    Token: s.token_hash,
  }))
  exportToCSV(`trazabilidad_${Date.now()}.csv`, rows)
}

export function exportBatchesCSV(batches: UCIDBatch[]) {
  const rows = batches.map(b => ({
    Lote: b.batch_name,
    Producto: b.product_name ?? '',
    Marca: b.product_brand ?? '',
    Cantidad: b.quantity,
    Generados: b.generated_count,
    Precio_Unitario: b.price_per_ucid,
    Total: b.total_price,
    Estado: b.status,
    Creado: new Date(b.created_at).toLocaleString('es-CO'),
  }))
  exportToCSV(`lotes_${Date.now()}.csv`, rows)
}

export function generatePDFReport(opts: {
  companyName: string
  dateRange: string
  totalScans: number
  uniqueUsers: number
  totalBatches: number
  totalUcids: number
  scans: ScanEvent[]
  batches: UCIDBatch[]
  dailyData: { day: string; escaneos: number }[]
}) {
  const doc = new jsPDF()
  const now = new Date().toLocaleString('es-CO')

  // Header
  doc.setFillColor(16, 185, 129)
  doc.rect(0, 0, 210, 30, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text('TraceQR - Reporte de Trazabilidad', 14, 14)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(`Generado: ${now}`, 14, 22)

  // Company info
  doc.setTextColor(30, 30, 30)
  doc.setFontSize(13)
  doc.setFont('helvetica', 'bold')
  doc.text(opts.companyName, 14, 42)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(`Periodo: ${opts.dateRange}`, 14, 48)

  // KPIs
  doc.setFillColor(241, 245, 249)
  doc.roundedRect(14, 54, 182, 22, 2, 2, 'F')
  doc.setFontSize(8)
  doc.setTextColor(100, 116, 139)
  doc.text('TOTAL ESCANEOS', 20, 62)
  doc.text('USUARIOS UNICOS', 64, 62)
  doc.text('LOTES CREADOS', 108, 62)
  doc.text('UCIDs GENERADOS', 152, 62)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(15, 23, 42)
  doc.text(String(opts.totalScans), 20, 71)
  doc.text(String(opts.uniqueUsers), 64, 71)
  doc.text(String(opts.totalBatches), 108, 71)
  doc.text(String(opts.totalUcids), 152, 71)

  // Daily trend chart (simple bars)
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(15, 23, 42)
  doc.text('Tendencia diaria de escaneos', 14, 88)
  const chartX = 14
  const chartY = 92
  const chartW = 182
  const chartH = 50
  const maxVal = Math.max(...opts.dailyData.map(d => d.escaneos), 1)
  const barW = chartW / opts.dailyData.length
  doc.setFillColor(241, 245, 249)
  doc.rect(chartX, chartY, chartW, chartH, 'F')
  opts.dailyData.forEach((d, i) => {
    const h = (d.escaneos / maxVal) * chartH
    doc.setFillColor(16, 185, 129)
    doc.rect(chartX + i * barW + 1, chartY + chartH - h, barW - 2, h, 'F')
  })

  // Scans table
  autoTable(doc, {
    startY: 150,
    head: [['Fecha', 'Barcode', 'Fuente', 'Ubicacion', 'Puntos']],
    body: opts.scans.slice(0, 25).map(s => [
      new Date(s.created_at).toLocaleString('es-CO'),
      s.barcode,
      s.acquisition_source ?? '-',
      s.location_name ?? '-',
      String(s.points_earned),
    ]),
    theme: 'striped',
    headStyles: { fillColor: [16, 185, 129] },
    styles: { fontSize: 7 },
  })

  // Batches table on new page
  if (opts.batches.length > 0) {
    doc.addPage()
    doc.setFontSize(13)
    doc.setFont('helvetica', 'bold')
    doc.text('Lotes de UCIDs', 14, 20)
    autoTable(doc, {
      startY: 25,
      head: [['Lote', 'Producto', 'Cantidad', 'Generados', 'Estado', 'Creado']],
      body: opts.batches.map(b => [
        b.batch_name,
        b.product_name ?? '-',
        String(b.quantity),
        String(b.generated_count),
        b.status,
        new Date(b.created_at).toLocaleDateString('es-CO'),
      ]),
      theme: 'striped',
      headStyles: { fillColor: [16, 185, 129] },
      styles: { fontSize: 8 },
    })
  }

  // Footer
  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(7)
    doc.setTextColor(148, 163, 184)
    doc.text(
      `TraceQR | Reporte confidencial | Pagina ${i} de ${pageCount}`,
      14,
      290,
    )
  }

  doc.save(`reporte_trazabilidad_${opts.companyName.replace(/\s/g, '_')}_${Date.now()}.pdf`)
}
