'use client';

import { useState, type FormEvent } from 'react';
import { signIn } from 'next-auth/react';
import Link from 'next/link';

function friendlyError(code: string | undefined, error: string | undefined): string {
  if (code === 'account_locked') {
    return 'Too many failed attempts. This account is locked for 15 minutes.';
  }
  if (error) {
    return 'Invalid email or password.';
  }
  return 'Something went wrong. Please try again.';
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
    });

    setSubmitting(false);

    if (!result || result.error) {
      setError(friendlyError(result?.code, result?.error));
      return;
    }

    window.location.assign('/');
  }

  return (
    <main className="mx-auto flex min-h-full w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-16">
      <h1 className="text-2xl font-semibold">Log in to My Notion</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded border border-black/15 px-3 py-2 dark:border-white/20"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Password
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded border border-black/15 px-3 py-2 dark:border-white/20"
          />
        </label>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
      </form>

      <button
        type="button"
        onClick={() => signIn('google', { redirectTo: '/' })}
        className="rounded border border-black/15 px-4 py-2 dark:border-white/20"
      >
        Continue with Google
      </button>

      <p className="text-sm">
        No account yet?{' '}
        <Link href="/register" className="underline">
          Register
        </Link>
      </p>
    </main>
  );
}
