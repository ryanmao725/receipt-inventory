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
