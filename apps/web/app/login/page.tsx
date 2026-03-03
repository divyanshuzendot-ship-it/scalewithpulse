import Link from 'next/link';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const hasError = params.error === '1';

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <h1>Pulse Internal Access</h1>
        <p>
          Google SSO is the production target. This placeholder keeps the POC
          behind internal controls for <strong>@adbuffs.com</strong> users.
        </p>
        <form action="/api/auth/login" method="post" className="auth-form">
          <label>
            Work email
            <input
              type="email"
              name="email"
              placeholder="name@adbuffs.com"
              required
            />
          </label>
          <label>
            Temporary access code
            <input
              type="password"
              name="token"
              placeholder="Configured in INTERNAL_AUTH_BYPASS_TOKEN"
              required
            />
          </label>
          <button type="submit">Continue</button>
        </form>
        {hasError ? <p className="error">Invalid email domain or code.</p> : null}
        <p className="muted">
          Next step: replace this screen with Google OAuth and enforce roles from
          backend contracts.
        </p>
        <Link href="https://developers.google.com/identity" target="_blank">
          Google Identity docs
        </Link>
      </section>
    </main>
  );
}
