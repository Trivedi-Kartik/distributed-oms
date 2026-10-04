'use client';

import React from 'react';
import { 
  DollarSign, 
  ShoppingCart, 
  CheckCircle2, 
  Package, 
  CreditCard, 
  ArrowRight, 
  Zap, 
  TrendingUp,
  FileCode2,
  AlertTriangle,
  RotateCcw
} from 'lucide-react';
import { Order, OrderSummaryStats, InventorySummary, PaymentStats } from '../lib/types';

interface OverviewTabProps {
  orderStats: OrderSummaryStats | null;
  inventorySummary: InventorySummary | null;
  paymentStats: PaymentStats | null;
  recentOrders: Order[];
  onNavigateTab: (tab: string) => void;
  onOpenCreateOrder: () => void;
  onOpenRestock: () => void;
  onTriggerDlq: () => void;
}

export function OverviewTab({
  orderStats,
  inventorySummary,
  paymentStats,
  recentOrders,
  onNavigateTab,
  onOpenCreateOrder,
  onOpenRestock,
  onTriggerDlq,
}: OverviewTabProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const paymentSuccessRate = paymentStats && (paymentStats.authorized.count + paymentStats.failed.count > 0)
    ? Math.round((paymentStats.authorized.count / (paymentStats.authorized.count + paymentStats.failed.count)) * 100)
    : 100;

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* 1. KPI Cards Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Card 1: Total Revenue */}
        <div className="glass-panel p-5 relative overflow-hidden group">
          <div className="absolute -right-4 -top-4 w-24 h-24 bg-indigo-500/10 rounded-full blur-2xl group-hover:bg-indigo-500/20 transition-all" />
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Volume</span>
            <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <DollarSign size={18} />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-extrabold text-white tracking-tight">
              {formatCurrency(orderStats?.totalRevenue || 0)}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
              <TrendingUp size={14} />
              <span>{formatCurrency(orderStats?.confirmedRevenue || 0)} confirmed</span>
            </div>
          </div>
        </div>

        {/* Card 2: Orders Total */}
        <div className="glass-panel p-5 relative overflow-hidden group">
          <div className="absolute -right-4 -top-4 w-24 h-24 bg-purple-500/10 rounded-full blur-2xl group-hover:bg-purple-500/20 transition-all" />
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Orders</span>
            <div className="p-2 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
              <ShoppingCart size={18} />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-extrabold text-white tracking-tight">
              {orderStats?.totalOrders || 0}
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-[11px] font-medium text-slate-400">
              <span className="text-emerald-400">{orderStats?.countsByStatus.CONFIRMED || 0} Confirmed</span>
              <span>•</span>
              <span className="text-rose-400">{orderStats?.countsByStatus.CANCELLED || 0} Cancelled</span>
            </div>
          </div>
        </div>

        {/* Card 3: Warehouse Stock */}
        <div className="glass-panel p-5 relative overflow-hidden group">
          <div className="absolute -right-4 -top-4 w-24 h-24 bg-cyan-500/10 rounded-full blur-2xl group-hover:bg-cyan-500/20 transition-all" />
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Available Stock</span>
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
              <Package size={18} />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-extrabold text-white tracking-tight">
              {inventorySummary?.total_available_units || 0} <span className="text-sm font-normal text-slate-400">units</span>
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-[11px] font-medium text-slate-400">
              <span>{inventorySummary?.total_skus || 0} SKUs</span>
              <span>•</span>
              <span className="text-amber-400">{inventorySummary?.total_reserved_units || 0} Reserved</span>
            </div>
          </div>
        </div>

        {/* Card 4: Payment Success Rate */}
        <div className="glass-panel p-5 relative overflow-hidden group">
          <div className="absolute -right-4 -top-4 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl group-hover:bg-emerald-500/20 transition-all" />
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Payment Rate</span>
            <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <CreditCard size={18} />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-extrabold text-white tracking-tight">
              {paymentSuccessRate}%
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-[11px] font-medium text-slate-400">
              <span className="text-emerald-400">{paymentStats?.authorized.count || 0} Auth</span>
              <span>•</span>
              <span className="text-rose-400">{paymentStats?.failed.count || 0} Rejections</span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Interactive Architecture Pipeline & Event Stream Visualization */}
      <div className="glass-panel p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Zap className="text-amber-400" size={18} />
              <span>Event-Driven Saga Pipeline Flow</span>
            </h2>
            <p className="text-xs text-slate-400">
              Real-time message propagation through Apache Kafka topics and microservice boundaries
            </p>
          </div>
          <span className="text-xs px-2.5 py-1 rounded-md bg-white/5 border border-white/10 text-slate-300 code-font">
            KRaft Mode • Zero ZooKeeper
          </span>
        </div>

        {/* Pipeline Nodes */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-2">
          {/* Node 1: Order API & Outbox */}
          <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:border-indigo-500/40 transition-all">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">Step 1 • Ingestion</span>
              <span className="h-2 w-2 rounded-full bg-indigo-500" />
            </div>
            <h3 className="text-sm font-semibold text-white">Order Service</h3>
            <p className="text-xs text-slate-400 mt-1">
              Atomic insert to <code className="text-indigo-300">orders</code> + <code className="text-indigo-300">outbox_events</code>.
            </p>
            <div className="mt-3 pt-2 border-t border-white/5 text-[11px] text-slate-400 flex items-center justify-between">
              <span>Topic:</span>
              <span className="code-font text-indigo-300">order.events</span>
            </div>
          </div>

          {/* Node 2: Inventory */}
          <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:border-cyan-500/40 transition-all">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-400">Step 2 • Reservation</span>
              <span className="h-2 w-2 rounded-full bg-cyan-500" />
            </div>
            <h3 className="text-sm font-semibold text-white">Inventory Service</h3>
            <p className="text-xs text-slate-400 mt-1">
              Pessimistic lock <code className="text-cyan-300">FOR UPDATE</code>. Reserves or emits stock failure.
            </p>
            <div className="mt-3 pt-2 border-t border-white/5 text-[11px] text-slate-400 flex items-center justify-between">
              <span>Topic:</span>
              <span className="code-font text-cyan-300">inventory.events</span>
            </div>
          </div>

          {/* Node 3: Payment */}
          <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:border-emerald-500/40 transition-all">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">Step 3 • Authorization</span>
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
            </div>
            <h3 className="text-sm font-semibold text-white">Payment Service</h3>
            <p className="text-xs text-slate-400 mt-1">
              Idempotent check on <code className="text-emerald-300">event_id</code>. Limit check (≤ ₹5,00,000).
            </p>
            <div className="mt-3 pt-2 border-t border-white/5 text-[11px] text-slate-400 flex items-center justify-between">
              <span>Topic:</span>
              <span className="code-font text-emerald-300">payment.events</span>
            </div>
          </div>

          {/* Node 4: Saga Coordinator */}
          <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:border-purple-500/40 transition-all">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-purple-400">Step 4 • Orchestrator</span>
              <span className="h-2 w-2 rounded-full bg-purple-500" />
            </div>
            <h3 className="text-sm font-semibold text-white">Saga Orchestrator</h3>
            <p className="text-xs text-slate-400 mt-1">
              Confirms order OR triggers compensation to un-reserve stock.
            </p>
            <div className="mt-3 pt-2 border-t border-white/5 text-[11px] text-slate-400 flex items-center justify-between">
              <span>Outcomes:</span>
              <span className="code-font text-purple-300">CONFIRMED / CANCELLED</span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Quick Actions & Recent Transactions Split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Quick Actions Panel */}
        <div className="glass-panel p-5 space-y-3">
          <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
            <Zap size={16} className="text-indigo-400" />
            <span>Interactive Operational Triggers</span>
          </h3>

          <button
            onClick={onOpenCreateOrder}
            className="w-full flex items-center justify-between p-3 rounded-xl bg-gradient-to-r from-indigo-600/20 to-purple-600/20 border border-indigo-500/30 hover:border-indigo-500 transition-all text-left group"
          >
            <div>
              <div className="text-xs font-bold text-white group-hover:text-indigo-300 transition-colors">
                Simulate New Customer Order
              </div>
              <div className="text-[11px] text-slate-400">Triggers Outbox + Saga pipeline</div>
            </div>
            <ArrowRight size={16} className="text-indigo-400 group-hover:translate-x-1 transition-transform" />
          </button>

          <button
            onClick={onOpenRestock}
            className="w-full flex items-center justify-between p-3 rounded-xl bg-gradient-to-r from-cyan-600/20 to-blue-600/20 border border-cyan-500/30 hover:border-cyan-500 transition-all text-left group"
          >
            <div>
              <div className="text-xs font-bold text-white group-hover:text-cyan-300 transition-colors">
                Restock Warehouse Inventory
              </div>
              <div className="text-[11px] text-slate-400">Atomically adds quantity to catalog</div>
            </div>
            <ArrowRight size={16} className="text-cyan-400 group-hover:translate-x-1 transition-transform" />
          </button>

          <button
            onClick={onTriggerDlq}
            className="w-full flex items-center justify-between p-3 rounded-xl bg-gradient-to-r from-rose-600/20 to-amber-600/20 border border-rose-500/30 hover:border-rose-500 transition-all text-left group"
          >
            <div>
              <div className="text-xs font-bold text-white group-hover:text-rose-300 transition-colors flex items-center gap-1.5">
                <RotateCcw size={13} />
                <span>Replay DLQ Dead Letters</span>
              </div>
              <div className="text-[11px] text-slate-400">Scans payment.events.dlq and re-routes</div>
            </div>
            <ArrowRight size={16} className="text-rose-400 group-hover:translate-x-1 transition-transform" />
          </button>

          <button
            onClick={() => onNavigateTab('swagger')}
            className="w-full flex items-center justify-between p-3 rounded-xl bg-white/[0.03] border border-white/10 hover:border-white/20 transition-all text-left group"
          >
            <div>
              <div className="text-xs font-bold text-white group-hover:text-slate-200 transition-colors flex items-center gap-1.5">
                <FileCode2 size={13} className="text-slate-400" />
                <span>Open Swagger UI Documentation</span>
              </div>
              <div className="text-[11px] text-slate-400">Interactive OpenAPI 3.0 dashboards</div>
            </div>
            <ArrowRight size={16} className="text-slate-400 group-hover:translate-x-1 transition-transform" />
          </button>
        </div>

        {/* Recent Orders Stream */}
        <div className="glass-panel p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-white">Recent Saga Transactions</h3>
            <button
              onClick={() => onNavigateTab('orders')}
              className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors font-medium flex items-center gap-1"
            >
              <span>View all orders</span>
              <ArrowRight size={12} />
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-white/[0.06] text-slate-400 uppercase tracking-wider text-[10px]">
                  <th className="py-2.5 px-3">Order ID</th>
                  <th className="py-2.5 px-3">Customer</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Amount</th>
                  <th className="py-2.5 px-3">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {recentOrders.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500">
                      No orders placed yet. Click "Simulate New Customer Order" above to place one!
                    </td>
                  </tr>
                ) : (
                  recentOrders.slice(0, 5).map((order) => {
                    const statusClass = 
                      order.status === 'CONFIRMED' ? 'badge-confirmed' :
                      order.status === 'PENDING' ? 'badge-pending' :
                      order.status === 'COMPENSATING' ? 'badge-compensating' : 'badge-cancelled';

                    return (
                      <tr key={order.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="py-2.5 px-3 code-font text-indigo-300 font-medium">
                          {order.id.slice(0, 8)}...
                        </td>
                        <td className="py-2.5 px-3 text-slate-300">{order.customer_id}</td>
                        <td className="py-2.5 px-3">
                          <span className={`badge ${statusClass}`}>{order.status}</span>
                        </td>
                        <td className="py-2.5 px-3 text-white font-semibold">
                          ₹{Number(order.total_amount).toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3 text-slate-400">
                          {new Date(order.created_at).toLocaleTimeString()}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

export default OverviewTab;

