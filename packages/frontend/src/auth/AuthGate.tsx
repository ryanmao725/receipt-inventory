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
