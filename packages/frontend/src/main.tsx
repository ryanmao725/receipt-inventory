import React from "react";
import ReactDOM from "react-dom/client";
import { Amplify } from "aws-amplify";
import { ColorSchemeScript, MantineProvider } from "@mantine/core";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/fraunces/500.css";
import "@fontsource/fraunces/600.css";
import "@fontsource/fraunces/700.css";
import "@fontsource/space-mono/400.css";
import "@fontsource/space-mono/700.css";
import "@mantine/core/styles.css";
import "@mantine/dropzone/styles.css";
import "./theme.css";
import { theme } from "./theme.js";
import AuthGate from "./auth/AuthGate.js";

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: import.meta.env.VITE_USER_POOL_ID,
      userPoolClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ColorSchemeScript defaultColorScheme="light" />
    <MantineProvider theme={theme} defaultColorScheme="light">
      <AuthGate />
    </MantineProvider>
  </React.StrictMode>,
);
