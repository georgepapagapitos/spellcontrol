import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { CollectionPage } from './pages/CollectionPage';
import { BinderPage } from './pages/BinderPage';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/collection" replace />} />
        <Route path="/collection" element={<CollectionPage />} />
        <Route path="/binder" element={<BinderPage />} />
        <Route path="*" element={<Navigate to="/collection" replace />} />
      </Route>
    </Routes>
  );
}
