import { Navigate } from "react-router-dom";

// The real app lives entirely under /design-preview — this route exists only because it's the
// site root that a bookmark or a fresh visit lands on.
const Index = () => <Navigate to="/design-preview" replace />;

export default Index;
