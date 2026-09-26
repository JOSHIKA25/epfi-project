import React, { useState, useEffect } from 'react';
import {
  BookOpen,
  Search,
  FileText,
  Bookmark,
  ShieldAlert,
  Wrench,
  CheckCircle,
  ExternalLink,
} from 'lucide-react';
import { RAGSearchResult } from '../types/index.js';
import { api } from '../services/api.js';

export const RAGKnowledgeView: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('IDV(4) cooling water runaway limits');
  const [searchResults, setSearchResults] = useState<RAGSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

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
    handleSearch();
  }, []);

  const sampleQueries = [
    'Reactor cooling water excursion IDV(4)',
    'Control valve stiction SOP IDV(14)',
    'Emergency shutdown limits MAWP',
    'Condenser fouling protocol IDV(16)',
    'Compressor anti-surge operation IDV(20)',
  ];

  const filteredResults = searchResults.filter((r) => {
    if (selectedCategory === 'all') return true;
    return r.chunk.category === selectedCategory;
  });

  return (
    <div className="p-4 flex flex-col h-full overflow-y-auto bg-slate-950 text-slate-100 gap-4">
      {/* Top Banner */}
      <div className="p-4 rounded-xl border bg-slate-900 border-slate-800 shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-cyan-400" />
            Tennessee Eastman Process - RAG Engineering Knowledge Base
          </h2>
          <p className="text-xs text-slate-400 font-sans mt-0.5 max-w-2xl">
            Semantic & BM25 hybrid retrieval grounded in Downs & Vogel benchmark manuals, process thermodynamics, Safe Operating Limits (SOL), and Standard Operating Procedures.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono">
          <span className="px-2.5 py-1 rounded bg-slate-950 text-cyan-400 border border-slate-800">
            Vector Embedding + BM25 Hybrid
          </span>
          <span className="px-2.5 py-1 rounded bg-slate-950 text-emerald-400 border border-slate-800">
            9 Curated Specifications
          </span>
        </div>
      </div>

      {/* Search Bar & Categories */}
      <div className="p-4 bg-slate-900 rounded-xl border border-slate-800 flex flex-col gap-3 shadow-lg">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
            <input
              type="text"
              placeholder="Query engineering specs, fault physical mechanisms, SOPs, or equipment manuals..."
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
            <span>Search RAG</span>
          </button>
        </div>

        {/* Quick Query Pills */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-slate-400 font-semibold text-[11px] mr-1">Recommended Searches:</span>
          {sampleQueries.map((sq, idx) => (
            <button
              key={idx}
              onClick={() => {
                setSearchQuery(sq);
                handleSearch(sq);
              }}
              className="px-2.5 py-1 rounded bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-800 text-[11px] transition cursor-pointer"
            >
              {sq}
            </button>
          ))}
        </div>
      </div>

      {/* Category Filter */}
      <div className="flex items-center gap-2">
        {['all', 'safety_limits', 'fault_physics', 'maintenance_sop', 'instrumentation', 'process_spec'].map((cat) => (
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
                    <span>Relevance:</span>
                    <strong>{(res.score * 100).toFixed(0)}%</strong>
                  </div>
                </div>

                {/* Title & Section */}
                <h3 className="text-sm font-bold text-white mb-0.5">{chunk.documentTitle}</h3>
                <div className="text-xs font-mono text-cyan-400/90 mb-2">{chunk.section}</div>

                {/* Content snippet */}
                <p className="text-xs text-slate-300 font-sans leading-relaxed mb-3 bg-slate-950/80 p-3 rounded-lg border border-slate-800/80">
                  {chunk.content}
                </p>

                {/* Matched Keywords */}
                <div className="flex flex-wrap items-center gap-1 mb-2">
                  <span className="text-[10px] text-slate-500 font-mono">Matched Entities:</span>
                  {res.matchedKeywords.map((kw, idx) => (
                    <span
                      key={idx}
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800/60"
                    >
                      {kw}
                    </span>
                  ))}
                </div>
              </div>

              {/* Footer citations */}
              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-400">
                <span>Ref: Eastman Chemical Company</span>
                <span className="text-slate-500">Grounded Citation</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
