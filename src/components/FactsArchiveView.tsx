import React, { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { BriefState, SportsFact } from '../types';

interface FactsArchiveViewProps {
  onPreviewFact: (factId: string) => void;
}

export const FactsArchiveView: React.FC<FactsArchiveViewProps> = ({ onPreviewFact }) => {
  const [facts, setFacts] = useState<SportsFact[]>([]);
  const [state, setState] = useState<BriefState | null>(null);
  const [category, setCategory] = useState<string>('All');
  const [loading, setLoading] = useState(true);

  const loadData = () => {
    setLoading(true);
    fetch('/api/facts')
      .then((r) => r.json())
      .then((data) => {
        setFacts(data.facts || []);
        setState(data.state || null);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleReset = async () => {
    const res = await fetch('/api/facts/reset', { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      setState(data.state);
    }
  };

  const categories = ['All', ...Array.from(new Set(facts.map((f) => f.category)))];
  const usedSet = new Set(state?.used_fact_ids || []);
  const filtered = category === 'All' ? facts : facts.filter((f) => f.category === category);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#DDD6C8] pb-4">
        <div>
          <h2 className="font-display text-2xl font-bold text-[#1A1816]">
            Sports Fact of the Day Archive
          </h2>
          <p className="mt-1 text-sm text-[#5C574F]">
            {facts.length} kid-friendly facts in <code className="font-tabular text-xs">data/facts.json</code> ·{' '}
            {usedSet.size} printed so far in <code className="font-tabular text-xs">data/state.json</code>
          </p>
        </div>

        <button
          type="button"
          onClick={handleReset}
          className="inline-flex items-center gap-1.5 rounded-md border border-[#CFC7B8] bg-white px-3.5 py-2 text-xs font-semibold text-[#1A1816] hover:bg-[#F3EFE7] whitespace-nowrap shrink-0"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset Printed Cycle
        </button>
      </div>

      {/* Category Filter Buttons */}
      <div className="flex flex-wrap items-center gap-1.5">
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setCategory(cat)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              category === cat
                ? 'bg-[#1A1816] text-white'
                : 'bg-[#EFECE4] text-[#4A453E] hover:bg-[#E5E0D5]'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="rounded-md border border-[#DDD6C8] bg-white p-8 text-sm text-[#5C574F]">
          Loading facts archive...
        </div>
      ) : (
        <div className="divide-y divide-[#E4DFD5] rounded-md border border-[#DDD6C8] bg-white">
          {filtered.map((item) => {
            const isUsed = usedSet.has(item.id);
            return (
              <div
                key={item.id}
                className="flex flex-col justify-between gap-3 px-5 py-4 sm:flex-row sm:items-center"
              >
                <div className="max-w-3xl space-y-1">
                  <div className="flex items-center gap-2 text-xs text-[#5C574F]">
                    <span className="font-tabular uppercase">{item.id}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-medium text-[#1A1816]">{item.category}</span>
                    <span aria-hidden="true">·</span>
                    <span>{isUsed ? 'Already Printed' : 'Queued'}</span>
                  </div>
                  <p className="font-editorial text-[15px] leading-relaxed text-[#1A1816]">
                    {item.fact}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => onPreviewFact(item.id)}
                  className="self-start rounded-md border border-[#1E3A8A] px-3 py-1.5 text-xs font-semibold text-[#1E3A8A] transition-colors hover:bg-[#1E3A8A] hover:text-white sm:self-center whitespace-nowrap shrink-0"
                >
                  Feature in Broadsheet
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
