import { useEffect, useState } from "react";
import { Dashboard } from "@/components/Dashboard";
import { LocalAuth } from "@/components/LocalAuth";
import { isLocalAuthenticated } from "@/lib/localAuth";

const Index = () => {
  const [isAuth, setIsAuth] = useState(isLocalAuthenticated());

  useEffect(() => {
    const onAuthChange = () => setIsAuth(isLocalAuthenticated());
    window.addEventListener("local-auth-changed", onAuthChange);
    return () => window.removeEventListener("local-auth-changed", onAuthChange);
  }, []);

  return isAuth ? <Dashboard /> : <LocalAuth />;
};

export default Index;
