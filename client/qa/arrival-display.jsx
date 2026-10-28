// Real page + property provider on the disposable, read-only UI QA server.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { PropertyProvider } from '../src/context/PropertyContext';
import { useAuthStore } from '../src/stores/authStore';
import ArrivalsPage from '../src/pages/ArrivalsPage';
import '../src/index.css';
import '../src/components/kit/kit.css';
const boot = await fetch('/__qa/bootstrap').then((r) => r.json());
localStorage.setItem('hotel4u_token', boot.token);
useAuthStore.setState({ isAuthenticated: true, user: boot.user });
createRoot(document.getElementById('root')).render(<React.StrictMode><BrowserRouter><PropertyProvider><main style={{ width: '100%', minWidth: 0, padding: 16 }}><header className="ui-page" style={{ marginBottom: 16 }}><h1>בדיקת דף ההגעות — נתוני דמה בלבד</h1></header><ArrivalsPage /></main></PropertyProvider></BrowserRouter></React.StrictMode>);
