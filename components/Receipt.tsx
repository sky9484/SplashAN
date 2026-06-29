"use client";

import { forwardRef, useRef } from "react";
import { useReactToPrint } from "react-to-print";
import { Download, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ReceiptProps = {
  txDigest: string;
  sender: string;
  recipient: string;
  amount: string;
  currency: string;
  fee: string;
  feeTier?: 'STANDARD' | 'DISCOUNT';
  fundingSource?: string;
  timestamp: string;
  reference?: string;
  explorerUrl?: string | null;
};

type LegacyReceiptProps = {
  transactionId: string;
  recipient?: string;
  amount?: string;
  time?: string;
  className?: string;
};

const SettlementReceipt = forwardRef<HTMLDivElement, ReceiptProps>(function SettlementReceipt(props, ref) {
  return (
    <div ref={ref} className="mx-auto max-w-xl bg-[#F6F0ED] p-10 font-sans text-[#326273]">
      <div className="mb-6 flex items-center justify-between border-b-2 border-[#326273] pb-4">
        <div className="text-3xl font-extrabold">
          SPLASH<span className="text-[#5C9EAD]">.</span>
        </div>
        <div className="text-right text-xs">
          <div className="font-bold">SETTLEMENT RECEIPT</div>
          <div className="mt-1 font-mono text-[10px]">{props.timestamp}</div>
        </div>
      </div>
      <div className="space-y-3 text-sm">
        <ReceiptRow label="Reference" value={props.reference ?? "—"} />
        <ReceiptRow label="Sender" value={props.sender} />
        <ReceiptRow label="Recipient" value={props.recipient} />
        <ReceiptRow label="Amount" value={`${props.amount} ${props.currency}`} />
        <ReceiptRow label={`Fee (${props.feeTier ?? 'STANDARD'})`} value={`${props.fee} ${props.currency}`} />
        <ReceiptRow label="Payment source" value={props.fundingSource ?? 'Bank USD to native USDC'} />
        <ReceiptRow label="On-chain digest" value={props.txDigest} mono />
        {props.explorerUrl && (
          <ReceiptRow label="Sui Explorer" value={props.explorerUrl} mono />
        )}
      </div>
      <div className="mt-8 border-t border-[#326273]/20 pt-4 text-[10px] text-[#326273]/60">
        Verify this settlement on chain at the Sui Explorer URL above. The digest is the immutable transaction reference recorded on Sui testnet.
      </div>
    </div>
  );
});

function ReceiptRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-[#326273]/60">{label}</span>
      <span className={`text-right ${mono ? "break-all font-mono text-xs" : "font-medium"}`}>{value}</span>
    </div>
  );
}

export function Receipt({
  transactionId,
  recipient = "Batch payroll recipients",
  amount = "RM 24,880.00",
  time = "400ms",
  className,
}: LegacyReceiptProps) {
  const receiptRef = useRef<HTMLDivElement>(null);
  const printReceipt = useReactToPrint({
    contentRef: receiptRef,
    documentTitle: `Splash receipt ${transactionId}`,
  });

  return (
    <div className={cn("space-y-3", className)}>
      <div
        ref={receiptRef}
        className="relative overflow-hidden rounded-t-2xl bg-[#fffaf6] p-6 text-[#326273] shadow-xl ring-1 ring-[#326273]/10 before:absolute before:inset-x-0 before:bottom-0 before:h-4 before:bg-[linear-gradient(135deg,transparent_75%,#F6F0ED_75%),linear-gradient(225deg,transparent_75%,#F6F0ED_75%)] before:bg-[length:16px_16px] before:bg-bottom"
      >
        <div className="flex items-start justify-between gap-6 border-b border-dashed border-[#326273]/25 pb-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[#5C9EAD]">Splash Finance</p>
            <h3 className="mt-2 text-2xl font-semibold">Settlement Receipt</h3>
          </div>
          <div className="rounded-full bg-[#E39774]/15 px-3 py-1 text-xs font-semibold text-[#b65f3f]">Sponsored</div>
        </div>

        <div className="mt-5 space-y-3 text-sm">
          <div className="flex justify-between gap-6">
            <span className="text-[#326273]/65">Transaction ID</span>
            <span className="max-w-44 truncate font-mono font-medium">{transactionId}</span>
          </div>
          <div className="flex justify-between gap-6">
            <span className="text-[#326273]/65">Recipient</span>
            <span className="text-right font-medium">{recipient}</span>
          </div>
          <div className="flex justify-between gap-6">
            <span className="text-[#326273]/65">Amount</span>
            <span className="font-medium">{amount}</span>
          </div>
          <div className="flex justify-between gap-6">
            <span className="text-[#326273]/65">Time</span>
            <span className="font-medium">{time}</span>
          </div>
          <div className="flex justify-between gap-6">
            <span className="text-[#326273]/65">Network Fee</span>
            <span className="font-medium text-[#5C9EAD]">Sponsored</span>
          </div>
        </div>
      </div>

      <Button type="button" variant="outline" onClick={() => printReceipt()} className="gap-2 border-[#5C9EAD]/40 text-[#326273]">
        <Printer className="size-4" />
        Print receipt
        <Download className="size-4" />
      </Button>
    </div>
  );
}

export default SettlementReceipt;
