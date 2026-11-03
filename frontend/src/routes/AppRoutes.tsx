import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { AdminRoute } from '@/components/AdminRoute';
import { LoadingBlock } from '@/components/Spinner';
import Home from '@/pages/Home';
import Catalog from '@/pages/Catalog';
import MovieDetails from '@/pages/MovieDetails';
import Watch from '@/pages/Watch';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';
import OAuthSuccess from '@/pages/OAuthSuccess';
import SubscriptionPlans from '@/pages/SubscriptionPlans';
import MockCheckout from '@/pages/MockCheckout';
import Profile from '@/pages/Profile';
import NotFound from '@/pages/NotFound';

const AdminPanel = lazy(() => import('@/pages/AdminPanel'));

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/catalog" element={<Catalog />} />
      <Route path="/movie/:id" element={<MovieDetails />} />
      <Route path="/watch/:id" element={<Watch />} />

      {/* auth */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/auth/oauth-success" element={<OAuthSuccess />} />

      {/* subscriptions */}
      <Route
        path="/plans"
        element={
          <ProtectedRoute>
            <SubscriptionPlans />
          </ProtectedRoute>
        }
      />
      <Route
        path="/mock-checkout/:sessionId"
        element={
          <ProtectedRoute>
            <MockCheckout />
          </ProtectedRoute>
        }
      />

      {/* user */}
      <Route
        path="/profile"
        element={
          <ProtectedRoute>
            <Profile />
          </ProtectedRoute>
        }
      />

      {/* admin */}
      <Route
        path="/admin"
        element={
          <AdminRoute>
            <Suspense fallback={<LoadingBlock />}>
              <AdminPanel />
            </Suspense>
          </AdminRoute>
        }
      />

      <Route path="/404" element={<NotFound />} />
      <Route path="*" element={<Navigate to="/404" replace />} />
    </Routes>
  );
}
