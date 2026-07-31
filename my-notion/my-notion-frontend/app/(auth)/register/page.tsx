'use client';

import { useState, type FormEvent } from 'react';
import { signIn } from 'next-auth/react';
import Link from 'next/link';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    // Goes through the /api/register Route Handler, which forwards to
    // my-notion-backend's POST /api/v1/auth/register (spine boundary: no
    // direct frontend -> backend fetch from the browser).
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setSubmitting(false);
      setError(
        res.status === 409
          ? 'An account with this email already exists.'
          : (data?.error?.message ?? 'Registration failed.'),
      );
      return;
    }

    // Registration succeeded — sign in through Auth.js so it mints the
    // actual session JWT (AD-5: Auth.js is the single token issuer).
    const result = await signIn('credentials', { email, password, redirect: false });
    setSubmitting(false);

    if (!result || result.error) {
      // Registered but auto-login failed for some reason — send to /login.
      window.location.assign('/login');
      return;
    }

    window.location.assign('/');
  }

  return (
    <main className="mx-auto flex min-h-full w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-16">
      <h1 className="text-2xl font-semibold">Create your My Notion account</h1>

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
            minLength={8}
            autoComplete="new-password"
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
          {submitting ? 'Creating account…' : 'Register'}
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
        Already have an account?{' '}
        <Link href="/login" className="underline">
          Log in
        </Link>
      </p>
    </main>
  );
}
