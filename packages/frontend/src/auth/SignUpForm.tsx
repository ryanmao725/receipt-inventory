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
