import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppToken } from '../hooks/useAppToken';
import { api } from '../api';
import { SurfaceNextResponse, UserReaction } from '../types';

const TRIGGER_LABELS: Record<SurfaceNextResponse['trigger_reason'], string> = {
  SCHEDULED:        'Something you wrote {N} days ago',
  CONTEXT_MATCH:    'This connects to what you\'re thinking about',
  CONFLICT_DETECTED: 'You used to believe something different',
  RANDOM_DEEP_PULL: 'Pulled from the deep',
};

type Phase = 'loading' | 'ready' | 'reacting' | 'done' | 'empty' | 'error';

export function SurfaceCard() {
  const [data, setData]         = useState<SurfaceNextResponse | null>(null);
  const [phase, setPhase]       = useState<Phase>('loading');
  const [errMsg, setErrMsg]     = useState('');
  const [expansion, setExpansion] = useState<{ full_content?: string } | null>(null);
  const surfacedAt              = useRef(Date.now());
  const navigate                = useNavigate();
  const { getToken }            = useAppToken();

  // Touch/swipe state
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const [swipeDx, setSwipeDx]   = useState(0);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setPhase('loading');
    try {
      const token = await getToken();
      const result = await api.nextSurface(token!);
      setData(result);
      surfacedAt.current = Date.now();
      setPhase('ready');
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'NO_SURFACE_AVAILABLE') {
        setPhase('empty');
      } else {
        setErrMsg((err as Error).message ?? 'Failed to load');
        setPhase('error');
      }
    }
  }

  const react = useCallback(async (reaction: UserReaction) => {
    if (!data || phase !== 'ready') return;
    setPhase('reacting');

    const elapsed = Date.now() - surfacedAt.current;
    try {
      const token  = await getToken();
      const result = await api.react(data.surface_event_id, reaction, elapsed, token!);

      if (reaction === 'expanded' && result.full_content) {
        setExpansion({ full_content: result.full_content });
        setPhase('ready');
      } else {
        setPhase('done');
        setTimeout(() => navigate('/'), 1200);
      }
    } catch (err) {
      setErrMsg((err as Error).message ?? 'Reaction failed');
      setPhase('ready');
    }
  }, [data, phase, getToken, navigate]);

  // Swipe handlers
  const onTouchStart = (e: React.TouchEvent) => {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!touchStart.current) return;
    const dx = e.touches[0].clientX - touchStart.current.x;
    const dy = Math.abs(e.touches[0].clientY - touchStart.current.y);
    if (Math.abs(dx) > dy) setSwipeDx(dx);
  };

  const onTouchEnd = () => {
    if (Math.abs(swipeDx) > 80) {
      void react(swipeDx > 0 ? 'saved' : 'ignored');
    }
    setSwipeDx(0);
    touchStart.current = null;
  };

  // ── Render states ──────────────────────────────────────────────────────────

  if (phase === 'loading') {
    return (
      <Screen>
        <div className="text-[#3a3a3a] text-sm tracking-widest animate-pulse">retrieving…</div>
      </Screen>
    );
  }

  if (phase === 'empty') {
    return (
      <Screen>
        <div className="flex flex-col items-center gap-6 text-center">
          <p className="text-[#3a3a3a] text-lg font-light">Nothing ready to surface.</p>
          <p className="text-[#1f1f1f] text-xs tracking-widest">The right moment hasn't arrived yet.</p>
          <button onClick={() => navigate('/')} className="text-[#3a3a3a] hover:text-[#666] text-xs tracking-widest uppercase transition-colors mt-4">
            Back to the void
          </button>
        </div>
      </Screen>
    );
  }

  if (phase === 'error') {
    return (
      <Screen>
        <div className="flex flex-col items-center gap-4 text-center">
          <p className="text-red-800 text-sm">{errMsg}</p>
          <button onClick={() => void load()} className="text-[#666] text-xs tracking-widest uppercase">Retry</button>
        </div>
      </Screen>
    );
  }

  if (phase === 'done') {
    return (
      <Screen>
        <p className="text-[#3a3a3a] text-sm tracking-widest animate-[fadeIn_0.4s_ease]">Noted.</p>
      </Screen>
    );
  }

  if (!data) return null;

  const days  = data.entry.days_since_written;
  const label = TRIGGER_LABELS[data.trigger_reason].replace('{N}', String(days));

  const cardStyle: React.CSSProperties = {
    transform: `translateX(${swipeDx}px) rotate(${swipeDx * 0.02}deg)`,
    opacity: 1 - Math.abs(swipeDx) / 300,
    transition: swipeDx === 0 ? 'transform 0.3s ease, opacity 0.3s ease' : 'none',
  };

  return (
    <Screen>
      <div
        style={cardStyle}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        className="w-full max-w-xl flex flex-col gap-8 select-none"
      >
        {/* Header label */}
        <div className="flex flex-col gap-1">
          <span className={[
            'text-xs tracking-widest uppercase',
            data.trigger_reason === 'CONFLICT_DETECTED' ? 'text-amber-600' : 'text-[#3a3a3a]',
          ].join(' ')}>
            {label}
          </span>
          {data.trigger_reason === 'SCHEDULED' && (
            <span className="text-[#1f1f1f] text-xs">{days} day{days === 1 ? '' : 's'} in the ground</span>
          )}
        </div>

        {/* Main content */}
        <p className="text-[#e8e8e8] text-xl font-light leading-relaxed">
          {expansion?.full_content ?? data.entry.content}
        </p>

        {/* Conflicting entry */}
        {data.trigger_reason === 'CONFLICT_DETECTED' && data.conflicting_entry && (
          <div className="border-t border-[#1f1f1f] pt-6">
            <span className="text-amber-700 text-xs tracking-widest uppercase block mb-3">
              You once thought:
            </span>
            <p className="text-[#666] text-base font-light leading-relaxed italic">
              {data.conflicting_entry.content}
            </p>
          </div>
        )}

        {/* Swipe hint */}
        {swipeDx === 0 && (
          <div className="flex justify-between text-[#1f1f1f] text-xs tracking-widest">
            <span>← ignore</span>
            <span>save →</span>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-3 pt-2">
          <ActionButton
            label="Dismiss"
            onClick={() => void react('dismissed')}
            disabled={phase === 'reacting'}
            variant="neutral"
          />
          <ActionButton
            label="Save"
            onClick={() => void react('saved')}
            disabled={phase === 'reacting'}
            variant="neutral"
          />
          <ActionButton
            label="Go Deeper"
            onClick={() => void react('expanded')}
            disabled={phase === 'reacting'}
            variant="accent"
          />
        </div>
      </div>
    </Screen>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-6">
      {children}
    </div>
  );
}

interface ActionButtonProps {
  label: string;
  onClick: () => void;
  disabled: boolean;
  variant: 'neutral' | 'accent';
}

function ActionButton({ label, onClick, disabled, variant }: ActionButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={[
        'flex-1 py-3 text-xs tracking-widest uppercase border transition-all duration-150',
        disabled ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer',
        variant === 'accent'
          ? 'border-[#e8e8e8] text-[#e8e8e8] hover:bg-[#e8e8e8] hover:text-[#0a0a0a]'
          : 'border-[#1f1f1f] text-[#666] hover:border-[#3a3a3a] hover:text-[#e8e8e8]',
      ].join(' ')}
    >
      {label}
    </button>
  );
}
