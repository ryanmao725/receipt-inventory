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
