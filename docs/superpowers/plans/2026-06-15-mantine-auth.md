# Custom Mantine Auth Screen Implementation Plan (Plan B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Amplify's `<Authenticator>` with a custom Mantine auth experience (sign in, sign up, email-code confirm, forgot-password) on the `aws-amplify/auth` APIs, and remove the unused `@aws-amplify/ui-react` dependency.

**Architecture:** A `useAuth` hook (initial `getCurrentUser()` + Amplify `Hub` `"auth"` events) drives an `AuthGate` that renders a `Loader`, `<App/>`, or `<AuthScreen/>`. `AuthScreen` is a small mode state machine rendering per-mode Mantine forms that call the official Amplify auth functions. The frontend has no unit-test harness, so each task's gate is a clean `pnpm --filter @receipt-scanner/frontend build` (tsc + Vite).

**Tech Stack:** React 18, Vite, TypeScript (ESM), `@mantine/core`, `aws-amplify` (`aws-amplify/auth`, `aws-amplify/utils`).

---

## File Structure

```
packages/frontend/src/
├─ main.tsx                 # MODIFY (Task 4) — render AuthGate, drop Authenticator + ui-react CSS
└─ auth/
   ├─ types.ts              # NEW (Task 1) — AuthMode union
   ├─ SignInForm.tsx        # NEW (Task 1)
   ├─ SignUpForm.tsx        # NEW (Task 1)
   ├─ ConfirmForm.tsx       # NEW (Task 2)
   ├─ ForgotForm.tsx        # NEW (Task 2)
   ├─ AuthScreen.tsx        # NEW (Task 3) — mode machine + shared email/password
   ├─ useAuth.ts            # NEW (Task 4) — status hook
   └─ AuthGate.tsx          # NEW (Task 4) — loading/signedIn/signedOut switch
packages/frontend/package.json  # MODIFY (Task 4) — remove @aws-amplify/ui-react
```

Each task leaves the build green: new-but-unimported components are still type-checked by `tsc` and compile standalone; they get wired into the entry point in Task 4.

---

## Task 1: Auth mode type + Sign-in and Sign-up forms

**Files:**
- Create: `packages/frontend/src/auth/types.ts`
- Create: `packages/frontend/src/auth/SignInForm.tsx`
- Create: `packages/frontend/src/auth/SignUpForm.tsx`

- [ ] **Step 1: Create `packages/frontend/src/auth/types.ts`**

```ts
export type AuthMode = "signIn" | "signUp" | "confirm" | "forgot";
```

- [ ] **Step 2: Create `packages/frontend/src/auth/SignInForm.tsx`**

```tsx
import { useState, type FormEvent } from "react";
import { signIn } from "aws-amplify/auth";
import { Alert, Anchor, Button, Group, PasswordInput, Stack, TextInput } from "@mantine/core";
import type { AuthMode } from "./types.js";

interface Props {
  email: string;
  setEmail: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  setMode: (m: AuthMode) => void;
}

export default function SignInForm({ email, setEmail, password, setPassword, setMode }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { nextStep } = await signIn({ username: email, password });
      // Unverified account: route to the confirmation step instead of erroring.
      if (nextStep.signInStep === "CONFIRM_SIGN_UP") setMode("confirm");
      // On success the Hub "signedIn" event flips the gate to <App/>.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <Stack>
        {error && <Alert color="red">{error}</Alert>}
        <TextInput label="Email" type="email" required value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
        <PasswordInput label="Password" required value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
        <Button type="submit" loading={loading} fullWidth>Sign in</Button>
        <Group justify="space-between">
          <Anchor component="button" type="button" size="sm" onClick={() => setMode("signUp")}>Create account</Anchor>
          <Anchor component="button" type="button" size="sm" onClick={() => setMode("forgot")}>Forgot password?</Anchor>
        </Group>
      </Stack>
    </form>
  );
}
```

- [ ] **Step 3: Create `packages/frontend/src/auth/SignUpForm.tsx`**

