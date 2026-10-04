'use client';

import React, { useState } from 'react';
import { X, Plus, Trash2, ShoppingBag, Sparkles, AlertCircle } from 'lucide-react';
import { InventoryItem } from '../lib/types';
import { createOrder } from '../lib/api';

interface OrderItemForm {
  sku: string;
  quantity: number;
  price: number;
}

interface CreateOrderModalProps {
  inventory: InventoryItem[];
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  showToast: (type: 'success' | 'error' | 'info', message: string) => void;
}

export default function CreateOrderModal({
  inventory,
  isOpen,
  onClose,
  onSuccess,
  showToast
}: CreateOrderModalProps) {
  const [customerId, setCustomerId] = useState('CUST-8801');
  const [items, setItems] = useState<OrderItemForm[]>([
    {
      sku: inventory.length > 0 ? inventory[0].sku : 'SKU-MACBOOK-PRO',
      quantity: 1,
      price: 1999.00
    }
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleAddItem = () => {
    const defaultSku = inventory.length > 0 ? inventory[0].sku : 'SKU-IPHONE-16';
    setItems([...items, { sku: defaultSku, quantity: 1, price: 999.00 }]);
  };

  const handleRemoveItem = (index: number) => {
    if (items.length <= 1) return;
    setItems(items.filter((_, i) => i !== index));
  };

  const handleItemChange = (index: number, field: keyof OrderItemForm, value: string | number) => {
    const updated = [...items];
    if (field === 'quantity') {
      updated[index].quantity = Math.max(1, Number(value));
    } else if (field === 'price') {
      updated[index].price = Math.max(0, Number(value));
    } else {
      updated[index].sku = String(value);
    }
    setItems(updated);
  };

  const calculateTotal = () => {
    return items.reduce((sum, item) => sum + (item.quantity * item.price), 0);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      if (!customerId.trim()) {
        throw new Error('Customer ID is required');
      }
      if (items.length === 0) {
        throw new Error('Please add at least one line item');
      }

      await createOrder({
        customerId: customerId.trim(),
        items: items.map(item => ({
          sku: item.sku,
          quantity: Number(item.quantity),
          unitPrice: Number(item.price)
        }))
      });

      showToast('success', 'Order created and dispatched to Saga pipeline!');
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to place order';
      setError(msg);
      showToast('error', msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div 
        className="glass-card w-full max-w-xl max-h-[90vh] overflow-y-auto border-slate-700 p-6 shadow-2xl relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Create New Order</h3>
              <p className="text-xs text-slate-400">Triggers Transactional Outbox & Saga Orchestration</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mt-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-5">
          {/* Customer ID */}
          <div>
            <label className="block text-2xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              Customer Reference ID
            </label>
            <input
              type="text"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              placeholder="e.g. CUST-9902 or user_alice"
              required
              className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono transition-colors"
            />
          </div>

          {/* Line Items */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-2xs font-semibold uppercase tracking-wider text-slate-300">
                Order Line Items
              </label>
              <button
                type="button"
                onClick={handleAddItem}
                className="flex items-center gap-1.5 text-2xs font-semibold text-cyan-400 hover:text-cyan-300 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Item
              </button>
            </div>

            <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
              {items.map((item, idx) => (
                <div 
                  key={idx} 
                  className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center gap-2.5"
                >
                  {/* SKU dropdown or text */}
                  <div className="flex-1">
                    <label className="block text-3xs text-slate-500 mb-1">SKU</label>
                    {inventory.length > 0 ? (
                      <select
                        value={item.sku}
                        onChange={(e) => handleItemChange(idx, 'sku', e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white font-mono focus:outline-none focus:border-cyan-500 cursor-pointer"
                      >
                        {inventory.map((inv) => (
                          <option key={inv.sku} value={inv.sku}>
                            {inv.sku} (Available: {inv.available_quantity})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={item.sku}
                        onChange={(e) => handleItemChange(idx, 'sku', e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white font-mono focus:outline-none focus:border-cyan-500"
                        placeholder="SKU-XXXX"
                      />
                    )}
                  </div>

                  {/* Qty */}
                  <div className="w-20">
                    <label className="block text-3xs text-slate-500 mb-1">Quantity</label>
                    <input
                      type="number"
                      min={1}
                      value={item.quantity}
                      onChange={(e) => handleItemChange(idx, 'quantity', e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white font-mono focus:outline-none focus:border-cyan-500 text-center"
                    />
                  </div>

                  {/* Price */}
                  <div className="w-28">
                    <label className="block text-3xs text-slate-500 mb-1">Unit Price ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      value={item.price}
                      onChange={(e) => handleItemChange(idx, 'price', e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-white font-mono focus:outline-none focus:border-cyan-500 text-right"
                    />
                  </div>

                  {/* Remove Button */}
                  {items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveItem(idx)}
                      className="mt-4 p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Total & Action */}
          <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
            <div>
              <span className="text-3xs uppercase tracking-wider text-slate-400 block">Total Order Value</span>
              <span className="text-xl font-bold font-mono text-cyan-400">
                ${calculateTotal().toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold text-xs shadow-lg shadow-cyan-900/30 transition-all cursor-pointer disabled:opacity-50"
              >
                <Sparkles className="w-4 h-4" />
                <span>{isSubmitting ? 'Submitting...' : 'Dispatch Saga Order'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
