import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './hooks/useAuth.jsx';
import ProtectedRoute from './components/auth/ProtectedRoute.jsx';
import DashboardLayout from './components/layout/DashboardLayout.jsx';

import LandingPage from './pages/LandingPage.jsx';
import LoginPage from './pages/auth/LoginPage.jsx';
import RegisterPage from './pages/auth/RegisterPage.jsx';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage.jsx';

import DashboardPage from './pages/dashboard/DashboardPage.jsx';
import ProductsPage from './pages/dashboard/ProductsPage.jsx';
import ProductDetailPage from './pages/dashboard/ProductDetailPage.jsx';
import UploadPage from './pages/dashboard/UploadPage.jsx';
import ExpiringPage from './pages/dashboard/ExpiringPage.jsx';
import RiskPage from './pages/dashboard/RiskPage.jsx';
import FraudPage from './pages/dashboard/FraudPage.jsx';
import AgentPage from './pages/dashboard/AgentPage.jsx';
import SettingsPage from './pages/dashboard/SettingsPage.jsx';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Public */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />

        {/* Protected */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="products" element={<ProductsPage />} />
          <Route path="products/:id" element={<ProductDetailPage />} />
          <Route path="upload" element={<UploadPage />} />
          <Route path="expiring" element={<ExpiringPage />} />
          <Route path="risk" element={<RiskPage />} />
          <Route path="fraud" element={<FraudPage />} />
          <Route path="agent" element={<AgentPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<LandingPage />} />
      </Routes>
    </AuthProvider>
  );
}
