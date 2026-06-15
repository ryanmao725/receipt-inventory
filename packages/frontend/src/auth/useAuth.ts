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
