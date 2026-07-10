import React, { Suspense, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, useGLTF, Environment, Float, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';

function Model({ url }) {
  const { scene } = useGLTF(url);
  
  useEffect(() => {
    scene.traverse((child) => {
      if (child.isMesh) {
        // Apply a realistic human-like skin tone
        child.material.color.set('#f1c27d');
        child.material.roughness = 0.45;
        child.material.metalness = 0.1;
        child.material.needsUpdate = true;
      }
    });
  }, [scene]);

  return (
    <primitive 
      object={scene} 
      scale={3.5} 
      position={[0, -2.5, 0]} 
      rotation={[0, 0, 0]}
    />
  );
}

export default function ModelViewer() {
  return (
    <div className="absolute inset-0 w-full h-full opacity-40 pointer-events-none">
      <Canvas camera={{ position: [0, 0, 7], fov: 45 }}>
        <ambientLight intensity={0.6} />
        <spotLight position={[10, 15, 10]} angle={0.3} penumbra={1} intensity={1.5} color="#ffe8d6" />
        <pointLight position={[-10, -10, -10]} intensity={0.5} color="#bde0fe" />
        
        <Suspense fallback={null}>
          <Float speed={1.2} rotationIntensity={0.2} floatIntensity={0.5}>
            <Model url="/respirator.glb" />
          </Float>
          <Environment preset="city" />
        </Suspense>
        
        <OrbitControls 
          enableZoom={false} 
          enablePan={false}
          autoRotate 
          autoRotateSpeed={0.8}
          minPolarAngle={Math.PI / 2.5}
          maxPolarAngle={Math.PI / 1.5}
        />
      </Canvas>
    </div>
  );
}

// Preload the model
useGLTF.preload('/respirator.glb');
