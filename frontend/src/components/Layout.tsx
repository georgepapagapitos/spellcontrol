import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { useCollectionStore } from '../store/collection';
import { Header } from './Header';
import { Footer } from './Footer';
import { BinderEditor } from './BinderEditor';
import { ToastViewport } from './ToastViewport';

export function Layout() {
  const hydrateCards = useCollectionStore((s) => s.hydrateCards);

  useEffect(() => {
    hydrateCards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <Header />
      <div className="container">
        <Outlet />
        <BinderEditor />
        <Footer />
      </div>
      <ToastViewport />
    </>
  );
}
