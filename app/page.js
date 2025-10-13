'use client'
import Image from "next/image";
import React from "react";
import dynamic from "next/dynamic";

const VoronoiDiagram = dynamic(() => import("./components/VoronoiDiagram"), {
  ssr: false,
});

export default function Home() {
  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "800px", width: "800px" }}>
      <VoronoiDiagram numPoints={1000} />
    </div>
  );
}
