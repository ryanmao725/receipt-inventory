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
