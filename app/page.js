'use client'
import Image from "next/image";
import React from "react";
import dynamic from "next/dynamic";

const VoronoiDiagram = dynamic(() => import("./components/game/VoronoiDiagram"), {
  ssr: false,
});

export default function Home() {
  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "flex-start", minHeight: "100vh", width: "100vw", overflow: "auto", padding: 16 }}>
      <VoronoiDiagram numPoints={1000} />
    </div>
  );
}