```tsx
import { useState, type FormEvent } from "react";
import { signUp } from "aws-amplify/auth";
import { Alert, Anchor, Button, PasswordInput, Stack, TextInput } from "@mantine/core";
import type { AuthMode } from "./types.js";

interface Props {
  email: string;
  setEmail: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  setMode: (m: AuthMode) => void;
}

export default function SignUpForm({ email, setEmail, password, setPassword, setMode }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await signUp({ username: email, password, options: { userAttributes: { email } } });
      setMode("confirm");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign up failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <Stack>
        {error && <Alert color="red">{error}</Alert>}
        <TextInput label="Email" type="email" required value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
        <PasswordInput label="Password" required value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
        <Button type="submit" loading={loading} fullWidth>Create account</Button>
        <Anchor component="button" type="button" size="sm" onClick={() => setMode("signIn")}>Back to sign in</Anchor>
      </Stack>
    </form>
  );
}
```

- [ ] **Step 4: Build to verify**

Run: `pnpm --filter @receipt-scanner/frontend build`
Expected: tsc + Vite succeed, no type errors (the new files are type-checked even though not yet imported).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/auth/types.ts packages/frontend/src/auth/SignInForm.tsx packages/frontend/src/auth/SignUpForm.tsx
git commit -m "feat(frontend): Mantine sign-in and sign-up forms on aws-amplify/auth

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Confirmation and Forgot-password forms

**Files:**
- Create: `packages/frontend/src/auth/ConfirmForm.tsx`
- Create: `packages/frontend/src/auth/ForgotForm.tsx`

- [ ] **Step 1: Create `packages/frontend/src/auth/ConfirmForm.tsx`**

```tsx
import { useState, type FormEvent } from "react";
import { confirmSignUp, resendSignUpCode, signIn } from "aws-amplify/auth";
import { Alert, Anchor, Button, Group, Stack, Text, TextInput } from "@mantine/core";
import type { AuthMode } from "./types.js";

interface Props {
  email: string;
  password: string;
  setMode: (m: AuthMode) => void;
}

export default function ConfirmForm({ email, password, setMode }: Props) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await confirmSignUp({ username: email, confirmationCode: code });
      await signIn({ username: email, password }); // held password → auto sign-in
      // Hub "signedIn" flips the gate to <App/>.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Confirmation failed");
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    setError("");
    try {
      await resendSignUpCode({ username: email });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resend code");
    }
  };

  return (
    <form onSubmit={submit}>
      <Stack>
        <Text size="sm" c="dimmed">Enter the code sent to {email}.</Text>
        {error && <Alert color="red">{error}</Alert>}
        <TextInput label="Verification code" required value={code} onChange={(e) => setCode(e.currentTarget.value)} />
        <Button type="submit" loading={loading} fullWidth>Confirm</Button>
        <Group justify="space-between">
          <Anchor component="button" type="button" size="sm" onClick={resend}>Resend code</Anchor>
          <Anchor component="button" type="button" size="sm" onClick={() => setMode("signIn")}>Back to sign in</Anchor>
        </Group>
      </Stack>
    </form>
  );
}
```

- [ ] **Step 2: Create `packages/frontend/src/auth/ForgotForm.tsx`**

