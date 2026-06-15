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
