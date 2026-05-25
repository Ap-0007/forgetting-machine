import React from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider } from '@clerk/clerk-react';
import App from './App';
import './index.css';

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string;
const isDevMode = !publishableKey || publishableKey.startsWith('pk_test_placeholder');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isDevMode ? (
      // Dev mode: skip Clerk entirely — API uses DEV_USER_ID bypass
      <App devMode />
    ) : (
      <ClerkProvider publishableKey={publishableKey}>
        <App />
      </ClerkProvider>
    )}
  </React.StrictMode>,
);
