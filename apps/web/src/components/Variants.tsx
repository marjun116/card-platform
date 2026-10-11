/** Saving house rules as a named variant, and sharing its link. */
import type { OptionValue } from '@card-table/engine';
import type { VariantInfo } from '@card-table/server/protocol';
import { type FormEvent, useState } from 'react';
import { api, ApiError, variantLink } from '../api';

/** Copies `text`, then says so. */
export function CopyButton({ text, label = 'Copy link' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard
      .writeText(text)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };
  return (
    <>
      <button type="button" className="small" onClick={copy}>
        {label}
      </button>
      <span role="status" className="muted">
        {copied ? 'Copied' : ''}
      </span>
    </>
  );
}

/**
 * "Save as variant": a button that opens a name field. Once saved, it shows
 * the share link.
 */
export function SaveVariant({
  game,
  options,
  playerCount,
  onSaved,
}: {
  game: string;
  options: Record<string, OptionValue>;
  playerCount: number;
  onSaved?: (variant: VariantInfo) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<VariantInfo | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    api
      .saveVariant(game, name.trim(), options, playerCount)
      .then((variant) => {
        setSaved(variant);
        setOpen(false);
        setName('');
        onSaved?.(variant);
      })
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Could not save it'))
      .finally(() => setBusy(false));
  };

  return (
    <div className="save-variant stack">
      {saved && (
        <div className="invite">
          <label className="field">
            Saved “{saved.name}”. Share it with this link:
            <input readOnly value={variantLink(saved)} onFocus={(e) => e.currentTarget.select()} />
          </label>
          <CopyButton text={variantLink(saved)} />
        </div>
      )}
      {open ? (
        <form onSubmit={submit} className="inline-form">
          <label className="field">
            Name these house rules
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Grandma's rules"
              maxLength={60}
              autoFocus
            />
          </label>
          <button type="submit" className="primary" disabled={busy || name.trim() === ''}>
            Save
          </button>
          <button type="button" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <p>
          <button type="button" onClick={() => setOpen(true)}>
            {saved ? 'Save another variant' : 'Save as variant'}
          </button>
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
