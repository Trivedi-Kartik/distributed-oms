'use client';

import React, { useState } from 'react';
import { 
  Package, 
  Plus, 
  RotateCw, 
  Layers, 
  CheckCircle, 
  Clock, 
  AlertTriangle,
  ArrowUpRight,
  TrendingUp,
  Box
} from 'lucide-react';
import { InventoryItem, InventorySummary, Reservation } from '../lib/types';

interface InventoryTabProps {
  inventory: InventoryItem[];
  summary: InventorySummary | null;
  reservations: Reservation[];
  onOpenRestockSku: (sku: string) => void;
  onOpenCreateProduct: () => void;
  onRefresh: () => void;
}

export function InventoryTab({
  inventory,
  summary,
  reservations,
  onOpenRestockSku,
  onOpenCreateProduct,
  onRefresh,
}: InventoryTabProps) {
  const [filterResStatus, setFilterResStatus] = useState<string>('ALL');

  const filteredReservations = reservations.filter((r) => {
    return filterResStatus === 'ALL' || r.status === filterResStatus;
  });

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Top Header & Summary */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Package className="text-cyan-400" size={20} />
            <span>Warehouse Catalog & Stock Allocations</span>
          </h2>
          <p className="text-xs text-slate-400">
            Pessimistic concurrency locking (<code className="text-cyan-300">SELECT ... FOR UPDATE</code>) eliminates race conditions
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button onClick={onOpenCreateProduct} className="btn-primary text-xs py-2">
            <Plus size={14} />
            <span>Add New SKU</span>
          </button>
        </div>
      </div>

      {/* Stock Summary Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="glass-panel p-4 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-semibold text-slate-400 uppercase">Active Catalog SKUs</div>
            <div className="text-2xl font-extrabold text-white mt-1">{summary?.total_skus || 0}</div>
          </div>
          <div className="p-3 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <Box size={20} />
          </div>
        </div>

        <div className="glass-panel p-4 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-semibold text-slate-400 uppercase">Available On Shelf</div>
            <div className="text-2xl font-extrabold text-emerald-400 mt-1">{summary?.total_available_units || 0} units</div>
          </div>
          <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle size={20} />
          </div>
        </div>

        <div className="glass-panel p-4 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-semibold text-slate-400 uppercase">Awaiting Payment (Locked)</div>
            <div className="text-2xl font-extrabold text-amber-400 mt-1">{summary?.total_reserved_units || 0} units</div>
          </div>
          <div className="p-3 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Clock size={20} />
          </div>
        </div>
      </div>

      {/* Product Cards Grid */}
      <div>
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Active Warehouse Products</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {inventory.map((item) => {
            const totalStock = item.available_quantity + item.reserved_quantity;
            const availablePercentage = totalStock > 0 
              ? Math.round((item.available_quantity / totalStock) * 100) 
              : 0;

            const isLowStock = item.available_quantity <= 2;

            return (
              <div key={item.sku} className="glass-panel p-5 relative group glass-card-interactive">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="code-font text-[11px] text-cyan-400 font-semibold bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20">
                      {item.sku}
                    </span>
                    <h4 className="text-sm font-bold text-white mt-2 group-hover:text-cyan-300 transition-colors">
                      {item.name}
                    </h4>
                  </div>
                  <button
                    onClick={() => onOpenRestockSku(item.sku)}
                    className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/5 transition-all text-xs flex items-center gap-1"
                    title="Restock this item"
                  >
                    <Plus size={12} />
                    <span>Restock</span>
                  </button>
                </div>

                {/* Stock Gauges */}
                <div className="mt-5 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Available Stock</span>
                    <span className={`font-bold ${isLowStock ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {item.available_quantity} units
                    </span>
                  </div>

                  {/* Progress Bar */}
                  <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        isLowStock 
                          ? 'bg-gradient-to-r from-rose-500 to-amber-500' 
                          : 'bg-gradient-to-r from-cyan-500 to-emerald-500'
                      }`}
                      style={{ width: `${availablePercentage}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                    <span>Reserved for Orders:</span>
                    <span className="text-amber-400 font-medium">{item.reserved_quantity} units</span>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-white/[0.04] flex items-center justify-between text-[10px] text-slate-500">
                  <span>Last Modified:</span>
                  <span>{new Date(item.updated_at).toLocaleTimeString()}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Order Reservations Table */}
      <div className="glass-panel p-5">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Layers size={16} className="text-cyan-400" />
              <span>Order Stock Allocations Log</span>
            </h3>
            <p className="text-xs text-slate-400">Tracks stock lifecycle: RESERVED $\to$ CONFIRMED or RELEASED (Compensation)</p>
          </div>

          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-white/[0.03] border border-white/[0.06] text-xs">
            {['ALL', 'RESERVED', 'RELEASED'].map((st) => (
              <button
                key={st}
                onClick={() => setFilterResStatus(st)}
                className={`px-3 py-1 rounded-lg font-medium transition-all ${
                  filterResStatus === st 
                    ? 'bg-cyan-600 text-white' 
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/[0.08] text-slate-400 text-[10px] uppercase">
                <th className="py-2.5 px-3">Reservation ID</th>
                <th className="py-2.5 px-3">Order ID</th>
                <th className="py-2.5 px-3">SKU</th>
                <th className="py-2.5 px-3">Qty</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {filteredReservations.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    No reservations matching filter.
                  </td>
                </tr>
              ) : (
                filteredReservations.map((res) => (
                  <tr key={res.id} className="hover:bg-white/[0.02]">
                    <td className="py-2.5 px-3 code-font text-slate-400">{res.id.slice(0, 8)}...</td>
                    <td className="py-2.5 px-3 code-font text-indigo-300 font-medium">{res.order_id.slice(0, 8)}...</td>
                    <td className="py-2.5 px-3 code-font text-cyan-300">{res.sku}</td>
                    <td className="py-2.5 px-3 text-white font-bold">{res.quantity}</td>
                    <td className="py-2.5 px-3">
                      <span className={`badge ${res.status === 'RESERVED' ? 'badge-pending' : 'badge-confirmed'}`}>
                        {res.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-400">{new Date(res.created_at).toLocaleTimeString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default InventoryTab;

