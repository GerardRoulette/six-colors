'use client'
import Image from "next/image";
import React from "react";
import dynamic from "next/dynamic";

const VoronoiDiagram = dynamic(() => import("./components/game/VoronoiDiagram"), {
  ssr: false,
});

export default function Home() {
  return (
    <div style={{ height: "100dvh", width: "100%", overflow: "hidden" }}>
      <VoronoiDiagram numPoints={1000} />
    </div>
  );
}
