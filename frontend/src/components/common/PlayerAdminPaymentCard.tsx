import React, { useState, useEffect } from 'react';
import { ApiClient } from '../../api/client';
import { AdminPaymentInfo } from '../../../../shared/src/types';
import {
  QrCode,
  Copy,
  Check,
  ShieldCheck,
  Sparkles,
  ExternalLink,
  Coins,
  Maximize2,
  X,
  CreditCard,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';

interface PlayerAdminPaymentCardProps {
  onRequestTokens: () => void;
  compact?: boolean;
}

export const PlayerAdminPaymentCard: React.FC<PlayerAdminPaymentCardProps> = ({
  onRequestTokens,
  compact = false,
}) => {
  const [adminPayment, setAdminPayment] = useState<AdminPaymentInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [isZoomed, setIsZoomed] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchAdminPayment = () => {
    setIsRefreshing(true);
    ApiClient.getAdminPaymentInfo()
      .then((info) => setAdminPayment(info))
      .catch((err) => console.warn('Could not load admin payment info:', err))
      .finally(() => {
        setLoading(false);
        setTimeout(() => setIsRefreshing(false), 400);
      });
  };

  useEffect(() => {
    fetchAdminPayment();

    const handleUpdate = () => {
      fetchAdminPayment();
    };

    window.addEventListener('admin_payment_updated', handleUpdate);
    window.addEventListener('storage', handleUpdate);
    return () => {
      window.removeEventListener('admin_payment_updated', handleUpdate);
      window.removeEventListener('storage', handleUpdate);
    };
  }, []);

  const handleCopyUpi = () => {
    if (!adminPayment?.upiId) return;
    navigator.clipboard.writeText(adminPayment.upiId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const upiId = adminPayment?.upiId || 'admin.bravo@oksbi';
  const qrImage =
    adminPayment?.upiQrCode ||
    `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(
      `upi://pay?pa=${upiId}&pn=${encodeURIComponent(
        adminPayment?.paymentAccountName || 'BigDaddy Agent'
      )}&cu=INR`
    )}`;

  if (compact) {
    return (
      <div className="bg-gradient-to-r from-amber-950/30 via-zinc-900 to-zinc-950 border border-amber-500/40 rounded-xl p-2.5 shadow-md">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <QrCode className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-[10px] font-bold text-amber-200 uppercase font-serif tracking-wider">
              Admin Payment QR & UPI
            </span>
          </div>
          <span className="text-[8px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/30">
            ● Direct Agent
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          {/* QR Thumbnail */}
          <div
            onClick={() => setIsZoomed(true)}
            className="w-16 h-16 rounded-lg bg-zinc-950 border border-amber-500/40 p-0.5 shrink-0 cursor-pointer relative group overflow-hidden shadow-inner"
            title="Click to zoom QR photo"
          >
            <img src={qrImage} alt="Admin UPI QR" className="w-full h-full object-contain rounded" />
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
              <Maximize2 className="w-3.5 h-3.5 text-white" />
            </div>
          </div>

          {/* UPI ID & 1-Tap Copy */}
          <div className="flex-1 min-w-0">
            <span className="text-[9px] text-zinc-400 block truncate">
              {adminPayment?.paymentAccountName || `${adminPayment?.adminUsername || 'Agent'} Bravo`}
            </span>
            <div className="text-xs font-mono font-bold text-amber-300 truncate tracking-tight mb-1">
              {upiId}
            </div>

            <button
              onClick={handleCopyUpi}
              className={`w-full py-1 px-2 rounded-lg font-bold text-[10px] flex items-center justify-center gap-1 transition active:scale-95 shadow-sm ${
                copied
                  ? 'bg-emerald-500 text-zinc-950 shadow-emerald-500/20'
                  : 'bg-amber-500 hover:bg-amber-400 text-zinc-950 shadow-amber-500/20'
              }`}
            >
              {copied ? (
                <>
                  <Check className="w-3 h-3 text-zinc-950" />
                  <span>UPI ID Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  <span>Copy UPI ID</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Modal for Zoomed QR Photo */}
        {isZoomed && (
          <div
            onClick={() => setIsZoomed(false)}
            className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="bg-zinc-950 border border-amber-500/40 rounded-2xl p-4 max-w-[320px] w-full text-center relative shadow-2xl"
            >
              <button
                onClick={() => setIsZoomed(false)}
                className="absolute top-2.5 right-2.5 p-1 rounded-full bg-zinc-900 text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
              <h4 className="text-xs font-black text-amber-300 uppercase font-serif mb-2">
                Scan Admin QR Photo
              </h4>
              <div className="w-56 h-56 mx-auto rounded-xl bg-white p-2 shadow-inner mb-3">
                <img src={qrImage} alt="Admin QR Full" className="w-full h-full object-contain" />
              </div>
              <div className="text-xs font-mono font-bold text-amber-300 mb-2">{upiId}</div>
              <button
                onClick={handleCopyUpi}
                className="w-full py-2 rounded-xl bg-amber-500 text-zinc-950 font-bold text-xs flex items-center justify-center gap-1.5"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied!' : 'Copy UPI ID'}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-zinc-950 rounded-2xl border border-amber-500/30 p-3.5 shadow-xl relative overflow-hidden transition-all text-zinc-100">
      {/* Card Header */}
      <div className="flex items-center justify-between pb-2 border-b border-zinc-800/80 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-400 via-amber-600 to-yellow-700 flex items-center justify-center shadow-md shadow-amber-500/20 text-zinc-950 font-bold">
            <QrCode className="w-4.5 h-4.5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5 leading-none">
              <h3 className="text-xs font-black text-amber-200 uppercase font-serif tracking-wider">
                Admin Deposit QR & UPI
              </h3>
            </div>
            <span className="text-[9px] text-zinc-400 font-medium mt-0.5 block">
              Official Agent: <strong className="text-zinc-200">{adminPayment?.adminUsername || 'Admin Bravo'}</strong>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={fetchAdminPayment}
            title="Refresh Admin Payment Details"
            className="p-1 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-amber-400 transition"
          >
            <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin text-amber-400' : ''}`} />
          </button>
          <div className="flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-mono">
            <ShieldCheck className="w-3 h-3 text-emerald-400" />
            <span>Verified Agent</span>
          </div>
        </div>
      </div>

      {/* Main Content Layout */}
      <div className="flex flex-col items-center">
        {/* Admin QR Code Photo Frame with Zoom CTA */}
        <div className="relative group mb-3">
          <div
            onClick={() => setIsZoomed(true)}
            className="w-40 h-40 rounded-2xl bg-zinc-900 border-2 border-amber-500/40 p-2 shadow-lg shadow-black/80 flex items-center justify-center cursor-pointer transition transform active:scale-95 group-hover:border-amber-400"
            title="Click to zoom full screen"
          >
            <img
              src={qrImage}
              alt="Admin Payment QR Photo"
              className="w-full h-full object-contain rounded-xl bg-white"
            />
            {/* Hover overlay hint */}
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 rounded-2xl flex flex-col items-center justify-center text-white text-[10px] font-bold transition gap-1">
              <Maximize2 className="w-5 h-5 text-amber-400" />
              <span>Tap to Enlarge</span>
            </div>
          </div>

          <span className="text-[8px] text-zinc-500 text-center block mt-1 font-mono">
            Tap QR to zoom full-screen
          </span>
        </div>

        {/* Admin UPI Details Card */}
        <div className="w-full bg-zinc-900/80 border border-zinc-800 rounded-xl p-2.5 mb-3">
          <div className="flex items-center justify-between text-[9px] text-zinc-400 uppercase font-semibold mb-1">
            <span>Admin UPI ID (Pay Here)</span>
            <span className="text-amber-400 font-bold">Instant Chip Credit</span>
          </div>

          {/* UPI Address Box with 1-Tap Copy */}
          <div className="flex items-center justify-between bg-zinc-950 border border-amber-500/30 rounded-lg p-1.5 pl-2.5">
            <div className="truncate mr-2">
              <span className="text-xs font-mono font-black text-amber-300 block truncate">
                {upiId}
              </span>
              <span className="text-[8px] text-zinc-400 truncate block">
                {adminPayment?.paymentAccountName || 'Official Casino Agent Bravo'}
              </span>
            </div>

            <button
              onClick={handleCopyUpi}
              className={`px-3 py-1.5 rounded-md font-bold text-xs flex items-center gap-1 transition active:scale-95 shrink-0 shadow-sm ${
                copied
                  ? 'bg-emerald-500 text-zinc-950 shadow-emerald-500/30'
                  : 'bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-zinc-950 shadow-amber-500/20'
              }`}
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-zinc-950" />
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy UPI</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Step-by-Step Deposit Instructions (Telugu & English) */}
        <div className="w-full bg-amber-950/20 border border-amber-500/20 rounded-xl p-2.5 mb-3 text-[10px] space-y-1 text-zinc-300">
          <div className="text-[10px] font-bold text-amber-300 uppercase flex items-center gap-1 mb-1">
            <Sparkles className="w-3 h-3" />
            <span>How to Deposit Chips / చిప్స్ ఎలా పొందాలి:</span>
          </div>
          <p className="leading-tight text-zinc-300">
            1. పైన ఉన్న <strong>QR ఫోటోను స్కాన్ చేయండి</strong> లేదా <strong>UPI ID ని కాపీ చేయండి</strong>.
          </p>
          <p className="leading-tight text-zinc-300">
            2. Google Pay / PhonePe / Paytm లో కావలసిన మొత్తం పేమెంట్ చేయండి.
          </p>
          <p className="leading-tight text-zinc-300">
            3. పేమెంట్ పూర్తయిన తర్వాత కింద ఉన్న <strong>"Request Additional Chips"</strong> బటన్ నొక్కి అమౌంట్ & UTR నోట్ సబ్మిట్ చేయండి. మీ అడ్మిన్ వెంటనే చిప్స్ యాడ్ చేస్తారు!
          </p>
        </div>

        {/* Action Button: Open Token Request Modal */}
        <button
          onClick={onRequestTokens}
          className="w-full py-2.5 rounded-xl font-black text-xs uppercase tracking-wider bg-gradient-to-r from-amber-500 via-amber-600 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-zinc-950 shadow-md shadow-amber-500/20 flex items-center justify-center gap-1.5 transition active:scale-[0.98]"
        >
          <Coins className="w-4 h-4" />
          <span>Request Chips (Submit Deposit)</span>
        </button>
      </div>

      {/* Full Screen Image Modal */}
      {isZoomed && (
        <div
          onClick={() => setIsZoomed(false)}
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-zinc-950 border border-amber-500/40 rounded-2xl p-4 max-w-[340px] w-full text-center relative shadow-2xl"
          >
            <button
              onClick={() => setIsZoomed(false)}
              className="absolute top-3 right-3 p-1.5 rounded-full bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
            <h4 className="text-sm font-black text-amber-300 uppercase font-serif mb-1">
              Admin Payment QR Photo
            </h4>
            <p className="text-[10px] text-zinc-400 mb-3">
              Scan directly using Google Pay, PhonePe, or Paytm
            </p>
            <div className="w-64 h-64 mx-auto rounded-xl bg-white p-2.5 shadow-inner mb-3">
              <img src={qrImage} alt="Admin QR Full" className="w-full h-full object-contain" />
            </div>
            <div className="text-xs font-mono font-bold text-amber-300 mb-2">{upiId}</div>
            <button
              onClick={handleCopyUpi}
              className="w-full py-2 rounded-xl bg-amber-500 text-zinc-950 font-bold text-xs flex items-center justify-center gap-1.5"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'UPI ID Copied!' : 'Copy UPI ID'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
