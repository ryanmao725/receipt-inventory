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
