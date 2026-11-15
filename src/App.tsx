import { useCallback, useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import { BroadsheetView } from './components/BroadsheetView';
import { TeamDeskView } from './components/TeamDeskView';
import { FactsArchiveView } from './components/FactsArchiveView';
import { DeployMacView } from './components/DeployMacView';
import type { EditionPayload } from './types';

type ActiveTab = 'broadsheet' | 'teams' | 'facts' | 'deploy';

function getTodayEtIso(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('broadsheet');
  const [selectedDate, setSelectedDate] = useState<string>(() => getTodayEtIso());
  const [storyMode, setStoryMode] = useState<'auto' | 'offline'>('auto');
  const [forcedFactId, setForcedFactId] = useState<string | undefined>(undefined);

  const [edition, setEdition] = useState<EditionPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [regenerating, setRegenerating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEdition = useCallback(
    async (opts?: { date?: string; mode?: 'auto' | 'offline'; factId?: string }) => {
      const targetDate = opts?.date ?? selectedDate;
      const targetMode = opts?.mode ?? storyMode;
      const targetFact = opts?.factId ?? forcedFactId;

      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          date: targetDate,
          mode: targetMode,
        });
        if (targetFact) params.set('factId', targetFact);

        const res = await fetch(`/api/edition?${params.toString()}`);
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody.error || `Request failed (${res.status})`);
        }
        const data: EditionPayload = await res.json();
        setEdition(data);
      } catch (err: any) {
        setError(err?.message || 'Unable to fetch morning edition');
      } finally {
        setLoading(false);
      }
    },
    [selectedDate, storyMode, forcedFactId]
  );

  useEffect(() => {
    fetchEdition();
  }, [fetchEdition]);

  const handleRegenerateStory = async () => {
    if (!edition) return;
    setRegenerating(true);
    try {
      const res = await fetch('/api/edition/regenerate-story', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_game: edition.lead_game,
          mode: storyMode,
        }),
      });
      if (res.ok) {
        const story = await res.json();
        setEdition((prev) => (prev ? { ...prev, top_story: story } : prev));
      }
    } finally {
      setRegenerating(false);
    }
  };

  const handleDownloadHtml = async () => {
    if (!edition) return;
    const res = await fetch('/api/edition/latest-html', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(edition),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'latest.html';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    if (activeTab !== 'broadsheet') {
      setActiveTab('broadsheet');
      setTimeout(() => window.print(), 120);
    } else {
      window.print();
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F4EE] text-[#1A1816]">
      {/* Top Bar Contract: 3 zones separated by gap-8 (hidden on print) */}
      <header className="no-print border-b border-[#DDD6C8] bg-[#FAF8F4]">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-8 px-6 py-4">
          {/* Zone 1: Single-element Brand Wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab('broadsheet')}
            className="font-display text-xl font-bold tracking-tight text-[#1A1816] whitespace-nowrap shrink-0 text-left"
          >
            The Morning Box Score
          </button>

          {/* Zone 2: 4 concise single-line nav links */}
          <nav className="flex items-center gap-6 overflow-x-auto text-sm font-medium">
            {(
              [
                { id: 'broadsheet', label: 'Broadsheet' },
                { id: 'teams', label: 'Team Desk' },
                { id: 'facts', label: 'Facts Archive' },
                { id: 'deploy', label: 'Deploy & Mac' },
              ] as const
            ).map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`border-b-2 pb-0.5 transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'border-[#1E3A8A] font-semibold text-[#1A1816]'
                      : 'border-transparent text-[#5C574F] hover:text-[#1A1816]'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: 1 primary action */}
          <div className="shrink-0">
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-2 rounded-md bg-[#1E3A8A] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#172D6E] whitespace-nowrap shrink-0"
            >
              <Printer className="h-3.5 w-3.5" />
              Print Broadsheet
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="mx-auto max-w-[1200px] px-6 py-8">
        {activeTab === 'broadsheet' && (
          <BroadsheetView
            edition={edition}
            loading={loading}
            regenerating={regenerating}
            error={error}
            selectedDate={selectedDate}
            storyMode={storyMode}
            onDateChange={(d) => {
              setForcedFactId(undefined);
              setSelectedDate(d);
            }}
            onStoryModeChange={(m) => setStoryMode(m)}
            onRefresh={() => {
              setForcedFactId(undefined);
              fetchEdition({ factId: undefined });
            }}
            onRegenerateStory={handleRegenerateStory}
            onDownloadHtml={handleDownloadHtml}
          />
        )}

        {activeTab === 'teams' && (
          <TeamDeskView
            onConfigSaved={() => {
              fetchEdition();
            }}
          />
        )}

        {activeTab === 'facts' && (
          <FactsArchiveView
            onPreviewFact={(factId) => {
              setForcedFactId(factId);
              setActiveTab('broadsheet');
            }}
          />
        )}

        {activeTab === 'deploy' && <DeployMacView />}
      </main>
    </div>
  );
}
