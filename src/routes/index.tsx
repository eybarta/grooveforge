import { createFileRoute } from "@tanstack/react-router";
import { GrooveForge } from "@/components/groove-forge";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return <GrooveForge />;
}
