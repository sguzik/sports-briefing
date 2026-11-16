import React, { useEffect, useState } from 'react';
import { Check, Copy, Download, FileCode2, FolderGit2, Printer } from 'lucide-react';
import type { RepoFileEntry } from '../types';

export const DeployMacView: React.FC = () => {
  const [files, setFiles] = useState<RepoFileEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>('.github/workflows/daily_brief.yml');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/repo/files')
      .then((r) => r.json())
      .then((data) => {
        const list: RepoFileEntry[] = data.files || [];
        setFiles(list);
        if (list.length > 0 && !list.some((f) => f.path === selectedPath)) {
          setSelectedPath(list[0].path);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const activeFile = files.find((f) => f.path === selectedPath) || files[0];

  const handleCopy = async () => {
    if (!activeFile) return;
    await navigator.clipboard.writeText(activeFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#DDD6C8] pb-4">
        <div>
          <h2 className="font-display text-2xl font-bold text-[#1A1816]">
            GitHub Actions + Headless Mac Mini Pipeline
          </h2>
          <p className="mt-1 text-sm text-[#5C574F]">
            Complete split-architecture repository ready to push to GitHub and schedule on your Mac Mini.
          </p>
        </div>

        <a
          href="/api/repo/download-zip"
          download="morning-sports-brief.zip"
          className="inline-flex items-center gap-2 rounded-md bg-[#1E3A8A] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#172D6E] whitespace-nowrap shrink-0"
        >
          <Download className="h-4 w-4" />
          Download Repository (.zip)
        </a>
      </div>

      {/* 3-Step Architecture Overview */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <div className="rounded-md border border-[#DDD6C8] bg-white p-5">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#5C574F]">
            <FolderGit2 className="h-4 w-4 text-[#1E3A8A]" />
            <span>01. Cloud Cron (5:05 AM ET)</span>
          </div>
          <h3 className="text-base font-semibold text-[#1A1816]">
            GitHub Actions + Python 3.11
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-[#4A453E]">
            Runs <code className="font-tabular text-xs">build_brief.py</code> daily at{' '}
            <code className="font-tabular text-xs">5 9 * * *</code> /{' '}
            <code className="font-tabular text-xs">5 10 * * *</code> UTC (5:05 AM ET year-round), fetches ESPN scores &amp; RSS highlights, summarizes at 1st–2nd grade level, and persists <code className="font-tabular text-xs">state.json</code>.
          </p>
        </div>

        <div className="rounded-md border border-[#DDD6C8] bg-white p-5">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#5C574F]">
            <FileCode2 className="h-4 w-4 text-[#1E3A8A]" />
            <span>02. Static Artifact</span>
          </div>
          <h3 className="text-base font-semibold text-[#1A1816]">
            Self-Contained latest.html
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-[#4A453E]">
            Inlines all print CSS via <code className="font-tabular text-xs">premailer</code>, embeds{' '}
            <code className="font-tabular text-xs">&lt;meta name=&quot;edition-date&quot;&gt;</code>, and deploys automatically to GitHub Pages.
          </p>
        </div>

        <div className="rounded-md border border-[#DDD6C8] bg-white p-5">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#5C574F]">
            <Printer className="h-4 w-4 text-[#1E3A8A]" />
            <span>03. Local Print (5:25 AM)</span>
          </div>
          <h3 className="text-base font-semibold text-[#1A1816]">
            Headless Mac Mini + CUPS
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-[#4A453E]">
            A <code className="font-tabular text-xs">launchd</code> job runs{' '}
            <code className="font-tabular text-xs">print_brief.sh</code>: curls{' '}
            <code className="font-tabular text-xs">latest.html</code>, checks duplicate-print guard, converts to US Letter PDF via headless Chrome, and prints with <code className="font-tabular text-xs">lp</code>.
          </p>
        </div>
      </div>

      {/* Repository File Explorer */}
      <div className="grid grid-cols-1 overflow-hidden rounded-md border border-[#DDD6C8] bg-white lg:grid-cols-12">
        <aside className="border-b border-[#DDD6C8] bg-[#FAF8F4] p-3 lg:col-span-4 lg:border-b-0 lg:border-r">
          <div className="px-2 pb-2 text-xs font-semibold uppercase tracking-wider text-[#5C574F]">
            morning-sports-brief/ ({files.length} files)
          </div>
          {loading ? (
            <div className="px-2 py-4 text-xs text-[#5C574F]">Loading files...</div>
          ) : (
            <div className="space-y-0.5">
              {files.map((file) => {
                const active = file.path === selectedPath;
                return (
                  <button
                    key={file.path}
                    type="button"
                    onClick={() => setSelectedPath(file.path)}
                    className={`block w-full truncate rounded px-2.5 py-1.5 text-left font-tabular text-xs transition-colors ${
                      active
                        ? 'bg-[#1E3A8A] font-semibold text-white'
                        : 'text-[#3F3B35] hover:bg-[#ECE7DD]'
                    }`}
                  >
                    {file.path}
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        <div className="flex flex-col lg:col-span-8">
          <div className="flex items-center justify-between border-b border-[#DDD6C8] bg-[#FAF8F4] px-4 py-2.5">
            <span className="font-tabular text-xs font-semibold text-[#1A1816]">
              {activeFile?.path || ''}
            </span>
            <button
              type="button"
              onClick={handleCopy}
              disabled={!activeFile}
              className="inline-flex items-center gap-1.5 rounded border border-[#CFC7B8] bg-white px-2.5 py-1 text-xs font-medium text-[#1A1816] hover:bg-[#F3EFE7] whitespace-nowrap shrink-0"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-[#14532D]" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy File'}
            </button>
          </div>
          <pre className="max-h-[540px] flex-1 overflow-auto bg-[#1F1D1A] p-4 font-tabular text-xs leading-relaxed text-[#EFECE4]">
            {activeFile?.content || ''}
          </pre>
        </div>
      </div>
    </div>
  );
};
