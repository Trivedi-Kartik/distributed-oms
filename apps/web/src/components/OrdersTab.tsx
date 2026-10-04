'use client';

import React, { useState } from 'react';
import { 
  Plus, 
  Search, 
  X, 
  Layers, 
  Eye, 
  Clock, 
  CheckCircle2, 
  AlertOctagon, 
  RotateCcw,
  Check,
  Send
} from 'lucide-react';
import { Order, InventoryItem } from '../lib/types';
import { cancelOrder, fetchOrderById } from '../lib/api';

interface OrdersTabProps {
  orders: Order[];
  inventory: InventoryItem[];
  onOpenCreateOrder: () => void;
  onRefresh: () => void;
  onShowToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export function OrdersTab({
  orders,
  inventory,
  onOpenCreateOrder,
  onRefresh,
  onShowToast,
}: OrdersTabProps) {
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  // Filtered orders
  const filteredOrders = orders.filter((order) => {
    const matchesStatus = filterStatus === 'ALL' || order.status === filterStatus;
    const matchesSearch = 
      order.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.customer_id.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  const handleInspect = async (orderId: string) => {
    setLoadingDetail(true);
    try {
      const detailed = await fetchOrderById(orderId);
      setSelectedOrder(detailed);
    } catch (err: any) {
      onShowToast(err.message || 'Failed to fetch order details', 'error');
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleCancelOrder = async (orderId: string) => {
    setCancellingId(orderId);
    try {
      const res = await cancelOrder(orderId, 'User requested cancellation from Control Center');
      onShowToast(`Order cancellation initiated: ${res.message}`, 'info');
      onRefresh();
      // Re-fetch detail if open
      if (selectedOrder?.id === orderId) {
        const updated = await fetchOrderById(orderId);
        setSelectedOrder(updated);
      }
    } catch (err: any) {
      onShowToast(err.message || 'Failed to cancel order', 'error');
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Action & Filter Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        {/* Left: Filter Buttons */}
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-white/[0.03] border border-white/[0.06] overflow-x-auto w-full sm:w-auto">
          {['ALL', 'CONFIRMED', 'PENDING', 'COMPENSATING', 'CANCELLED'].map((st) => (
            <button
              key={st}
              onClick={() => setFilterStatus(st)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                filterStatus === st
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
              }`}
            >
              {st}
            </button>
          ))}
        </div>

        {/* Right: Search & Create Button */}
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by Order ID or Customer..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>

          <button onClick={onOpenCreateOrder} className="btn-primary text-xs py-2 whitespace-nowrap">
            <Plus size={14} />
            <span>Create Order</span>
          </button>
        </div>
      </div>

      {/* Orders Table */}
      <div className="glass-panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/[0.08] bg-white/[0.01] text-slate-400 uppercase tracking-wider text-[10px]">
                <th className="py-3 px-4">Order ID</th>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Total Amount</th>
                <th className="py-3 px-4">Created Time</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-500">
                    No orders match your filter criteria.
                  </td>
                </tr>
              ) : (
                filteredOrders.map((order) => {
                  const statusBadgeClass =
                    order.status === 'CONFIRMED' ? 'badge-confirmed' :
                    order.status === 'PENDING' ? 'badge-pending' :
                    order.status === 'COMPENSATING' ? 'badge-compensating' : 'badge-cancelled';

                  return (
                    <tr key={order.id} className="hover:bg-white/[0.02] transition-colors group">
                      <td className="py-3 px-4 code-font text-indigo-300 font-medium">
                        {order.id}
                      </td>
                      <td className="py-3 px-4 text-slate-200 font-medium">{order.customer_id}</td>
                      <td className="py-3 px-4">
                        <span className={`badge ${statusBadgeClass}`}>{order.status}</span>
                      </td>
                      <td className="py-3 px-4 text-white font-bold">
                        ₹{Number(order.total_amount).toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-slate-400">
                        {new Date(order.created_at).toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleInspect(order.id)}
                            className="btn-secondary py-1 px-2.5 text-[11px]"
                            title="Inspect items & outbox"
                          >
                            <Eye size={12} />
                            <span>Inspect</span>
                          </button>

                          {(order.status === 'CONFIRMED' || order.status === 'PENDING') && (
                            <button
                              onClick={() => handleCancelOrder(order.id)}
                              disabled={cancellingId === order.id}
                              className="btn-danger py-1 px-2.5 text-[11px]"
                              title="Trigger Saga compensation rollback"
                            >
                              <RotateCcw size={12} className={cancellingId === order.id ? 'animate-spin' : ''} />
                              <span>Cancel</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Order Detail & Outbox Inspector Drawer / Modal */}
      {selectedOrder && (
        <div className="modal-overlay" onClick={() => setSelectedOrder(null)}>
          <div 
            className="glass-panel w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-6"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-4">
              <div>
                <span className="text-[11px] text-indigo-400 font-bold uppercase tracking-wider">
                  Saga Transaction Inspector
                </span>
                <h3 className="text-base font-bold text-white code-font mt-0.5">
                  {selectedOrder.id}
                </h3>
              </div>
              <button
                onClick={() => setSelectedOrder(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Order Status & Key Metadata */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                <div className="text-[10px] text-slate-400 uppercase">Customer</div>
                <div className="text-xs font-semibold text-white mt-1">{selectedOrder.customer_id}</div>
              </div>
              <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                <div className="text-[10px] text-slate-400 uppercase">Status</div>
                <div className="mt-1">
                  <span className={`badge ${
                    selectedOrder.status === 'CONFIRMED' ? 'badge-confirmed' :
                    selectedOrder.status === 'PENDING' ? 'badge-pending' :
                    selectedOrder.status === 'COMPENSATING' ? 'badge-compensating' : 'badge-cancelled'
                  }`}>
                    {selectedOrder.status}
                  </span>
                </div>
              </div>
              <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                <div className="text-[10px] text-slate-400 uppercase">Total Amount</div>
                <div className="text-xs font-bold text-emerald-400 mt-1">
                  ₹{Number(selectedOrder.total_amount).toLocaleString()}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                <div className="text-[10px] text-slate-400 uppercase">Created Time</div>
                <div className="text-[11px] text-slate-300 mt-1">
                  {new Date(selectedOrder.created_at).toLocaleTimeString()}
                </div>
              </div>
            </div>

            {selectedOrder.cancellation_reason && (
              <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-start gap-2">
                <AlertOctagon size={16} className="text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">Cancellation Reason:</span> {selectedOrder.cancellation_reason}
                </div>
              </div>
            )}

            {/* Line Items Table */}
            <div>
              <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-2">Order Line Items</h4>
              <div className="rounded-xl border border-white/[0.06] overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-white/[0.02] border-b border-white/[0.06] text-slate-400 text-[10px]">
                    <tr>
                      <th className="py-2 px-3">SKU</th>
                      <th className="py-2 px-3">Quantity</th>
                      <th className="py-2 px-3">Unit Price</th>
                      <th className="py-2 px-3 text-right">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {selectedOrder.items?.map((item) => (
                      <tr key={item.sku}>
                        <td className="py-2 px-3 code-font text-cyan-300">{item.sku}</td>
                        <td className="py-2 px-3 text-slate-200">{item.quantity}</td>
                        <td className="py-2 px-3 text-slate-400">₹{Number(item.unit_price).toLocaleString()}</td>
                        <td className="py-2 px-3 text-right text-white font-medium">
                          ₹{(item.quantity * Number(item.unit_price)).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Transactional Outbox Events Publication History */}
            <div>
              <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Send size={13} className="text-indigo-400" />
                <span>Transactional Outbox Publication Logs</span>
              </h4>
              <div className="rounded-xl border border-white/[0.06] overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-white/[0.02] border-b border-white/[0.06] text-slate-400 text-[10px]">
                    <tr>
                      <th className="py-2 px-3">Outbox Event Type</th>
                      <th className="py-2 px-3">Saved At (DB TX)</th>
                      <th className="py-2 px-3">Relay Published To Kafka</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {selectedOrder.outboxEvents?.map((outbox) => (
                      <tr key={outbox.id}>
                        <td className="py-2 px-3 code-font text-indigo-300 font-semibold">{outbox.event_type}</td>
                        <td className="py-2 px-3 text-slate-400">{new Date(outbox.created_at).toLocaleTimeString()}</td>
                        <td className="py-2 px-3">
                          {outbox.published_at ? (
                            <span className="flex items-center gap-1 text-emerald-400 font-medium">
                              <CheckCircle2 size={12} />
                              <span>{new Date(outbox.published_at).toLocaleTimeString()}</span>
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-amber-400 font-medium">
                              <Clock size={12} />
                              <span>Queued in DB Outbox...</span>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between border-t border-white/[0.08] pt-4">
              <span className="text-[11px] text-slate-500">
                Guaranteed At-Least-Once Delivery via Transactional Outbox
              </span>
              {(selectedOrder.status === 'CONFIRMED' || selectedOrder.status === 'PENDING') && (
                <button
                  onClick={() => handleCancelOrder(selectedOrder.id)}
                  disabled={cancellingId === selectedOrder.id}
                  className="btn-danger text-xs py-1.5 px-3"
                >
                  <RotateCcw size={13} className={cancellingId === selectedOrder.id ? 'animate-spin' : ''} />
                  <span>Initiate Compensation Rollback</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default OrdersTab;

