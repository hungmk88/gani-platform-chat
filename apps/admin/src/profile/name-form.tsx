'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api } from '../api/client';
import type { Me } from '../me';
import { ApiFailure, unwrap } from '../query/fetch';
import { MAX_NAME, nameError, nameOf } from './name';

const input = 'rounded-input border border-border-strong px-3 py-2';
const primary = 'rounded-input bg-accent px-4 py-2 text-accent-on disabled:opacity-70';

/**
 * "Đổi tên" (#5, `PATCH /v1/me`, N162): the name one goes by, everywhere in the app. Waits for the server, no Idempotency-Key (it
 * sets a value); then the frame reads /v1/me again (`router.refresh`), so the top bar shows the new name.
 */
export function NameForm({ name }: { name: string }) {
  const router = useRouter();
  const [value, setValue] = useState(name);
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation<Me, ApiFailure, string>({
    mutationFn: (next) => unwrap(api<Me>('/v1/me', { method: 'PATCH', body: { name: next } })),
    onSuccess: (me) => {
      setValue(me.name);
      router.refresh();
    },
  });
  const unchanged = value.trim() === name;

  return (
    <form
      aria-labelledby="name-title"
      className="flex max-w-[400px] flex-col gap-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (save.isPending || unchanged) return;
        const body = nameOf(value);
        if (typeof body === 'string') return setProblem(body);
        save.mutate(body.name);
      }}
    >
      <h2 id="name-title" className="text-16 font-semibold">
        Đổi tên
      </h2>
      <label className="flex flex-col gap-1">
        Tên hiển thị
        <input
          value={value}
          maxLength={MAX_NAME}
          autoComplete="name"
          aria-invalid={problem ? true : undefined}
          className={input}
          onChange={(e) => {
            setValue(e.target.value);
            setProblem(null);
            save.reset();
          }}
        />
      </label>
      {problem ? <p role="alert">{problem}</p> : null}
      {save.error ? (
        <div role="alert">
          <p>{nameError(save.error.error)}</p>
          {save.error.error.traceId ? (
            <p className="text-12 text-text-muted">Mã: {save.error.error.traceId}</p>
          ) : null}
        </div>
      ) : null}
      {save.isSuccess ? <p role="status">Đã lưu tên {save.data.name}.</p> : null}
      <div>
        <button
          type="submit"
          className={primary}
          disabled={save.isPending || unchanged}
          aria-busy={save.isPending}
        >
          {save.isPending ? 'Đang lưu…' : 'Lưu tên'}
        </button>
      </div>
    </form>
  );
}
