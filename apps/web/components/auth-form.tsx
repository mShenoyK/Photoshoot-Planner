"use client";
import { useState } from "react";
import { api } from "./client";
export function AuthForm() {
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <section className="panel auth">
      <p className="eyebrow">Your creative workspace</p>
      <h1>
        A little preparation.
        <br />A better photograph.
      </h1>
      <p className="muted">
        Plan the people, place, and light. Keep every shoot in focus.
      </p>
      <h2>{register ? "Create your account" : "Welcome back"}</h2>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const f = new FormData(e.currentTarget);
          try {
            await api("auth/" + (register ? "register" : "login"), "POST", {
              email: f.get("email"),
              password: f.get("password"),
            });
            window.location.assign("/dashboard");
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="field">
          <label htmlFor="email">Email address</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete={register ? "new-password" : "current-password"}
            minLength={12}
            maxLength={128}
            required
          />
          <span className="hint">Use at least 12 characters.</span>
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button disabled={busy} type="submit">
          {busy ? "Please wait…" : register ? "Create account" : "Sign in"}{" "}
          <span aria-hidden>→</span>
        </button>
      </form>
      <div className="actions">
        <button
          className="secondary"
          onClick={() => {
            setRegister(!register);
            setError("");
          }}
        >
          {register
            ? "Already have an account? Sign in"
            : "New here? Create account"}
        </button>
      </div>
    </section>
  );
}
