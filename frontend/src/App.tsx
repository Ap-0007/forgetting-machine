import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SignIn, SignedIn, SignedOut } from '@clerk/clerk-react';
import { Void } from './screens/Void';
import { SurfaceCard } from './screens/SurfaceCard';
import { Graveyard } from './screens/Graveyard';

interface AppProps {
  devMode?: boolean;
}

export default function App({ devMode = false }: AppProps) {
  // In dev mode, skip Clerk entirely and render routes directly
  if (devMode) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/"          element={<Void />} />
          <Route path="/surface"   element={<SurfaceCard />} />
          <Route path="/graveyard" element={<Graveyard />} />
          <Route path="*"          element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    );
  }

  return (
    <BrowserRouter>
      <SignedOut>
        <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a]">
          <SignIn
            appearance={{
              elements: {
                rootBox: 'w-full max-w-sm',
                card: 'bg-[#111] border border-[#1f1f1f] shadow-none',
                headerTitle: 'text-[#e8e8e8]',
                headerSubtitle: 'text-[#666]',
                formButtonPrimary: 'bg-[#e8e8e8] text-[#0a0a0a] hover:bg-white',
                formFieldInput: 'bg-[#0a0a0a] border-[#1f1f1f] text-[#e8e8e8]',
                footerActionLink: 'text-[#e8e8e8]',
              },
            }}
          />
        </div>
      </SignedOut>

      <SignedIn>
        <Routes>
          <Route path="/"          element={<Void />} />
          <Route path="/surface"   element={<SurfaceCard />} />
          <Route path="/graveyard" element={<Graveyard />} />
          <Route path="*"          element={<Navigate to="/" replace />} />
        </Routes>
      </SignedIn>
    </BrowserRouter>
  );
}
