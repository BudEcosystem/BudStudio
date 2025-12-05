"use client";

import { useEffect, useRef } from "react";

const DESIRED_CELL_COUNT = 13;

interface GameOfLifeBackgroundProps {
  className?: string;
}

const GameOfLifeBackground = ({ className = "" }: GameOfLifeBackgroundProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gridRef = useRef<number[][]>([]);

  useEffect(() => {
    const GENERATION_INTERVAL = 1000;
    const FRAME_RATE = 75;
    const MAX_OPACITY = 0.2;

    const CELL_SIZE =
      Math.min(window.innerWidth, window.innerHeight) / DESIRED_CELL_COUNT;
    const GRID_WIDTH = Math.ceil(window.innerWidth / CELL_SIZE);
    const GRID_HEIGHT = Math.ceil(window.innerHeight / CELL_SIZE);
    const CANVAS_WIDTH = window.innerWidth;
    const CANVAS_HEIGHT = window.innerHeight;
    const DEAD_COLOR = "#0d0d0d";

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;

    // Initialize random grid
    const initialGrid: number[][] = [];
    const opacityGrid: number[][] = [];

    for (let y = 0; y < GRID_HEIGHT; y++) {
      const gridRow: number[] = [];
      const opacityRow: number[] = [];
      for (let x = 0; x < GRID_WIDTH; x++) {
        gridRow.push(Math.random() > 0.8 ? 1 : 0);
        opacityRow.push(MAX_OPACITY);
      }
      initialGrid.push(gridRow);
      opacityGrid.push(opacityRow);
    }

    gridRef.current = initialGrid;

    let lastGenerationTime = Date.now();
    let animationId: ReturnType<typeof setTimeout>;

    const draw = () => {
      const grid = gridRef.current;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw cells
      for (let y = 0; y < GRID_HEIGHT; y++) {
        for (let x = 0; x < GRID_WIDTH; x++) {
          const gridRow = grid[y];
          const opacityRow = opacityGrid[y];
          if (!gridRow || !opacityRow) continue;

          const cellValue = gridRow[x];
          const cellOpacity = opacityRow[x];
          if (cellValue === undefined || cellOpacity === undefined) continue;

          // Update opacity with transition
          if (cellValue) {
            if (cellOpacity < MAX_OPACITY) {
              opacityRow[x] = Math.min(MAX_OPACITY, cellOpacity + 0.1);
            }
          } else {
            if (cellOpacity > 0) {
              opacityRow[x] = Math.max(0, cellOpacity - 0.1);
            }
          }

          const currentOpacity = opacityRow[x] ?? 0;
          if (currentOpacity > 0) {
            const gradient = ctx.createLinearGradient(
              x * CELL_SIZE,
              y * CELL_SIZE,
              x * CELL_SIZE,
              (y + 1) * CELL_SIZE
            );
            gradient.addColorStop(0, `rgba(255, 255, 255, ${currentOpacity})`);
            gradient.addColorStop(1, `rgba(0, 0, 0, ${currentOpacity})`);
            ctx.fillStyle = gradient;
            ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
          } else {
            ctx.fillStyle = DEAD_COLOR;
            ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
          }
        }
      }

      // Draw grid lines
      ctx.strokeStyle = "#333333";
      ctx.lineWidth = 1;

      for (let x = 0; x <= GRID_WIDTH; x++) {
        ctx.beginPath();
        ctx.moveTo(x * CELL_SIZE, 0);
        ctx.lineTo(x * CELL_SIZE, CANVAS_HEIGHT);
        ctx.stroke();
      }

      for (let y = 0; y <= GRID_HEIGHT; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y * CELL_SIZE);
        ctx.lineTo(CANVAS_WIDTH, y * CELL_SIZE);
        ctx.stroke();
      }
    };

    const countAliveNeighbors = (x: number, y: number): number => {
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = (x + dx + GRID_WIDTH) % GRID_WIDTH;
          const ny = (y + dy + GRID_HEIGHT) % GRID_HEIGHT;
          const row = gridRef.current[ny];
          if (row) {
            count += row[nx] ?? 0;
          }
        }
      }
      return count;
    };

    const nextGeneration = () => {
      const currentGrid = gridRef.current;
      const newGrid: number[][] = currentGrid.map((arr) => [...arr]);

      for (let y = 0; y < GRID_HEIGHT; y++) {
        for (let x = 0; x < GRID_WIDTH; x++) {
          const neighbors = countAliveNeighbors(x, y);
          const currentRow = currentGrid[y];
          const newRow = newGrid[y];
          if (!currentRow || !newRow) continue;

          const alive = currentRow[x] ?? 0;
          if (alive && (neighbors < 2 || neighbors > 3)) {
            newRow[x] = 0;
          } else if (!alive && neighbors === 3) {
            newRow[x] = 1;
          }
        }
      }
      gridRef.current = newGrid;
    };

    const animate = () => {
      draw();

      const currentTime = Date.now();
      if (currentTime - lastGenerationTime >= GENERATION_INTERVAL) {
        nextGeneration();
        lastGenerationTime = currentTime;
      }

      animationId = setTimeout(() => requestAnimationFrame(animate), FRAME_RATE);
    };

    animate();

    return () => {
      clearTimeout(animationId);
    };
  }, []);

  return (
    <div className={`absolute top-0 left-0 w-full h-full overflow-hidden ${className}`}>
      <div className="absolute z-10 top-0 left-0 w-full h-full bg-black opacity-50 gol-bg"></div>
      <canvas
        ref={canvasRef}
        className="absolute top-0 left-0 w-full h-full"
        style={{
          backgroundColor: "#202020",
          opacity: 0.5,
        }}
      />
    </div>
  );
};

export default GameOfLifeBackground;
