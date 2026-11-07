"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section className="panel">
      <h1>Something interrupted your workspace.</h1>
      <p role="alert">Please try again. Saved briefs are retained.</p>
      <button onClick={reset}>Try again</button>
    </section>
  );
}
