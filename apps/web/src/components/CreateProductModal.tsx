'use client';

import React, { useState } from 'react';
import { X, PlusCircle, AlertCircle, Package } from 'lucide-react';
import { createInventoryItem } from '../lib/api';

interface CreateProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  showToast: (type: 'success' | 'error' | 'info', message: string) => void;
}

export default function CreateProductModal({
  isOpen,
  onClose,
  onSuccess,
  showToast
}: CreateProductModalProps) {
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [initialQuantity, setInitialQuantity] = useState(50);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      if (!sku.trim()) {
        throw new Error('SKU identifier is required');
      }

      await createInventoryItem({
        sku: sku.trim().toUpperCase(),
        name: name.trim(),
        availableQuantity: initialQuantity
      });
      showToast('success', `Created product SKU: ${sku.toUpperCase()}`);
      setSku('');
      setName('');
      setInitialQuantity(50);
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to register product SKU';
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
              <Package className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Register New Product SKU</h3>
              <p className="text-xs text-slate-400">Inventory Catalog Creation</p>
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
              Unique SKU Code
            </label>
            <input
              type="text"
              value={sku}
              onChange={(e) => setSku(e.target.value.toUpperCase())}
              placeholder="e.g. SKU-RTX-5090"
              required
              className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 font-mono focus:outline-none focus:border-purple-500 uppercase"
            />
          </div>

          <div>
            <label className="block text-2xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              Product Name / Title
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. NVIDIA GeForce RTX 5090 32GB"
              className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
            />
          </div>

          <div>
            <label className="block text-2xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              Initial Quantity in Stock
            </label>
            <input
              type="number"
              min={0}
              value={initialQuantity}
              onChange={(e) => setInitialQuantity(Math.max(0, parseInt(e.target.value) || 0))}
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
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-400 hover:to-pink-500 text-white font-semibold text-xs shadow-lg shadow-purple-900/30 transition-all cursor-pointer disabled:opacity-50"
            >
              <PlusCircle className="w-4 h-4" />
              <span>{isSubmitting ? 'Registering...' : 'Register SKU'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
