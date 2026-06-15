# Custom Mantine Auth Screen Design (Plan B)

**Date:** 2026-06-15

## Goal

Replace Amplify's drop-in `<Authenticator>` UI with a custom Mantine-built authentication experience layered on the official `aws-amplify/auth` APIs, covering sign in, sign up, email-code confirmation, and forgot-password. Remove the now-unused `@aws-amplify/ui-react` dependency.

## Context

- The Cognito user pool is email/password with self-signup, email verification (code), and SRP auth. `Amplify.configure(...)` in `main.tsx` already sets the pool/client IDs from `VITE_*` env vars.
- Currently `main.tsx` renders `<MantineProvider><Authenticator>{() => <App/>}</Authenticator></MantineProvider>` and imports `@aws-amplify/ui-react` + its CSS. `App.tsx` has a Sign-out button calling `signOut()` from `aws-amplify/auth`.

## Architecture

### Auth gate
- **`src/auth/useAuth.ts`** — hook returning `{ status }` where `status: "loading" | "signedIn" | "signedOut"`.
  - On mount: `getCurrentUser()` → `signedIn` on success, `signedOut` on throw.
  - Subscribes to Amplify `Hub` `"auth"` channel; updates status on `"signedIn"` and `"signedOut"` payload events (emitted by `signIn`/`signOut`). Unsubscribes on unmount.
- **`src/auth/AuthGate.tsx`** — uses `useAuth()`:
  - `loading` → a centered `Loader` (Mantine `Center` full viewport height).
  - `signedIn` → `<App/>`.
  - `signedOut` → `<AuthScreen/>`.
  - Replaces `<Authenticator>` in `main.tsx`.

### Auth screen
- **`src/auth/AuthScreen.tsx`** — orchestrator holding:
  - `mode: "signIn" | "signUp" | "confirm" | "forgot"` (forgot covers request + confirm sub-steps within `ForgotForm`).
  - Shared `email` and `password` state (carried through sign-up → confirm → auto-sign-in).
  - Renders the active form inside a centered layout: `Center mih="100vh"` → `Paper withBorder p="xl" w={360}` → `Stack` with a `Title` ("Receipt Scanner").
- **Form components** (each in `src/auth/`), props include the shared state setters + a `setMode` callback:
  - **`SignInForm`** — `TextInput` (email), `PasswordInput`, submit → `signIn({ username: email, password })`. If the result's `nextStep.signInStep === "CONFIRM_SIGN_UP"`, call `setMode("confirm")`. `Anchor` links: "Create account" → signUp, "Forgot password?" → forgot.
  - **`SignUpForm`** — email + password, submit → `signUp({ username: email, password, options: { userAttributes: { email } } })` → `setMode("confirm")`. Link back to signIn.
  - **`ConfirmForm`** — a `TextInput` for the 6-digit code, submit → `confirmSignUp({ username: email, confirmationCode })`, then `signIn({ username: email, password })` (held password) to land the user in the app. A "Resend code" `Anchor` → `resendSignUpCode({ username: email })`. Link back to signIn.
  - **`ForgotForm`** — two internal steps: (1) email → `resetPassword({ username: email })` → step 2; (2) code + new password → `confirmResetPassword({ username: email, confirmationCode, newPassword })` → `setMode("signIn")` with a success note. Link back to signIn.

### Wiring
- **`main.tsx`**: remove `import { Authenticator } from "@aws-amplify/ui-react"` and `import "@aws-amplify/ui-react/styles.css"`. Render:
  ```tsx
  <MantineProvider theme={theme} defaultColorScheme="light">
    <AuthGate />
  </MantineProvider>
  ```
  (Keep `ColorSchemeScript`, `Amplify.configure`, and the teal theme.)
- **`App.tsx`**: unchanged. Its `signOut()` emits the Hub `"signedOut"` event that flips the gate back to the auth screen.
- **`package.json`**: remove `@aws-amplify/ui-react` from dependencies (`pnpm remove`). Keep `aws-amplify`.

## Data flow

`main.tsx` → `AuthGate` (`useAuth`) → signed out renders `AuthScreen` → user completes a flow → Amplify emits Hub `"signedIn"` → `useAuth` flips to `signedIn` → `AuthGate` renders `App`. Sign out in `App` → `signOut()` → Hub `"signedOut"` → back to `AuthScreen`.

## Error handling

- Every form wraps its Amplify call in try/catch, holds a local `error` string, and renders it in a Mantine `Alert color="red"` when set. The submit `Button` shows `loading` and is disabled during the async call.
- Sign-in of an unconfirmed account routes to the confirm step (via `nextStep`) rather than erroring.
- Amplify error messages (e.g., wrong code, user exists, weak password) are surfaced verbatim via `err instanceof Error ? err.message : "..."`.

## Security notes

- All flows use the official `aws-amplify/auth` functions; no credentials are stored beyond the in-memory `email`/`password` state needed to chain confirm → auto-sign-in (cleared when the component unmounts on successful sign-in). Tokens are managed by Amplify, not custom code.
- The gate relies on `getCurrentUser()`/Hub, not on any client-trusted flag.

## Testing

- The frontend has no unit-test harness; the verification gate per task is a clean `pnpm --filter @receipt-scanner/frontend build` (TypeScript type-check + Vite build).
- **Manual verification checklist (post-deploy, on the live site):**
  1. Sign up with a new email + password → receive the emailed code → enter it → land in the app.
  2. Sign out → returns to the sign-in screen.
  3. Sign in with the same credentials → enters the app.
  4. Forgot password → request code → reset with new password → sign in with the new password.
  5. Wrong password / wrong code → an `Alert` shows the error, no crash.

## Out of scope (YAGNI)

- Social / federated login (email-password only, per earlier decision).
- "Remember me", MFA, or custom password-strength UI (Cognito enforces its policy; surface its errors).
- Frontend test harness (build remains the gate, consistent with the rest of the frontend).
- Any backend, infra, or Cognito configuration change.
