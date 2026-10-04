'use client';

import React, { useState, useEffect } from 'react';
import { X, ArrowUpCircle, PackagePlus, AlertCircle } from 'lucide-react';
import { InventoryItem } from '../lib/types';
import { restockInventory } from '../lib/api';

interface RestockModalProps {
  initialSku: string | null;
  inventory: InventoryItem[];
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  showToast: (type: 'success' | 'error' | 'info', message: string) => void;
}

export default function RestockModal({
  initialSku,
  inventory,
  isOpen,
  onClose,
  onSuccess,
  showToast
}: RestockModalProps) {
  const [sku, setSku] = useState(initialSku || (inventory.length > 0 ? inventory[0].sku : ''));
  const [quantity, setQuantity] = useState<number>(25);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialSku) {
      setSku(initialSku);
    } else if (inventory.length > 0 && !sku) {
      setSku(inventory[0].sku);
    }
  }, [initialSku, inventory, sku]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      if (!sku.trim()) {
        throw new Error('Please select or specify a SKU');
      }
      if (quantity <= 0) {
        throw new Error('Quantity must be greater than 0');
      }

      await restockInventory(sku, quantity);
      showToast('success', `Restocked ${quantity} units for ${sku}`);
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to restock item';
      setError(msg);
      showToast('error', msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div 
        className="glass-card w-full max-w-md border-slate-700 p-6 shadow-2xl relative"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-purple-500/20 text-purple-400 border border-purple-500/30">
              <PackagePlus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Replenish Stock</h3>
              <p className="text-xs text-slate-400">Inventory Concurrency Replenishment</p>
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

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label className="block text-2xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              Select Product SKU
            </label>
            {inventory.length > 0 ? (
              <select
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white font-mono focus:outline-none focus:border-purple-500 cursor-pointer"
              >
                {inventory.map((inv) => (
                  <option key={inv.sku} value={inv.sku}>
                    {inv.sku} ({inv.name || 'Unnamed'}) — Currently {inv.available_quantity} in stock
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="SKU-XXXX"
                required
                className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 font-mono focus:outline-none focus:border-purple-500"
              />
            )}
          </div>

          <div>
            <label className="block text-2xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              Units to Add
            </label>
            <input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 0))}
              required
              className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white font-mono focus:outline-none focus:border-purple-500"
            />
          </div>

          <div className="pt-4 border-t border-slate-800 flex items-center justify-end gap-3">
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
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-400 hover:to-indigo-500 text-white font-semibold text-xs shadow-lg shadow-purple-900/30 transition-all cursor-pointer disabled:opacity-50"
            >
              <ArrowUpCircle className="w-4 h-4" />
              <span>{isSubmitting ? 'Replenishing...' : 'Confirm Restock'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
