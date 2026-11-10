import React, { useState, useEffect } from 'react';
import {
  BookOpen,
  Search,
  FileText,
  Bookmark,
  ShieldAlert,
  Wrench,
  CheckCircle,
  Download,
  FileJson,
  Printer,
} from 'lucide-react';
import { MaintenanceWorkOrder, RAGDocumentChunk, RAGSearchResult } from '../types/index.js';
import { api } from '../services/api.js';
import { createRagHtml, createRagMarkdown, KNOWLEDGE_EXPORT_NOTICE } from '../services/knowledgeExports.js';

interface RAGKnowledgeViewProps {
  orders: MaintenanceWorkOrder[];
  onAttachSop: (orderId: string, sop: { title: string; section: string; snippet: string; sourceStatus?: string; citation?: string; sourceUrl?: string }) => Promise<void>;
  canAttach: boolean;
}

const highlightMatches = (content: string, terms: string[]) => {
  const matches = [...new Set(terms.map((term) => term.trim()).filter(Boolean))]
    .sort((left, right) => right.length - left.length);
  if (!matches.length) return content;
  const expression = new RegExp(`(${matches.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  const parts = content.split(expression);
  return parts.map((part, index) => matches.some((term) => term.toLowerCase() === part.toLowerCase())
    ? <mark key={index} className="rounded bg-amber-300/25 px-0.5 text-amber-100">{part}</mark>
    : part);
};

export const RAGKnowledgeView: React.FC<RAGKnowledgeViewProps> = ({ orders, onAttachSop, canAttach }) => {
  const [searchQuery, setSearchQuery] = useState('IDV(4) cooling water runaway limits');
  const [searchResults, setSearchResults] = useState<RAGSearchResult[]>([]);
  const [documents, setDocuments] = useState<RAGDocumentChunk[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [attachingId, setAttachingId] = useState<string | null>(null);
  const [attachMessage, setAttachMessage] = useState<string | null>(null);
  const pendingOrders = orders.filter((order) => order.status === 'PROPOSED_PENDING_ENGINEER');

  useEffect(() => {
    if (!pendingOrders.some((order) => order.id === selectedOrderId)) {
      setSelectedOrderId(pendingOrders[0]?.id || '');
    }
  }, [orders, selectedOrderId]);

  const attachSop = async (result: RAGSearchResult) => {
    if (!selectedOrderId) return;
    setAttachingId(result.chunk.id);
    setAttachMessage(null);
    try {
      await onAttachSop(selectedOrderId, {
        title: result.chunk.documentTitle,
        section: result.chunk.section,
        snippet: result.chunk.content.slice(0, 1200),
        sourceStatus: result.evidenceStatus,
        citation: result.chunk.source?.citation,
        sourceUrl: result.chunk.source?.url,
      });
      setAttachMessage(`Attached ${result.chunk.documentTitle} to ${selectedOrderId}.`);
    } catch (error) {
      setAttachMessage(error instanceof Error ? error.message : 'Could not attach this entry.');
    } finally {
      setAttachingId(null);
    }
  };

  const downloadFile = (filename: string, content: string, type: string) => {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const downloadDocument = (documentEntry: RAGDocumentChunk) => {
    const content = createRagMarkdown([documentEntry]);
    const filename = `${documentEntry.id.toLowerCase()}-${documentEntry.category}.md`;
    downloadFile(filename, content, 'text/markdown;charset=utf-8');
  };

  const downloadHandbook = (format: 'markdown' | 'json' | 'html') => {
    if (documents.length === 0) return;

    if (format === 'markdown') {
      downloadFile('tep-research-knowledge-pack.md', createRagMarkdown(documents), 'text/markdown;charset=utf-8');
    } else if (format === 'html') {
      downloadFile('tep-research-knowledge-pack.html', createRagHtml(documents), 'text/html;charset=utf-8');
    } else {
      const pack = {
        title: 'Tennessee Eastman Process — Research Knowledge Pack',
        exportedAt: new Date().toISOString(),
        sourceStatus: 'Citations and evidence status are included per entry. Local CSV provenance is not yet confirmed.',
        notice: KNOWLEDGE_EXPORT_NOTICE,
        documents,
      };
      downloadFile('tep-research-knowledge-pack.json', JSON.stringify(pack, null, 2), 'application/json;charset=utf-8');
    }
  };

  const handleSearch = async (queryToRun?: string) => {
    const q = queryToRun !== undefined ? queryToRun : searchQuery;
    if (!q.trim()) return;
    setIsSearching(true);
    try {
      const res = await api.searchRAG(q, 6);
      setSearchResults(res.results || []);
    } catch (err) {
      console.error('Error searching RAG:', err);
    } finally {
      setIsSearching(false);
    }
  };

  useEffect(() => {
    void handleSearch();
    void api.fetchRAGDocuments()
      .then((response) => setDocuments(response.documents))
      .catch((error) => console.error('Error loading RAG documents:', error));
  }, []);

  const sampleQueries = [
    'Process unit relationships',
    'Sensor readings for IDV 14',
    'IDV(14) sticking cooling water valve',
    'IDV 16 unknown fault types',
  ];

  const filteredResults = searchResults.filter((r) => {
    if (selectedCategory === 'all') return true;
    return r.chunk.category === selectedCategory;
  });
  const availableCategories = Array.from(new Set(documents.map((document) => document.category)));

  return (
    <div className="p-4 flex flex-col h-full overflow-y-auto bg-slate-950 text-slate-100 gap-4">
      <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900 px-4 py-3">
        <h2 className="text-base font-bold text-white">Knowledge graph + RAG</h2>
        <span className="text-xs text-slate-400">Reference search - no site SOPs loaded</span>
      </div>

      {/* Search Bar & Categories */}
      <div className="p-4 bg-slate-900 rounded-xl border border-slate-800 flex flex-col gap-3 shadow-lg">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
            <input
              type="text"
              placeholder="Search faults, sensors, or process terms..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-sans"
            />
          </div>

          <button
            onClick={() => handleSearch()}
            disabled={isSearching}
            className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition shadow cursor-pointer"
          >
            <Search className="w-3.5 h-3.5" />
            <span>Search</span>
          </button>
        </div>

        {/* Quick Query Pills */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-slate-400 font-semibold text-[11px] mr-1">Quick searches:</span>
          {sampleQueries.map((sq, idx) => (
            <button
              key={idx}
              onClick={() => {
                setSearchQuery(sq);
                void handleSearch(sq);
              }}
              className="px-2.5 py-1 rounded bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-800 text-[11px] transition cursor-pointer"
            >
              {sq}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs">
        <span className="font-semibold text-slate-300">{canAttach ? 'Attach reference to ticket:' : 'Engineer access required to attach a reference.'}</span>
        <select value={selectedOrderId} onChange={(event) => setSelectedOrderId(event.target.value)} disabled={!canAttach || !pendingOrders.length} className="max-w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-200 disabled:opacity-50">
          {pendingOrders.length ? pendingOrders.map((order) => <option key={order.id} value={order.id}>{order.id} · {order.targetUnit}</option>) : <option value="">No pending ticket</option>}
        </select>
        {attachMessage && <span role="status" className="text-cyan-300">{attachMessage}</span>}
      </div>

      {/* Category Filter */}
      <div className="flex items-center gap-2">
        {['all', ...availableCategories].map((cat) => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={`px-3 py-1 rounded-lg text-xs font-semibold capitalize transition cursor-pointer ${
              selectedCategory === cat
                ? 'bg-slate-800 text-cyan-400 border border-slate-700 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 border border-transparent'
            }`}
          >
            {cat.replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Search Results Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1">
        {filteredResults.map((res) => {
          const chunk = res.chunk;
          return (
            <div
              key={chunk.id}
              className="p-4 rounded-xl border bg-slate-900 border-slate-800 flex flex-col justify-between hover:border-slate-700 transition shadow-md"
            >
              <div>
                {/* Header */}
                <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-slate-800/80">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-950 text-cyan-400 border border-slate-800">
                      {chunk.id}
                    </span>
                    <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-slate-950 text-slate-400 border border-slate-800">
                      {chunk.category.replace('_', ' ')}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 font-mono text-xs text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800">
                    <span>Match score:</span>
                    <strong>{res.score.toFixed(2)}</strong>
                  </div>
                </div>

                {/* Title & Section */}
                <h3 className="text-sm font-bold text-white mb-0.5">{chunk.documentTitle}</h3>
                <div className="text-xs font-mono text-cyan-400/90 mb-2">{chunk.section}</div>
                <div className={`mb-2 text-[10px] font-bold uppercase ${res.evidenceStatus === 'PRIMARY_SOURCE' ? 'text-emerald-300' : res.evidenceStatus === 'METADATA_VERIFIED' ? 'text-amber-300' : 'text-rose-300'}`}>
                  {res.evidenceStatus.replaceAll('_', ' ')} · BM25/entity rank, not confidence
                </div>
                <p className="mb-2 text-[10px] text-slate-400">{chunk.source?.note || 'No source note provided; treat this entry as unverified.'}</p>

                {/* Content snippet */}
                <p className="text-xs text-slate-300 font-sans leading-relaxed mb-3 bg-slate-950/80 p-3 rounded-lg border border-slate-800/80">
                  {highlightMatches(chunk.content, res.matchedKeywords)}
                </p>

                {/* Matched Keywords */}
                <div className="flex flex-wrap items-center gap-1 mb-2">
                  <span className="text-[10px] text-slate-500 font-mono">Matched terms/entities:</span>
                  {res.matchedKeywords.map((kw, idx) => (
                    <span
                      key={idx}
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800/60"
                    >
                      {kw}
                    </span>
                  ))}
                </div>
                <button
                  onClick={() => void attachSop(res)}
                  disabled={!canAttach || !selectedOrderId || attachingId === chunk.id}
                  className="mb-2 px-2.5 py-1.5 rounded bg-emerald-900 hover:bg-emerald-800 disabled:opacity-40 text-emerald-200 text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <Wrench className="w-3 h-3" /> {attachingId === chunk.id ? 'Attaching…' : 'Attach cited reference'}
                </button>
              </div>

              {/* Footer citations */}
              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2 text-[11px] font-mono text-slate-400">
                {chunk.source ? (
                  <a href={chunk.source.url} target="_blank" rel="noreferrer" className="text-cyan-300 hover:underline">{chunk.source.citation}</a>
                ) : (
                  <span>Illustrative entry · no verified citation attached</span>
                )}
                <button
                  onClick={() => downloadDocument(chunk)}
                  className="shrink-0 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 flex items-center gap-1.5 cursor-pointer"
                  aria-label={`Download ${chunk.documentTitle} as Markdown`}
                >
                  <Download className="w-3 h-3" /> Download
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
