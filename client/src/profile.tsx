import { createRoot } from "react-dom/client";
import { ProfilePage } from "./ProfilePage.tsx";

declare global {
  interface Window {
    __DATA__: { username: string };
  }
}

const { username } = window.__DATA__;

createRoot(document.getElementById("root")!).render(<ProfilePage username={username} />);