```tsx
import { useState, type FormEvent } from "react";
import { resetPassword, confirmResetPassword } from "aws-amplify/auth";
import { Alert, Anchor, Button, PasswordInput, Stack, Text, TextInput } from "@mantine/core";
import type { AuthMode } from "./types.js";

interface Props {
  email: string;
  setEmail: (v: string) => void;
  setMode: (m: AuthMode) => void;
}

export default function ForgotForm({ email, setEmail, setMode }: Props) {
  const [step, setStep] = useState<"request" | "confirm">("request");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const request = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await resetPassword({ username: email });
      setStep("confirm");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start reset");
    } finally {
      setLoading(false);
    }
  };

  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await confirmResetPassword({ username: email, confirmationCode: code, newPassword });
      setMode("signIn");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset password");
    } finally {
      setLoading(false);
    }
  };

  if (step === "request") {
    return (
      <form onSubmit={request}>
        <Stack>
          <Text size="sm" c="dimmed">We'll email you a reset code.</Text>
          {error && <Alert color="red">{error}</Alert>}
          <TextInput label="Email" type="email" required value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
          <Button type="submit" loading={loading} fullWidth>Send reset code</Button>
          <Anchor component="button" type="button" size="sm" onClick={() => setMode("signIn")}>Back to sign in</Anchor>
        </Stack>
      </form>
    );
  }

  return (
    <form onSubmit={confirm}>
      <Stack>
        {error && <Alert color="red">{error}</Alert>}
        <TextInput label="Reset code" required value={code} onChange={(e) => setCode(e.currentTarget.value)} />
        <PasswordInput label="New password" required value={newPassword} onChange={(e) => setNewPassword(e.currentTarget.value)} />
        <Button type="submit" loading={loading} fullWidth>Reset password</Button>
        <Anchor component="button" type="button" size="sm" onClick={() => setMode("signIn")}>Back to sign in</Anchor>
      </Stack>
    </form>
  );
}
```

- [ ] **Step 3: Build to verify**

Run: `pnpm --filter @receipt-scanner/frontend build`
Expected: succeeds, no type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/auth/ConfirmForm.tsx packages/frontend/src/auth/ForgotForm.tsx
git commit -m "feat(frontend): Mantine email-confirm and forgot-password forms

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: AuthScreen orchestrator

**Files:**
- Create: `packages/frontend/src/auth/AuthScreen.tsx`

- [ ] **Step 1: Create `packages/frontend/src/auth/AuthScreen.tsx`**

```tsx
import { useState } from "react";
import { Center, Paper, Stack, Title } from "@mantine/core";
import type { AuthMode } from "./types.js";
import SignInForm from "./SignInForm.js";
import SignUpForm from "./SignUpForm.js";
import ConfirmForm from "./ConfirmForm.js";
import ForgotForm from "./ForgotForm.js";

export default function AuthScreen() {
  const [mode, setMode] = useState<AuthMode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <Center mih="100vh">
      <Paper withBorder p="xl" w={360} radius="md">
        <Stack>
          <Title order={2} ta="center">
            Receipt Scanner
          </Title>
          {mode === "signIn" && (
            <SignInForm
              email={email}
              setEmail={setEmail}
              password={password}
              setPassword={setPassword}
              setMode={setMode}
            />
          )}
          {mode === "signUp" && (
            <SignUpForm
              email={email}
              setEmail={setEmail}
              password={password}
              setPassword={setPassword}
              setMode={setMode}
            />
          )}
          {mode === "confirm" && <ConfirmForm email={email} password={password} setMode={setMode} />}
          {mode === "forgot" && <ForgotForm email={email} setEmail={setEmail} setMode={setMode} />}
        </Stack>
      </Paper>
    </Center>
  );
}
```

- [ ] **Step 2: Build to verify**

Run: `pnpm --filter @receipt-scanner/frontend build`
Expected: succeeds, no type errors (all four form imports resolve).

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/auth/AuthScreen.tsx
git commit -m "feat(frontend): AuthScreen mode machine wiring the auth forms

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Auth gate + wire into main + remove @aws-amplify/ui-react

**Files:**
- Create: `packages/frontend/src/auth/useAuth.ts`
- Create: `packages/frontend/src/auth/AuthGate.tsx`
- Modify: `packages/frontend/src/main.tsx`
- Modify: `packages/frontend/package.json` (via `pnpm remove`)

- [ ] **Step 1: Create `packages/frontend/src/auth/useAuth.ts`**

