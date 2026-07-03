import { useState } from 'react';
import { AuthProvider, useAuth } from './lib/auth';
import AppLayout from './components/AppLayout';
import AIChatbot from './components/AIChatbot';
import LoginPage from './pages/LoginPage';
import StudentDashboard from './pages/StudentDashboard';
import ScannerPage from './pages/ScannerPage';
import RankingPage from './pages/RankingPage';
import MapPage from './pages/MapPage';
import PointsPage from './pages/PointsPage';
import CompanyDashboard from './pages/CompanyDashboard';
import CompanyMapPage from './pages/CompanyMapPage';
import TraceabilityPage from './pages/TraceabilityPage';
import UCIDTrackingPage from './pages/UCIDTrackingPage';
import AdminDashboard from './pages/AdminDashboard';
import AdminCompanies from './pages/AdminCompanies';
import AdminUsers from './pages/AdminUsers';
import AdminStock from './pages/AdminStock';
import AdminProducts from './pages/AdminProducts';
import AdminLocations from './pages/AdminLocations';
import AdminUCID from './pages/AdminUCID';
import AdminProductLines from './pages/AdminProductLines';
import UCIDPrint from './pages/UCIDPrint';

function AppContent() {
  const { user, profile, loading } = useAuth();
  const [view, setView] = useState<string>(() => {
    // Check for public tracking page via query param
    const params = new URLSearchParams(window.location.search);
    if (params.get('track')) return 'public-tracking';

    // Check for /s/{short_code}/{hash} URL pattern (QR code deep link)
    const pathMatch = window.location.pathname.match(/^\/s\/([A-Z0-9]{8})\/([a-f0-9]+)/i);
    if (pathMatch) return 'public-tracking';

    return 'dashboard';
  });

  // Public tracking page - no auth required
  if (view === 'public-tracking') {
    return <UCIDTrackingPage />;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-400 text-sm">Cargando TraceQR...</p>
        </div>
      </div>
    );
  }

  if (!user || !profile) return <LoginPage />;

  // Default views per role
  const defaultView = profile.role === 'admin' ? 'admin-dashboard' : profile.role === 'company' ? 'company-dashboard' : 'dashboard';
  const activeView = view === 'dashboard' && profile.role !== 'student' ? defaultView : view;

  function renderPage() {
    switch (activeView) {
      // Student views
      case 'dashboard': return <StudentDashboard onNavigate={setView} />;
      case 'scanner': return <ScannerPage />;
      case 'ranking': return <RankingPage />;
      case 'map': return <MapPage />;
      case 'points': return <PointsPage />;

      // Company views
      case 'company-dashboard': return <CompanyDashboard />;
      case 'company-map': return <CompanyMapPage />;
      case 'traceability': return <TraceabilityPage />;
      case 'analytics': return <CompanyDashboard />;
      case 'admin-ucid': return <AdminUCID />;
      case 'company-ucid': return <AdminUCID />;
      case 'ucid-print': return <UCIDPrint />;
      case 'public-tracking': return <UCIDTrackingPage />;

      // Admin views
      case 'admin-dashboard': return <AdminDashboard />;
      case 'admin-companies': return <AdminCompanies />;
      case 'admin-users': return <AdminUsers />;
      case 'admin-stock': return <AdminStock />;
      case 'admin-products': return <AdminProducts />;
      case 'admin-locations': return <AdminLocations />;
      case 'admin-product-lines': return <AdminProductLines />;
      case 'admin-settings': return <AdminSettings />;
      case 'ai-chatbot': return <AIChatbot />;

      default: return profile.role === 'admin' ? <AdminDashboard /> : profile.role === 'company' ? <CompanyDashboard /> : <StudentDashboard onNavigate={setView} />;
    }
  }

  return (
    <AppLayout activeView={activeView} onNavigate={v => setView(v)}>
      {renderPage()}
    </AppLayout>
  );
}

function AdminSettings() {
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-6">Configuración</h1>
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div>
          <h2 className="text-white font-semibold mb-1">Plataforma TraceQR</h2>
          <p className="text-slate-400 text-sm">Sistema de trazabilidad de plásticos con IA y puntos canjeables.</p>
        </div>
        <div className="border-t border-slate-800 pt-4">
          <h3 className="text-slate-300 text-sm font-medium mb-3">Reglas del sistema</h3>
          <ul className="space-y-2 text-slate-400 text-sm">
            <li className="flex items-start gap-2"><span className="text-emerald-400 mt-0.5">•</span> 10 puntos por cada envase escaneado</li>
            <li className="flex items-start gap-2"><span className="text-emerald-400 mt-0.5">•</span> 50 puntos para canjear un refrigerio</li>
            <li className="flex items-start gap-2"><span className="text-emerald-400 mt-0.5">•</span> Máximo 1 refrigerio por día por usuario</li>
            <li className="flex items-start gap-2"><span className="text-emerald-400 mt-0.5">•</span> Cada escaneo genera un token SHA-256 único</li>
            <li className="flex items-start gap-2"><span className="text-emerald-400 mt-0.5">•</span> Los datos de productos se aprenden con IA por votación</li>
            <li className="flex items-start gap-2"><span className="text-emerald-400 mt-0.5">•</span> Integración con Open Food Facts para datos nutricionales</li>
          </ul>
        </div>
        <div className="border-t border-slate-800 pt-4">
          <h3 className="text-slate-300 text-sm font-medium mb-3">Algoritmo SHA-256</h3>
          <p className="text-slate-400 text-sm">Cada escaneo genera un token único usando SHA-256 sobre: ID de usuario + código de barras + timestamp. Garantiza la trazabilidad e inmutabilidad de cada evento.</p>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
