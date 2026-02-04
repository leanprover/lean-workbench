import { createRoot } from "react-dom/client";
import { ProjectsPage } from "./ProjectsPage.tsx";

declare global {
  interface Window {
    __DATA__: { username: string };
  }
}

const { username } = window.__DATA__;

createRoot(document.getElementById("root")!).render(<ProjectsPage username={username} />);
