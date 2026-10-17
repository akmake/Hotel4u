// Development-only entry. The production build has no reference to this file.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { useAuthStore } from '../src/stores/authStore';
import { PropertyProvider } from '../src/context/PropertyContext';
import AccountingPage from '../src/pages/fin/AccountingPage';
import '../src/index.css';
import '../src/components/kit/kit.css';

fetch('/api/pms/qa/bootstrap').then((res) => { if (!res.ok) throw new Error('QA server unavailable'); return res.json(); }).then(({ actor }) => {
  useAuthStore.setState({ user: actor, isAuthenticated: true });
  createRoot(document.getElementById('root')).render(<BrowserRouter><PropertyProvider><div className="p-4 w-full min-w-0" dir="rtl"><p role="note" className="ui-banner">סביבת בדיקה מבודדת — נתונים זמניים בלבד</p><AccountingPage /></div></PropertyProvider></BrowserRouter>);
}).catch(() => { document.getElementById('root').textContent = 'יש להפעיל את שרת בדיקות הנהלת החשבונות.'; });
