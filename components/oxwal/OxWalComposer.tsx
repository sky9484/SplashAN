'use client';

import type { Ref } from 'react';
import {
  AudioLines,
  ChevronDown,
  FileText,
  ImageIcon,
  Mic,
  Pencil,
  Plus,
  Search,
  Send,
} from 'lucide-react';

import { cn } from '@/lib/utils';

export type OxWalComposerChip = {
  label: string;
  prompt?: string;
  icon?: 'file' | 'image' | 'search' | 'write';
};

type OxWalComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onChipSubmit?: (prompt: string) => void;
  chips?: OxWalComposerChip[];
  disabled?: boolean;
  title?: string;
  placeholder?: string;
  priorityLabel?: string;
  compact?: boolean;
  className?: string;
  inputRef?: Ref<HTMLInputElement>;
};

const chipIcons = {
  file: FileText,
  image: ImageIcon,
  search: Search,
  write: Pencil,
} as const;

export default function OxWalComposer({
  value,
  onChange,
  onSubmit,
  onChipSubmit,
  chips = [],
  disabled = false,
  title,
  placeholder = 'Ask anything',
  priorityLabel = 'High',
  compact = false,
  className,
  inputRef,
}: OxWalComposerProps) {
  const hasValue = value.trim().length > 0;

  return (
    <div className={cn('mx-auto w-full max-w-3xl text-center', compact && 'max-w-none', className)}>
      {title && (
        <h2 className={cn('font-semibold tracking-normal text-[#050505]', compact ? 'text-base' : 'text-2xl')}>
          {title}
        </h2>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        className={cn(
          'mt-6 flex min-h-14 items-center gap-2 rounded-full border border-[#326273]/10 bg-white px-3 shadow-[0_14px_42px_rgba(31,68,82,0.12)] ring-1 ring-black/5',
          compact && 'mt-3 min-h-12 px-2 shadow-[0_10px_28px_rgba(31,68,82,0.12)]',
          disabled && 'opacity-75',
        )}
      >
        <button
          type="button"
          aria-label="Add context"
          disabled={disabled}
          className={cn(
            'grid shrink-0 place-items-center rounded-full text-[#1F4452] transition hover:bg-[#F6F0ED] disabled:cursor-not-allowed disabled:opacity-45',
            compact ? 'h-8 w-8' : 'h-10 w-10',
          )}
        >
          <Plus className={compact ? 'h-4 w-4' : 'h-5 w-5'} />
        </button>
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          className={cn(
            'min-w-0 flex-1 bg-transparent text-left font-medium text-[#111827] outline-none placeholder:text-[#87919A] disabled:cursor-not-allowed',
            compact ? 'text-xs' : 'text-sm',
          )}
        />
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'hidden shrink-0 items-center gap-1 rounded-full px-2 font-medium text-[#6E7781] transition hover:bg-[#F6F0ED] disabled:cursor-not-allowed disabled:opacity-45 sm:inline-flex',
            compact ? 'h-8 text-[11px]' : 'h-9 text-sm',
          )}
        >
          {priorityLabel}
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label="Voice input"
          disabled={disabled}
          className={cn(
            'grid shrink-0 place-items-center rounded-full text-[#111827] transition hover:bg-[#F6F0ED] disabled:cursor-not-allowed disabled:opacity-45',
            compact ? 'h-8 w-8' : 'h-9 w-9',
          )}
        >
          <Mic className={compact ? 'h-4 w-4' : 'h-5 w-5'} />
        </button>
        <button
          type="submit"
          aria-label={hasValue ? 'Send to 0xWal' : 'Start voice action'}
          disabled={disabled}
          className={cn(
            'grid shrink-0 place-items-center rounded-full bg-black text-white shadow-[0_8px_18px_rgba(0,0,0,0.22)] transition hover:scale-[1.03] disabled:cursor-not-allowed disabled:opacity-45',
            compact ? 'h-9 w-9' : 'h-11 w-11',
          )}
        >
          {hasValue ? <Send className={compact ? 'h-4 w-4' : 'h-5 w-5'} /> : <AudioLines className={compact ? 'h-4 w-4' : 'h-5 w-5'} />}
        </button>
      </form>
      {chips.length > 0 && (
        <div className={cn('mt-5 flex flex-wrap justify-center gap-3', compact && 'mt-3 gap-2')}>
          {chips.map((chip) => {
            const Icon = chipIcons[chip.icon ?? 'file'];
            const prompt = chip.prompt ?? chip.label;
            return (
              <button
                key={chip.label}
                type="button"
                disabled={disabled}
                onClick={() => {
                  if (onChipSubmit) onChipSubmit(prompt);
                  else onChange(prompt);
                }}
                className={cn(
                  'inline-flex items-center gap-2 rounded-full border border-[#326273]/10 bg-white px-4 py-2 font-medium text-[#6E7781] shadow-sm transition hover:border-[#5C9EAD]/30 hover:text-[#1F4452] disabled:cursor-not-allowed disabled:opacity-45',
                  compact ? 'px-3 py-1.5 text-[11px]' : 'text-sm',
                )}
              >
                <Icon className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
                {chip.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
