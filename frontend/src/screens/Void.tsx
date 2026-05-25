import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppToken } from '../hooks/useAppToken';
import { api } from '../api';
import { SourceType } from '../types';

type Phase = 'idle' | 'submitting' | 'buried';

export function Void() {
  const [content, setContent]       = useState('');
  const [phase, setPhase]           = useState<Phase>('idle');
  const [buriedDate, setBuriedDate] = useState<string | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const textareaRef                 = useRef<HTMLTextAreaElement>(null);
  const navigate                    = useNavigate();
  const { getToken }                = useAppToken();

  const submit = useCallback(async () => {
    const trimmed = content.trim();
    if (!trimmed || phase === 'submitting') return;

    const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
    if (wordCount < 10) {
      setError('At least 10 words needed.');
      return;
    }

    setError(null);
    setPhase('submitting');

    try {
      const token  = await getToken();
      const result = await api.ingest(trimmed, 'NOTE' as SourceType, token!);

      const date = new Date(result.estimated_first_surface);
      const fmt  = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      setBuriedDate(fmt);
      setContent('');
      setPhase('buried');
    } catch (err) {
      setError((err as Error).message ?? 'Something went wrong.');
      setPhase('idle');
    }
  }, [content, phase, getToken]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  };

  const reset = () => {
    setPhase('idle');
    setBuriedDate(null);
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center px-6 relative">

      {/* Graveyard icon */}
      <button
        onClick={() => navigate('/graveyard')}
        className="absolute top-6 right-6 text-[#3a3a3a] hover:text-[#666] transition-colors text-lg select-none"
        title="Graveyard"
        aria-label="Open graveyard"
      >
        ◉
      </button>

      {/* Surface check link */}
      <button
        onClick={() => navigate('/surface')}
        className="absolute top-6 left-6 text-[#3a3a3a] hover:text-[#666] transition-colors text-xs tracking-widest uppercase select-none"
        aria-label="Check surface"
      >
        surface
      </button>

      <div className="w-full max-w-xl">
        {phase === 'buried' ? (
          <BuriedConfirmation date={buriedDate!} onReset={reset} />
        ) : (
          <InputArea
            content={content}
            setContent={setContent}
            onSubmit={submit}
            onKeyDown={handleKey}
            submitting={phase === 'submitting'}
            error={error}
            textareaRef={textareaRef}
          />
        )}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface InputAreaProps {
  content: string;
  setContent: (v: string) => void;
  onSubmit: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  submitting: boolean;
  error: string | null;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
}

function InputArea({ content, setContent, onSubmit, onKeyDown, submitting, error, textareaRef }: InputAreaProps) {
  return (
    <div className="flex flex-col gap-6">
      <textarea
        ref={textareaRef}
        value={content}
        onChange={e => setContent(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Drop something here. We'll decide when you see it again."
        disabled={submitting}
        autoFocus
        rows={6}
        className={[
          'w-full bg-transparent resize-none',
          'text-[#e8e8e8] text-xl leading-relaxed font-light',
          'placeholder:text-[#3a3a3a]',
          'border-0 border-b border-[#1f1f1f]',
          'pb-4 transition-colors',
          'focus:border-[#3a3a3a]',
          submitting ? 'opacity-40 cursor-not-allowed' : '',
        ].join(' ')}
        aria-label="Entry input"
      />

      {error && (
        <p className="text-xs text-red-700 tracking-wide">{error}</p>
      )}

      <div className="flex items-center justify-between">
        <span className="text-[#3a3a3a] text-xs tracking-widest">
          {content.trim().split(/\s+/).filter(Boolean).length} words
        </span>

        <button
          onClick={onSubmit}
          disabled={submitting || content.trim().length === 0}
          className={[
            'text-xs tracking-widest uppercase',
            'px-4 py-2 border border-[#1f1f1f]',
            'transition-all duration-200',
            submitting || content.trim().length === 0
              ? 'text-[#3a3a3a] cursor-not-allowed'
              : 'text-[#666] hover:text-[#e8e8e8] hover:border-[#3a3a3a] cursor-pointer',
          ].join(' ')}
        >
          {submitting ? 'Burying…' : 'Bury'}
        </button>
      </div>

      <p className="text-[#3a3a3a] text-xs text-center tracking-wide">
        ⌘↵ to bury
      </p>
    </div>
  );
}

function BuriedConfirmation({ date, onReset }: { date: string; onReset: () => void }) {
  return (
    <div className="flex flex-col items-center gap-8 text-center animate-[fadeIn_0.6s_ease]">
      <p className="text-[#666] text-2xl font-light leading-relaxed">
        Buried.
      </p>
      <p className="text-[#3a3a3a] text-sm leading-relaxed">
        You'll see it again when the time is right.
      </p>
      <p className="text-[#1f1f1f] text-xs tracking-widest uppercase">
        Estimated resurfacing — {date}
      </p>
      <button
        onClick={onReset}
        className="text-[#3a3a3a] hover:text-[#666] text-xs tracking-widest uppercase transition-colors mt-4"
      >
        Bury something else
      </button>
    </div>
  );
}
