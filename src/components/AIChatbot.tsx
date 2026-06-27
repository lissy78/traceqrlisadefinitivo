import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import {
  Bot, Send, Sparkles, TrendingUp, Package, MapPin,
  Clock, BarChart3, Lightbulb, RefreshCw, ChevronDown
} from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  insights?: AIInsight[];
}

interface AIInsight {
  type: 'trend' | 'alert' | 'recommendation' | 'pattern';
  title: string;
  description: string;
  data?: Record<string, unknown>;
}

interface ScanPattern {
  brand: string;
  count: number;
  trend: 'up' | 'down' | 'stable';
  locations: string[];
}

export default function AIChatbot() {
  const { profile } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [patterns, setPatterns] = useState<ScanPattern[]>([]);
  const [insights, setInsights] = useState<AIInsight[]>([]);
  const [showInsights, setShowInsights] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadPatternsAndInsights();
    addWelcomeMessage();
  }, [profile]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function loadPatternsAndInsights() {
    if (!profile) return;

    // Load scan patterns learned by AI
    const { data: responses } = await supabase
      .from('ai_product_responses')
      .select('*')
      .order('vote_count', { ascending: false })
      .limit(50);

    // Load recent scans for pattern analysis
    let scanQuery = supabase
      .from('scan_events')
      .select('*, product:product_catalog(brand, name, category), company:companies(name)')
      .order('created_at', { ascending: false })
      .limit(100);

    if (profile.role === 'company' && profile.company_id) {
      scanQuery = scanQuery.eq('company_id', profile.company_id);
    }

    const { data: scans } = await scanQuery;

    // Analyze patterns
    const brandCounts: Record<string, { count: number; sources: Set<string>; times: number[] }> = {};

    (scans ?? []).forEach((scan: Record<string, unknown>) => {
      const brand = (scan.product as Record<string, string>)?.brand || (scan.scan_data as Record<string, string>)?.brand_name || 'Desconocido';
      const source = (scan as Record<string, string>).acquisition_source || 'No especificado';
      const hour = new Date((scan as Record<string, string>).created_at).getHours();

      if (!brandCounts[brand]) {
        brandCounts[brand] = { count: 0, sources: new Set(), times: [] };
      }
      brandCounts[brand].count++;
      brandCounts[brand].sources.add(source);
      brandCounts[brand].times.push(hour);
    });

    const scanPatterns: ScanPattern[] = Object.entries(brandCounts)
      .map(([brand, data]) => ({
        brand,
        count: data.count,
        trend: 'stable' as const,
        locations: Array.from(data.sources),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    setPatterns(scanPatterns);

    // Generate AI insights
    const generatedInsights: AIInsight[] = [];

    if (scanPatterns.length > 0) {
      const topBrand = scanPatterns[0];
      generatedInsights.push({
        type: 'pattern',
        title: `Patron dominante: ${topBrand.brand}`,
        description: `${topBrand.brand} representa el ${(topBrand.count / ((scans?.length || 1) * 100)).toFixed(1)}% de los escaneos. Fuentes principales: ${topBrand.locations.slice(0, 3).join(', ')}`,
        data: { brand: topBrand.brand, count: topBrand.count },
      });

      if (scanPatterns.length >= 3) {
        generatedInsights.push({
          type: 'trend',
          title: 'Distribucion de marcas',
          description: `Top 3: ${scanPatterns.slice(0, 3).map(p => `${p.brand} (${p.count})`).join(', ')}`,
        });
      }
    }

    // Time-based insights
    const hours = (scans ?? []).map((s: Record<string, unknown>) => new Date((s as Record<string, string>).created_at).getHours());
    const peakHours = findPeakHours(hours);
    if (peakHours.length > 0) {
      generatedInsights.push({
        type: 'recommendation',
        title: 'Horarios pico de reciclaje',
        description: `Mayor actividad entre ${peakHours[0]}:00 y ${peakHours[peakHours.length - 1]}:00. Considera colocar mas contenedores en estos horarios.`,
      });
    }

    // Location insights
    const sources = (scans ?? []).map((s: Record<string, unknown>) => (s as Record<string, string>).acquisition_source).filter(Boolean);
    const sourceCounts = countItems(sources);
    const topSource = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1])[0];
    if (topSource) {
      generatedInsights.push({
        type: 'pattern',
        title: 'Fuente principal de productos',
        description: `La mayoria de envases provienen de ${topSource[0]} (${topSource[1]} escaneos)`,
      });
    }

    // Learned responses insights
    const learnedBrands = (responses ?? []).filter((r: Record<string, unknown>) => r.question_key === 'brand_name');
    const highConfidence = learnedBrands.filter((r: Record<string, unknown>) => (r as Record<string, number>).confidence > 0.8);
    if (highConfidence.length > 0) {
      generatedInsights.push({
        type: 'alert',
        title: 'IA aprendida',
        description: `La IA ha aprendido ${highConfidence.length} patrones de marcas con alta confianza (>80%)`,
      });
    }

    setInsights(generatedInsights);
  }

  function findPeakHours(hours: number[]): number[] {
    const counts: Record<number, number> = {};
    hours.forEach(h => { counts[h] = (counts[h] || 0) + 1; });
    const max = Math.max(...Object.values(counts));
    return Object.entries(counts)
      .filter(([, c]) => c >= max * 0.7)
      .map(([h]) => parseInt(h))
      .sort((a, b) => a - b);
  }

  function countItems(items: string[]): Record<string, number> {
    const counts: Record<string, number> = {};
    items.forEach(item => { counts[item] = (counts[item] || 0) + 1; });
    return counts;
  }

  function addWelcomeMessage() {
    const welcomeMessage: Message = {
      role: 'assistant',
      content: `Hola! Soy el asistente IA de TraceQR. He analizado ${patterns.length} patrones de reciclaje y puedo ayudarte con:\n\n• Preguntas sobre tendencias de escaneo\n• Patrones de consumo de productos\n• Optimizacion de puntos de reciclaje\n• Analisis de marcas mas recicladas\n\nPreguntame lo que quieras saber sobre la trazabilidad.`,
      timestamp: new Date(),
    };
    setMessages([welcomeMessage]);
  }

  async function handleSend() {
    if (!input.trim() || loading) return;

    const userMessage: Message = {
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    // Process with AI
    const response = await processWithAI(input.trim());

    const assistantMessage: Message = {
      role: 'assistant',
      content: response.content,
      timestamp: new Date(),
      insights: response.insights,
    };

    setMessages(prev => [...prev, assistantMessage]);
    setLoading(false);
  }

  async function processWithAI(query: string): Promise<{ content: string; insights?: AIInsight[] }> {
    const queryLower = query.toLowerCase();
    const contextData = await fetchContextData(queryLower);

    // Generate contextual response
    let content = '';
    const responseInsights: AIInsight[] = [];

    if (queryLower.includes('marca') || queryLower.includes('brand')) {
      content = await analyzeBrands(queryLower, contextData, responseInsights);
    } else if (queryLower.includes('hora') || queryLower.includes('hora pico') || queryLower.includes('horario')) {
      content = await analyzeTimePatterns(queryLower, contextData, responseInsights);
    } else if (queryLower.includes('ubicacion') || queryLower.includes('lugar') || queryLower.includes('donde') || queryLower.includes('location')) {
      content = await analyzeLocations(queryLower, contextData, responseInsights);
    } else if (queryLower.includes('tendencia') || queryLower.includes('trend') || queryLower.includes('patron')) {
      content = await analyzeTrends(queryLower, contextData, responseInsights);
    } else if (queryLower.includes('optim') || queryLower.includes('mejorar') || queryLower.includes('suger')) {
      content = await generateRecommendations(queryLower, contextData, responseInsights);
    } else if (queryLower.includes('resumen') || queryLower.includes('reporte') || queryLower.includes('total')) {
      content = await generateSummary(queryLower, contextData, responseInsights);
    } else {
      // Default: general analysis
      content = await generateGeneralResponse(queryLower, contextData, responseInsights);
    }

    return { content, insights: responseInsights };
  }

  async function fetchContextData(query: string): Promise<Record<string, unknown>> {
    if (!profile) return {};

    const isCompanyUser = profile.role === 'company' && profile.company_id;

    // Fetch relevant data based on query
    const { data: scans } = await supabase
      .from('scan_events')
      .select('*, product:product_catalog(brand, name, category, material), company:companies(name)')
      .order('created_at', { ascending: false })
      .limit(isCompanyUser ? 500 : 1000);

    const { data: learnedResponses } = await supabase
      .from('ai_product_responses')
      .select('*')
      .order('confidence', { ascending: false })
      .limit(100);

    return {
      scans: scans || [],
      learnedResponses: learnedResponses || [],
      patterns,
      insights,
    };
  }

  async function analyzeBrands(query: string, context: Record<string, unknown>, insights: AIInsight[]): Promise<string> {
    const scans = context.scans as Array<Record<string, unknown>> || [];
    const brandCounts: Record<string, number> = {};

    scans.forEach((scan: Record<string, unknown>) => {
      const brand = (scan.product as Record<string, string | null>)?.brand ||
        (scan.scan_data as Record<string, string | null>)?.brand_name || 'Desconocido';
      brandCounts[brand] = (brandCounts[brand] || 0) + 1;
    });

    const sortedBrands = Object.entries(brandCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    if (sortedBrands.length === 0) {
      return 'No tengo datos de marcas escaneadas aun. Registra algunos escaneos para comenzar el aprendizaje.';
    }

    const total = sortedBrands.reduce((sum, [, count]) => sum + count, 0);
    let response = `**Analisis de marcas escaneadas:**\n\n`;

    sortedBrands.forEach(([brand, count], index) => {
      const percentage = ((count / total) * 100).toFixed(1);
      response += `${index + 1}. **${brand}**: ${count} escaneos (${percentage}%)\n`;
    });

    insights.push({
      type: 'pattern',
      title: 'Marca lider',
      description: `${sortedBrands[0][0]} lidera con ${sortedBrands[0][1]} escaneos`,
    });

    // Add learning insight
    const learned = context.learnedResponses as Array<Record<string, unknown>> || [];
    const brandLearning = learned.filter((r: Record<string, unknown>) => r.question_key === 'brand_name');
    response += `\n\nLa IA ha aprendido ${brandLearning.length} patrones de marcas basados en los escaneos de usuarios.`;

    return response;
  }

  async function analyzeTimePatterns(query: string, context: Record<string, unknown>, insights: AIInsight[]): Promise<string> {
    const scans = context.scans as Array<Record<string, unknown>> || [];
    if (scans.length === 0) {
      return 'No hay suficientes datos de escaneo para analizar patrones de tiempo.';
    }

    const hourCounts: Record<number, number> = {};
    const dayCounts: Record<string, number> = {};

    scans.forEach((scan: Record<string, unknown>) => {
      const date = new Date((scan as Record<string, string>).created_at);
      const hour = date.getHours();
      const day = date.toLocaleDateString('es-CO', { weekday: 'long' });

      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
      dayCounts[day] = (dayCounts[day] || 0) + 1;
    });

    const peakHour = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0];
    const peakDay = Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0];

    insights.push({
      type: 'pattern',
      title: 'Hora pico',
      description: `Mayor actividad a las ${peakHour[0]}:00 (${peakHour[1]} escaneos)`,
    });

    return `**Patrones de tiempo en el reciclaje:**\n\n` +
      `• **Hora pico**: ${peakHour[0]}:00 con ${peakHour[1]} escaneos\n` +
      `• **Dia mas activo**: ${peakDay[0]} con ${peakDay[1]} escaneos\n\n` +
      `**Recomendacion**: Considera aumentar la capacidad de contenedores entre ${parseInt(peakHour[0]) - 1}:00 y ${parseInt(peakHour[0]) + 1}:00 los dias ${peakDay[0]}.`;
  }

  async function analyzeLocations(query: string, context: Record<string, unknown>, insights: AIInsight[]): Promise<string> {
    const scans = context.scans as Array<Record<string, unknown>> || [];
    const sourceCounts: Record<string, number> = {};

    scans.forEach((scan: Record<string, unknown>) => {
      const source = (scan as Record<string, string | null>).acquisition_source || 'No especificado';
      sourceCounts[source] = (sourceCounts[source] || 0) + 1;
    });

    const sorted = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]);

    if (sorted.length === 0) {
      return 'No hay datos de ubicacion disponibles. Los usuarios deben indicar donde consiguieron el producto.';
    }

    insights.push({
      type: 'pattern',
      title: 'Fuente principal',
      description: `La mayoria de productos vienen de ${sorted[0][0]}`,
    });

    let response = `**Analisis de fuentes de productos:**\n\n`;
    sorted.forEach(([source, count], i) => {
      response += `${i + 1}. **${source}**: ${count} productos\n`;
    });

    response += `\n\nEsto puede ayudar a ubicar puntos de reciclaje cerca de ${sorted[0][0]}.`;
    return response;
  }

  async function analyzeTrends(query: string, context: Record<string, unknown>, insights: AIInsight[]): Promise<string> {
    const scans = context.scans as Array<Record<string, unknown>> || [];
    if (scans.length < 10) {
      return 'Necesito mas datos para identificar tendencias significativas. Registra al menos 10 escaneos.';
    }

    // Analyze recent vs older scans
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const recentScans = scans.filter((s: Record<string, unknown>) =>
      new Date((s as Record<string, string>).created_at) > weekAgo
    );
    const olderScans = scans.filter((s: Record<string, unknown>) =>
      new Date((s as Record<string, string>).created_at) <= weekAgo
    );

    const recentCount = recentScans.length;
    const olderCount = olderScans.length;
    const trendPercent = olderCount > 0 ? (((recentCount / olderCount) - 1) * 100).toFixed(1) : 'N/A';

    insights.push({
      type: 'trend',
      title: 'Tendencia semanal',
      description: `${trendPercent !== 'N/A' ? (parseFloat(trendPercent) > 0 ? '+' : '') + trendPercent + '% vs semana anterior' : 'Sin datos anteriores'}`,
    });

    return `**Analisis de tendencias:**\n\n` +
      `• **Esta semana**: ${recentCount} escaneos\n` +
      `• **Semana anterior**: ${olderCount} escaneos\n` +
      `• **Cambio**: ${trendPercent !== 'N/A' ? (parseFloat(trendPercent) > 0 ? '+' : '') + trendPercent + '%' : 'N/A'}\n\n` +
      (parseFloat(trendPercent || '0') > 0
        ? 'La participacion esta aumentando. Excelente trabajo!'
        : 'La participacion ha disminuido. Considera campanas de incentivo.');
  }

  async function generateRecommendations(query: string, context: Record<string, unknown>, insights: AIInsight[]): Promise<string> {
    const scans = context.scans as Array<Record<string, unknown>> || [];
    const patterns = context.patterns as ScanPattern[] || [];

    insights.push({
      type: 'recommendation',
      title: 'Optimizacion IA',
      description: 'Sugerencias basadas en patrones aprendidos',
    });

    const recommendations: string[] = [];

    // Brand-based recommendation
    if (patterns.length > 0) {
      recommendations.push(`**Involucra a ${patterns[0].brand}**: Es la marca mas reciclada. Un convenio con ellos podria aumentar la participacion.`);
    }

    // Location-based recommendation
    const sources = scans.map((s: Record<string, unknown>) => (s as Record<string, string | null>).acquisition_source).filter(Boolean);
    if (sources.length > 0) {
      const topSource = countItems(sources as string[]);
      const best = Object.entries(topSource).sort((a, b) => b[1] - a[1])[0];
      if (best) {
        recommendations.push(`**Punto estrategico**: Coloca contenedores cerca de ${best[0]} donde se originan ${best[1]} envases.`);
      }
    }

    // Volume recommendation
    if (scans.length > 50) {
      recommendations.push(`**Expandir capacidad**: Con ${scans.length} escaneos, considera incrementar el stock de refrigerios.`);
    }

    if (recommendations.length === 0) {
      return 'Necesito mas datos para generar recomendaciones personalizadas. Continua escaneando productos.';
    }

    return `**Recomendaciones de optimizacion:**\n\n` + recommendations.map((r, i) => `${i + 1}. ${r}`).join('\n\n');
  }

  async function generateSummary(query: string, context: Record<string, unknown>, insights: AIInsight[]): Promise<string> {
    const scans = context.scans as Array<Record<string, unknown>> || [];
    const learned = context.learnedResponses as Array<Record<string, unknown>> || [];

    const uniqueBrands = new Set(scans.map((s: Record<string, unknown>) =>
      (s.product as Record<string, string | null>)?.brand ||
      (s.scan_data as Record<string, string | null>)?.brand_name
    ).filter(Boolean));

    const uniqueMaterials = new Set(scans.map((s: Record<string, unknown>) =>
      (s.scan_data as Record<string, string | null>)?.material_type ||
      (s.product as Record<string, string | null>)?.material
    ).filter(Boolean));

    const totalPoints = scans.reduce((sum, s) => sum + ((s as Record<string, number>).points_earned || 0), 0);

    insights.push({
      type: 'trend',
      title: 'Resumen general',
      description: `${scans.length} escaneos, ${uniqueBrands.size} marcas, ${totalPoints} puntos`,
    });

    return `**Resumen de trazabilidad:**\n\n` +
      `• **Total escaneos**: ${scans.length}\n` +
      `• **Marcas unicas**: ${uniqueBrands.size}\n` +
      `• **Materiales identificados**: ${uniqueMaterials.size}\n` +
      `• **Puntos generados**: ${totalPoints}\n` +
      `• **Patrones aprendidos por IA**: ${learned.length}\n\n` +
      `La IA continua aprendiendo con cada escaneo para mejorar las predicciones.`;
  }

  async function generateGeneralResponse(query: string, context: Record<string, unknown>, insights: AIInsight[]): Promise<string> {
    const scans = context.scans as Array<Record<string, unknown>> || [];
    const learned = context.learnedResponses as Array<Record<string, unknown>> || [];

    // Find relevant learned responses
    const relevant = learned.find((r: Record<string, unknown>) =>
      query.includes((r as Record<string, string>).question_key) ||
      (r as Record<string, string>).answer?.toLowerCase().includes(query)
    );

    if (relevant) {
      insights.push({
        type: 'pattern',
        title: 'Conocimiento aprendido',
        description: `La IA encontro "${(relevant as Record<string, string>).answer}"`,
      });
    }

    return relevant
      ? `Basado en el aprendizaje de IA, tengo informacion sobre eso:\n\n**${(relevant as Record<string, string>).answer}**\n\n(Confianza: ${((relevant as Record<string, number>).confidence * 100).toFixed(0)}% basado en ${(relevant as Record<string, number>).vote_count} escaneos)`
      : `Tengo ${scans.length} escaneos analizados y ${learned.length} patrones aprendidos. Puedes preguntarme sobre:\n\n` +
        `• Marcas mas recicladas\n` +
        `• Horarios pico de escaneo\n` +
        `• Ubicaciones principales\n` +
        `• Tendencias de reciclaje\n` +
        `• Recomendaciones de optimizacion`;
  }

  function getInsightIcon(type: string) {
    switch (type) {
      case 'trend': return <TrendingUp className="w-4 h-4 text-blue-400" />;
      case 'alert': return <Lightbulb className="w-4 h-4 text-amber-400" />;
      case 'recommendation': return <Sparkles className="w-4 h-4 text-purple-400" />;
      default: return <Package className="w-4 h-4 text-emerald-400" />;
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Bot className="w-6 h-6 text-purple-400" />
            Asistente IA de Trazabilidad
          </h1>
          <p className="text-slate-400 text-sm mt-1">Aprendizaje automatico de patrones de reciclaje</p>
        </div>
        <button
          onClick={loadPatternsAndInsights}
          className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-xl text-sm transition-colors"
        >
          <RefreshCw className="w-4 h-4" /> Actualizar analisis
        </button>
      </div>

      {/* Insights Panel */}
      {showInsights && insights.length > 0 && (
        <div className="bg-gradient-to-br from-purple-900/20 to-blue-900/20 border border-purple-500/20 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-white font-semibold flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-400" />
              Insights de IA
            </h3>
            <button onClick={() => setShowInsights(false)} className="text-slate-400 hover:text-white">
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {insights.map((insight, i) => (
              <div key={i} className="bg-slate-900/60 border border-slate-800 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-1">
                  {getInsightIcon(insight.type)}
                  <span className="text-white text-xs font-medium">{insight.title}</span>
                </div>
                <p className="text-slate-400 text-xs">{insight.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Chat Interface */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl flex flex-col h-[500px]">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                  msg.role === 'user'
                    ? 'bg-purple-500/20 border border-purple-500/30 text-white'
                    : 'bg-slate-800 border border-slate-700 text-slate-200'
                }`}
              >
                {msg.role === 'assistant' && (
                  <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-700">
                    <Bot className="w-4 h-4 text-purple-400" />
                    <span className="text-purple-400 text-xs font-medium">TraceQR IA</span>
                  </div>
                )}
                <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
                <p className="text-xs text-slate-500 mt-2">
                  {msg.timestamp.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3">
                <div className="flex items-center gap-2">
                  <Bot className="w-4 h-4 text-purple-400 animate-pulse" />
                  <span className="text-slate-400 text-sm">Analizando...</span>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-4 border-t border-slate-800">
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
              placeholder="Pregunta sobre marcas, tendencias, horarios, ubicaciones..."
              className="flex-1 bg-slate-800 border border-slate-700 text-white placeholder-slate-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-purple-500 transition-colors"
            />
            <button
              onClick={handleSend}
              disabled={loading || !input.trim()}
              className="bg-purple-500 hover:bg-purple-400 disabled:opacity-50 text-white rounded-xl px-4 py-3 transition-colors flex items-center gap-2"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>

          {/* Quick actions */}
          <div className="flex flex-wrap gap-2 mt-3">
            {[
              'Marcas mas recicladas',
              'Horarios pico',
              'Tendencias',
              'Recomendaciones',
              'Resumen general'
            ].map(suggestion => (
              <button
                key={suggestion}
                onClick={() => { setInput(suggestion); }}
                className="bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white px-3 py-1.5 rounded-full text-xs transition-colors border border-slate-700"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Patterns Table */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4">
        <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-emerald-400" />
          Patrones aprendidos por IA
        </h3>
        {patterns.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="text-left text-xs text-slate-500 font-medium px-3 py-2">Marca</th>
                  <th className="text-left text-xs text-slate-500 font-medium px-3 py-2">Escaneos</th>
                  <th className="text-left text-xs text-slate-500 font-medium px-3 py-2">Fuentes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {patterns.map((p, i) => (
                  <tr key={i} className="hover:bg-slate-800/30">
                    <td className="px-3 py-2 text-white text-sm font-medium">{p.brand}</td>
                    <td className="px-3 py-2 text-emerald-400 text-sm font-semibold">{p.count}</td>
                    <td className="px-3 py-2 text-slate-400 text-xs">{p.locations.slice(0, 2).join(', ')}{p.locations.length > 2 ? ` +${p.locations.length - 2}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-slate-500 text-sm text-center py-4">No hay patrones aun. Registra escaneos para que la IA aprenda.</p>
        )}
      </div>
    </div>
  );
}
