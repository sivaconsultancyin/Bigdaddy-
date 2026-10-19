import React from 'react';
import { X, CheckCircle, XCircle, User, Coins, Calendar, FileText, Check, ShieldCheck } from 'lucide-react';
import { TokenRequest } from '../../../../shared/src/types';

interface ProofScreenshotModalProps {
  request: TokenRequest | null;
  isOpen: boolean;
  onClose: () => void;
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  approving?: boolean;
}

export const ProofScreenshotModal: React.FC<ProofScreenshotModalProps> = ({
  request,
  isOpen,
  onClose,
  onApprove,
  onReject,
  approving = false,
}) => {
  if (!isOpen || !request) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-3 animate-fadeIn"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-zinc-950 border border-amber-500/40 rounded-2xl w-full max-w-[420px] max-h-[92vh] flex flex-col shadow-2xl relative text-zinc-100 overflow-hidden"
      >
        {/* Modal Header */}
        <div className="p-3.5 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/60">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center font-bold">
              <ShieldCheck className="w-4.5 h-4.5" />
            </div>
            <div>
              <h3 className="text-xs font-black text-amber-200 uppercase font-serif tracking-wider">
                Payment Proof Verification
              </h3>
              <span className="text-[10px] text-zinc-400">
                Player: <strong className="text-zinc-200">{request.requesterUsername}</strong>
              </span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
          >
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        {/* Modal Body: Screenshot & Details */}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
          {/* Screenshot Display */}
          <div className="w-full bg-zinc-900 rounded-xl border border-zinc-800 p-2 text-center flex flex-col items-center justify-center shadow-inner">
            {request.proofScreenshot ? (
              <div className="relative group max-h-[50vh] overflow-hidden rounded-lg">
                <img
                  src={request.proofScreenshot}
                  alt={`Payment proof from ${request.requesterUsername}`}
                  className="w-full h-auto max-h-[48vh] object-contain rounded-lg mx-auto bg-black"
                />
              </div>
            ) : (
              <div className="py-8 text-zinc-500 text-xs">
                <FileText className="w-8 h-8 mx-auto mb-1 text-zinc-600" />
                <span>No screenshot was attached with this request.</span>
              </div>
            )}
            <span className="text-[9px] text-zinc-500 mt-1.5 block font-mono">
              Player Uploaded Transaction Receipt
            </span>
          </div>

          {/* Transaction Metadata Grid */}
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-2.5 space-y-1.5 text-xs">
            <div className="flex items-center justify-between pb-1 border-b border-zinc-800/60">
              <span className="text-zinc-400 text-[11px] flex items-center gap-1">
                <Coins className="w-3.5 h-3.5 text-amber-400" />
                <span>Requested Chips:</span>
              </span>
              <span className="font-mono font-black text-amber-300 text-sm">
                ₹{parseInt(request.amount || '0').toLocaleString()}
              </span>
            </div>

            <div className="flex items-center justify-between pb-1 border-b border-zinc-800/60">
              <span className="text-zinc-400 text-[11px] flex items-center gap-1">
                <User className="w-3.5 h-3.5 text-blue-400" />
                <span>Player Account:</span>
              </span>
              <span className="font-bold text-zinc-200">{request.requesterUsername}</span>
            </div>

            {request.note && (
              <div className="pt-0.5">
                <span className="text-zinc-400 text-[10px] uppercase font-semibold block mb-0.5">
                  Player Note / Transaction UTR:
                </span>
                <div className="bg-zinc-950 rounded-lg p-2 font-mono text-[11px] text-amber-200 border border-zinc-800/80 break-words">
                  {request.note}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between text-[10px] text-zinc-500 pt-1">
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                <span>Submitted at:</span>
              </span>
              <span className="font-mono">
                {new Date(request.createdAt).toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {/* Modal Actions Footer */}
        {onApprove && onReject && (
          <div className="p-3 bg-zinc-900/90 border-t border-zinc-800 flex items-center gap-2">
            <button
              type="button"
              disabled={approving}
              onClick={() => {
                onReject(request.id);
                onClose();
              }}
              className="flex-1 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-xs font-bold transition flex items-center justify-center gap-1.5 active:scale-95 disabled:opacity-50"
            >
              <XCircle className="w-4 h-4 text-rose-400" />
              <span>Reject Request</span>
            </button>

            <button
              type="button"
              disabled={approving}
              onClick={() => {
                onApprove(request.id);
                onClose();
              }}
              className="flex-1 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-zinc-950 text-xs font-black uppercase tracking-wider transition flex items-center justify-center gap-1.5 shadow-md shadow-emerald-500/20 active:scale-95 disabled:opacity-50"
            >
              <CheckCircle className="w-4 h-4 text-zinc-950" />
              <span>Approve & Credit</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
