import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppToken } from '../hooks/useAppToken';
import { api, subscribeToPush, unsubscribeFromPush } from '../api';
import { GraveyardStats } from '../types';

type ExcavatePhase = 'idle' | 'confirming' | 'excavating' | 'done';

export function Graveyard() {
  const [stats, setStats]           = useState<GraveyardStats | null>(null);
  const [loading, setLoading]       = useState(true);
  const [notifEnabled, setNotifEnabled] = useState(false);
  const [notifLoading, setNotifLoading] = useState(false);
  const [excavatePhase, setExcavatePhase] = useState<ExcavatePhase>('idle');
  const [excavateInput, setExcavateInput] = useState('');
  const navigate                    = useNavigate();
  const { getToken }                = useAppToken();

  useEffect(() => {
    void loadStats();
    void checkNotifStatus();
  }, []);

  async function loadStats() {
    setLoading(true);
    try {
      const token  = await getToken();
      const result = await api.graveyardStats(token!);
      setStats(result);
    } catch {
      // non-fatal
    } finally {
      setLoading(false);
    }
  }

  async function checkNotifStatus() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    const reg = await navigator.serviceWorker.getRegistration().catch(() => null);
    if (!reg) return;
    const sub = await reg.pushManager.getSubscription().catch(() => null);
    setNotifEnabled(!!sub);
  }

  const toggleNotifications = useCallback(async () => {
    setNotifLoading(true);
    try {
      const token = await getToken();
      if (notifEnabled) {
        await unsubscribeFromPush(token!);
        setNotifEnabled(false);
      } else {
        const granted = await Notification.requestPermission();
        if (granted !== 'granted') return;
        const ok = await subscribeToPush(token!);
        setNotifEnabled(ok);
      }
    } catch {
      // ignore
    } finally {
      setNotifLoading(false);
    }
  }, [notifEnabled, getToken]);

  const handleExcavate = useCallback(async () => {
    if (excavateInput !== 'EXCAVATE') return;
    setExcavatePhase('excavating');
    try {
      const token = await getToken();
      await api.excavate(token!);
      setExcavatePhase('done');
      void loadStats();
    } catch {
      setExcavatePhase('confirming');
    }
  }, [excavateInput, getToken]);

  return (
    <div className="min-h-screen bg-[#0a0a0a] px-6 py-12 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-12">
        <button
          onClick={() => navigate('/')}
          className="text-[#3a3a3a] hover:text-[#666] text-xs tracking-widest uppercase transition-colors"
        >
          ← back
        </button>
        <span className="text-[#1f1f1f] text-xs tracking-widest uppercase">graveyard</span>
      </div>

      <div className="flex-1 max-w-md mx-auto w-full flex flex-col gap-12">

        {/* Stats */}
        {loading ? (
          <div className="text-[#3a3a3a] text-sm tracking-widest animate-pulse">reading the depths…</div>
        ) : stats ? (
          <StatsPanel stats={stats} />
        ) : null}

        {/* Notifications toggle */}
        <section className="flex flex-col gap-4">
          <SectionLabel>Resurface notifications</SectionLabel>
          <div className="flex items-center justify-between">
            <span className="text-[#666] text-sm">
              {notifEnabled ? 'Enabled' : 'Disabled'}
            </span>
            <button
              onClick={() => void toggleNotifications()}
              disabled={notifLoading}
              className={[
                'relative w-10 h-6 rounded-full transition-colors duration-200 focus:outline-none',
                notifEnabled ? 'bg-[#e8e8e8]' : 'bg-[#1f1f1f]',
                notifLoading ? 'opacity-40' : '',
              ].join(' ')}
              aria-label="Toggle notifications"
            >
              <span className={[
                'absolute top-1 w-4 h-4 rounded-full bg-[#0a0a0a] transition-transform duration-200',
                notifEnabled ? 'translate-x-5' : 'translate-x-1',
              ].join(' ')} />
            </button>
          </div>
          <p className="text-[#3a3a3a] text-xs leading-relaxed">
            Max 3 per day. Quiet hours respected. Your timezone is detected automatically.
          </p>
        </section>

        {/* Danger zone */}
        <section className="flex flex-col gap-4 border-t border-[#1f1f1f] pt-8">
          <SectionLabel danger>Danger zone</SectionLabel>

          {excavatePhase === 'done' ? (
            <p className="text-[#666] text-sm">
              Excavation underway. Everything surfaces over the next 30 days.
            </p>
          ) : excavatePhase === 'confirming' || excavatePhase === 'excavating' ? (
            <div className="flex flex-col gap-3">
              <p className="text-[#666] text-xs leading-relaxed">
                This will schedule all buried entries to resurface over the next 30 days.
                Type <span className="text-[#e8e8e8] font-mono">EXCAVATE</span> to confirm.
              </p>
              <input
                type="text"
                value={excavateInput}
                onChange={e => setExcavateInput(e.target.value)}
                placeholder="EXCAVATE"
                className="bg-transparent border border-[#1f1f1f] text-[#e8e8e8] text-sm px-3 py-2 font-mono tracking-widest focus:border-[#3a3a3a] transition-colors"
                autoFocus
              />
              <div className="flex gap-3">
                <button
                  onClick={handleExcavate}
                  disabled={excavateInput !== 'EXCAVATE' || excavatePhase === 'excavating'}
                  className={[
                    'flex-1 py-2 text-xs tracking-widest uppercase border transition-all',
                    excavateInput === 'EXCAVATE' && excavatePhase !== 'excavating'
                      ? 'border-red-900 text-red-700 hover:bg-red-900/20'
                      : 'border-[#1f1f1f] text-[#3a3a3a] cursor-not-allowed',
                  ].join(' ')}
                >
                  {excavatePhase === 'excavating' ? 'Excavating…' : 'Confirm'}
                </button>
                <button
                  onClick={() => { setExcavatePhase('idle'); setExcavateInput(''); }}
                  className="px-4 py-2 text-xs tracking-widest uppercase text-[#3a3a3a] hover:text-[#666] transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setExcavatePhase('confirming')}
              className="self-start text-xs tracking-widest uppercase text-red-900 hover:text-red-700 transition-colors border border-red-900/30 hover:border-red-700/50 px-4 py-2"
            >
              Excavate everything
            </button>
          )}
        </section>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatsPanel({ stats }: { stats: GraveyardStats }) {
  return (
    <div className="flex flex-col gap-8">
      <Stat label="Total buried" value={String(stats.total_buried)} />

      {stats.deepest_entry && (
        <div className="flex flex-col gap-1">
          <span className="text-[#3a3a3a] text-xs tracking-widest uppercase">Deepest entry</span>
          <p className="text-[#666] text-sm font-light">
            "{stats.deepest_entry.first_words}…"
          </p>
          <p className="text-[#3a3a3a] text-xs">
            {stats.deepest_entry.age_days} day{stats.deepest_entry.age_days === 1 ? '' : 's'} old
            · {(stats.deepest_entry.burial_depth * 100).toFixed(0)}% buried
          </p>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <span className="text-[#3a3a3a] text-xs tracking-widest uppercase">Average depth</span>
        <p className="text-[#e8e8e8] text-lg font-light">
          Your average thought is buried{' '}
          <span className="text-[#666]">{stats.average_depth_meters.toLocaleString()} meters</span>{' '}
          deep.
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[#3a3a3a] text-xs tracking-widest uppercase">{label}</span>
      <span className="text-[#e8e8e8] text-3xl font-light tabular-nums">{value}</span>
    </div>
  );
}

function SectionLabel({ children, danger }: { children: React.ReactNode; danger?: boolean }) {
  return (
    <span className={`text-xs tracking-widest uppercase ${danger ? 'text-red-900' : 'text-[#3a3a3a]'}`}>
      {children}
    </span>
  );
}
