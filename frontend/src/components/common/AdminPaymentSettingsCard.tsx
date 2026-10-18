import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { ApiClient } from '../../api/client';
import {
  QrCode,
  Upload,
  CheckCircle,
  AlertCircle,
  Copy,
  Check,
  RefreshCw,
  Sparkles,
  Camera,
  Trash2,
  ExternalLink,
} from 'lucide-react';

interface AdminPaymentSettingsCardProps {
  onUpdated?: () => void;
}

export const AdminPaymentSettingsCard: React.FC<AdminPaymentSettingsCardProps> = ({ onUpdated }) => {
  const { user, refreshUser } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [upiId, setUpiId] = useState(user?.upiId || 'admin.bravo@oksbi');
  const [paymentAccountName, setPaymentAccountName] = useState(
    user?.paymentAccountName || `${user?.username || 'Admin'} Official Agent`
  );
  const [upiQrCode, setUpiQrCode] = useState<string>(
    user?.upiQrCode ||
      `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(
        `upi://pay?pa=${user?.upiId || 'admin.bravo@oksbi'}&pn=${encodeURIComponent(
          user?.paymentAccountName || 'Admin'
        )}&cu=INR`
      )}`
  );
  const [photoPreview, setPhotoPreview] = useState<string | null>(user?.upiQrCode || null);
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (user?.upiId) setUpiId(user.upiId);
    if (user?.paymentAccountName) setPaymentAccountName(user.paymentAccountName);
    if (user?.upiQrCode) {
      setUpiQrCode(user.upiQrCode);
      setPhotoPreview(user.upiQrCode);
    }
  }, [user?.upiId, user?.paymentAccountName, user?.upiQrCode]);

  // Handle Photo / QR Code File Upload
  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setErrorMsg('Please select a valid image file (PNG, JPG, WebP).');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setErrorMsg('Image size should be less than 5MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setPhotoPreview(result);
      setUpiQrCode(result);
      setErrorMsg(null);
    };
    reader.onerror = () => {
      setErrorMsg('Failed to read image file.');
    };
    reader.readAsDataURL(file);
  };

  // Generate dynamic QR code from current UPI ID
  const handleGenerateDefaultQr = () => {
    if (!upiId) {
      setErrorMsg('Please enter a UPI ID first.');
      return;
    }
    const cleanUpi = upiId.trim();
    const cleanName = (paymentAccountName || user?.username || 'Admin').trim();
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(
      `upi://pay?pa=${cleanUpi}&pn=${encodeURIComponent(cleanName)}&cu=INR`
    )}`;
    setUpiQrCode(qrUrl);
    setPhotoPreview(qrUrl);
    setErrorMsg(null);
  };

  const handleCopyUpi = () => {
    if (!upiId) return;
    navigator.clipboard.writeText(upiId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!upiId.trim()) {
      setErrorMsg('UPI ID is required (e.g. agent@oksbi)');
      return;
    }

    setLoading(true);
    try {
      await ApiClient.updatePaymentDetails({
        upiId: upiId.trim(),
        paymentAccountName: paymentAccountName.trim(),
        upiQrCode: upiQrCode || undefined,
      });

      await refreshUser();
      if (onUpdated) onUpdated();

      setSuccessMsg(
        'ఫోటో & UPI విజయవంతంగా అప్‌డేట్ చేయబడ్డాయి! మీ ప్లేయర్‌ల వాలెట్‌లో ఇప్పుడే కనిపిస్తాయి. (Photo & UPI updated! Now visible to all your players).'
      );
      setTimeout(() => setSuccessMsg(null), 5000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to update payment details');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-zinc-950 border border-amber-500/30 rounded-2xl p-3.5 shadow-xl relative overflow-hidden text-zinc-100">
      {/* Header */}
      <div className="flex items-center justify-between pb-2.5 border-b border-zinc-800/80 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center shadow-sm">
            <QrCode className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-black text-amber-200 uppercase font-serif tracking-wider leading-none">
              Payment QR & UPI Settings
            </h3>
            <span className="text-[9px] text-zinc-400 font-medium">
              Players will scan this photo & pay to this UPI in their wallet
            </span>
          </div>
        </div>

        <span className="text-[8px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 uppercase">
          Player Visible
        </span>
      </div>

      {successMsg && (
        <div className="mb-3 p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-[11px] leading-relaxed flex items-start gap-2">
          <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="mb-3 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-3">
        {/* Photo Upload & Preview Grid */}
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-3 flex flex-col sm:flex-row items-center gap-3">
          {/* Photo / QR Display Frame */}
          <div className="relative group shrink-0">
            <div className="w-28 h-28 rounded-xl bg-zinc-950 border-2 border-dashed border-amber-500/40 p-1 flex items-center justify-center overflow-hidden shadow-inner">
              {photoPreview ? (
                <img
                  src={photoPreview}
                  alt="Admin Payment QR / Photo"
                  className="w-full h-full object-contain rounded-lg"
                  onError={() => {
                    setErrorMsg('Could not load image preview. Please check image URL or file.');
                  }}
                />
              ) : (
                <div className="text-center p-2 text-zinc-500">
                  <Camera className="w-6 h-6 mx-auto mb-1 text-zinc-600" />
                  <span className="text-[8px] block">No Photo</span>
                </div>
              )}
            </div>

            {photoPreview && (
              <button
                type="button"
                onClick={() => {
                  setPhotoPreview(null);
                  setUpiQrCode('');
                }}
                title="Remove photo"
                className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-rose-500 hover:bg-rose-600 text-white flex items-center justify-center shadow transition active:scale-90"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Photo Upload Actions */}
          <div className="flex-1 space-y-2 w-full">
            <div>
              <span className="text-[10px] font-bold text-zinc-200 block mb-0.5">
                Admin QR Photo / Standee Image
              </span>
              <p className="text-[9px] text-zinc-400 leading-tight mb-2">
                Upload your payment QR photo or Google Pay / PhonePe QR code. Players will see this photo directly when depositing tokens.
              </p>
            </div>

            <input
              type="file"
              ref={fileInputRef}
              onChange={handlePhotoUpload}
              accept="image/*"
              className="hidden"
            />

            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-[10px] flex items-center gap-1.5 transition active:scale-95 shadow-sm shadow-amber-500/20"
              >
                <Upload className="w-3 h-3" />
                <span>Upload QR Photo</span>
              </button>

              <button
                type="button"
                onClick={handleGenerateDefaultQr}
                className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold text-[10px] flex items-center gap-1 transition active:scale-95 border border-zinc-700"
              >
                <Sparkles className="w-3 h-3 text-amber-400" />
                <span>Auto-Generate QR</span>
              </button>
            </div>
          </div>
        </div>

        {/* UPI ID Input */}
        <div>
          <label className="text-[10px] font-bold text-zinc-300 block mb-1 flex items-center justify-between">
            <span>Admin UPI ID (VPA)</span>
            {upiId && (
              <button
                type="button"
                onClick={handleCopyUpi}
                className="text-[9px] text-amber-400 hover:text-amber-300 font-mono font-normal flex items-center gap-0.5"
              >
                {copied ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5" />}
                <span>{copied ? 'Copied' : 'Test Copy'}</span>
              </button>
            )}
          </label>
          <div className="relative">
            <input
              type="text"
              value={upiId}
              onChange={(e) => setUpiId(e.target.value)}
              placeholder="e.g. agent.bigdaddy@oksbi or 9876543210@paytm"
              className="w-full bg-zinc-900 border border-zinc-700 focus:border-amber-500 rounded-xl px-3 py-2 text-xs font-mono text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
              required
            />
          </div>
          <span className="text-[8px] text-zinc-500 mt-0.5 block">
            This UPI ID will appear with a 1-tap Copy button on player screens.
          </span>
        </div>

        {/* Account Holder Name Input */}
        <div>
          <label className="text-[10px] font-bold text-zinc-300 block mb-1">
            Display Account Name (Optional)
          </label>
          <input
            type="text"
            value={paymentAccountName}
            onChange={(e) => setPaymentAccountName(e.target.value)}
            placeholder="e.g. BigDaddy Admin Bravo Official Agent"
            className="w-full bg-zinc-900 border border-zinc-700 focus:border-amber-500 rounded-xl px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
          />
        </div>

        {/* Image URL fallback (if Admin prefers pasting a web URL) */}
        <div>
          <label className="text-[9px] text-zinc-400 block mb-0.5">
            Or Paste Direct QR Image URL (Optional)
          </label>
          <input
            type="url"
            value={upiQrCode.startsWith('data:') ? '' : upiQrCode}
            onChange={(e) => {
              const url = e.target.value;
              setUpiQrCode(url);
              setPhotoPreview(url || null);
            }}
            placeholder="https://example.com/my-qr-code.png"
            className="w-full bg-zinc-900/60 border border-zinc-800 rounded-lg px-2.5 py-1 text-[11px] text-zinc-300 font-mono placeholder:text-zinc-600 focus:outline-none"
          />
        </div>

        {/* Save Button */}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 rounded-xl font-black text-xs uppercase tracking-wider bg-gradient-to-r from-amber-500 via-amber-600 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-zinc-950 shadow-md shadow-amber-500/20 flex items-center justify-center gap-1.5 transition active:scale-[0.98] disabled:opacity-50"
        >
          {loading ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>Saving Changes...</span>
            </>
          ) : (
            <>
              <Check className="w-3.5 h-3.5" />
              <span>Save & Publish to Players</span>
            </>
          )}
        </button>
      </form>
    </div>
  );
};