```ts
import { useEffect, useState } from "react";
import { Hub } from "aws-amplify/utils";
import { getCurrentUser } from "aws-amplify/auth";

export type AuthStatus = "loading" | "signedIn" | "signedOut";

export function useAuth(): { status: AuthStatus } {
  const [status, setStatus] = useState<AuthStatus>("loading");

  useEffect(() => {
    let active = true;
    getCurrentUser()
      .then(() => {
        if (active) setStatus("signedIn");
      })
      .catch(() => {
        if (active) setStatus("signedOut");
      });

    const unsubscribe = Hub.listen("auth", ({ payload }) => {
      if (payload.event === "signedIn") setStatus("signedIn");
      else if (payload.event === "signedOut") setStatus("signedOut");
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return { status };
}
```

- [ ] **Step 2: Create `packages/frontend/src/auth/AuthGate.tsx`**

```tsx
import { Center, Loader } from "@mantine/core";
import { useAuth } from "./useAuth.js";
import App from "../App.js";
import AuthScreen from "./AuthScreen.js";

export default function AuthGate() {
  const { status } = useAuth();
  if (status === "loading") {
    return (
      <Center mih="100vh">
        <Loader />
      </Center>
    );
  }
  return status === "signedIn" ? <App /> : <AuthScreen />;
}
```

- [ ] **Step 3: Replace `packages/frontend/src/main.tsx`**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { Amplify } from "aws-amplify";
import { ColorSchemeScript, MantineProvider, createTheme } from "@mantine/core";
import "@mantine/core/styles.css";
import AuthGate from "./auth/AuthGate.js";

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: import.meta.env.VITE_USER_POOL_ID,
      userPoolClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID,
    },
  },
});

const theme = createTheme({ primaryColor: "teal" });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ColorSchemeScript defaultColorScheme="light" />
    <MantineProvider theme={theme} defaultColorScheme="light">
      <AuthGate />
    </MantineProvider>
  </React.StrictMode>,
);
```

(Removed the `Authenticator` import and the `@aws-amplify/ui-react/styles.css` import.)

- [ ] **Step 4: Remove the unused dependency**

Run: `pnpm --filter @receipt-scanner/frontend remove @aws-amplify/ui-react`
Expected: updates `packages/frontend/package.json` and `pnpm-lock.yaml`; `aws-amplify` stays.

- [ ] **Step 5: Confirm nothing else imports the removed package**

Run: `grep -rn "@aws-amplify/ui-react" packages/frontend/src || echo "no references"`
Expected: prints `no references`.

- [ ] **Step 6: Build the frontend and the whole workspace**

Run: `pnpm --filter @receipt-scanner/frontend build`
Expected: tsc + Vite succeed, no errors.

Run: `pnpm -r build && pnpm -r test`
Expected: all packages build; backend/infra tests still green (frontend-only change).

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/auth/useAuth.ts packages/frontend/src/auth/AuthGate.tsx packages/frontend/src/main.tsx packages/frontend/package.json pnpm-lock.yaml
git commit -m "feat(frontend): auth gate + custom Mantine auth, drop @aws-amplify/ui-react

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notes for the implementer

- **ESM imports** use `.js` extensions for local files (`./types.js`, `../App.js`); package imports (`@mantine/core`, `aws-amplify/auth`, `aws-amplify/utils`) do not.
- **Hub import path:** `Hub` comes from `aws-amplify/utils` in Amplify v6 (not the v5 top-level export).
- **Why each task builds:** the build script is `tsc -p tsconfig.json && vite build`; tsc type-checks every file under `src`, so the forms compile in Tasks 1–2 even before being imported. Wiring happens in Task 4.
- **No frontend unit tests** — the build is the gate. After deploy, run the manual checklist from the spec (sign up → emailed code → app; sign out; sign in; forgot-password).
- **Deploy:** pushing to `master` (touches `packages/frontend/**`) auto-runs deploy-frontend; or deploy manually. Auth is best validated on the live site against the real Cognito pool.
- **No backend/infra/Cognito change** — this is frontend-only; `Amplify.configure` and the pool are unchanged.
```
