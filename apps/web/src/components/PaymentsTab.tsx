'use client';

import React, { useState } from 'react';
import { 
  CreditCard, 
  CheckCircle2, 
  XCircle, 
  RotateCcw, 
  Search, 
  ShieldCheck, 
  Zap, 
  AlertTriangle,
  Flame,
  Fingerprint,
  TrendingUp,
  Receipt,
  Clock
} from 'lucide-react';
import { PaymentRecord, ProcessedEvent } from '../lib/types';
import { triggerDlqReplay } from '../lib/api';

interface PaymentsTabProps {
  payments: PaymentRecord[];
  processedEvents: ProcessedEvent[];
  onRefresh: () => void;
  showToast: (type: 'success' | 'error' | 'info', message: string) => void;
}

export default function PaymentsTab({
  payments,
  processedEvents,
  onRefresh,
  showToast
}: PaymentsTabProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [isReplaying, setIsReplaying] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<'transactions' | 'idempotency'>('transactions');

  // Stats calculation
  const totalProcessed = payments.length;
  const authorizedPayments = payments.filter(p => p.status === 'AUTHORIZED');
  const failedPayments = payments.filter(p => p.status === 'FAILED');
  const totalVolume = authorizedPayments.reduce((acc, p) => acc + Number(p.amount || 0), 0);
  const failedVolume = failedPayments.reduce((acc, p) => acc + Number(p.amount || 0), 0);
  const successRate = totalProcessed > 0 ? Math.round((authorizedPayments.length / totalProcessed) * 100) : 100;

  // Filtered transactions
  const filteredPayments = payments.filter(p => {
    const orderRef = p.order_id || (p as any).orderId || '';
    const id = p.id || '';
    const matchesSearch = 
      id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      orderRef.toLowerCase().includes(searchTerm.toLowerCase());
    
    if (!matchesSearch) return false;
    if (statusFilter === 'ALL') return true;
    if (statusFilter === 'AUTHORIZED') return p.status === 'AUTHORIZED';
    if (statusFilter === 'FAILED') return p.status === 'FAILED';
    return p.status === statusFilter;
  });

  const handleDlqReplay = async () => {
    setIsReplaying(true);
    try {
      const res = await triggerDlqReplay();
      showToast('success', res.message || 'DLQ compensation replay triggered successfully!');
      setTimeout(() => {
        onRefresh();
      }, 1200);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to trigger DLQ replay';
      showToast('error', errorMsg);
    } finally {
      setIsReplaying(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner / KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="glass-card p-5 border-l-4 border-l-emerald-500">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Settled Volume</span>
            <Receipt className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-emerald-400">
            ${totalVolume.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-slate-400 mt-2 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>{authorizedPayments.length} successful authorizations</span>
          </div>
        </div>

        <div className="glass-card p-5 border-l-4 border-l-rose-500">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Declined / Reverted</span>
            <Flame className="w-5 h-5 text-rose-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-rose-400">
            ${failedVolume.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-slate-400 mt-2 flex items-center gap-1.5">
            <XCircle className="w-3.5 h-3.5 text-rose-400" />
            <span>{failedPayments.length} failed transactions</span>
          </div>
        </div>

        <div className="glass-card p-5 border-l-4 border-l-cyan-500">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Success Rate</span>
            <TrendingUp className="w-5 h-5 text-cyan-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-cyan-400">
            {successRate}%
          </div>
          <div className="text-xs text-slate-400 mt-2">
            Across {totalProcessed} total payment attempts
          </div>
        </div>

        <div className="glass-card p-5 border-l-4 border-l-amber-500">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Idempotency Keys</span>
            <Fingerprint className="w-5 h-5 text-amber-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-amber-300">
            {processedEvents.length}
          </div>
          <div className="text-xs text-slate-400 mt-2">
            Deduplication records active
          </div>
        </div>
      </div>

      {/* DLQ Resilience & Operational Control Card */}
      <div className="glass-card p-5 bg-gradient-to-r from-amber-950/20 via-slate-900/80 to-purple-950/20 border-amber-500/30 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30">
              <Zap className="w-4 h-4" />
            </span>
            <h3 className="font-semibold text-white text-base">Dead Letter Queue (DLQ) & Resilience Engine</h3>
            <span className="text-2xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono">
              payment.events.dlq
            </span>
          </div>
          <p className="text-xs text-slate-400 max-w-2xl">
            Simulate or recover transactions rejected by downstream payment gateways. Replaying DLQ messages injects compensation sweeps into Kafka consumer groups with exponential backoff handling.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleDlqReplay}
            disabled={isReplaying}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-600 to-rose-600 hover:from-amber-500 hover:to-rose-500 text-white font-medium text-xs shadow-lg shadow-amber-900/30 transition-all cursor-pointer disabled:opacity-50"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${isReplaying ? 'animate-spin' : ''}`} />
            <span>{isReplaying ? 'Triggering DLQ Replay...' : 'Trigger DLQ Replay'}</span>
          </button>
        </div>
      </div>

      {/* Sub-tab Switcher & Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        {/* Toggle sub-tabs */}
        <div className="flex p-1 bg-slate-900/90 rounded-xl border border-slate-800 self-stretch sm:self-auto">
          <button
            onClick={() => setActiveSubTab('transactions')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-all ${
              activeSubTab === 'transactions'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <CreditCard className="w-3.5 h-3.5" />
            <span>Transaction Ledger ({payments.length})</span>
          </button>
          <button
            onClick={() => setActiveSubTab('idempotency')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-all ${
              activeSubTab === 'idempotency'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Idempotency Deduplication Store ({processedEvents.length})</span>
          </button>
        </div>

        {/* Filter controls if on transactions tab */}
        {activeSubTab === 'transactions' && (
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search payment or order..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-slate-900/80 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-slate-900/80 border border-slate-800 rounded-xl text-xs text-white px-3 py-2 focus:outline-none focus:border-cyan-500 transition-colors cursor-pointer"
            >
              <option value="ALL">All Statuses</option>
              <option value="AUTHORIZED">Authorized / Completed</option>
              <option value="FAILED">Failed / Declined</option>
            </select>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      {activeSubTab === 'transactions' ? (
        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900/80 text-slate-400 uppercase tracking-wider text-2xs border-b border-slate-800/80">
                <tr>
                  <th className="py-3.5 px-4 font-semibold">Payment ID</th>
                  <th className="py-3.5 px-4 font-semibold">Order Reference</th>
                  <th className="py-3.5 px-4 font-semibold">Amount</th>
                  <th className="py-3.5 px-4 font-semibold">Status</th>
                  <th className="py-3.5 px-4 font-semibold">Gateway Auth Ref</th>
                  <th className="py-3.5 px-4 font-semibold">Audit Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-sans">
                {filteredPayments.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-12 text-slate-500">
                      No payment transactions found.
                    </td>
                  </tr>
                ) : (
                  filteredPayments.map((p) => {
                    const isSuccess = p.status === 'AUTHORIZED';
                    const isFailed = p.status === 'FAILED';

                    const orderRef = p.order_id || (p as any).orderId || 'N/A';
                    const createdAt = p.created_at || (p as any).createdAt;

                    return (
                      <tr key={p.id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-3.5 px-4 font-mono font-medium text-slate-200">
                          {p.id.slice(0, 14)}...
                        </td>
                        <td className="py-3.5 px-4 font-mono text-cyan-400 font-semibold">
                          {orderRef.slice(0, 14)}...
                        </td>
                        <td className="py-3.5 px-4 font-mono font-bold text-white">
                          ${Number(p.amount).toFixed(2)}
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-2xs font-semibold ${
                              isSuccess
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                                : isFailed
                                ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                                : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                            }`}
                          >
                            {isSuccess ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                            {p.status}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 font-mono text-slate-400 text-2xs">
                          <span className="bg-slate-800/60 px-2 py-0.5 rounded border border-slate-700/60 text-slate-300">
                            {p.currency || 'INR'}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-slate-400 text-2xs font-mono">
                          {createdAt ? new Date(createdAt).toLocaleString() : 'Just now'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Idempotency Deduplication Audit Table */
        <div className="glass-card overflow-hidden">
          <div className="p-4 border-b border-slate-800/80 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-amber-400" />
              <h4 className="text-xs font-semibold text-white uppercase tracking-wider">
                Event Deduplication Ledger (Processed Kafka Message IDs)
              </h4>
            </div>
            <span className="text-2xs text-slate-400 font-mono">
              Prevents duplicate charges on network retries
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900/80 text-slate-400 uppercase tracking-wider text-2xs border-b border-slate-800/80">
                <tr>
                  <th className="py-3.5 px-4 font-semibold">Event ID / Hash</th>
                  <th className="py-3.5 px-4 font-semibold">Consumer Group</th>
                  <th className="py-3.5 px-4 font-semibold">Processed At</th>
                  <th className="py-3.5 px-4 font-semibold">Verification Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-sans">
                {processedEvents.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-center py-12 text-slate-500">
                      No processed event keys recorded yet.
                    </td>
                  </tr>
                ) : (
                  processedEvents.map((evt, idx) => {
                    const eventId = evt.event_id || (evt as any).eventId || `EVT-${idx}`;
                    const consumerName = evt.consumer_name || (evt as any).consumerName || 'payment-consumer-group';
                    const processedAt = evt.processed_at || (evt as any).processedAt;

                    return (
                      <tr key={eventId || idx} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-3.5 px-4 font-mono font-medium text-amber-300">
                          {eventId}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-slate-400 text-2xs">
                          {consumerName}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-slate-400 text-2xs">
                          {processedAt ? new Date(processedAt).toLocaleString() : 'N/A'}
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-2xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                            <CheckCircle2 className="w-3 h-3" />
                            Deduped & Committed
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
