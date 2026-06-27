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
import TraceabilityPage from './pages/TraceabilityPage';
import AdminDashboard from './pages/AdminDashboard';
import AdminCompanies from './pages/AdminCompanies';
import AdminUsers from './pages/AdminUsers';
import AdminStock from './pages/AdminStock';
import AdminProducts from './pages/AdminProducts';
import AdminLocations from './pages/AdminLocations';
import AdminUCID from './pages/AdminUCID';
import UCIDPrint from './pages/UCIDPrint';
import { Shield, AlertTriangle } from 'lucide-react';

function AppContent() {
  const { user, profile, loading } = useAuth();
  const [view, setView] = useState<string>(() => {
    // Default view per role is set after profile loads
    return 'dashboard';
  });

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

  // Block ALL company views if the company is not yet approved by admin
  const isCompanyApproved = profile.role !== 'company' || profile.company_is_approved === true;

  function renderPage() {
    // Company users without approval see a pending screen everywhere
    if (profile.role === 'company' && !profile.company_is_approved) {
      return <PendingApproval />;
    }

    switch (activeView) {
      // Student views
      case 'dashboard': return <StudentDashboard onNavigate={setView} />;
      case 'scanner': return <ScannerPage />;
      case 'ranking': return <RankingPage />;
      case 'map': return <MapPage />;
      case 'points': return <PointsPage />;

      // Company views
      case 'company-dashboard': return <CompanyDashboard />;
      case 'traceability': return <TraceabilityPage />;
      case 'analytics': return <CompanyDashboard />;
      case 'admin-ucid': return <AdminUCID />;
      case 'company-ucid': return <AdminUCID />;
      case 'ucid-print': return <UCIDPrint />;

      // Admin views
      case 'admin-dashboard': return <AdminDashboard />;
      case 'admin-companies': return <AdminCompanies />;
      case 'admin-users': return <AdminUsers />;
      case 'admin-stock': return <AdminStock />;
      case 'admin-products': return <AdminProducts />;
      case 'admin-locations': return <AdminLocations />;
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

function PendingApproval() {
  return (
    <div className="p-6 max-w-2xl mx-auto h-full flex items-center">
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-8 text-center w-full">
        <div className="w-16 h-16 rounded-2xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center mx-auto mb-4">
          <Shield className="w-8 h-8 text-amber-400" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2">Empresa pendiente de aprobacion</h2>
        <p className="text-slate-400 text-sm mb-4">
          Tu empresa esta registrada pero aun no ha sido aprobada por el administrador.
        </p>
        <div className="bg-slate-900/60 rounded-xl p-4 text-left">
          <h3 className="text-amber-300 text-sm font-medium mb-2">Que significa esto?</h3>
          <ul className="space-y-2 text-slate-400 text-xs">
            <li className="flex items-start gap-2">
              <AlertTriangle className="w-3 h-3 text-amber-400 mt-0.5 shrink-0" />
              <span>No puedes ver el dashboard de trazabilidad hasta ser aprobado</span>
            </li>
            <li className="flex items-start gap-2">
              <AlertTriangle className="w-3 h-3 text-amber-400 mt-0.5 shrink-0" />
              <span>No puedes generar ni imprimir UCIDs</span>
            </li>
            <li className="flex items-start gap-2">
              <AlertTriangle className="w-3 h-3 text-amber-400 mt-0.5 shrink-0" />
              <span>Contacta al administrador para activar tu acceso</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
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
